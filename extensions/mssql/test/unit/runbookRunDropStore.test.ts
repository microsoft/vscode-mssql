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
        drops.createRun({
            runId: "run_keep",
            runbookId: "book_1",
            planRevision: "1",
            planHash: "hash",
            startedEpochMs: 43,
        });
        const candidatePath = drops.artifactPath(
            "run_delete",
            "extract-release-candidate",
            "candidate.dacpac",
        );
        const manifestPath = drops.artifactPath(
            "run_delete",
            "create-release-manifest",
            "release-manifest.json",
        );
        const retainedPath = drops.artifactPath(
            "run_keep",
            "create-release-manifest",
            "release-manifest.json",
        );
        fs.writeFileSync(candidatePath, "candidate");
        fs.writeFileSync(manifestPath, "manifest");
        fs.writeFileSync(retainedPath, "retained");
        fs.mkdirSync(path.join(legacyRoot, "run_delete"), { recursive: true });
        fs.mkdirSync(path.join(legacyRoot, "run_keep"), { recursive: true });

        expect(drops.deleteRun("run_delete")).to.equal(true);
        expect(fs.existsSync(path.join(dropRoot, "run_delete"))).to.equal(false);
        expect(fs.existsSync(path.join(legacyRoot, "run_delete"))).to.equal(false);
        expect(fs.existsSync(candidatePath)).to.equal(false);
        expect(fs.existsSync(manifestPath)).to.equal(false);
        expect(fs.readFileSync(retainedPath, "utf8")).to.equal("retained");
        expect(fs.existsSync(path.join(legacyRoot, "run_keep"))).to.equal(true);
    });

    test("cleans atomic-write remnants only for explicitly sealed runs", () => {
        const dropRoot = path.join(root, "drops");
        const drops = new RunbookRunDropStore(dropRoot);
        for (const runId of ["run_interrupted", "run_active"]) {
            drops.createRun({
                runId,
                runbookId: "book_1",
                planRevision: "1",
                planHash: "hash",
                startedEpochMs: 42,
            });
        }
        const interruptedManifestTemp = path.join(dropRoot, "run_interrupted", "manifest.json.tmp");
        const interruptedArtifactTemp = `${drops.artifactPath(
            "run_interrupted",
            "create-release-manifest",
            "release-manifest.json",
        )}.tmp`;
        const retainedArtifact = drops.artifactPath(
            "run_interrupted",
            "extract-release-candidate",
            "candidate.dacpac",
        );
        const activeArtifactTemp = `${drops.artifactPath(
            "run_active",
            "create-release-manifest",
            "release-manifest.json",
        )}.tmp`;
        fs.writeFileSync(interruptedManifestTemp, "partial manifest");
        fs.writeFileSync(interruptedArtifactTemp, "partial artifact");
        fs.writeFileSync(retainedArtifact, "candidate");
        fs.writeFileSync(activeArtifactTemp, "active write");

        expect(drops.cleanupTemporaryFiles(["run_interrupted", "run_interrupted"])).to.equal(2);
        expect(fs.existsSync(interruptedManifestTemp)).to.equal(false);
        expect(fs.existsSync(interruptedArtifactTemp)).to.equal(false);
        expect(fs.readFileSync(retainedArtifact, "utf8")).to.equal("candidate");
        expect(fs.readFileSync(activeArtifactTemp, "utf8")).to.equal("active write");
    });
});
