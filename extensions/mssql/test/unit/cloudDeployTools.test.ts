/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";

import {
    CloudDeployCreateEnvironmentTool,
    CloudDeployDescribeEnvironmentTool,
    CloudDeployDiffRunsTool,
    CloudDeployGetRunResultTool,
    CloudDeployImportRunTool,
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
    RunListEntry,
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

class FakeRunStore {
    public scanCount = 0;
    private readonly _records: Map<string, RunRecord>;
    constructor(records: RunRecord[] = []) {
        this._records = new Map(records.map((r) => [r.runId, r]));
    }
    public async scan(): Promise<void> {
        this.scanCount++;
    }
    public async get(runId: string): Promise<RunRecord | undefined> {
        return this._records.get(runId);
    }
    public async latest(envId: string): Promise<RunRecord | undefined> {
        return this._forEnv(envId)[0];
    }
    public list(envId?: string): RunListEntry[] {
        const source = envId === undefined ? [...this._records.values()] : this._forEnv(envId);
        return source
            .slice()
            .sort((a, b) => b.startedAtMs - a.startedAtMs)
            .map((r) => ({
                runId: r.runId,
                envId: r.environmentId,
                envDisplayName: r.environmentSnapshot.name,
                status: r.status,
                startedAtMs: r.startedAtMs,
                endedAtMs: r.endedAtMs,
                artifactPath: `/runs/${r.runId}.cdrun.zip`,
            }));
    }
    private _forEnv(envId: string): RunRecord[] {
        return [...this._records.values()]
            .filter((r) => r.environmentId === envId)
            .sort((a, b) => b.startedAtMs - a.startedAtMs);
    }
}

function emptyAsyncIterable(): AsyncIterable<never> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<never> {
            return { next: () => Promise.resolve({ done: true, value: undefined }) };
        },
    };
}

class FakeReader {
    constructor(private readonly _byPath: Record<string, RunRecord> = {}) {}
    public async read(artifactPath: string): Promise<RunRecord> {
        const record = this._byPath[artifactPath];
        if (record === undefined) {
            throw new Error(`no artifact at ${artifactPath}`);
        }
        return record;
    }
    public readEvents(): AsyncIterable<never> {
        return emptyAsyncIterable();
    }
}

class FakeWriter {
    public readonly writes: Array<{ record: RunRecord; dest: string }> = [];
    public async write(record: RunRecord, _events: unknown, dest: string) {
        this.writes.push({ record, dest });
        return { path: dest, sizeBytes: 1 };
    }
}

interface ServiceOptions {
    store?: FakeEnvironmentStore | undefined;
    runsDirectory?: string;
    run?: RunFn;
    runsStore?: FakeRunStore;
    reader?: FakeReader;
    writer?: FakeWriter;
}

function makeService(opts: ServiceOptions = {}): CloudDeployService {
    const store = "store" in opts ? opts.store : new FakeEnvironmentStore();
    return {
        environments: store,
        validation: {
            run: opts.run ?? (async () => ({ record: makeRunRecord() })),
        },
        runs: {
            store: opts.runsStore,
            reader: opts.reader ?? new FakeReader(),
            writer: opts.writer ?? new FakeWriter(),
            runsDirectory: opts.runsDirectory,
        },
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

        test("import run requires confirmation", async () => {
            const tool = new CloudDeployImportRunTool(() => makeService());
            const result = await tool.prepareInvocation();
            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages.message).to.be.instanceOf(vscode.MarkdownString);
        });

        test("get run result and diff runs announce without confirmation", async () => {
            const getResult = await new CloudDeployGetRunResultTool(() =>
                makeService(),
            ).prepareInvocation();
            const diffResult = await new CloudDeployDiffRunsTool(() =>
                makeService(),
            ).prepareInvocation();
            expect((getResult as { confirmationMessages?: unknown }).confirmationMessages).to.be
                .undefined;
            expect((diffResult as { confirmationMessages?: unknown }).confirmationMessages).to.be
                .undefined;
        });
    });

    suite("get run result", () => {
        test("returns a run by id", async () => {
            const record = makeRunRecord({ runId: "run-9", environmentId: "e1" });
            const service = makeService({ runsStore: new FakeRunStore([record]) });
            const tool = new CloudDeployGetRunResultTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ runId: "run-9" })));

            expect(result.success).to.be.true;
            expect(result.run.runId).to.equal("run-9");
        });

        test("returns the latest run for an environment", async () => {
            const older = makeRunRecord({ runId: "old", environmentId: "e1", startedAtMs: 100 });
            const newer = makeRunRecord({ runId: "new", environmentId: "e1", startedAtMs: 200 });
            const service = makeService({ runsStore: new FakeRunStore([older, newer]) });
            const tool = new CloudDeployGetRunResultTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "e1" })));

            expect(result.run.runId).to.equal("new");
        });

        test("lists recent runs when neither id is given", async () => {
            const service = makeService({
                runsStore: new FakeRunStore([
                    makeRunRecord({ runId: "a", startedAtMs: 1 }),
                    makeRunRecord({ runId: "b", startedAtMs: 2 }),
                ]),
            });
            const tool = new CloudDeployGetRunResultTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({})));

            expect(result.success).to.be.true;
            expect(result.count).to.equal(2);
            expect(result.runs[0].runId).to.equal("b");
        });

        test("reports run not found for an unknown id", async () => {
            const service = makeService({ runsStore: new FakeRunStore([]) });
            const tool = new CloudDeployGetRunResultTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ runId: "ghost" })));

            expect(result.success).to.be.false;
            expect(result.message).to.include("ghost");
        });

        test("reports no runs for an environment with none", async () => {
            const service = makeService({ runsStore: new FakeRunStore([]) });
            const tool = new CloudDeployGetRunResultTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "e1" })));

            expect(result.success).to.be.false;
            expect(result.message).to.include("e1");
        });

        test("scans the store before reading", async () => {
            const store = new FakeRunStore([makeRunRecord({ runId: "r" })]);
            const service = makeService({ runsStore: store });
            await new CloudDeployGetRunResultTool(() => service).call(
                invokeOptions({ runId: "r" }),
            );
            expect(store.scanCount).to.be.greaterThan(0);
        });

        test("reports no workspace when the run store is absent", async () => {
            const service = makeService();
            const result = JSON.parse(
                await new CloudDeployGetRunResultTool(() => service).call(invokeOptions({})),
            );
            expect(result.success).to.be.false;
        });
    });

    suite("diff runs", () => {
        const base = makeRunRecord({
            runId: "base-1",
            environmentId: "e1",
            startedAtMs: 100,
            status: RunStatus.Passed,
            validations: [staticAnalysisGate(ValidationStatus.Passed, [])],
        });
        const candidate = makeRunRecord({
            runId: "cand-1",
            environmentId: "e1",
            startedAtMs: 200,
            status: RunStatus.Failed,
            validations: [
                staticAnalysisGate(ValidationStatus.Failed, [
                    {
                        kind: "static-analysis",
                        ruleId: "SQL71502",
                        severity: "error",
                        message: "boom",
                    },
                ]),
            ],
        });

        test("diffs two explicit runs and flags the changed gate", async () => {
            const service = makeService({ runsStore: new FakeRunStore([base, candidate]) });
            const tool = new CloudDeployDiffRunsTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ baseRunId: "base-1", candidateRunId: "cand-1" })),
            );

            expect(result.success).to.be.true;
            expect(result.comparison.base.runId).to.equal("base-1");
            expect(result.comparison.candidate.runId).to.equal("cand-1");
            expect(result.comparison.changedGates).to.include("static-analysis");
        });

        test("diffs the latest two runs for an environment", async () => {
            const service = makeService({ runsStore: new FakeRunStore([base, candidate]) });
            const tool = new CloudDeployDiffRunsTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "e1" })));

            expect(result.comparison.base.runId).to.equal("base-1");
            expect(result.comparison.candidate.runId).to.equal("cand-1");
        });

        test("reports run not found for an unknown base id", async () => {
            const service = makeService({ runsStore: new FakeRunStore([candidate]) });
            const tool = new CloudDeployDiffRunsTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ baseRunId: "ghost", candidateRunId: "cand-1" })),
            );

            expect(result.success).to.be.false;
            expect(result.message).to.include("ghost");
        });

        test("asks for runs when the environment has fewer than two", async () => {
            const service = makeService({ runsStore: new FakeRunStore([candidate]) });
            const tool = new CloudDeployDiffRunsTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ environmentId: "e1" })));

            expect(result.success).to.be.false;
        });

        test("asks for runs when nothing is provided", async () => {
            const service = makeService({ runsStore: new FakeRunStore([base, candidate]) });
            const tool = new CloudDeployDiffRunsTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({})));

            expect(result.success).to.be.false;
        });

        test("reports no workspace when the run store is absent", async () => {
            const service = makeService();
            const result = JSON.parse(
                await new CloudDeployDiffRunsTool(() => service).call(invokeOptions({})),
            );
            expect(result.success).to.be.false;
        });
    });

    suite("import run", () => {
        const ART = "/artifacts/imported.cdrun.zip";
        const imported = makeRunRecord({ runId: "imported-1", environmentId: "e1" });

        test("reads an artifact and returns its structured results", async () => {
            const service = makeService({ reader: new FakeReader({ [ART]: imported }) });
            const tool = new CloudDeployImportRunTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ artifactPath: ART })));

            expect(result.success).to.be.true;
            expect(result.imported).to.be.true;
            expect(result.run.runId).to.equal("imported-1");
            expect(result.persisted).to.be.undefined;
        });

        test("persists into the runs directory when asked", async () => {
            const writer = new FakeWriter();
            const store = new FakeRunStore([]);
            const service = makeService({
                reader: new FakeReader({ [ART]: imported }),
                writer,
                runsStore: store,
                runsDirectory: "/ws/.mssql/runs",
            });
            const tool = new CloudDeployImportRunTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ artifactPath: ART, persist: true })),
            );

            expect(result.persisted).to.be.true;
            expect(writer.writes).to.have.lengthOf(1);
            expect(writer.writes[0].dest).to.include("imported-1.cdrun.zip");
            expect(store.scanCount).to.be.greaterThan(0);
        });

        test("does not persist when persist is omitted", async () => {
            const writer = new FakeWriter();
            const service = makeService({
                reader: new FakeReader({ [ART]: imported }),
                writer,
                runsDirectory: "/ws/.mssql/runs",
            });
            const tool = new CloudDeployImportRunTool(() => service);

            await tool.call(invokeOptions({ artifactPath: ART }));

            expect(writer.writes).to.have.lengthOf(0);
        });

        test("does not persist when there is no runs directory", async () => {
            const writer = new FakeWriter();
            const service = makeService({ reader: new FakeReader({ [ART]: imported }), writer });
            const tool = new CloudDeployImportRunTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ artifactPath: ART, persist: true })),
            );

            expect(result.persisted).to.be.undefined;
            expect(writer.writes).to.have.lengthOf(0);
        });

        test("surfaces a read failure as an error result", async () => {
            const service = makeService({ reader: new FakeReader({}) });
            const tool = new CloudDeployImportRunTool(() => service);

            const result = JSON.parse(
                await tool.call(invokeOptions({ artifactPath: "/nope/x.cdrun.zip" })),
            );

            expect(result.success).to.be.false;
        });

        test("requires an artifact path", async () => {
            const service = makeService({ reader: new FakeReader() });
            const tool = new CloudDeployImportRunTool(() => service);

            const result = JSON.parse(await tool.call(invokeOptions({ artifactPath: "  " })));

            expect(result.success).to.be.false;
        });
    });
});
