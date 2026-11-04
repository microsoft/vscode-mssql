/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-2: ITdsDriver port semantics against the deterministic fake driver.
 * Pins the contract the tedious adapter must also satisfy: driverSeq order,
 * completed-after-all-events, bounded pause overrun, cancel/sever/one-lease
 * behavior, and virtual-clock determinism (no wall-clock coupling).
 */

import { expect } from "chai";
import {
    ITdsConnection,
    TdsCompletion,
    TdsConnectionObserver,
    TdsErrorCategory,
    TdsOpenRequest,
    TdsQueryEvent,
    TdsServerMessage,
} from "../../../src/services/tsNative/driver/tdsDriver";
import {
    FakeTdsDriver,
    FakeTdsConnection,
    FakeTdsDriverOptions,
    VirtualClock,
} from "../../../src/services/tsNative/driver/fakeTdsDriver";

const OPEN: TdsOpenRequest = {
    server: "fake",
    applicationName: "tsq2-tests",
    encrypt: true,
    trustServerCertificate: true,
    connectTimeoutMs: 15000,
    auth: { kind: "sqlLogin", user: "sa", password: "" },
};

class RecordingConnObserver implements TdsConnectionObserver {
    lost: TdsErrorCategory[] = [];
    databases: string[] = [];
    orphanMessages: TdsServerMessage[] = [];
    onLost(reason: TdsErrorCategory): void {
        this.lost.push(reason);
    }
    onDatabaseChanged(database: string): void {
        this.databases.push(database);
    }
    onOrphanMessage(message: TdsServerMessage): void {
        this.orphanMessages.push(message);
    }
}

class RecordingQueryObserver {
    events: TdsQueryEvent[] = [];
    onEvent(event: TdsQueryEvent): void {
        this.events.push(event);
    }
}

const CTX = { operationId: "op-test" };

async function openFake(options: FakeTdsDriverOptions): Promise<{
    clock: VirtualClock;
    connection: ITdsConnection;
    connObserver: RecordingConnObserver;
}> {
    const clock = new VirtualClock();
    const driver = new FakeTdsDriver(clock, options);
    const connObserver = new RecordingConnObserver();
    const open = driver.open(OPEN, connObserver, CTX);
    await clock.flush();
    return { clock, connection: await open, connObserver };
}

const TWO_SETS: FakeTdsDriverOptions = {
    queries: [
        {
            match: "SELECT 2 SETS",
            steps: [
                { step: "metadata", columns: [{ name: "a", typeName: "int" }] },
                { step: "row", cells: [{ value: 1 }] },
                { step: "row", cells: [{ value: 2 }] },
                { step: "done", token: "done", rowCount: 2, more: true },
                {
                    step: "message",
                    message: { number: 0, severity: 0, message: "hi", isError: false },
                },
                { step: "metadata", columns: [{ name: "b", typeName: "varchar" }] },
                { step: "row", cells: [{ value: "x" }] },
                { step: "done", token: "done", rowCount: 1, more: false },
            ],
        },
    ],
};

suite("ts-native fake TDS driver (TSQ2-2 port semantics)", () => {
    test("scripted stream: driverSeq order, completed after all events", async () => {
        const { clock, connection } = await openFake(TWO_SETS);
        const observer = new RecordingQueryObserver();
        let completion: TdsCompletion | undefined;
        const lease = connection.execute({ batchText: "SELECT 2 SETS" }, observer, CTX);
        void lease.completed.then((c) => (completion = c));
        await lease.accepted;
        await clock.advance(50);

        expect(completion?.ok).to.equal(true);
        const kinds = observer.events.map((e) => e.kind);
        expect(kinds).to.deep.equal([
            "metadata",
            "row",
            "row",
            "done",
            "message",
            "metadata",
            "row",
            "done",
        ]);
        const seqs = observer.events.map((e) => e.driverSeq);
        expect(seqs).to.deep.equal([...seqs].sort((a, b) => a - b));
        // completed resolved only after the final event was observed
        expect(observer.events.length).to.equal(8);
    });

    test("pause bounds row delivery to the overrun budget; resume continues", async () => {
        const { clock, connection } = await openFake({
            pauseOverrunRows: 1,
            queries: [
                {
                    match: "BIG",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "rows", count: 100, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 100, more: false },
                    ],
                },
            ],
        });
        const observer = new RecordingQueryObserver();
        const lease = connection.execute({ batchText: "BIG" }, observer, CTX);
        // Rows advance one per virtual tick: deliver a few, then pause.
        await clock.advance(3);
        lease.pause("sinkBackpressure");
        const rowsAtPause = observer.events.filter((e) => e.kind === "row").length;
        expect(rowsAtPause).to.be.greaterThan(0).and.lessThan(100);
        await clock.advance(100);
        const rowsWhilePaused = observer.events.filter((e) => e.kind === "row").length;
        expect(rowsWhilePaused - rowsAtPause).to.be.at.most(1, "bounded overrun");

        lease.resume("sinkBackpressure");
        await clock.advance(500);
        expect(observer.events.filter((e) => e.kind === "row").length).to.equal(100);
        expect((await lease.completed).ok).to.equal(true);
    });

    test("cancel mid-stream: cancel completion, no events after terminal", async () => {
        const { clock, connection } = await openFake({
            queries: [
                {
                    match: "LONG",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "rows", count: 10, make: (i) => [{ value: i }] },
                        { step: "delay", ms: 1000 },
                        { step: "rows", count: 10, make: (i) => [{ value: i }] },
                        { step: "done", token: "done", rowCount: 20, more: false },
                    ],
                },
            ],
        });
        const observer = new RecordingQueryObserver();
        const lease = connection.execute({ batchText: "LONG" }, observer, CTX);
        await clock.advance(5); // genuinely mid-stream: a few rows delivered
        expect(observer.events.filter((e) => e.kind === "row").length).to.be.greaterThan(0);
        await lease.cancel("user");
        await clock.advance(2000);
        const completion = await lease.completed;
        expect(completion.ok).to.equal(false);
        expect(completion.error?.category).to.equal("cancel");
        const countAtTerminal = observer.events.length;
        await clock.advance(1000);
        expect(observer.events.length).to.equal(countAtTerminal, "no events after terminal");
    });

    test("sever: active lease completes once with network error; onLost fires once", async () => {
        const { clock, connection, connObserver } = await openFake({
            queries: [
                {
                    match: "SEVER",
                    steps: [
                        { step: "metadata", columns: [{ name: "n", typeName: "int" }] },
                        { step: "row", cells: [{ value: 1 }] },
                        { step: "sever" },
                    ],
                },
            ],
        });
        const observer = new RecordingQueryObserver();
        const lease = connection.execute({ batchText: "SEVER" }, observer, CTX);
        await clock.advance(50);
        const completion = await lease.completed;
        expect(completion.ok).to.equal(false);
        expect(completion.error?.category).to.equal("network");
        expect(connection.state).to.equal("lost");
        expect(connObserver.lost).to.deep.equal(["network"]);
        // Listener accounting: nothing left installed after loss.
        expect((connection as FakeTdsConnection).installedListeners).to.equal(0);
    });

    test("open failures map to stable categories; hang stays pending for caller deadline", async () => {
        const clock = new VirtualClock();
        const driver = new FakeTdsDriver(clock, {
            opens: [{ outcome: "authFail" }, { outcome: "timeout" }, { outcome: "hang" }],
        });
        const observer = new RecordingConnObserver();

        let authCategory: string | undefined;
        try {
            await driver.open(OPEN, observer, CTX);
        } catch (error) {
            authCategory = (error as { category?: string }).category;
        }
        expect(authCategory).to.equal("auth");

        let timeoutCategory: string | undefined;
        try {
            await driver.open(OPEN, observer, CTX);
        } catch (error) {
            timeoutCategory = (error as { category?: string }).category;
        }
        expect(timeoutCategory).to.equal("timeout");

        let settled = false;
        void driver.open(OPEN, observer, CTX).then(
            () => (settled = true),
            () => (settled = true),
        );
        await clock.advance(60_000);
        expect(settled).to.equal(false, "hang outcome never settles; domain deadline owns it");
    });

    test("second execute while active is rejected typed (engine enforces Busy above)", async () => {
        const { clock, connection } = await openFake({
            queries: [
                {
                    match: "HANG",
                    steps: [{ step: "hangUntilCancel" }],
                },
            ],
        });
        const first = connection.execute({ batchText: "HANG" }, new RecordingQueryObserver(), CTX);
        await clock.flush();
        const second = connection.execute({ batchText: "HANG" }, new RecordingQueryObserver(), CTX);
        let acceptError: unknown;
        await second.accepted.catch((error) => (acceptError = error));
        expect((acceptError as { category?: string })?.category).to.equal("internal");
        const completion = await second.completed;
        expect(completion.ok).to.equal(false);
        await first.cancel("dispose");
        await clock.advance(10);
    });

    test("out-of-band database change reaches the connection observer", async () => {
        const { connection, connObserver } = await openFake({});
        (connection as FakeTdsConnection).signalDatabaseChanged("tempdb");
        expect(connObserver.databases).to.deep.equal(["tempdb"]);
    });

    test("virtual clock: delays are virtual and timers are reclaimed", async () => {
        const { clock, connection } = await openFake({
            queries: [
                {
                    match: "DELAY",
                    steps: [
                        { step: "delay", ms: 5000 },
                        { step: "done", token: "done", rowCount: 0, more: false },
                    ],
                },
            ],
        });
        const lease = connection.execute({ batchText: "DELAY" }, new RecordingQueryObserver(), CTX);
        let done = false;
        void lease.completed.then(() => (done = true));
        await clock.flush();
        expect(done).to.equal(false);
        await clock.advance(4999);
        expect(done).to.equal(false);
        await clock.advance(1);
        expect(done).to.equal(true);
        expect(clock.pendingTimerCount()).to.equal(0, "no leaked virtual timers");
    });
});
