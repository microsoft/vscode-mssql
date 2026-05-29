/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as yazl from "yazl";

import { DiagnosticEvent } from "../../src/cloudDeploy/diagnostics/types";
import { RunArtifactReader } from "../../src/cloudDeploy/runs/runArtifactReader";
import {
    RUN_EVENTS_ENTRY,
    RUN_MANIFEST_ENTRY,
    RunArtifactWriter,
} from "../../src/cloudDeploy/runs/runArtifactWriter";
import { RunArtifactParseError } from "../../src/cloudDeploy/runs/runArtifactSchema";
import { RUN_RECORD_SCHEMA_VERSION } from "../../src/cloudDeploy/runs/types";
import { FakeFileProvider, makeValidRunRecord } from "./cloudDeployRunsTestHelpers";

const ARTIFACT_PATH = "/artifacts/run.cdrun.zip";

/** Build a zip in memory and seed it into a FakeFileProvider at `ARTIFACT_PATH`. */
async function seedZip(
    provider: FakeFileProvider,
    entries: Array<{ name: string; data: Buffer }>,
): Promise<void> {
    const zip = new yazl.ZipFile();
    for (const e of entries) {
        zip.addBuffer(e.data, e.name);
    }
    zip.end();
    const buf = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        zip.outputStream
            .on("data", (c: Buffer) => chunks.push(c))
            .on("end", () => resolve(Buffer.concat(chunks)))
            .on("error", reject);
    });
    provider.files.set(ARTIFACT_PATH, buf);
}

async function readErr<T>(p: Promise<T>): Promise<RunArtifactParseError> {
    try {
        await p;
    } catch (err) {
        if (err instanceof RunArtifactParseError) {
            return err;
        }
        throw err;
    }
    throw new Error("Expected RunArtifactParseError but no error was thrown.");
}

suite("CloudDeploy RunArtifactReader", () => {
    let provider: FakeFileProvider;
    let reader: RunArtifactReader;

    setup(() => {
        provider = new FakeFileProvider();
        reader = new RunArtifactReader(provider);
    });

    suite("read() — happy path", () => {
        test("reads a writer-produced artifact end-to-end", async () => {
            const writer = new RunArtifactWriter(provider);
            const record = makeValidRunRecord({ runId: "happy-1" });
            await writer.write(record, undefined, ARTIFACT_PATH);

            const back = await reader.read(ARTIFACT_PATH);
            expect(back.runId).to.equal("happy-1");
            expect(back.environmentSnapshot.id).to.equal(record.environmentSnapshot.id);
        });

        test("preserves passthrough fields in the manifest", async () => {
            const record = { ...makeValidRunRecord(), futureField: "v2" };
            const manifest = Buffer.from(JSON.stringify(record));
            await seedZip(provider, [{ name: RUN_MANIFEST_ENTRY, data: manifest }]);

            const back = await reader.read(ARTIFACT_PATH);
            expect((back as unknown as { futureField: string }).futureField).to.equal("v2");
        });
    });

    suite("read() — failure modes (kind exhaustive)", () => {
        test("kind=io when the file does not exist", async () => {
            const err = await readErr(reader.read("/missing.cdrun.zip"));
            expect(err.kind).to.equal("io");
            expect(err.filePath).to.equal("/missing.cdrun.zip");
        });

        test("kind=malformed-zip when the bytes are not a zip", async () => {
            provider.files.set(ARTIFACT_PATH, Buffer.from("not a zip"));
            const err = await readErr(reader.read(ARTIFACT_PATH));
            expect(err.kind).to.equal("malformed-zip");
        });

        test("kind=missing-entry when manifest.json is absent", async () => {
            await seedZip(provider, [{ name: RUN_EVENTS_ENTRY, data: Buffer.from("{}\n") }]);
            const err = await readErr(reader.read(ARTIFACT_PATH));
            expect(err.kind).to.equal("missing-entry");
        });

        test("kind=schema-validation when manifest.json is invalid JSON", async () => {
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from("{ not json") },
            ]);
            const err = await readErr(reader.read(ARTIFACT_PATH));
            expect(err.kind).to.equal("schema-validation");
        });

        test("kind=unknown-schema-version when schemaVersion is forward", async () => {
            const record = { ...makeValidRunRecord(), schemaVersion: 99 };
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
            ]);
            const err = await readErr(reader.read(ARTIFACT_PATH));
            expect(err.kind).to.equal("unknown-schema-version");
            expect(err.schemaVersion).to.equal(99);
        });

        test("kind=schema-validation populates issues[] with jq paths", async () => {
            const record = { ...makeValidRunRecord(), runId: "" };
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
            ]);
            const err = await readErr(reader.read(ARTIFACT_PATH));
            expect(err.kind).to.equal("schema-validation");
            expect(err.issues).to.exist;
            expect(err.issues!.some((i) => i.path === "$.runId")).to.be.true;
        });

        test("sanity: RUN_RECORD_SCHEMA_VERSION is 1 (gate for forward-version test)", () => {
            expect(RUN_RECORD_SCHEMA_VERSION).to.equal(1);
        });
    });

    suite("readEvents()", () => {
        test("yields nothing when events.jsonl is absent", async () => {
            const record = makeValidRunRecord();
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
            ]);
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents(ARTIFACT_PATH)) {
                collected.push(ev);
            }
            expect(collected).to.deep.equal([]);
        });

        test("yields one event per NDJSON line", async () => {
            const record = makeValidRunRecord();
            const events = [
                {
                    id: "e-1",
                    timestampMs: 1,
                    source: "environment-store",
                    severity: "info",
                    type: "environments-loaded",
                    payload: { count: 0 },
                },
                {
                    id: "e-2",
                    timestampMs: 2,
                    source: "run-store",
                    severity: "info",
                    type: "run-persisted",
                    payload: { runId: "r", path: "/p", sizeBytes: 1 },
                },
            ];
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
                {
                    name: RUN_EVENTS_ENTRY,
                    data: Buffer.from(events.map((e) => JSON.stringify(e)).join("\n") + "\n"),
                },
            ]);
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents(ARTIFACT_PATH)) {
                collected.push(ev);
            }
            expect(collected.map((e) => e.type)).to.deep.equal([
                "environments-loaded",
                "run-persisted",
            ]);
        });

        test("skips malformed lines silently (events are advisory)", async () => {
            const record = makeValidRunRecord();
            const goodLine = JSON.stringify({
                id: "ok",
                timestampMs: 1,
                source: "environment-store",
                severity: "info",
                type: "environments-loaded",
                payload: { count: 0 },
            });
            const events = `${goodLine}\n{not json\n${goodLine}\n`;
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
                { name: RUN_EVENTS_ENTRY, data: Buffer.from(events) },
            ]);
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents(ARTIFACT_PATH)) {
                collected.push(ev);
            }
            expect(collected).to.have.lengthOf(2);
        });

        test("skips non-object event lines (best-effort shape check)", async () => {
            const record = makeValidRunRecord();
            const events = `"a string"\n123\nnull\n`;
            await seedZip(provider, [
                { name: RUN_MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(record)) },
                { name: RUN_EVENTS_ENTRY, data: Buffer.from(events) },
            ]);
            const collected: DiagnosticEvent[] = [];
            for await (const ev of reader.readEvents(ARTIFACT_PATH)) {
                collected.push(ev);
            }
            expect(collected).to.deep.equal([]);
        });

        test("rewraps I/O failures as kind=io", async () => {
            const err = await readErr(
                (async () => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    for await (const _ev of reader.readEvents("/missing.cdrun.zip")) {
                        // unreachable
                    }
                })(),
            );
            expect(err.kind).to.equal("io");
        });
    });
});
