/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RunbookRunDropStore } from "../../src/runbookStudio/runbookRunDropStore";

suite("RunbookRunDropStore", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-run-drop-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("creates a safe manifest and organizes artifacts by run", () => {
        const drops = new RunbookRunDropStore(path.join(root, "drops"));
        const directory = drops.createRun({
            runId: "run_1",
            runbookId: "book_1",
            planRevision: "3",
            planHash: "hash",
            startedEpochMs: 42,
        });
        const artifact = drops.artifactPath("run_1", "extract/source", "WWI.dacpac");
        fs.writeFileSync(artifact, "dacpac");
        drops.markTerminal("run_1", "succeeded", 84);

        expect(artifact).to.equal(path.join(directory, "artifacts", "extract_source-WWI.dacpac"));
        expect(
            JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")),
        ).to.deep.include({
            schemaVersion: 1,
            runId: "run_1",
            runbookId: "book_1",
            state: "succeeded",
            endedEpochMs: 84,
        });
        expect(drops.pathForOpen("run_1")).to.equal(directory);
        expect(drops.listPersistedRunIds()).to.deep.equal(["run_1"]);
    });

    test("deletes current and legacy files only for the selected run", () => {
        const dropRoot = path.join(root, "drops");
        const legacyRoot = path.join(root, "managed-artifacts");
        const drops = new RunbookRunDropStore(dropRoot, legacyRoot);
        drops.createRun({
            runId: "run_delete",
            runbookId: "book_1",
            planRevision: "1",
            planHash: "hash",
            startedEpochMs: 42,
        });
        fs.mkdirSync(path.join(legacyRoot, "run_delete"), { recursive: true });
        fs.mkdirSync(path.join(legacyRoot, "run_keep"), { recursive: true });

        expect(drops.deleteRun("run_delete")).to.equal(true);
        expect(fs.existsSync(path.join(dropRoot, "run_delete"))).to.equal(false);
        expect(fs.existsSync(path.join(legacyRoot, "run_delete"))).to.equal(false);
        expect(fs.existsSync(path.join(legacyRoot, "run_keep"))).to.equal(true);
    });
});
