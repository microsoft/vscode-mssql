/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { LocalFileProvider } from "../../src/cloudDeploy/providers";
import {
    LocalRunsDirectoryReader,
    RunArtifactReader,
    RunArtifactWriter,
    RunStatus,
    RunStore,
    RunsDirectoryReader,
} from "../../src/cloudDeploy/runs";
import {
    FakeFileProvider,
    makeEnvironment,
    makeValidRunRecord,
} from "./cloudDeployRunsTestHelpers";

class FakeDirectoryReader implements RunsDirectoryReader {
    public paths: string[] = [];
    public async list(): Promise<readonly string[]> {
        return this.paths.slice();
    }
}

suite("CloudDeploy RunStore", () => {
    let provider: FakeFileProvider;
    let writer: RunArtifactWriter;
    let reader: RunArtifactReader;
    let dirReader: FakeDirectoryReader;
    let store: RunStore;

    setup(() => {
        provider = new FakeFileProvider();
        writer = new RunArtifactWriter(provider);
        reader = new RunArtifactReader(provider);
        dirReader = new FakeDirectoryReader();
        store = new RunStore(dirReader, reader);
    });

    teardown(() => {
        store.dispose();
    });

    async function seedRun(
        artifactPath: string,
        envId: string,
        envName: string,
        startedAtMs: number,
        status: RunStatus = RunStatus.Passed,
    ): Promise<string> {
        const env = makeEnvironment({ id: envId, name: envName });
        const record = makeValidRunRecord({
            runId: `${envId}-run-${startedAtMs}`,
            environmentId: envId,
            environmentSnapshot: env,
            startedAtMs,
            endedAtMs: startedAtMs + 1_000,
            status,
        });
        await writer.write(record, undefined, artifactPath);
        dirReader.paths.push(artifactPath);
        return record.runId;
    }

    suite("list (empty / pre-scan)", () => {
        test("returns an empty array when the cache is empty", () => {
            expect(store.list()).to.deep.equal([]);
        });

        test("returns an empty array filtered by an env that has no runs", () => {
            expect(store.list("env-x")).to.deep.equal([]);
        });
    });

    suite("scan", () => {
        test("populates the cache from the directory reader", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await seedRun("/runs/b.cdrun.zip", "ci", "CI", 2_000);
            await store.scan();
            expect(store.list().length).to.equal(2);
        });

        test("returns an empty list when the directory reader yields nothing", async () => {
            await store.scan();
            expect(store.list()).to.deep.equal([]);
        });

        test("skips corrupt artifacts silently", async () => {
            await seedRun("/runs/good.cdrun.zip", "dev", "Dev", 1_000);
            // Plant a non-zip file at a path the directory reader returns.
            provider.files.set("/runs/corrupt.cdrun.zip", Buffer.from("not a zip"));
            dirReader.paths.push("/runs/corrupt.cdrun.zip");
            await store.scan();
            expect(store.list().length).to.equal(1);
            expect(store.list()[0].envId).to.equal("dev");
        });

        test("fires onDidChange after a successful scan", async () => {
            let fired = 0;
            store.onDidChange(() => {
                fired++;
            });
            await store.scan();
            expect(fired).to.equal(1);
        });

        test("deduplicates concurrent calls — both promises resolve to the same in-flight scan", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            const p1 = store.scan();
            const p2 = store.scan();
            await Promise.all([p1, p2]);
            // Both completed; cache populated exactly once.
            expect(store.list().length).to.equal(1);
        });

        test("subsequent scans replace the cache with the current directory contents", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await store.scan();
            expect(store.list().length).to.equal(1);
            // Remove the artifact path from the directory listing.
            dirReader.paths = [];
            await store.scan();
            expect(store.list()).to.deep.equal([]);
        });
    });

    suite("list (after scan)", () => {
        test("sorts runs descending by startedAtMs", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await seedRun("/runs/b.cdrun.zip", "dev", "Dev", 3_000);
            await seedRun("/runs/c.cdrun.zip", "dev", "Dev", 2_000);
            await store.scan();
            const ids = store.list().map((r) => r.runId);
            expect(ids[0]).to.contain("3000");
            expect(ids[1]).to.contain("2000");
            expect(ids[2]).to.contain("1000");
        });

        test("filters by envId", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await seedRun("/runs/b.cdrun.zip", "ci", "CI", 2_000);
            await seedRun("/runs/c.cdrun.zip", "dev", "Dev", 3_000);
            await store.scan();
            const dev = store.list("dev");
            expect(dev.length).to.equal(2);
            expect(dev.every((r) => r.envId === "dev")).to.be.true;
        });

        test("populates envDisplayName from the environment snapshot", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Local Dev", 1_000);
            await store.scan();
            expect(store.list()[0].envDisplayName).to.equal("Local Dev");
        });
    });

    suite("latest", () => {
        test("returns the most recent full RunRecord for the env", async () => {
            await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await seedRun("/runs/b.cdrun.zip", "dev", "Dev", 5_000);
            await store.scan();
            const latest = await store.latest("dev");
            expect(latest).to.exist;
            expect(latest!.startedAtMs).to.equal(5_000);
        });

        test("returns undefined for an env with no cached runs", async () => {
            await store.scan();
            expect(await store.latest("nope")).to.be.undefined;
        });
    });

    suite("get", () => {
        test("returns the full RunRecord by id", async () => {
            const runId = await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await store.scan();
            const record = await store.get(runId);
            expect(record).to.exist;
            expect(record!.runId).to.equal(runId);
        });

        test("returns undefined for an unknown id", async () => {
            await store.scan();
            expect(await store.get("nonexistent")).to.be.undefined;
        });

        test("returns undefined when the artifact has become unreadable since scan", async () => {
            const runId = await seedRun("/runs/a.cdrun.zip", "dev", "Dev", 1_000);
            await store.scan();
            // Corrupt the bytes after caching the listing.
            provider.files.set("/runs/a.cdrun.zip", Buffer.from("garbage"));
            expect(await store.get(runId)).to.be.undefined;
        });
    });
});

suite("CloudDeploy LocalRunsDirectoryReader", () => {
    let root: string;

    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-runstore-"));
    });

    teardown(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    test("returns an empty list when the runs directory does not exist", async () => {
        const reader = new LocalRunsDirectoryReader(path.join(root, "missing"));
        expect(await reader.list()).to.deep.equal([]);
    });

    test("returns absolute paths of *.cdrun.zip files only", async () => {
        await fs.writeFile(path.join(root, "a.cdrun.zip"), "x");
        await fs.writeFile(path.join(root, "b.cdrun.zip"), "x");
        await fs.writeFile(path.join(root, "ignore.txt"), "x");
        await fs.writeFile(path.join(root, "ignore.zip"), "x");
        const reader = new LocalRunsDirectoryReader(root);
        const list = await reader.list();
        expect(list.length).to.equal(2);
        expect(list.every((p) => p.endsWith(".cdrun.zip"))).to.be.true;
        expect(list.every((p) => path.isAbsolute(p))).to.be.true;
    });

    test("works against a writer-produced artifact (round-trip)", async () => {
        const provider = new LocalFileProvider();
        const writer = new RunArtifactWriter(provider);
        const reader = new RunArtifactReader(provider);
        const dirReader = new LocalRunsDirectoryReader(root);
        const store = new RunStore(dirReader, reader);
        try {
            const record = makeValidRunRecord({
                runId: "round-trip-1",
                environmentId: "dev",
                environmentSnapshot: makeEnvironment({ id: "dev", name: "Dev" }),
            });
            await writer.write(record, undefined, path.join(root, "round-trip.cdrun.zip"));
            await store.scan();
            expect(store.list().length).to.equal(1);
            const got = await store.get("round-trip-1");
            expect(got).to.exist;
            expect(got!.runId).to.equal("round-trip-1");
        } finally {
            store.dispose();
        }
    });
});
