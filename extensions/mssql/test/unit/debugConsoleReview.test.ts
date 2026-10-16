/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DirectoryHistoryProvider } from "../../src/diagnostics/perfHistory/directoryProvider";
import { PerfHistoryService } from "../../src/diagnostics/perfHistory/perfHistoryService";
import { mergeBackfill } from "../../src/diagnostics/liveArchive";
import { DiagEvent } from "../../src/sharedInterfaces/diagnostics";
import { stubExtensionContext } from "./utils";

suite("Debug Console review regressions", () => {
    let root: string;
    let sandbox: sinon.SinonSandbox;
    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-review-"));
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("scenario details reject traversal and linked directories", () => {
        const provider = new DirectoryHistoryProvider("test", root);
        expect(() =>
            provider.scenarioDetails({ sourceId: "test", runId: "../outside", scenarioId: "s" }),
        ).to.throw("escapes");
        const target = path.join(root, "external");
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(root, "linked-run"), "junction");
        expect(() =>
            provider.scenarioDetails({ sourceId: "test", runId: "linked-run", scenarioId: "s" }),
        ).to.throw("symbolic links");
        expect(() => provider.repDir("linked-run", "s", 0)).to.throw("symbolic links");
    });

    test("result dumps refuse malformed and oversized raw content", async () => {
        const provider = new DirectoryHistoryProvider("test", root);
        const service = new PerfHistoryService(stubExtensionContext(sandbox), () => {});
        sandbox.stub(service, "ensureIndexed").resolves(provider);
        const rep = provider.repDir("run", "scenario", 0);
        fs.mkdirSync(rep, { recursive: true });
        const query = {
            sourceId: "test",
            runId: "run",
            scenarioId: "scenario",
            repId: 0,
            file: "result" as const,
        };
        for (const content of [
            '{"machineId":"secret-canary",',
            JSON.stringify({ machineId: "secret-canary", padding: "x".repeat(600000) }),
        ]) {
            fs.writeFileSync(path.join(rep, "result.json"), content);
            const result = await service.dump(query);
            expect(result.text).not.to.include("secret-canary");
            expect(result.text).to.include("cannot be safely redacted");
        }
    });

    test("backfill keeps recovered events queryable and respects the archive bound", () => {
        const event = (seq: number) => ({ seq }) as DiagEvent;
        const archive = [5, 6, 7, 8].map(event);
        const recovered = [1, 2, 5].map(event);
        expect(mergeBackfill(archive, recovered, 5).map((e) => e.seq)).to.deep.equal([
            1, 2, 5, 7, 8,
        ]);
        expect(mergeBackfill(archive, recovered, 2).map((e) => e.seq)).to.deep.equal([2, 5]);
    });
});
