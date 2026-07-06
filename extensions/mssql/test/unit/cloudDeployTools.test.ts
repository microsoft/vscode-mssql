/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";

import {
    CloudDeployCreateEnvironmentTool,
    CloudDeployDescribeEnvironmentTool,
    CloudDeployListEnvironmentsTool,
    CloudDeployValidateEnvironmentTool,
} from "../../src/copilot/tools/cloudDeployTools";
import type { CloudDeployService } from "../../src/cloudDeploy/cloudDeployService";
import type { CloudDeployValidationRunResult } from "../../src/cloudDeploy/validation/validationApi";
import {
    Environment,
    SourceOfTruthKind,
    ValidationType,
} from "../../src/cloudDeploy/environments/types";
import {
    RUN_RECORD_SCHEMA_VERSION,
    RunRecord,
    RunStatus,
    StaticAnalysisFinding,
    ValidationResult,
    ValidationStatus,
} from "../../src/cloudDeploy/runs/types";

// =============================================================================
// Fakes + builders
// =============================================================================

class FakeEnvironmentStore {
    public readonly upserted: Environment[] = [];
    private readonly _envs: Environment[];

    constructor(
        envs: Environment[] = [],
        private readonly _upsertError?: Error,
    ) {
        this._envs = [...envs];
    }

    public list(): Environment[] {
        return [...this._envs];
    }

    public get(id: string): Environment | undefined {
        return this._envs.find((e) => e.id === id);
    }

    public async upsert(env: Environment): Promise<void> {
        if (this._upsertError !== undefined) {
            throw this._upsertError;
        }
        this.upserted.push(env);
        this._envs.push(env);
    }
}

type RunFn = (envId: string, opts: unknown) => Promise<CloudDeployValidationRunResult>;

interface ServiceOptions {
    store?: FakeEnvironmentStore | undefined;
    runsDirectory?: string;
    run?: RunFn;
}

function makeService(opts: ServiceOptions = {}): CloudDeployService {
    const store = "store" in opts ? opts.store : new FakeEnvironmentStore();
    return {
        environments: store,
        validation: {
            run: opts.run ?? (async () => ({ record: makeRunRecord() })),
        },
        runs: { runsDirectory: opts.runsDirectory },
    } as unknown as CloudDeployService;
}

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
    return {
        id: "e1",
        name: "Env One",
        sourceOfTruth: { kind: SourceOfTruthKind.SqlProj, path: "db/app.sqlproj" },
        validations: [{ type: ValidationType.StaticAnalysis, enabled: true, settings: {} }],
        ...overrides,
    };
}

function staticAnalysisGate(
    status: ValidationStatus,
    findings: StaticAnalysisFinding[],
): ValidationResult {
    return {
        validationId: "static-analysis",
        displayName: "Static analysis",
        status,
        startedAtMs: 0,
        endedAtMs: 1,
        payload: {
            validationType: ValidationType.StaticAnalysis,
            findings,
            summary: { info: 0, warning: 0, error: findings.length },
        },
    };
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
        runId: "run-1",
        environmentId: "e1",
        environmentSnapshot: makeEnvironment(),
        runner: { userId: "u", displayName: "U", hostKind: "vscode" },
        startedAtMs: 0,
        endedAtMs: 1,
        status: RunStatus.Passed,
        validations: [],
        ...overrides,
    };
}

function invokeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
    return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function prepareOptions<T>(input: T): vscode.LanguageModelToolInvocationPrepareOptions<T> {
    return { input } as vscode.LanguageModelToolInvocationPrepareOptions<T>;
}

function freshToken(): vscode.CancellationToken {
    return new vscode.CancellationTokenSource().token;
}

// =============================================================================
// Tests
// =============================================================================

suite("CloudDeploy agent tools", () => {
    suite("list environments", () => {
        test("maps each environment to id, name, source, and enabled gates", async () => {
            const service = makeService({
                store: new FakeEnvironmentStore([
                    makeEnvironment({ id: "staging", name: "Staging", description: "pre-prod" }),
                ]),
            });
            const tool = new CloudDeployListEnvironmentsTool(() => service);

            const result = JSON.parse(await tool.call());

            expect(result.success).to.be.true;
            expect(result.count).to.equal(1);
            expect(result.environments[0]).to.deep.equal({
                id: "staging",
                name: "Staging",
                description: "pre-prod",
                sourceOfTruth: { kind: "sqlproj", path: "db/app.sqlproj" },
                validations: ["static-analysis"],
            });
        });

        test("omits disabled validations from the enabled list", async () => {
            const service = makeService({
                store: new FakeEnvironmentStore([
                    makeEnvironment({
                        validations: [
                            { type: ValidationType.StaticAnalysis, enabled: true, settings: {} },
                            { type: ValidationType.Connectivity, enabled: false, settings: {} },
                        ],
                    }),
                ]),
            });
            const tool = new CloudDeployListEnvironmentsTool(() => service);

            const result = JSON.parse(await tool.call());

            expect(result.environments[0].validations).to.deep.equal(["static-analysis"]);
        });

        test("reports no workspace when the env store is absent", async () => {
            const service = makeService({ store: undefined });
            const tool = new CloudDeployListEnvironmentsTool(() => service);

            const result = JSON.parse(await tool.call());

            expect(result.success).to.be.false;
            expect(result.message).to.be.a("string");
        });
    });

    suite("describe environment", () => {
        test("returns the full environment when it exists", async () => {
            const env = makeEnvironment({ id: "prod" });
            const service = makeService({ store: new FakeEnvironmentStore([env]) });
            const tool = new CloudDeployDescribeEnvironmentTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "prod" })));

            expect(result.success).to.be.true;
            expect(result.environment.id).to.equal("prod");
        });

        test("reports not found for an unknown id", async () => {
            const service = makeService({ store: new FakeEnvironmentStore([]) });
            const tool = new CloudDeployDescribeEnvironmentTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "nope" })));

            expect(result.success).to.be.false;
            expect(result.message).to.include("nope");
        });

        test("reports no workspace when the env store is absent", async () => {
            const service = makeService({ store: undefined });
            const tool = new CloudDeployDescribeEnvironmentTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "x" })));

            expect(result.success).to.be.false;
        });
    });

    suite("create environment — needs_input contract", () => {
        test("asks for id, name, and source-of-truth kind when input is empty", async () => {
            const service = makeService({ store: new FakeEnvironmentStore() });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({})));

            expect(result.status).to.equal("needs_input");
            const fields = result.missing.map((m: { field: string }) => m.field);
            expect(fields).to.include.members(["id", "name", "sourceOfTruth.kind"]);
        });

        test("asks for the path when a sqlproj source omits it", async () => {
            const service = makeService({ store: new FakeEnvironmentStore() });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(
                    invokeOptions({
                        id: "s",
                        name: "S",
                        sourceOfTruth: { kind: "sqlproj" },
                    }),
                ),
            );

            expect(result.status).to.equal("needs_input");
            const fields = result.missing.map((m: { field: string }) => m.field);
            expect(fields).to.deep.equal(["sourceOfTruth.path"]);
        });

        test("asks for the connection profile id when a connection source omits it", async () => {
            const service = makeService({ store: new FakeEnvironmentStore() });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(
                    invokeOptions({
                        id: "s",
                        name: "S",
                        sourceOfTruth: { kind: "connection" },
                    }),
                ),
            );

            expect(result.status).to.equal("needs_input");
            const fields = result.missing.map((m: { field: string }) => m.field);
            expect(fields).to.deep.equal(["sourceOfTruth.connectionProfileId"]);
        });

        test("flags an unrecognized source-of-truth kind with valid options", async () => {
            const service = makeService({ store: new FakeEnvironmentStore() });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(
                    invokeOptions({ id: "s", name: "S", sourceOfTruth: { kind: "bogus" } }),
                ),
            );

            expect(result.status).to.equal("needs_input");
            const kindGap = result.missing.find(
                (m: { field: string }) => m.field === "sourceOfTruth.kind",
            );
            expect(kindGap.options).to.deep.equal(["sqlproj", "dacpac", "connection"]);
        });
    });

    suite("create environment — persistence", () => {
        test("upserts a sqlproj environment and echoes it back", async () => {
            const store = new FakeEnvironmentStore();
            const service = makeService({ store });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(
                    invokeOptions({
                        id: "staging",
                        name: "Staging",
                        sourceOfTruth: { kind: "sqlproj", path: "db/app.sqlproj" },
                    }),
                ),
            );

            expect(result.status).to.equal("created");
            expect(store.upserted).to.have.lengthOf(1);
            expect(store.upserted[0].id).to.equal("staging");
            expect(store.upserted[0].sourceOfTruth).to.deep.equal({
                kind: "sqlproj",
                path: "db/app.sqlproj",
            });
        });

        test("builds a connection source of truth", async () => {
            const store = new FakeEnvironmentStore();
            const service = makeService({ store });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            await tool.call(
                invokeOptions({
                    id: "live",
                    name: "Live",
                    sourceOfTruth: { kind: "connection", connectionProfileId: "profile-7" },
                }),
            );

            expect(store.upserted[0].sourceOfTruth).to.deep.equal({
                kind: "connection",
                connectionProfileId: "profile-7",
            });
        });

        test("defaults to connectivity and static-analysis when no validations are named", async () => {
            const store = new FakeEnvironmentStore();
            const service = makeService({ store });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            await tool.call(
                invokeOptions({
                    id: "s",
                    name: "S",
                    sourceOfTruth: { kind: "sqlproj", path: "p.sqlproj" },
                }),
            );

            expect(store.upserted[0].validations.map((v) => v.type)).to.deep.equal([
                "connectivity",
                "static-analysis",
            ]);
        });

        test("enables exactly the named validations, de-duplicated", async () => {
            const store = new FakeEnvironmentStore();
            const service = makeService({ store });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            await tool.call(
                invokeOptions({
                    id: "s",
                    name: "S",
                    sourceOfTruth: { kind: "sqlproj", path: "p.sqlproj" },
                    validations: ["unit-tests", "unit-tests", "static-analysis"],
                }),
            );

            expect(store.upserted[0].validations.map((v) => v.type)).to.deep.equal([
                "unit-tests",
                "static-analysis",
            ]);
        });

        test("surfaces an upsert failure as an error result", async () => {
            const store = new FakeEnvironmentStore([], new Error("disk full"));
            const service = makeService({ store });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(
                    invokeOptions({
                        id: "s",
                        name: "S",
                        sourceOfTruth: { kind: "sqlproj", path: "p.sqlproj" },
                    }),
                ),
            );

            expect(result.success).to.be.false;
            expect(result.message).to.include("disk full");
        });

        test("reports no workspace when the env store is absent", async () => {
            const service = makeService({ store: undefined });
            const tool = new CloudDeployCreateEnvironmentTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ id: "s", name: "S" })));

            expect(result.success).to.be.false;
        });
    });

    suite("validate environment", () => {
        const findings = [
            {
                kind: "static-analysis" as const,
                ruleId: "SQL71502",
                severity: "error" as const,
                message: "Unresolved reference to [dbo].[Reactions].",
                location: { file: "db/Get.sql", line: 13 },
            },
        ];

        test("returns the rollup, tally, and per-gate findings", async () => {
            const record = makeRunRecord({
                status: RunStatus.Failed,
                validations: [staticAnalysisGate(ValidationStatus.Failed, findings)],
            });
            const service = makeService({ store: new FakeEnvironmentStore([makeEnvironment()]) });
            (service.validation.run as unknown) = async () => ({ record });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ environmentId: "e1" }), freshToken()),
            );

            expect(result.success).to.be.true;
            expect(result.run.status).to.equal(RunStatus.Failed);
            expect(result.run.gatesPassed).to.equal(0);
            expect(result.run.gatesTotal).to.equal(1);
            expect(result.run.gates[0].findings[0]).to.deep.equal({
                kind: "static-analysis",
                rule: "SQL71502",
                severity: "error",
                message: "Unresolved reference to [dbo].[Reactions].",
                file: "db/Get.sql",
                line: 13,
            });
        });

        test("persists to the runs directory when one is available", async () => {
            let capturedOpts: { persist?: boolean; artifactDir?: string } | undefined;
            const service = makeService({
                store: new FakeEnvironmentStore([makeEnvironment()]),
                runsDirectory: "/ws/.mssql/runs",
                run: async (_id, opts) => {
                    capturedOpts = opts as typeof capturedOpts;
                    return {
                        record: makeRunRecord(),
                        runArtifactPath: "/ws/.mssql/runs/run-1.cdrun.zip",
                    };
                },
            });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ environmentId: "e1" }), freshToken()),
            );

            expect(capturedOpts?.persist).to.be.true;
            expect(capturedOpts?.artifactDir).to.equal("/ws/.mssql/runs");
            expect(result.runArtifactPath).to.equal("/ws/.mssql/runs/run-1.cdrun.zip");
        });

        test("does not request persistence when there is no runs directory", async () => {
            let capturedOpts: { persist?: boolean } | undefined;
            const service = makeService({
                store: new FakeEnvironmentStore([makeEnvironment()]),
                run: async (_id, opts) => {
                    capturedOpts = opts as typeof capturedOpts;
                    return { record: makeRunRecord() };
                },
            });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            await tool.call(invokeOptions({ environmentId: "e1" }), freshToken());

            expect(capturedOpts?.persist).to.be.undefined;
        });

        test("reports not found before running when the id is unknown", async () => {
            let ran = false;
            const service = makeService({
                store: new FakeEnvironmentStore([]),
                run: async () => {
                    ran = true;
                    return { record: makeRunRecord() };
                },
            });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ environmentId: "ghost" }), freshToken()),
            );

            expect(result.success).to.be.false;
            expect(result.message).to.include("ghost");
            expect(ran).to.be.false;
        });

        test("reports no workspace when the env store is absent", async () => {
            const service = makeService({ store: undefined });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ environmentId: "e1" }), freshToken()),
            );

            expect(result.success).to.be.false;
        });

        test("bridges the cancellation token to the run's abort signal", async () => {
            const source = new vscode.CancellationTokenSource();
            const service = makeService({
                store: new FakeEnvironmentStore([makeEnvironment()]),
                run: async (_id, opts) => {
                    const signal = (opts as { signal: AbortSignal }).signal;
                    expect(signal.aborted).to.be.false;
                    source.cancel();
                    expect(signal.aborted).to.be.true;
                    return { record: makeRunRecord() };
                },
            });
            const tool = new CloudDeployValidateEnvironmentTool(() => service);

            await tool.call(invokeOptions({ environmentId: "e1" }), source.token);
        });
    });

    suite("prepareInvocation", () => {
        test("list environments announces itself without a confirmation", async () => {
            const tool = new CloudDeployListEnvironmentsTool(() => makeService());

            const result = await tool.prepareInvocation();

            expect(result.invocationMessage).to.be.a("string");
            expect((result as { confirmationMessages?: unknown }).confirmationMessages).to.be
                .undefined;
        });

        test("describe environment includes the id in its message", async () => {
            const tool = new CloudDeployDescribeEnvironmentTool(() => makeService());

            const result = await tool.prepareInvocation(prepareOptions({ environmentId: "prod" }));

            expect(result.invocationMessage).to.include("prod");
        });

        test("create environment requires confirmation", async () => {
            const tool = new CloudDeployCreateEnvironmentTool(() => makeService());

            const result = await tool.prepareInvocation();

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
        });

        test("validate environment confirmation names the target id", async () => {
            const tool = new CloudDeployValidateEnvironmentTool(() => makeService());

            const result = await tool.prepareInvocation(prepareOptions({ environmentId: "e1" }));

            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.message.value).to.include("e1");
        });
    });
});
