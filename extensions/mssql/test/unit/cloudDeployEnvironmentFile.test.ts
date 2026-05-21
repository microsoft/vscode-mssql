/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import {
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    Environment,
    EnvironmentsFile,
} from "../../src/cloudDeploy/environments/types";
import {
    EnvironmentsFileParseError,
    getEnvironmentsFileUri,
    loadEnvironmentsFile,
    saveEnvironmentsFile,
} from "../../src/cloudDeploy/environments/environmentFile";

function makeFolder(root: string): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(root),
        name: path.basename(root),
        index: 0,
    };
}

function makeEnv(id: string): Environment {
    return {
        id,
        name: id,
        sourceOfTruth: { kind: "container", connectionProfileId: "conn-1" },
        validations: [],
    };
}

function makeFile(...envs: Environment[]): EnvironmentsFile {
    return {
        schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
        environments: envs,
    };
}

suite("CloudDeploy EnvironmentFile", () => {
    let workspaceRoot: string;
    let folder: vscode.WorkspaceFolder;

    setup(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-envfile-"));
        folder = makeFolder(workspaceRoot);
    });

    teardown(async () => {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    });

    suite("getEnvironmentsFileUri", () => {
        test("returns the .mssql/environments.json path for the folder", () => {
            const uri = getEnvironmentsFileUri(folder);
            // Compare case-insensitively: on Windows the drive letter case can
            // round-trip differently through vscode.Uri (`c:` vs `C:`).
            const expected = path.join(workspaceRoot, ".mssql", "environments.json");
            expect(uri.fsPath.toLowerCase()).to.equal(expected.toLowerCase());
        });
    });

    suite("loadEnvironmentsFile", () => {
        test("returns an empty file when the file does not exist (ENOENT is not an error)", async () => {
            const file = await loadEnvironmentsFile(folder);
            expect(file.schemaVersion).to.equal(ENVIRONMENTS_FILE_SCHEMA_VERSION);
            expect(file.environments).to.deep.equal([]);
        });

        test("reads back what was written", async () => {
            await saveEnvironmentsFile(folder, makeFile(makeEnv("a"), makeEnv("b")));
            const file = await loadEnvironmentsFile(folder);
            expect(file.environments.map((e) => e.id)).to.deep.equal(["a", "b"]);
        });

        test("throws EnvironmentsFileParseError on invalid JSON", async () => {
            const target = path.join(workspaceRoot, ".mssql", "environments.json");
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, "{ not json", { encoding: "utf8" });

            let caught: unknown;
            try {
                await loadEnvironmentsFile(folder);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
        });

        test("throws EnvironmentsFileParseError with issues[] on schema violations", async () => {
            const target = path.join(workspaceRoot, ".mssql", "environments.json");
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(
                target,
                JSON.stringify({ schemaVersion: 1, environments: [{ id: "" }] }),
                { encoding: "utf8" },
            );

            let caught: unknown;
            try {
                await loadEnvironmentsFile(folder);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
            const issues = (caught as EnvironmentsFileParseError).issues;
            expect(issues, "expected issues[] on schema failure").to.exist;
            expect(issues!.length).to.be.greaterThan(0);
        });
    });

    suite("saveEnvironmentsFile", () => {
        test("creates the .mssql directory if missing", async () => {
            await saveEnvironmentsFile(folder, makeFile(makeEnv("a")));
            const stat = await fs.stat(path.join(workspaceRoot, ".mssql"));
            expect(stat.isDirectory()).to.be.true;
        });

        test("writes pretty-printed JSON with a trailing newline", async () => {
            await saveEnvironmentsFile(folder, makeFile(makeEnv("a")));
            const raw = await fs.readFile(path.join(workspaceRoot, ".mssql", "environments.json"), {
                encoding: "utf8",
            });
            expect(raw.endsWith("\n")).to.be.true;
            // Pretty-printed (multiple lines, not single-line JSON).
            expect(raw.split("\n").length).to.be.greaterThan(3);
        });

        test("leaves no temp files behind on successful write", async () => {
            await saveEnvironmentsFile(folder, makeFile(makeEnv("a")));
            const entries = await fs.readdir(path.join(workspaceRoot, ".mssql"));
            // Only the real file; no `.environments.json.<pid>.<ts>.tmp` strays.
            expect(entries).to.deep.equal(["environments.json"]);
        });

        test("overwriting preserves only the latest content (no partial state)", async () => {
            await saveEnvironmentsFile(folder, makeFile(makeEnv("first")));
            await saveEnvironmentsFile(folder, makeFile(makeEnv("second")));
            const file = await loadEnvironmentsFile(folder);
            expect(file.environments.map((e) => e.id)).to.deep.equal(["second"]);
        });
    });
});
