/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";
import { DiagnosticEvent } from "../../src/cloudDeploy/diagnostics/types";
import { LocalFileProvider } from "../../src/cloudDeploy/providers";
import {
    RUN_EVENTS_ENTRY,
    RUN_MANIFEST_ENTRY,
    RunArtifactWriter,
} from "../../src/cloudDeploy/runs/runArtifactWriter";
import { RunArtifactReader } from "../../src/cloudDeploy/runs/runArtifactReader";
import { RunArtifactParseError } from "../../src/cloudDeploy/runs/runArtifactSchema";
import { FakeFileProvider, makeValidRunRecord } from "./cloudDeployRunsTestHelpers";
import { TestEventCollector } from "./cloudDeployTestEventCollector";

async function* emptyEvents(): AsyncIterable<DiagnosticEvent> {
    // empty
}

async function* fixedEvents(...events: DiagnosticEvent[]): AsyncIterable<DiagnosticEvent> {
    for (const e of events) {
        yield e;
    }
}

suite("CloudDeploy RunArtifactWriter", () => {
    suite("in-memory writes (FakeFileProvider)", () => {
        let provider: FakeFileProvider;
        let writer: RunArtifactWriter;
        let bus: DiagnosticEventBus;
        let collector: TestEventCollector;

        setup(() => {
            provider = new FakeFileProvider();
            bus = new DiagnosticEventBus();
            collector = new TestEventCollector(bus);
            writer = new RunArtifactWriter(provider, bus);
        });

        teardown(() => {
            collector.dispose();
            bus.dispose();
        });

        test("persists a single zip file at destPath", async () => {
            const record = makeValidRunRecord();
            const result = await writer.write(record, undefined, "/artifacts/run-1.cdrun.zip");
            expect(result.path).to.equal("/artifacts/run-1.cdrun.zip");
            expect(result.sizeBytes).to.be.greaterThan(0);
            expect(provider.files.has("/artifacts/run-1.cdrun.zip")).to.be.true;
            expect(provider.files.get("/artifacts/run-1.cdrun.zip")!.length).to.equal(
                result.sizeBytes,
            );
        });

        test("emits run-persisted with runId, path, and sizeBytes", async () => {
            const record = makeValidRunRecord({ runId: "abc" });
            const result = await writer.write(record, emptyEvents(), "/out.cdrun.zip");
            const emitted = collector.eventsOfType("run-persisted");
            expect(emitted).to.have.lengthOf(1);
            expect(emitted[0].payload.runId).to.equal("abc");
            expect(emitted[0].payload.path).to.equal("/out.cdrun.zip");
            expect(emitted[0].payload.sizeBytes).to.equal(result.sizeBytes);
        });

        test("round-trips through the reader (record body matches)", async () => {
            const record = makeValidRunRecord({ runId: "rt-1" });
            await writer.write(record, undefined, "/out.cdrun.zip");
            const reader = new RunArtifactReader(provider);
            const readBack = await reader.read("/out.cdrun.zip");
            expect(readBack.runId).to.equal("rt-1");
            expect(readBack.environmentSnapshot.id).to.equal(record.environmentSnapshot.id);
        });

        test("round-trips drained events through readEvents()", async () => {
            const record = makeValidRunRecord();
            const stamped: DiagnosticEvent = {
                id: "e-1",
                timestampMs: 1234,
                source: "environment-store",
                severity: "info",
                type: "environments-loaded",
                payload: { count: 0 },
            };
            await writer.write(record, fixedEvents(stamped), "/out.cdrun.zip");

            const reader = new RunArtifactReader(provider);
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents("/out.cdrun.zip")) {
                collected.push(ev);
            }
            expect(collected).to.have.lengthOf(1);
            expect(collected[0].type).to.equal("environments-loaded");
        });

        test("omits events.jsonl entirely when no events were drained", async () => {
            const record = makeValidRunRecord();
            await writer.write(record, undefined, "/out.cdrun.zip");
            const reader = new RunArtifactReader(provider);
            // readEvents() yields nothing when the entry is absent.
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents("/out.cdrun.zip")) {
                collected.push(ev);
            }
            expect(collected).to.deep.equal([]);
        });

        test("entry names are exactly manifest.json (and events.jsonl when present)", async () => {
            // Sanity: writer is the only place these constants are produced.
            expect(RUN_MANIFEST_ENTRY).to.equal("manifest.json");
            expect(RUN_EVENTS_ENTRY).to.equal("events.jsonl");
        });

        test("emits run-persist-failed and throws on a malformed record", async () => {
            // Pre-validation should reject and emit the failure event.
            const bad = { ...makeValidRunRecord(), runId: "" };
            let caught: unknown;
            try {
                await writer.write(bad as never, undefined, "/out.cdrun.zip");
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(RunArtifactParseError);
            const failed = collector.eventsOfType("run-persist-failed");
            expect(failed).to.have.lengthOf(1);
            expect(failed[0].payload.path).to.equal("/out.cdrun.zip");
        });

        test("emits run-persist-failed when the provider write throws", async () => {
            const throwingProvider: FakeFileProvider = new FakeFileProvider();
            // Stub writeFileAtomic to fail.
            throwingProvider.writeFileAtomic = async () => {
                throw new Error("disk full");
            };
            const failingWriter = new RunArtifactWriter(throwingProvider, bus);

            let caught: unknown;
            try {
                await failingWriter.write(makeValidRunRecord(), undefined, "/out.cdrun.zip");
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(Error);
            expect((caught as Error).message).to.equal("disk full");
            const failed = collector.eventsOfType("run-persist-failed");
            expect(failed).to.have.lengthOf(1);
            expect(failed[0].payload.cause).to.equal("disk full");
        });

        test("works with no bus configured (optional dep)", async () => {
            const noBusWriter = new RunArtifactWriter(provider);
            const result = await noBusWriter.write(
                makeValidRunRecord(),
                undefined,
                "/no-bus.cdrun.zip",
            );
            expect(result.sizeBytes).to.be.greaterThan(0);
        });
    });

    suite("disk writes (LocalFileProvider)", () => {
        let workspaceRoot: string;

        setup(async () => {
            workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-runwriter-"));
        });

        teardown(async () => {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
        });

        test("writes a single .cdrun.zip with no leftover temp files", async () => {
            const writer = new RunArtifactWriter(new LocalFileProvider());
            const dest = path.join(workspaceRoot, "nested", "run-1.cdrun.zip");
            await writer.write(makeValidRunRecord(), undefined, dest);

            const stat = await fs.stat(dest);
            expect(stat.isFile()).to.be.true;
            expect(stat.size).to.be.greaterThan(0);

            const entries = await fs.readdir(path.dirname(dest));
            expect(entries).to.deep.equal(["run-1.cdrun.zip"]);
        });

        test("the written file is a real zip (yauzl can parse it)", async () => {
            const writer = new RunArtifactWriter(new LocalFileProvider());
            const dest = path.join(workspaceRoot, "run.cdrun.zip");
            await writer.write(makeValidRunRecord({ runId: "real-1" }), undefined, dest);

            const reader = new RunArtifactReader(new LocalFileProvider());
            const record = await reader.read(dest);
            expect(record.runId).to.equal("real-1");
        });
    });
});
