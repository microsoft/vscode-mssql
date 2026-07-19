/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    cleanupStaleLocalDacpacArtifacts,
    disposeStagedLocalDacpacArtifact,
    LocalDacpacStageError,
    stageLocalDacpacArtifact,
    type StagedLocalDacpacArtifact,
    verifyStagedLocalDacpacArtifact,
} from "../../src/runbookStudio/runtime/localDacpacStaging";

suite("Runbook Studio local DACPAC staging", () => {
    let root: string;
    let sourcePath: string;
    let stagingRoot: string;
    let stages: StagedLocalDacpacArtifact[];

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-dacpac-stage-"));
        sourcePath = path.join(root, "source.dacpac");
        stagingRoot = path.join(root, "staging");
        stages = [];
        fs.writeFileSync(sourcePath, "approved dacpac bytes");
    });

    teardown(async () => {
        for (const stage of stages) {
            await disposeStagedLocalDacpacArtifact(stage);
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("stages beneath the approved content digest and verifies the private copy", async () => {
        const digest = sha256(fs.readFileSync(sourcePath));
        const stage = await stageLocalDacpacArtifact(stagingRoot, sourcePath, digest, () => false);
        stages.push(stage);

        expect(stage.contentDirectory).to.equal(path.join(path.resolve(stagingRoot), digest));
        expect(path.dirname(stage.stagedPath)).to.equal(stage.contentDirectory);
        expect(stage.stagedPath).to.not.equal(sourcePath);
        expect(fs.readFileSync(stage.stagedPath, "utf8")).to.equal("approved dacpac bytes");
        await verifyStagedLocalDacpacArtifact(stage, () => false);

        await disposeStagedLocalDacpacArtifact(stage);
        expect(fs.existsSync(stage.stagedPath)).to.equal(false);
    });

    test("workspace mutation after staging cannot change the deployment copy", async () => {
        const digest = sha256(fs.readFileSync(sourcePath));
        const stage = await stageLocalDacpacArtifact(stagingRoot, sourcePath, digest, () => false);
        stages.push(stage);

        fs.writeFileSync(sourcePath, "changed workspace artifact");
        await verifyStagedLocalDacpacArtifact(stage, () => false);
        expect(sha256(fs.readFileSync(stage.stagedPath))).to.equal(digest);
    });

    test("rejects a copy that does not match the approved digest and removes it", async () => {
        let error: unknown;
        try {
            await stageLocalDacpacArtifact(
                stagingRoot,
                sourcePath,
                sha256(Buffer.from("different bytes")),
                () => false,
            );
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(LocalDacpacStageError);
        expect((error as LocalDacpacStageError).reason).to.equal("digestMismatch");
        expect(listFiles(stagingRoot)).to.deep.equal([]);
    });

    test("detects staged artifact tampering before publish", async () => {
        const digest = sha256(fs.readFileSync(sourcePath));
        const stage = await stageLocalDacpacArtifact(stagingRoot, sourcePath, digest, () => false);
        stages.push(stage);
        fs.chmodSync(stage.stagedPath, 0o600);
        fs.writeFileSync(stage.stagedPath, "tampered bytes");

        let error: unknown;
        try {
            await verifyStagedLocalDacpacArtifact(stage, () => false);
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(LocalDacpacStageError);
        expect(["digestMismatch", "invalidArtifact"]).to.include(
            (error as LocalDacpacStageError).reason,
        );
    });

    test("stale cleanup removes only recognized old stage files", async () => {
        const digest = sha256(fs.readFileSync(sourcePath));
        const oldStage = await stageLocalDacpacArtifact(
            stagingRoot,
            sourcePath,
            digest,
            () => false,
        );
        const recentStage = await stageLocalDacpacArtifact(
            stagingRoot,
            sourcePath,
            digest,
            () => false,
        );
        stages.push(oldStage, recentStage);
        const unrelatedPath = path.join(oldStage.contentDirectory, "keep.txt");
        fs.writeFileSync(unrelatedPath, "not a stage file");
        const oldDate = new Date("2026-01-01T00:00:00.000Z");
        fs.utimesSync(oldStage.stagedPath, oldDate, oldDate);

        const result = cleanupStaleLocalDacpacArtifacts(
            stagingRoot,
            new Date("2026-07-01T00:00:00.000Z").getTime(),
        );

        expect(result.deletedFiles).to.equal(1);
        expect(fs.existsSync(oldStage.stagedPath)).to.equal(false);
        expect(fs.existsSync(recentStage.stagedPath)).to.equal(true);
        expect(fs.existsSync(unrelatedPath)).to.equal(true);
    });
});

function sha256(value: Buffer): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function listFiles(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }
    return fs
        .readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
}
