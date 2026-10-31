/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    DataPlaneErrorCodes,
    IQueryEventSink,
    RowsPage,
} from "../../../src/services/sqlDataPlane/api";
import {
    FakeTdsDriver,
    FakeTdsDriverOptions,
    FakeTdsStep,
    VirtualClock,
} from "../../../src/services/tsNative/driver/fakeTdsDriver";
import {
    TsNativeBackend,
    TsNativeBackendDeps,
} from "../../../src/services/tsNative/tsNativeBackend";
import { BoundedEventLane } from "../../../src/services/tsNative/boundedEventLane";
import { TdsCompletion, TdsQueryObserver } from "../../../src/services/tsNative/driver/tdsDriver";
import { encodeCell, EncodePolicy } from "../../../src/services/tsNative/cellEncoder";
import {
    parseTsNativeOverrides,
    hasMeasurementTaintingOverrides,
} from "../../../src/services/tsNative/overrides";
import { transcodeSpatial } from "../../../src/services/tsNative/spatialTranscoder";
import { cellDisplayText } from "../../../src/sharedInterfaces/queryStudioGridOps";

const PROFILE = {
    profileFingerprint: "review",
    server: "fakehost",
    authKind: "sql" as const,
    user: "sa",
};
const POLICY: EncodePolicy = {
    maxCellBytes: 65536,
    truncatedPrefixBytes: 65536,
    spatialWkb: true,
    vectorBinary: false,
    lossyPreview: false,
};
const sink = (): IQueryEventSink => ({
    onResultSetStarted: () => undefined,
    onRowsPage: () => undefined,
    onMessage: () => undefined,
    onComplete: () => undefined,
});

suite("ts-native review regressions", () => {
    const sandbox = sinon.createSandbox();
    const owned: Array<{ backend: TsNativeBackend; clock: VirtualClock }> = [];
    teardown(async () => {
        for (const { backend, clock } of owned.splice(0)) {
            const disposed = backend.dispose();
            await clock.advance(100000);
            await disposed;
        }
        sandbox.restore();
    });
    function harness(options: FakeTdsDriverOptions = {}, deps: Partial<TsNativeBackendDeps> = {}) {
        const clock = new VirtualClock();
        const driver = new FakeTdsDriver(clock, options);
        let n = 0;
        const backend = new TsNativeBackend({
            clock,
            driver,
            ids: { next: (p) => `${p}-${++n}` },
            ...deps,
        });
        owned.push({ backend, clock });
        const params = {
            profile: PROFILE,
            applicationName: "review-tests",
            auth: { passwordProvider: async () => "test-secret" },
        };
        const open = async () => {
            const pending = backend.openSession(params);
            await clock.flush();
            return pending;
        };
        return { clock, driver, backend, params, open };
    }

    test("disposal rejects a late physical open and leaves no published session", async () => {
        const h = harness({ opens: [{ outcome: "ok", delayMs: 100 }] });
        const pending = h.backend.openSession(h.params).catch((error) => error);
        await h.clock.advance(1);
        await h.backend.dispose();
        await h.clock.advance(100);
        expect((await pending).code).to.equal(DataPlaneErrorCodes.unavailable);
        expect(h.driver.connections[0].state).to.equal("lost");
        expect(h.backend.snapshot().sessions).to.deep.equal([]);
        const rejected = await h.backend.openSession(h.params).catch((error) => error);
        expect(rejected.code).to.equal(DataPlaneErrorCodes.unavailable);
        expect(h.driver.connections).to.have.length(1);
    });

    test("disposal during credentials never starts a physical open", async () => {
        const h = harness();
        const credential = Promise.withResolvers<string>();
        const pending = h.backend
            .openSession({ ...h.params, auth: { passwordProvider: () => credential.promise } })
            .catch((error) => error);
        await h.clock.flush();
        await h.backend.dispose();
        credential.resolve("test-secret");
        expect((await pending).code).to.equal(DataPlaneErrorCodes.unavailable);
        expect(h.driver.connections).to.have.length(0);
    });

    for (const [encrypt, expected] of [
        ["Optional", false],
        [" optional ", false],
        ["Mandatory", true],
        [false, false],
    ] as const) {
        test(`maps saved encryption ${encrypt}`, async () => {
            const h = harness();
            await h.backend.openSession({ ...h.params, profile: { ...PROFILE, encrypt } });
            expect(h.driver.connections[0].openRequest.encrypt).to.equal(expected);
        });
    }
    for (const profile of [
        { ...PROFILE, encrypt: "Strict" },
        { ...PROFILE, server: "np:server" },
        { ...PROFILE, server: "(localdb)\\MSSQLLocalDB" },
    ]) {
        test(`rejects unsupported transport before credentials: ${"encrypt" in profile ? profile.encrypt : profile.server}`, async () => {
            const h = harness();
            const passwordProvider = sandbox.stub().resolves("test-secret");
            const failure = await h.backend
                .openSession({ ...h.params, profile, auth: { passwordProvider } })
                .catch((error) => error);
            expect(failure.code).to.equal(DataPlaneErrorCodes.capabilityUnsupported);
            expect(passwordProvider).not.to.have.been.called;
            expect(h.driver.connections).to.be.empty;
        });
    }
    for (const server of [
        "tcp:localhost,1433",
        "TCP:.,1433",
        "(local),1433",
        "localhost\\SQLEXPRESS,1433",
        "tcp:.\\SQLEXPRESS,1433",
    ]) {
        test(`normalizes saved endpoint ${server}`, async () => {
            const h = harness();
            await h.backend.openSession({ ...h.params, profile: { ...PROFILE, server } });
            expect(h.driver.connections[0].openRequest).to.include({
                server: "localhost",
                port: 1433,
            });
            expect(h.driver.connections[0].openRequest.instanceName).to.equal(undefined);
        });
    }
    test("open errors preserve useful details and redact the supplied secret", async () => {
        const h = harness();
        sandbox.stub(h.driver, "open").rejects(new Error("self-signed certificate; test-secret"));
        const failure = await h.backend.openSession(h.params).catch((error) => error);
        expect(failure.message).to.include("self-signed certificate");
        expect(failure.message).not.to.include("test-secret");
    });

    test("a throwing subscriber cannot interrupt connection-loss cleanup", async () => {
        const h = harness({ queries: [{ match: "wait", steps: [{ step: "hangUntilCancel" }] }] });
        const session = await h.open();
        session.onDidChangeState(() => {
            throw new Error("subscriber failure");
        });
        const remaining = sandbox.spy();
        session.onDidChangeState(remaining);
        const handle = session.execute("wait", {}, sink());
        await h.clock.flush();
        expect(() => h.driver.connections[0].destroy("test loss")).not.to.throw();
        await h.clock.flush();
        expect((await handle.completion).status).to.equal("connectionLost");
        expect(remaining.calledOnce).to.equal(true);
        expect(h.backend.snapshot().sessions).to.deep.equal([]);
    });

    test("close deadline includes an unresponsive query cancellation", async () => {
        const h = harness({ queries: [{ match: "wait", steps: [{ step: "hangUntilCancel" }] }] });
        const session = await h.open();
        const execute = sandbox.spy(h.driver.connections[0], "execute");
        const handle = session.execute("wait", {}, sink());
        await h.clock.flush();
        sandbox.stub(execute.firstCall.returnValue, "cancel").returns(new Promise(() => undefined));
        let closed = false;
        const closing = session.close({ timeoutMs: 100 }).then(() => {
            closed = true;
        });
        await h.clock.advance(99);
        expect(closed).to.equal(false);
        await h.clock.advance(1);
        await closing;
        expect(session.state).to.equal("closed");
        expect((await handle.completion).status).to.equal("connectionLost");
        expect(h.backend.snapshot().sessions).to.deep.equal([]);
    });

    test("retained Unicode prefixes are charged in UTF-8 bytes", () => {
        const encoded = encodeCell(
            { value: "漢".repeat(3000) },
            { name: "text", typeName: "nvarchar" },
            { ...POLICY, maxCellBytes: 4096 },
        );
        const prefix = (encoded.value as { v: string }).v;
        expect(Buffer.byteLength(prefix, "utf8")).to.equal(4095);
        expect(encoded.approxBytes).to.equal(4095 + 96);
    });

    test("large nested spatial collections preserve serialized child order", () => {
        const count = 2000;
        const clr = Buffer.alloc(27 + count * 39);
        clr[4] = 1;
        clr[5] = 4;
        clr.writeUInt32LE(count, 6);
        let offset = 10;
        for (let i = 0; i < count; i++) {
            clr.writeDoubleLE(i, offset);
            clr.writeDoubleLE(i + 0.5, offset + 8);
            offset += 16;
        }
        clr.writeUInt32LE(count, offset);
        offset += 4;
        for (let i = 0; i < count; i++) {
            clr[offset] = 1;
            clr.writeInt32LE(i, offset + 1);
            offset += 5;
        }
        clr.writeUInt32LE(1 + count * 2, offset);
        offset += 4;
        const shape = (parent: number, figure: number, type: number) => {
            clr.writeInt32LE(parent, offset);
            clr.writeInt32LE(figure, offset + 4);
            clr[offset + 8] = type;
            offset += 9;
        };
        shape(-1, 0, 7);
        for (let i = 0; i < count; i++) {
            shape(0, i, 4);
            shape(1 + i * 2, i, 1);
        }
        const result = transcodeSpatial(clr, "geometry");
        expect(result.status).to.equal("ok");
        if (result.status !== "ok") return;
        expect(result.wkb.length).to.equal(9 + count * 30);
        expect(result.wkb.readUInt32LE(5)).to.equal(count);
        for (let i = 0; i < count; i++) {
            expect(result.wkb.readDoubleLE(9 + i * 30 + 14)).to.equal(i);
            expect(result.wkb.readDoubleLE(9 + i * 30 + 22)).to.equal(i + 0.5);
        }
    });

    test("open probes publish the initial database, edition, version, login and SPID", async () => {
        const h = harness(
            {
                queries: [
                    {
                        match: (text) => text.includes("SERVERPROPERTY"),
                        steps: [
                            {
                                step: "metadata",
                                columns: Array.from({ length: 5 }, () => ({
                                    name: "fact",
                                    typeName: "int",
                                })),
                            },
                            {
                                step: "row",
                                cells: [5, "17.0.1", "initialdb", "testlogin", 123].map(
                                    (value) => ({ value }),
                                ),
                            },
                            { step: "done", token: "done", rowCount: 1, more: false },
                        ],
                    },
                ],
            },
            { probeOnOpen: true },
        );
        const session = await h.open();
        expect(session.info).to.include({
            engineEditionId: 5,
            serverVersion: "17.0.1",
            database: "initialdb",
            loginName: "testlogin",
            spid: 123,
        });
    });
    test("a hung facts probe shares the open deadline and destroys its connection", async () => {
        const h = harness(
            { queries: [{ match: () => true, steps: [{ step: "hangUntilCancel" }] }] },
            { probeOnOpen: true, deadlines: { openMs: 25 } },
        );
        const pending = h.backend.openSession(h.params).catch((error) => error);
        await h.clock.advance(30);
        expect((await pending).code).to.equal(DataPlaneErrorCodes.clientTimeout);
        expect(h.driver.connections[0].state).to.equal("lost");
        expect(h.backend.snapshot().sessions).to.deep.equal([]);
    });

    test("completion waits for the last page, set end and onComplete", async () => {
        const h = harness({
            queries: [
                {
                    match: "ROWS",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "row", cells: [{ value: 1 }] },
                        { step: "done", token: "done", rowCount: 1, more: false },
                    ],
                },
            ],
        });
        const session = await h.open();
        const release = Promise.withResolvers<void>();
        const order: string[] = [];
        const events = sink();
        events.onRowsPage = async () => {
            await release.promise;
            order.push("page");
        };
        events.onResultSetEnded = () => {
            order.push("end");
        };
        events.onComplete = () => {
            order.push("onComplete");
        };
        const handle = session.execute("ROWS", {}, events);
        const completed = handle.completion.then(() => order.push("completion"));
        await h.clock.flush();
        expect(order).to.deep.equal([]);
        expect(() => session.execute("ROWS", {}, sink())).to.throw("already active");
        release.resolve();
        await h.clock.flush();
        await completed;
        expect(order).to.deep.equal(["page", "end", "onComplete", "completion"]);
    });

    test("hundreds of empty result sets remain bounded and drain before completion", async () => {
        const steps: FakeTdsStep[] = [];
        for (let i = 0; i < 500; i++)
            steps.push(
                { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                { step: "done", token: "done", rowCount: 0, more: i < 499 },
            );
        const h = harness({ queries: [{ match: "EMPTY", steps }] });
        const session = await h.open();
        let starts = 0;
        const events = sink();
        events.onResultSetStarted = async () => {
            await new Promise<void>((resolve) => h.clock.setTimeout(resolve, 2));
            starts++;
        };
        const handle = session.execute("EMPTY", {}, events);
        await h.clock.advance(2000);
        expect((await handle.completion).status).to.equal("succeeded");
        expect(starts).to.equal(500);
    });

    test("lane byte budget includes the active callback and fails oversized delivery", async () => {
        const clock = new VirtualClock();
        const failure = sandbox.spy();
        const lane = new BoundedEventLane(
            clock,
            { maxItems: 4, maxBytes: 100, sinkCallbackDeadlineMs: 10 },
            failure,
        );
        lane.enqueue({ label: "first", bytes: 70, run: () => new Promise(() => undefined) });
        expect(lane.hasCapacity(31)).to.equal(false);
        lane.enqueue({ label: "oversized", bytes: 101, run: () => undefined });
        expect(failure.firstCall.args[0].kind).to.equal("resourceLimit");
        expect(lane.snapshot().highWaterBytes).to.equal(70);
        await clock.advance(11);
    });

    test("oversized row pages cross the byte watermark without losing rows", async () => {
        const h = harness({
            queries: [
                {
                    match: "LARGE",
                    steps: [
                        {
                            step: "metadata",
                            columns: [0, 1, 2].map((n) => ({ name: `s${n}`, typeName: "varchar" })),
                        },
                        {
                            step: "rows",
                            count: 12,
                            make: () => [0, 1, 2].map(() => ({ value: "x".repeat(900_000) })),
                        },
                        { step: "done", token: "done", rowCount: 12, more: false },
                    ],
                },
            ],
        });
        const session = await h.open();
        const events = sink();
        let rows = 0;
        events.onRowsPage = async (page) => {
            await new Promise<void>((resolve) => h.clock.setTimeout(resolve, 200));
            rows += page.rowCount;
            expect(page.compact.values[0][0]).to.equal("x".repeat(900_000));
        };
        const handle = session.execute(
            "LARGE",
            { pageBytes: 16_384, maxCellBytes: 1_048_576 },
            events,
        );
        await h.clock.advance(10_000);
        expect((await handle.completion).status).to.equal("succeeded");
        expect(rows).to.equal(12);
    });

    for (const drains of [true, false]) {
        test(`sink failure retains Busy until the driver ${drains ? "drains" : "is forcibly closed"}`, async () => {
            const h = harness(
                {
                    queries: [
                        {
                            match: "NEXT",
                            steps: [{ step: "done", token: "done", rowCount: 0, more: false }],
                        },
                    ],
                },
                { deadlines: { completeAfterCancelMs: 100 } },
            );
            const session = await h.open();
            const completed = Promise.withResolvers<TdsCompletion>();
            let observer!: TdsQueryObserver;
            const execute = sandbox
                .stub(h.driver.connections[0], "execute")
                .callsFake((_request, events) => {
                    observer = events;
                    return {
                        generation: 1,
                        accepted: Promise.resolve(),
                        completed: completed.promise,
                        pause: () => undefined,
                        resume: () => undefined,
                        cancel: async () => ({ delivered: true }),
                    };
                });
            const events = sink();
            events.onRowsPage = () => {
                throw new Error("sink failed");
            };
            const handle = session.execute("FAIL", { pageRows: 1 }, events);
            observer.onEvent({
                kind: "metadata",
                driverSeq: 1,
                columns: [{ name: "n", typeName: "int" }],
            });
            observer.onEvent({ kind: "row", driverSeq: 2, cells: [{ value: 1 }] });
            await h.clock.flush();
            expect((await handle.completion).error?.code).to.equal(DataPlaneErrorCodes.sinkError);
            expect(() => session.execute("NEXT", {}, sink()))
                .to.throw()
                .with.property("code", DataPlaneErrorCodes.busy);
            execute.restore();
            if (drains) {
                completed.resolve({
                    ok: false,
                    error: { category: "cancel", message: "cancelled" },
                });
                await h.clock.flush();
                const next = session.execute("NEXT", {}, sink());
                await h.clock.flush();
                expect((await next.completion).status).to.equal("succeeded");
            } else {
                await h.clock.advance(101);
                expect(h.driver.connections[0].state).to.equal("lost");
                expect(() => session.execute("NEXT", {}, sink()))
                    .to.throw()
                    .with.property("code", DataPlaneErrorCodes.unavailable);
            }
        });
    }

    test("lower-only overrides cap caller page/cell tuning and preserve tighter callers", async () => {
        const h = harness(
            {
                queries: [
                    {
                        match: "ROWS",
                        steps: [
                            { step: "metadata", columns: [{ name: "s", typeName: "nvarchar" }] },
                            { step: "rows", count: 20, make: () => [{ value: "x".repeat(200) }] },
                            { step: "done", token: "done", rowCount: 20, more: false },
                        ],
                    },
                ],
            },
            { defaultExecuteOptions: { pageRows: 10, maxCellBytes: 100 } },
        );
        const session = await h.open();
        for (const [pageRows, expectedPages] of [
            [500, 2],
            [5, 4],
        ]) {
            const pages: RowsPage[] = [];
            const events = sink();
            events.onRowsPage = (page) => {
                pages.push(page);
            };
            const handle = session.execute("ROWS", { pageRows, maxCellBytes: 65536 }, events);
            await h.clock.advance(100);
            expect((await handle.completion).status).to.equal("succeeded");
            expect(pages).to.have.length(expectedPages);
            expect(pages[0].compact.values[0][0]).to.include({
                $t: "truncated",
                bytes: 200,
                v: "x".repeat(100),
            });
        }
    });

    test("unimplemented live fault keys are ignored, not reported as active", () => {
        const keys = [
            "delayEveryPageMs",
            "dropAfterPages",
            "malformedEventAt",
            "memoryPressureAfterBytes",
            "sinkDelayMs",
            "delayEveryRows",
        ];
        const parsed = parseTsNativeOverrides({
            faults: Object.fromEntries(keys.map((key) => [key, 1])),
        });
        expect(parsed.ignoredKeys).to.have.members(keys.map((key) => `faults.${key}`));
        expect(parsed.faults).to.equal(undefined);
        expect(hasMeasurementTaintingOverrides(parsed)).to.equal(false);
    });

    test("exact cells remain usable while values with lost precision are visibly unavailable", () => {
        for (const typeName of ["decimal", "money"]) {
            expect(
                encodeCell(
                    { value: 12.34 },
                    { name: "n", typeName, precision: 38, scale: 2 },
                    POLICY,
                ).value,
            ).to.deep.equal({ $t: "decimal", v: "12.34" });
            const unavailable = encodeCell(
                { value: 12345678901234568 },
                { name: "n", typeName, scale: 2 },
                POLICY,
            ).value;
            expect(unavailable).to.have.property("$t", "provider");
            expect(cellDisplayText(unavailable)).to.include("unavailable");
        }
        expect(
            encodeCell({ value: 12.34 }, { name: "v", typeName: "sql_variant" }, POLICY).value,
        ).to.have.property("$t", "provider");
    });

    test("temporal wrappers and real display match the shared grid conventions", () => {
        const date = new Date("2025-01-02T03:04:05.123Z");
        const encoded = encodeCell(
            { value: date },
            { name: "d", typeName: "datetime" },
            POLICY,
        ).value;
        expect(cellDisplayText(encoded)).to.equal("2025-01-02 03:04:05.123");
        const seconds = encodeCell(
            { value: date },
            { name: "d", typeName: "datetime2", scale: 0 },
            POLICY,
        ).value;
        expect(cellDisplayText(seconds)).to.equal("2025-01-02 03:04:05");
        for (const value of [0.1, 3.3])
            expect(
                encodeCell({ value: Math.fround(value) }, { name: "r", typeName: "real" }, POLICY)
                    .value,
            ).to.equal(value);
        expect(
            encodeCell({ value: date }, { name: "d", typeName: "datetimeoffset" }, POLICY).value,
        ).to.have.property("$t", "provider");
    });

    test("empty CLR shapes match SQL Server's WKB convention", () => {
        for (const [shape, wkbType] of [
            [1, 4],
            [2, 2],
            [3, 3],
        ]) {
            const clr = Buffer.alloc(27);
            clr[4] = 1;
            clr[5] = 4;
            clr.writeUInt32LE(1, 14);
            clr.writeInt32LE(-1, 18);
            clr.writeInt32LE(-1, 22);
            clr[26] = shape;
            const result = transcodeSpatial(clr, "geometry");
            expect(result.status).to.equal("ok");
            if (result.status === "ok")
                expect(result.wkb.toString("hex")).to.equal(
                    `01${wkbType.toString(16).padStart(2, "0")}00000000000000`,
                );
        }
    });
    test("typed spatial respects the per-query byte cap without truncating WKB", () => {
        const raw = Buffer.from("e6100000010c000000000000f03f0000000000000040", "hex");
        const value = encodeCell(
            { value: raw },
            { name: "shape", typeName: "udt", udtName: "geometry" },
            { ...POLICY, maxCellBytes: 20 },
        ).value;
        expect(value).to.include({ $t: "spatial", status: "unrenderable", reason: "maxCellBytes" });
        expect(value).not.to.have.property("wkb");
    });
});
