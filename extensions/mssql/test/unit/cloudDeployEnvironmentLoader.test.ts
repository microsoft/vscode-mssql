/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    Environment,
    EnvironmentsFile,
    SourceOfTruthKind,
} from "../../src/cloudDeploy/environments/types";
import { EnvironmentsFileParseError } from "../../src/cloudDeploy/environments/environmentSchema";
import {
    EnvironmentNotFoundError,
    loadEnvironmentsFromPath,
    resolveEnvironment,
} from "../../src/cloudDeploy/environments/environmentLoader";

function makeEnv(id: string): Environment {
    return {
        id,
        name: id,
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "proj/Project.sqlproj" },
        validations: [],
    };
}

function makeFile(...envs: Environment[]): EnvironmentsFile {
    return {
        schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
        environments: envs,
    };
}

async function expectThrows(run: () => Promise<unknown>): Promise<unknown> {
    let caught: unknown;
    try {
        await run();
    } catch (err) {
        caught = err;
    }
    return caught;
}

suite("CloudDeploy EnvironmentLoader", () => {
    let dir: string;
    let configPath: string;

    setup(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-envloader-"));
        configPath = path.join(dir, "environments.json");
    });

    teardown(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    suite("loadEnvironmentsFromPath", () => {
        test("loads and validates a well-formed file", async () => {
            await fs.writeFile(configPath, JSON.stringify(makeFile(makeEnv("dev"))), "utf8");
            const file = await loadEnvironmentsFromPath(configPath);
            expect(file.environments.map((env) => env.id)).to.deep.equal(["dev"]);
        });

        test("throws EnvironmentsFileParseError when the file is missing", async () => {
            const caught = await expectThrows(() =>
                loadEnvironmentsFromPath(path.join(dir, "absent.json")),
            );
            expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
        });

        test("throws EnvironmentsFileParseError on malformed JSON", async () => {
            await fs.writeFile(configPath, "{ not json", "utf8");
            const caught = await expectThrows(() => loadEnvironmentsFromPath(configPath));
            expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
        });

        test("throws EnvironmentsFileParseError with issues on schema-invalid content", async () => {
            await fs.writeFile(
                configPath,
                JSON.stringify({
                    schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
                    environments: [{ id: "x" }],
                }),
                "utf8",
            );
            const caught = await expectThrows(() => loadEnvironmentsFromPath(configPath));
            expect(caught).to.be.instanceOf(EnvironmentsFileParseError);
            expect((caught as EnvironmentsFileParseError).issues).to.not.be.undefined;
            expect((caught as EnvironmentsFileParseError).issues!.length).to.be.greaterThan(0);
        });
    });

    suite("resolveEnvironment", () => {
        test("returns the environment with the matching id", () => {
            const file = makeFile(makeEnv("a"), makeEnv("b"));
            expect(resolveEnvironment(file, "b").id).to.equal("b");
        });

        test("throws EnvironmentNotFoundError listing available ids when absent", () => {
            const file = makeFile(makeEnv("a"), makeEnv("b"));
            let caught: unknown;
            try {
                resolveEnvironment(file, "missing");
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(EnvironmentNotFoundError);
            expect((caught as EnvironmentNotFoundError).availableIds).to.deep.equal(["a", "b"]);
        });

        test("throws EnvironmentNotFoundError for an empty environment list", () => {
            const file = makeFile();
            let caught: unknown;
            try {
                resolveEnvironment(file, "missing");
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(EnvironmentNotFoundError);
            expect((caught as EnvironmentNotFoundError).availableIds).to.deep.equal([]);
        });
    });
});
