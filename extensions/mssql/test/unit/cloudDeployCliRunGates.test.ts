/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";

import {
    Environment,
    EnvironmentsFile,
    ENVIRONMENTS_FILE_SCHEMA_VERSION,
    SourceOfTruthKind,
} from "../../src/cloudDeploy/environments/types";
import { EnvironmentsFileParseError } from "../../src/cloudDeploy/environments/environmentSchema";
import { FileProvider } from "../../src/cloudDeploy/providers";
import { RUN_RECORD_SCHEMA_VERSION, RunRecord, RunStatus } from "../../src/cloudDeploy/runs/types";
import {
    exitCodeFor,
    runGates,
    RunGatesDeps,
    RunGatesIo,
} from "../../src/cloudDeploy/cli/runGates";

const REQUIRED_ARGS = ["--env", "dev", "--config", "c.json", "--out", "o.zip"] as const;

/** In-memory `FileProvider` that records every `writeFileAtomic`. */
class RecordingFileProvider implements FileProvider {
    public readonly writes: Array<{ path: string; data: Buffer }> = [];

    public async readFileBuffer(): Promise<Buffer> {
        throw new Error("readFileBuffer is not used by run-gates");
    }

    public async writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
        this.writes.push({ path: filePath, data });
    }

    public async fileExists(): Promise<boolean> {
        return false;
    }
}

function makeEnv(id: string): Environment {
    return {
        id,
        name: id,
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "proj/Project.sqlproj" },
        validations: [],
    };
}

function makeFile(...envs: Environment[]): EnvironmentsFile {
    return { schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION, environments: envs };
}

function makeRecord(status: RunStatus): RunRecord {
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: "cli-test-run",
        environmentId: "dev",
        environmentSnapshot: makeEnv("dev"),
        runner: {
            userId: "cloud-deploy-cli",
            displayName: "Cloud Deploy CLI",
            hostKind: "github-actions",
        },
        startedAtMs: 1,
        endedAtMs: 2,
        status,
        validations: [],
    };
}

function captureIo(): { io: RunGatesIo; out: () => string; err: () => string } {
    let outText = "";
    let errText = "";
    const io: RunGatesIo = {
        out: {
            write: (chunk: string) => {
                outText += chunk;
                return true;
            },
        } as unknown as NodeJS.WritableStream,
        err: {
            write: (chunk: string) => {
                errText += chunk;
                return true;
            },
        } as unknown as NodeJS.WritableStream,
    };
    return { io, out: () => outText, err: () => errText };
}

function makeDeps(overrides: Partial<RunGatesDeps> = {}): RunGatesDeps {
    return {
        fileProvider: new RecordingFileProvider(),
        loadEnvironments: async () => makeFile(makeEnv("dev")),
        runValidation: async () => makeRecord(RunStatus.Passed),
        ...overrides,
    };
}

suite("CloudDeploy CLI runGates", () => {
    suite("exitCodeFor", () => {
        test("maps Passed, Skipped, and Warning to 0", () => {
            expect(exitCodeFor(RunStatus.Passed)).to.equal(0);
            expect(exitCodeFor(RunStatus.Skipped)).to.equal(0);
            expect(exitCodeFor(RunStatus.Warning)).to.equal(0);
        });

        test("maps Failed and Errored to 1", () => {
            expect(exitCodeFor(RunStatus.Failed)).to.equal(1);
            expect(exitCodeFor(RunStatus.Errored)).to.equal(1);
        });

        test("maps Cancelled to 130", () => {
            expect(exitCodeFor(RunStatus.Cancelled)).to.equal(130);
        });
    });

    suite("argument handling", () => {
        test("prints usage to stdout and returns 0 for --help", async () => {
            const { io, out } = captureIo();
            const code = await runGates(["--help"], makeDeps(), io);
            expect(code).to.equal(0);
            expect(out()).to.contain("Usage:");
        });

        test("prints an error to stderr and returns 2 for an unknown flag", async () => {
            const { io, err } = captureIo();
            const code = await runGates([...REQUIRED_ARGS, "--bogus"], makeDeps(), io);
            expect(code).to.equal(2);
            expect(err()).to.contain("error:");
        });
    });

    suite("run orchestration", () => {
        test("writes the artifact and returns 0 when the run passes", async () => {
            const fileProvider = new RecordingFileProvider();
            const { io, out } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({ fileProvider, runValidation: async () => makeRecord(RunStatus.Passed) }),
                io,
            );
            expect(code).to.equal(0);
            expect(fileProvider.writes).to.have.length(1);
            expect(fileProvider.writes[0].path).to.equal(path.resolve("o.zip"));
            expect(out()).to.contain("Run passed");
        });

        test("still writes the artifact but returns 1 when a gate errors", async () => {
            const fileProvider = new RecordingFileProvider();
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    fileProvider,
                    runValidation: async () => makeRecord(RunStatus.Errored),
                }),
                io,
            );
            expect(code).to.equal(1);
            expect(fileProvider.writes).to.have.length(1);
        });

        test("returns 2 when the requested environment id is not found", async () => {
            const { io, err } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({ loadEnvironments: async () => makeFile(makeEnv("other")) }),
                io,
            );
            expect(code).to.equal(2);
            expect(err()).to.contain("error:");
        });

        test("returns 2 when the config fails to load", async () => {
            const { io } = captureIo();
            const code = await runGates(
                [...REQUIRED_ARGS],
                makeDeps({
                    loadEnvironments: async () => {
                        throw new EnvironmentsFileParseError("c.json", "broken");
                    },
                }),
                io,
            );
            expect(code).to.equal(2);
        });
    });
});
