/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { CatalogQuery, ServerCapabilities, gate, runCatalogQuery } from "sql-feature/core";
import {
    agent,
    agentQueries,
    AgentScheduleError,
    agentAccessSql,
    agentVisibility,
    agentServiceState,
    jobActionStateSql,
    canApplyJobAction,
    jobActionFingerprint,
} from "sql-feature/agent";
import {
    compareWaitCounters,
    compareFileIoCounters,
    dmvQueries,
    dmvCollectorForQuery,
    dmvReadinessFrom,
    dmvReadinessWithCollectorFailure,
    dmvReadinessSql,
} from "sql-feature/diagnostics/dmv";
import {
    queryStoreQueries,
    queryStoreStateSql,
    setQueryStoreSql,
    queryStoreReadiness,
    compileQueryStoreConfiguration,
    queryStoreConfigurationMatches,
    compileQueryStoreMaintenance,
    queryStoreInterventionCapabilities,
    queryStoreInvestigationContext,
    inspectQueryStorePlanXml,
    planForQueryStorePlan,
    plansForQueryStoreQuery,
    queryStoreCoverageFromRows,
    queryStoreHints,
    compileQueryStorePlanAction,
    compileQueryStoreHint,
    compileClearQueryStoreHint,
    type QueryStorePlanAction,
    type QueryStoreMaintenanceAction,
    type QueryStoreConfiguration,
    type QueryStoreInvestigationContext,
} from "sql-feature/diagnostics/querystore";

import {
    DiagnosticsQuerySummary,
    DiagnosticsSection,
    DiagnosticsSnapshot,
    NewJobRequest,
    SqlDiagnosticsReducers,
    SqlDiagnosticsState,
    cellDisplayText,
} from "../sharedInterfaces/sqlDiagnostics";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { DataPlaneRunner } from "./dataPlaneRunner";
import { DiagnosticsAdapter } from "./diagnosticsAdapter";
import { getErrorMessage } from "../utils/utils";
import { SqlFeatures } from "../constants/locConstants";

/** Queries that need a job selected before they mean anything. */
const JOB_SCOPED_QUERIES = new Set(["agent.jobSteps", "agent.jobHistory"]);

/** Actions a user can take on a job, and the statement each maps to. */
const JOB_ACTIONS = {
    start: (name: string) => agent.startJobSql(name),
    stop: (name: string) => agent.stopJobSql(name),
    enable: (name: string) => agent.setJobEnabledSql(name, true),
    disable: (name: string) => agent.setJobEnabledSql(name, false),
    delete: (name: string) => agent.deleteJobSql(name),
} as const;

type JobAction = keyof typeof JOB_ACTIONS;

function sectionOf(query: CatalogQuery): DiagnosticsSection {
    if (query.id.startsWith("qds.")) {
        return "querystore";
    }
    if (query.id.startsWith("agent.")) {
        return "agent";
    }
    return "dmv";
}

const ALL_QUERIES: readonly CatalogQuery[] = [
    ...dmvQueries,
    ...queryStoreQueries,
    ...agentQueries,
    agent.jobSteps,
    agent.jobHistory,
];

/**
 * Shared transport for independent SQL Activity, Query Store and Agent panels.
 *
 * The webview only ever names a query; the SQL, the platform gating and the permission checks
 * all live here, so nothing the webview sends can widen what runs on the server.
 */
export class SqlDiagnosticsWebviewController extends WebviewPanelController<
    SqlDiagnosticsState,
    SqlDiagnosticsReducers
> {
    private _capabilities?: ServerCapabilities;
    private _queryStoreEnabled?: boolean;
    private _queryStoreBusy = false;
    private _queryGeneration = 0;
    private _planGeneration = 0;
    private _waitBaseline?: {
        params?: Record<string, unknown>;
        rows: readonly Record<string, unknown>[];
        collectedAt: string;
        complete: boolean;
    };
    private _storageBaseline?: {
        params?: Record<string, unknown>;
        rows: readonly Record<string, unknown>[];
        collectedAt: string;
        complete: boolean;
    };
    private readonly _diagnostics = new DiagnosticsAdapter();

    constructor(
        context: vscode.ExtensionContext,
        private readonly _runner: DataPlaneRunner,
        connectionLabel: string,
        private readonly _section: DiagnosticsSection,
        private readonly _chooseDatabase: () => Promise<void>,
    ) {
        super(
            context,
            sourceFileForSection(_section),
            "sqlDiagnostics",
            {
                section: _section,
                queries: [],
                isLoading: true,
                jobOptions: [],
            },
            {
                title: SqlFeatures.title(
                    {
                        dmv: SqlFeatures.activity,
                        querystore: SqlFeatures.queryStore,
                        agent: SqlFeatures.agent,
                    }[_section],
                    connectionLabel,
                ),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: vscode.Uri.joinPath(context.extensionUri, "media", "database.svg"),
            },
        );

        this.registerReducers();
        void this.initialize();
    }

    /** Identifies the server, then offers only what it can actually run. */
    private async initialize(): Promise<void> {
        try {
            this._capabilities = await this._runner.capabilities();
            if (this._section === "dmv") {
                await this.readDmvReadiness(this._capabilities);
            }
            if (this._section === "querystore") {
                this._queryStoreEnabled = await this.readQueryStoreState(this._capabilities);
                this.state.queryStoreInterventions = queryStoreInterventionCapabilities(
                    this._capabilities,
                );
            }

            this.state.server = {
                platformName: this._capabilities.platform,
                edition: this._capabilities.edition,
                productVersion: this._capabilities.productVersion,
                serverName: this._capabilities.serverName,
                database: this._capabilities.database,
                hasSqlAgent: this._capabilities.hasSqlAgent,
                hasQueryStore: this._capabilities.hasQueryStore,
                queryStoreEnabled: this._queryStoreEnabled,
            };
            this.state.queries = this.describeQueries();
            this.state.isLoading = false;
            this.updateState();

            if (this._section === "agent") await this.readAgentReadiness();
        } catch (error) {
            this.fail(error);
        }
    }

    private async readDmvReadiness(capabilities: ServerCapabilities): Promise<void> {
        if (this.state.dmvReadinessBusy) return;
        this.state.dmvReadinessBusy = true;
        this.state.dmvReadiness = dmvReadinessFrom(capabilities);
        this.updateState();
        try {
            const result = await this._runner.query(dmvReadinessSql, {
                tag: "sqlDiag.dmvReadiness",
            });
            this.state.dmvReadiness = dmvReadinessFrom(capabilities, result.rows[0]);
        } catch (error) {
            this.state.dmvReadiness = dmvReadinessFrom(
                capabilities,
                undefined,
                getErrorMessage(error),
            );
        } finally {
            this.state.dmvReadinessBusy = false;
            this.updateState();
        }
    }

    /**
     * Query Store can be present but switched off for a database, which is a different message
     * from "not supported here". A failure to read it is treated as unknown, not as off.
     */
    private async readQueryStoreState(
        capabilities: ServerCapabilities,
    ): Promise<boolean | undefined> {
        this.state.queryStore = queryStoreReadiness(
            capabilities.hasQueryStore,
            capabilities.database,
        );
        if (this.state.queryStore.status === "unsupported") {
            return false;
        }
        try {
            const result = await this._runner.query(queryStoreStateSql, {
                tag: "sqlDiag.queryStoreState",
            });
            this.state.queryStore = queryStoreReadiness(
                capabilities.hasQueryStore,
                capabilities.database,
                result.rows[0],
            );
            return this.state.queryStore.canReadHistory;
        } catch (error) {
            const message = getErrorMessage(error);
            this.state.queryStore.access = isPermissionError(message) ? "denied" : "inconclusive";
            this.state.queryStore.error = message;
            return undefined;
        }
    }

    private describeQueries(): DiagnosticsQuerySummary[] {
        const capabilities = this._capabilities;
        return this.queries.map((query) => {
            const result = capabilities
                ? gate(query, capabilities, this._queryStoreEnabled)
                : { allowed: false, reason: SqlFeatures.diagnosticsIdentifying };
            return {
                id: query.id,
                title: query.title,
                description: query.description,
                section: sectionOf(query),
                available: result.allowed,
                unavailableReason: result.reason,
                requiresSelection: JOB_SCOPED_QUERIES.has(query.id),
            };
        });
    }

    private async readAgentReadiness(): Promise<void> {
        if (this.state.agentReadinessBusy) return;
        this.state.agentReadinessBusy = true;
        const readiness = {
            supported: this._capabilities?.hasSqlAgent === true,
            service: "unknown",
            visibility: "unknown",
        } as NonNullable<SqlDiagnosticsState["agentReadiness"]>;
        this.state.agentReadiness = readiness;
        this.updateState();
        try {
            if (!readiness.supported) return;
            try {
                const result = await this._runner.query(agentAccessSql, { tag: "agent.access" });
                readiness.visibility = agentVisibility(result.rows[0]);
            } catch (error) {
                readiness.accessError = getErrorMessage(error);
            }
            try {
                const result = await this._runner.query(agent.agentStatus.sql(), {
                    tag: "agent.serviceReadiness",
                });
                readiness.service = agentServiceState(result.rows[0]?.status);
            } catch (error) {
                readiness.serviceError = getErrorMessage(error);
            }
            await this.loadJobOptions();
        } finally {
            this.state.agentReadinessBusy = false;
            this.updateState();
        }
    }

    private async loadJobOptions(): Promise<void> {
        try {
            const outcome = await runCatalogQuery(agent.jobs, this._runner, this._capabilities!, {
                diagnostics: this._diagnostics,
            });
            const error = outcome.error ?? (outcome.gate.allowed ? undefined : outcome.gate.reason);
            if (error) {
                this.state.jobOptions = [];
                if (this.state.agentReadiness) this.state.agentReadiness.jobsError = error;
                this.updateState();
                return;
            }
            this.state.jobOptions = (outcome.result?.rows ?? [])
                .map((r) => ({ id: String(r.job_id ?? ""), name: String(r.name ?? "") }))
                .filter((job) => job.id.length > 0 && job.name.length > 0);
            if (
                this.state.selectedJobId &&
                !this.state.jobOptions.some((job) => job.id === this.state.selectedJobId)
            )
                this.state.selectedJobId = undefined;
            this.updateState();
            if (this.state.agentReadiness) this.state.agentReadiness.jobsError = undefined;
        } catch (error) {
            if (this.state.agentReadiness)
                this.state.agentReadiness.jobsError = getErrorMessage(error);
            this.updateState();
        }
    }

    private registerReducers(): void {
        this.registerReducer("recheckAgent", async () => {
            if (this._section === "agent") await this.readAgentReadiness();
            return this.state;
        });
        this.registerReducer("openResultText", async (state, payload) => {
            const result = this.state.result;
            if (
                result?.ranAt !== payload.ranAt ||
                !Number.isInteger(payload.rowIndex) ||
                !result.columns.some((column) => column.field === payload.field && column.wide)
            )
                return state;
            const value = result.rows[payload.rowIndex]?.[payload.field];
            const document = await vscode.workspace.openTextDocument({
                language: typeof value === "string" ? "sql" : "plaintext",
                content: cellDisplayText(value),
            });
            await vscode.window.showTextDocument(document, { preview: false });
            return state;
        });
        this.registerReducer("chooseDatabase", async () => {
            if (this._section === "querystore") await this._chooseDatabase();
            return this.state;
        });
        this.registerReducer("selectJob", async (state, payload) => {
            if (
                this._section === "agent" &&
                state.jobOptions.some((job) => job.id === payload.jobId)
            ) {
                state.selectedJobId = payload.jobId;
                if (state.selectedQueryId && JOB_SCOPED_QUERIES.has(state.selectedQueryId)) {
                    await this.runById(state.selectedQueryId);
                }
            }
            return state;
        });

        this.registerReducer("runQuery", async (state, payload) => {
            await this.runById(payload.queryId, payload.params);
            return this.state;
        });

        this.registerReducer("createJob", async (state, payload) => {
            if (this._section === "agent") await this.createJob(payload.request);
            return this.state;
        });

        this.registerReducer("setQueryStore", async (state, payload) => {
            if (this._section === "querystore")
                await this.setQueryStore(payload.enabled, payload.configuration);
            return this.state;
        });
        this.registerReducer("queryStoreMaintenance", async (state, payload) => {
            if (this._section === "querystore") {
                await this.runQueryStoreMaintenance(payload.action);
            }
            return this.state;
        });
        this.registerReducer("inspectQueryStorePlan", async (state, payload) => {
            if (this._section === "querystore") {
                await this.inspectQueryStorePlan(payload.queryId, payload.planId);
            }
            return this.state;
        });
        this.registerReducer("openQueryStorePlan", async () => {
            const inspection = this.state.queryStorePlan?.inspection;
            if (!inspection?.complete || !inspection.xml) return this.state;
            const document = await vscode.workspace.openTextDocument({
                language: "xml",
                content: inspection.xml,
            });
            await vscode.window.showTextDocument(document, { preview: false });
            return this.state;
        });
        this.registerReducer("queryStorePlanAction", async (state, payload) => {
            if (this._section === "querystore") {
                await this.runQueryStorePlanAction(payload.queryId, payload.planId, payload.action);
            }
            return this.state;
        });
        this.registerReducer("setQueryStoreHint", async (state, payload) => {
            if (this._section === "querystore") {
                await this.runQueryStoreHint(payload.queryId, payload.hint);
            }
            return this.state;
        });
        this.registerReducer("clearQueryStoreHint", async (state, payload) => {
            if (this._section === "querystore") {
                await this.runQueryStoreHint(payload.queryId);
            }
            return this.state;
        });
        this.registerReducer("loadQueryStorePlans", async (state, payload) => {
            if (this._section === "querystore") {
                await this.loadQueryStorePlans(payload.queryId);
            }
            return this.state;
        });

        this.registerReducer("refresh", async () => {
            if (this._section === "querystore") await this.initialize();
            if (this.state.selectedQueryId) {
                await this.runById(
                    this.state.selectedQueryId,
                    this.state.result?.queryId === this.state.selectedQueryId &&
                        !JOB_SCOPED_QUERIES.has(this.state.selectedQueryId)
                        ? this.state.result.params
                        : undefined,
                );
            }
            return this.state;
        });

        this.registerReducer("jobAction", async (state, payload) => {
            if (this._section === "agent") await this.runJobAction(payload.jobId, payload.action);
            return this.state;
        });

        this.registerReducer("openInEditor", async (state, payload) => {
            const query = this.queries.find((q) => q.id === payload.queryId);
            if (query) {
                // Opening the SQL lets a user see exactly what ran and adapt it, rather than
                // treating the panel as a black box.
                const document = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: query.sql(
                        this.state.result?.queryId === query.id
                            ? this.state.result.params
                            : this.paramsFor(query),
                    ),
                });
                await vscode.window.showTextDocument(document, { preview: false });
            }
            return state;
        });

        this.registerReducer("exportCsv", async (state) => {
            await this.exportCsv();
            return state;
        });
    }

    private paramsFor(query: CatalogQuery): Record<string, unknown> | undefined {
        return JOB_SCOPED_QUERIES.has(query.id) && this.state.selectedJobId
            ? { jobId: this.state.selectedJobId }
            : undefined;
    }

    private get queries(): readonly CatalogQuery[] {
        return ALL_QUERIES.filter((query) => sectionOf(query) === this._section);
    }

    private async runById(queryId: string, params?: Record<string, unknown>): Promise<void> {
        const query = this.queries.find((q) => q.id === queryId);
        if (!query || !this._capabilities) {
            return;
        }

        if (JOB_SCOPED_QUERIES.has(queryId) && !this.state.selectedJobId) {
            this.state.errorMessage = SqlFeatures.diagnosticsChooseJob;
            this.updateState();
            return;
        }

        const requestedParams = params ?? this.paramsFor(query);
        const effectiveParams = query.id.startsWith("qds.")
            ? {
                  ...requestedParams,
                  referenceAt:
                      typeof requestedParams?.referenceAt === "string"
                          ? requestedParams.referenceAt
                          : new Date().toISOString(),
              }
            : requestedParams;
        const waitBaseline =
            isWaitQuery(queryId) &&
            this._waitBaseline &&
            waitParamsMatch(this._waitBaseline.params, effectiveParams)
                ? this._waitBaseline
                : undefined;
        const storageBaseline =
            isStorageQuery(queryId) &&
            this._storageBaseline &&
            storageParamsMatch(this._storageBaseline.params, effectiveParams)
                ? this._storageBaseline
                : undefined;
        const generation = ++this._queryGeneration;
        this.state.isLoading = true;
        this.state.errorMessage = undefined;
        this.state.selectedQueryId = queryId;
        this.state.result = undefined;
        this.updateState();

        const collectionStartedAt = new Date().toISOString();
        const outcome = await runCatalogQuery(query, this._runner, this._capabilities, {
            params: effectiveParams,
            queryStoreOn: this._queryStoreEnabled,
            diagnostics: this._diagnostics,
        });
        const collectionEndedAt = new Date().toISOString();

        if (generation !== this._queryGeneration || this.state.selectedQueryId !== queryId) {
            return;
        }

        this.state.isLoading = false;

        if (!outcome.gate.allowed) {
            this.state.errorMessage = outcome.gate.reason;
        } else if (outcome.error) {
            if (this._section === "dmv" && this.state.dmvReadiness) {
                const collectorId = dmvCollectorForQuery(queryId);
                if (collectorId) {
                    this.state.dmvReadiness = dmvReadinessWithCollectorFailure(
                        this.state.dmvReadiness,
                        collectorId,
                        outcome.error,
                    );
                }
            }
            this.state.errorMessage =
                outcome.outcome === "unknown"
                    ? `${SqlFeatures.queryOutcomeUnknown} ${outcome.error}`
                    : outcome.error;
        } else if (outcome.result) {
            let queryStoreContext: QueryStoreInvestigationContext | undefined;
            try {
                queryStoreContext = query.id.startsWith("qds.")
                    ? queryStoreInvestigationContext(
                          queryId,
                          effectiveParams,
                          String(effectiveParams?.referenceAt ?? collectionEndedAt),
                      )
                    : undefined;
            } catch (error) {
                this.state.errorMessage = getErrorMessage(error);
                this.updateState();
                return;
            }
            let rows = outcome.result.rows as Record<string, string | number | boolean | null>[];
            let snapshot = createSnapshot(
                this._section,
                this.state.server,
                queryId,
                effectiveParams,
                outcome.result.rows.length,
                outcome.result.truncated,
                collectionStartedAt,
                collectionEndedAt,
                queryStoreContext,
                rows,
            );
            if (isWaitQuery(queryId) && waitBaseline) {
                const comparison = compareWaitCounters(waitBaseline.rows, rows, {
                    baselineComplete: waitBaseline.complete,
                    currentComplete: !outcome.result.truncated,
                });
                rows = comparison.rows as Record<string, string | number | boolean | null>[];
                snapshot = {
                    ...snapshot,
                    window:
                        comparison.status === "delta"
                            ? {
                                  kind: "comparison",
                                  start: waitBaseline.collectedAt,
                                  end: collectionEndedAt,
                                  baselineStart: waitBaseline.collectedAt,
                                  baselineEnd: waitBaseline.collectedAt,
                                  label: SqlFeatures.diagnosticsWaitCounterInterval,
                              }
                            : snapshot.window,
                    comparison: {
                        status: comparison.status,
                        baselineCollectedAt: waitBaseline.collectedAt,
                        reason: comparison.reason,
                    },
                };
            } else if (isStorageQuery(queryId) && storageBaseline) {
                const comparison = compareFileIoCounters(storageBaseline.rows, rows, {
                    baselineComplete: storageBaseline.complete,
                    currentComplete: !outcome.result.truncated,
                });
                rows = comparison.rows as Record<string, string | number | boolean | null>[];
                snapshot = {
                    ...snapshot,
                    window:
                        comparison.status === "delta"
                            ? {
                                  kind: "comparison",
                                  start: storageBaseline.collectedAt,
                                  end: collectionEndedAt,
                                  baselineStart: storageBaseline.collectedAt,
                                  baselineEnd: storageBaseline.collectedAt,
                                  label: SqlFeatures.diagnosticsStorageCounterInterval,
                              }
                            : snapshot.window,
                    comparison: {
                        status: comparison.status,
                        baselineCollectedAt: storageBaseline.collectedAt,
                        reason: comparison.reason,
                    },
                };
            } else if (isWaitQuery(queryId)) {
                snapshot = {
                    ...snapshot,
                    comparison: { status: "baseline" },
                };
            } else if (isStorageQuery(queryId)) {
                snapshot = {
                    ...snapshot,
                    comparison: { status: "baseline" },
                };
            }
            this.state.result = {
                params: effectiveParams,
                queryId,
                columns: query.columns.map((c) => ({ ...c })),
                rows,
                durationMs: outcome.durationMs,
                truncated: outcome.result.truncated,
                ranAt: new Date().toISOString(),
                snapshot,
                ...(queryStoreContext ? { queryStoreContext } : {}),
            };
            if (isWaitQuery(queryId)) {
                this._waitBaseline = {
                    params: effectiveParams,
                    rows: outcome.result.rows,
                    collectedAt: collectionEndedAt,
                    complete: !outcome.result.truncated,
                };
            }
            if (isStorageQuery(queryId)) {
                this._storageBaseline = {
                    params: effectiveParams,
                    rows: outcome.result.rows,
                    collectedAt: collectionEndedAt,
                    complete: !outcome.result.truncated,
                };
            }
        }
        this.updateState();
    }

    /**
     * Runs a job action, confirming first for anything that stops or destroys work. The action
     * name is looked up in a fixed table, so the webview cannot ask for arbitrary SQL.
     */
    private async runJobAction(jobId: string, action: JobAction): Promise<void> {
        if (this.state.jobActionBusy || !Object.prototype.hasOwnProperty.call(JOB_ACTIONS, action))
            return;
        if (!this.state.jobOptions.some((job) => job.id === jobId)) return;
        this.state.jobActionBusy = true;
        this.state.errorMessage = undefined;
        this.updateState();
        try {
            const preflight = await this._runner.query(jobActionStateSql(jobId), {
                tag: "agent.actionPreflight",
            });
            const reviewed = preflight.rows[0];
            if (!reviewed || typeof reviewed.name !== "string")
                throw new Error(SqlFeatures.jobUnavailable);
            const jobName = reviewed.name;
            const allowed = canApplyJobAction(reviewed, action);
            const fingerprint = jobActionFingerprint(reviewed);
            const sql = JOB_ACTIONS[action](jobId);
            const label = SqlFeatures.agentActions[action];
            const choice = await vscode.window.showWarningMessage(
                SqlFeatures.reviewJobAction(label, jobName),
                {
                    modal: true,
                    detail: SqlFeatures.reviewJobActionDetails(
                        allowed
                            ? SqlFeatures.agentActionEffects[action]
                            : SqlFeatures.jobActionAccessUnestablished,
                        sql,
                    ),
                },
                ...(allowed
                    ? [SqlFeatures.apply, SqlFeatures.generateSql]
                    : [SqlFeatures.generateSql]),
            );
            if (choice === SqlFeatures.generateSql) {
                const document = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: sql,
                });
                await vscode.window.showTextDocument(document, { preview: false });
                return;
            }
            if (choice !== SqlFeatures.apply || !allowed) return;
            const current = (
                await this._runner.query(jobActionStateSql(jobId), { tag: "agent.actionPreflight" })
            ).rows[0];
            if (
                !current ||
                !canApplyJobAction(current, action) ||
                jobActionFingerprint(current) !== fingerprint
            )
                throw new Error(SqlFeatures.jobChangedDuringReview);
            await this._runner.query(sql, { tag: `agent.${action}` });
            this._diagnostics.emit({
                type: "sqlDiag.agent.jobAction",
                status: "ok",
                fields: {
                    action: { value: action, cls: "system" },
                    session: { value: jobName, cls: "objectName" },
                },
            });
            void vscode.window.showInformationMessage(
                SqlFeatures.agentActionAccepted(label, jobName),
            );
            await this.loadJobOptions();
            await this.runById("agent.jobs");
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
        } finally {
            this.state.jobActionBusy = false;
            this.updateState();
        }
    }

    /**
     * Creates a SQL Agent job from the form.
     *
     * The form's values are validated here rather than trusted from the webview, and every one
     * of them reaches the server as a quoted literal built by the package, never as SQL text
     * the webview supplied.
     */
    private async createJob(request: NewJobRequest): Promise<void> {
        if (this.state.jobCreation?.busy) return;
        this.state.jobCreation = { busy: true };
        this.state.errorMessage = undefined;
        this.updateState();
        try {
            await this.reviewCreateJob(request);
        } catch (error) {
            this.state.errorMessage =
                error instanceof AgentScheduleError
                    ? SqlFeatures.invalidJobSchedule
                    : getErrorMessage(error);
        } finally {
            this.state.jobCreation = {
                ...this.state.jobCreation,
                busy: false,
                error: this.state.errorMessage,
            };
            this.updateState();
        }
    }

    private async reviewCreateJob(request: NewJobRequest): Promise<void> {
        const name = request?.name?.trim() ?? "";
        const steps = (request?.steps ?? []).map((step) => ({
            name: step.name?.trim() ?? "",
            command: step.command ?? "",
            retryAttempts: step.retryAttempts,
            retryIntervalMinutes: step.retryIntervalMinutes,
            database: step.database?.trim() ?? "",
        }));

        if (
            steps.some((step) =>
                [step.retryAttempts ?? 0, step.retryIntervalMinutes ?? 0].some(
                    (value) => !Number.isInteger(value) || value < 0 || value > 2147483647,
                ),
            )
        ) {
            this.state.errorMessage = SqlFeatures.invalidJobRetries;
            return;
        }
        if (!name) {
            this.state.errorMessage = SqlFeatures.jobNameRequired;
            this.updateState();
            return;
        }
        if (steps.length === 0) {
            this.state.errorMessage = SqlFeatures.jobStepsRequired;
            this.updateState();
            return;
        }
        if (steps.some((step) => !step.database)) {
            this.state.errorMessage = SqlFeatures.jobDatabaseRequired;
            this.updateState();
            return;
        }
        if (!this._capabilities?.hasSqlAgent) {
            this.state.errorMessage = SqlFeatures.agentUnavailable;
            this.updateState();
            return;
        }

        try {
            const sql = agent.createJobSql({
                name,
                description: request.description?.trim() ?? "",
                enabled: request.enabled === true,
                schedule: request.schedule,
                steps,
            });
            const choice = await vscode.window.showInformationMessage(
                SqlFeatures.reviewJob(name),
                { modal: true, detail: sql },
                SqlFeatures.apply,
                SqlFeatures.generateSql,
            );
            if (choice === SqlFeatures.generateSql) {
                const document = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: sql,
                });
                await vscode.window.showTextDocument(document, { preview: false });
                return;
            }
            if (choice !== SqlFeatures.apply) return;
            const result = await this._runner.query(sql, { tag: "agent.createJob" });
            const createdJobId = result.rows[0]?.job_id;
            if (typeof createdJobId !== "string")
                throw new Error(SqlFeatures.jobCreationUnverified);
            agent.jobIdLiteral(createdJobId);
            this.state.jobCreation = { busy: true, createdJobId };
            this._diagnostics.emit({
                type: "sqlDiag.agent.jobAction",
                status: "ok",
                fields: {
                    action: { value: "create", cls: "system" },
                    session: { value: name, cls: "objectName" },
                },
            });
            vscode.window.showInformationMessage(SqlFeatures.jobCreated(name));
            this.state.errorMessage = undefined;
            await this.loadJobOptions();
            await this.runById("agent.jobs");
        } catch (error) {
            this.state.errorMessage =
                error instanceof AgentScheduleError
                    ? SqlFeatures.invalidJobSchedule
                    : getErrorMessage(error);
            this.updateState();
        }
    }

    /** Reviews a generated operation-mode change, then verifies the actual server state. */
    private async setQueryStore(
        enabled: boolean,
        configuration?: QueryStoreConfiguration,
    ): Promise<void> {
        if (this._queryStoreBusy) return;
        this._queryStoreBusy = true;
        this.state.isLoading = true;
        this.state.errorMessage = undefined;
        this.state.queryStoreMaintenance = undefined;
        this.updateState();
        try {
            await this.reviewQueryStore(enabled, configuration);
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
        } finally {
            this._queryStoreBusy = false;
            this.state.isLoading = false;
            this.updateState();
        }
    }

    private async reviewQueryStore(
        enabled: boolean,
        configuration?: QueryStoreConfiguration,
    ): Promise<void> {
        const capabilities = this._capabilities;
        const database = capabilities?.database;
        if (!capabilities || !database) return;
        await this.readQueryStoreState(capabilities);
        if (
            this.state.queryStore?.status === "unsupported" ||
            (!enabled && capabilities.platform === "azureSqlDatabase")
        ) {
            this.state.errorMessage = SqlFeatures.queryStoreUnavailable;
            this.updateState();
            return;
        }
        let sql: string;
        try {
            sql = configuration
                ? compileQueryStoreConfiguration(database, configuration, capabilities)
                : setQueryStoreSql(database, enabled);
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
            return;
        }
        const configurationFingerprint = () => {
            const state = this.state.queryStore;
            return JSON.stringify([
                state?.actualState,
                state?.desiredState,
                state?.canConfigure,
                state?.captureMode,
                state?.maxStorageMb,
                state?.runtimeIntervalMinutes,
                state?.flushIntervalSeconds,
                state?.retentionDays,
                state?.waitCaptureMode,
                state?.cleanupMode,
            ]);
        };
        const reviewedState = configurationFingerprint();
        const choices =
            this.state.queryStore?.canConfigure === true
                ? [SqlFeatures.apply, SqlFeatures.generateSql]
                : [SqlFeatures.generateSql];
        const choice = await vscode.window.showInformationMessage(
            SqlFeatures.reviewQueryStore(database),
            { modal: true, detail: sql },
            ...choices,
        );
        if (choice === SqlFeatures.generateSql) {
            const document = await vscode.workspace.openTextDocument({
                language: "sql",
                content: sql,
            });
            await vscode.window.showTextDocument(document, { preview: false });
            return;
        }
        if (choice !== SqlFeatures.apply) return;
        try {
            await this.readQueryStoreState(capabilities);
            if (
                this.state.queryStore?.canConfigure !== true ||
                configurationFingerprint() !== reviewedState
            ) {
                this.state.errorMessage = SqlFeatures.queryStoreStateChanged;
                this.updateState();
                return;
            }
            await this._runner.query(sql, { tag: "sqlDiag.setQueryStore" });
            await this.initialize();
            const verified = configuration
                ? queryStoreConfigurationMatches(this.state.queryStore, configuration)
                : this.state.queryStore?.actualState === (enabled ? 2 : 0);
            this.state.errorMessage = verified ? undefined : SqlFeatures.queryStoreNotVerified;
            if (verified) void vscode.window.showInformationMessage(SqlFeatures.queryStoreVerified);
            this.updateState();
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
        }
    }

    private async runQueryStoreMaintenance(action: QueryStoreMaintenanceAction): Promise<void> {
        if (this._queryStoreBusy) return;
        const capabilities = this._capabilities;
        const database = capabilities?.database;
        const supported = capabilities
            ? queryStoreInterventionCapabilities(capabilities).maintenance[action]
            : false;
        if (!capabilities || !database || !supported) {
            this.state.errorMessage = SqlFeatures.queryStoreMaintenanceUnavailable;
            this.updateState();
            return;
        }
        this._queryStoreBusy = true;
        this.state.isLoading = true;
        this.state.errorMessage = undefined;
        this.updateState();
        try {
            await this.readQueryStoreState(capabilities);
            if (this.state.queryStore?.canConfigure !== true) {
                this.state.errorMessage = SqlFeatures.queryStoreConfigurePermission;
                return;
            }
            const reviewedState = queryStoreFingerprint(this.state.queryStore);
            const sql = compileQueryStoreMaintenance(database, action);
            const label = SqlFeatures.queryStoreMaintenanceActions[action];
            const choice = await vscode.window.showWarningMessage(
                SqlFeatures.reviewQueryStoreMaintenance(label, database),
                {
                    modal: true,
                    detail: SqlFeatures.queryStoreMaintenanceEffects[action](sql),
                },
                SqlFeatures.apply,
                SqlFeatures.generateSql,
            );
            if (choice === SqlFeatures.generateSql) {
                const document = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: sql,
                });
                await vscode.window.showTextDocument(document, { preview: false });
                return;
            }
            if (choice !== SqlFeatures.apply) return;
            await this.readQueryStoreState(capabilities);
            if (queryStoreFingerprint(this.state.queryStore) !== reviewedState) {
                this.state.errorMessage = SqlFeatures.queryStoreStateChanged;
                return;
            }
            await this._runner.query(sql, { tag: `sqlDiag.queryStore.${action}` });
            await this.readQueryStoreState(capabilities);
            const verified = action === "disable" && this.state.queryStore?.actualState === 0;
            this.state.queryStoreMaintenance = {
                action,
                outcome: verified ? "verified" : "acceptedUnverified",
            };
            this.state.errorMessage = verified
                ? undefined
                : action === "disable"
                  ? SqlFeatures.queryStoreNotVerified
                  : undefined;
            if (verified) {
                void vscode.window.showInformationMessage(
                    SqlFeatures.queryStoreMaintenanceAccepted(label),
                );
            }
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
        } finally {
            this._queryStoreBusy = false;
            this.state.isLoading = false;
            this.updateState();
        }
    }

    private async inspectQueryStorePlan(queryId: number, planId: number): Promise<void> {
        const generation = ++this._planGeneration;
        if (
            !this._capabilities ||
            !Number.isSafeInteger(queryId) ||
            queryId <= 0 ||
            !Number.isSafeInteger(planId) ||
            planId <= 0
        ) {
            this.state.queryStorePlan = {
                queryId,
                planId,
                loading: false,
                error: SqlFeatures.queryStorePlanIdentityInvalid,
            };
            this.updateState();
            return;
        }
        this.state.queryStorePlan = { queryId, planId, loading: true };
        this.updateState();
        try {
            const outcome = await runCatalogQuery(
                planForQueryStorePlan,
                this._runner,
                this._capabilities,
                {
                    params: { queryId, planId },
                    queryStoreOn: this._queryStoreEnabled,
                    diagnostics: this._diagnostics,
                },
            );
            if (generation !== this._planGeneration) return;
            if (outcome.outcome !== "succeeded" || !outcome.result) {
                this.state.queryStorePlan = {
                    queryId,
                    planId,
                    loading: false,
                    error:
                        outcome.error ??
                        outcome.gate.reason ??
                        SqlFeatures.queryStorePlanUnavailable,
                };
                return;
            }
            const row = outcome.result.rows[0];
            const inspection = inspectQueryStorePlanXml(row?.query_plan, outcome.result.truncated);
            this.state.queryStorePlan = {
                queryId,
                planId,
                loading: false,
                inspection,
                isForced: row?.is_forced_plan === true || Number(row?.is_forced_plan) === 1,
                forceFailureCount: numericValue(row?.force_failure_count),
                forceFailureReason:
                    typeof row?.last_force_failure_reason_desc === "string"
                        ? row.last_force_failure_reason_desc
                        : undefined,
            };
            await this.readQueryStoreHint(queryId, generation);
        } catch (error) {
            this.state.queryStorePlan = {
                queryId,
                planId,
                loading: false,
                error: getErrorMessage(error),
            };
        }
        this.updateState();
    }

    private async readQueryStoreHint(
        queryId: number,
        generation = this._planGeneration,
    ): Promise<void> {
        const capabilities = this._capabilities;
        if (!capabilities || !queryStoreInterventionCapabilities(capabilities).hints) {
            this.state.queryStoreHint = { queryId, loading: false };
            return;
        }
        try {
            const outcome = await runCatalogQuery(queryStoreHints, this._runner, capabilities, {
                params: { queryId },
                queryStoreOn: this._queryStoreEnabled,
                diagnostics: this._diagnostics,
            });
            if (generation !== this._planGeneration) return;
            const row = outcome.result?.rows[0];
            this.state.queryStoreHint = {
                queryId,
                loading: false,
                hint: typeof row?.query_hints === "string" ? row.query_hints : undefined,
                state: typeof row?.state_desc === "string" ? row.state_desc : undefined,
                failureReason:
                    typeof row?.last_query_hint_failure_reason_desc === "string"
                        ? row.last_query_hint_failure_reason_desc
                        : undefined,
                ...(outcome.error ? { error: outcome.error } : {}),
            };
        } catch (error) {
            this.state.queryStoreHint = { queryId, loading: false, error: getErrorMessage(error) };
        }
        this.updateState();
    }

    private async loadQueryStorePlans(queryId: number): Promise<void> {
        const capabilities = this._capabilities;
        if (!capabilities || !Number.isSafeInteger(queryId) || queryId <= 0) {
            this.state.queryStorePlans = {
                queryId,
                loading: false,
                plans: [],
                error: SqlFeatures.queryStorePlanIdentityInvalid,
            };
            this.updateState();
            return;
        }
        const generation = ++this._planGeneration;
        this.state.queryStorePlan = undefined;
        this.state.queryStoreHint = undefined;
        this.state.queryStorePlans = { queryId, loading: true, plans: [] };
        this.updateState();
        try {
            const evidenceParams = {
                ...(this.state.result?.params ?? {}),
                queryId,
            };
            const outcome = await runCatalogQuery(
                plansForQueryStoreQuery,
                this._runner,
                capabilities,
                {
                    params: evidenceParams,
                    queryStoreOn: this._queryStoreEnabled,
                    diagnostics: this._diagnostics,
                },
            );
            if (generation !== this._planGeneration) return;
            const plans = (outcome.result?.rows ?? [])
                .map((row) => ({
                    planId: Number(row.plan_id),
                    isForced: row.is_forced_plan === true || Number(row.is_forced_plan) === 1,
                    forceFailureCount: numericValue(row.force_failure_count),
                    forceFailureReason:
                        typeof row.last_force_failure_reason_desc === "string"
                            ? row.last_force_failure_reason_desc
                            : undefined,
                    firstObserved:
                        typeof row.first_compile_start_time === "string"
                            ? row.first_compile_start_time
                            : undefined,
                    lastObserved:
                        typeof row.last_compile_start_time === "string"
                            ? row.last_compile_start_time
                            : undefined,
                    executions: numericValue(row.executions) ?? 0,
                    totalDurationUs: numericValue(row.total_duration_us),
                    averageDurationUs: numericValue(row.avg_duration_us),
                    selectedMetricTotal: numericValue(row.selected_metric_total),
                    selectedMetricAverage: numericValue(row.selected_metric_average),
                    selectedMetricMaximum: numericValue(row.selected_metric_maximum),
                    observedIntervals: numericValue(row.observed_interval_count) ?? 0,
                    firstInterval:
                        typeof row.first_interval_start === "string"
                            ? row.first_interval_start
                            : undefined,
                    lastInterval:
                        typeof row.last_interval_start === "string"
                            ? row.last_interval_start
                            : undefined,
                    lastExecution:
                        typeof row.last_execution_time === "string"
                            ? row.last_execution_time
                            : undefined,
                }))
                .filter((plan) => Number.isSafeInteger(plan.planId) && plan.planId > 0);
            this.state.queryStorePlans = {
                queryId,
                loading: false,
                plans,
                ...(outcome.error ? { error: outcome.error } : {}),
            };
            await this.readQueryStoreHint(queryId, generation);
        } catch (error) {
            if (generation === this._planGeneration) {
                this.state.queryStorePlans = {
                    queryId,
                    loading: false,
                    plans: [],
                    error: getErrorMessage(error),
                };
            }
        }
        this.updateState();
    }

    private async runQueryStorePlanAction(
        queryId: number,
        planId: number,
        action: QueryStorePlanAction,
    ): Promise<void> {
        const capabilities = this._capabilities;
        const database = capabilities?.database;
        if (
            !capabilities ||
            !database ||
            !queryStoreInterventionCapabilities(capabilities).planForcing ||
            !Number.isSafeInteger(queryId) ||
            queryId <= 0 ||
            !Number.isSafeInteger(planId) ||
            planId <= 0
        ) {
            this.state.errorMessage = SqlFeatures.queryStoreInterventionUnavailable;
            this.updateState();
            return;
        }
        await this.readQueryStoreState(capabilities);
        if (this.state.queryStore?.canConfigure !== true) {
            this.state.errorMessage = SqlFeatures.queryStoreConfigurePermission;
            this.updateState();
            return;
        }
        await this.inspectQueryStorePlan(queryId, planId);
        let sql: string;
        try {
            sql = compileQueryStorePlanAction(queryId, planId, action);
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
            return;
        }
        const reviewedState = queryStoreFingerprint(this.state.queryStore);
        const reviewedPlan = queryStorePlanFingerprint(this.state.queryStorePlan);
        const label =
            action === "force"
                ? SqlFeatures.queryStoreForcePlan
                : SqlFeatures.queryStoreUnforcePlan;
        const choice = await vscode.window.showWarningMessage(
            SqlFeatures.reviewQueryStorePlanAction(label, queryId, planId),
            { modal: true, detail: sql },
            SqlFeatures.apply,
            SqlFeatures.generateSql,
        );
        if (choice === SqlFeatures.generateSql) {
            const document = await vscode.workspace.openTextDocument({
                language: "sql",
                content: sql,
            });
            await vscode.window.showTextDocument(document, { preview: false });
            return;
        }
        if (choice !== SqlFeatures.apply) return;
        try {
            await this.readQueryStoreState(capabilities);
            await this.inspectQueryStorePlan(queryId, planId);
            if (
                queryStoreFingerprint(this.state.queryStore) !== reviewedState ||
                queryStorePlanFingerprint(this.state.queryStorePlan) !== reviewedPlan
            ) {
                this.state.errorMessage = SqlFeatures.queryStoreStateChanged;
                this.updateState();
                return;
            }
            await this._runner.query(sql, { tag: `sqlDiag.queryStore.${action}Plan` });
            await this.inspectQueryStorePlan(queryId, planId);
            const forced = this.state.queryStorePlan?.isForced;
            const verified = forced === (action === "force");
            this.state.errorMessage = verified ? undefined : SqlFeatures.queryStoreNotVerified;
            if (verified)
                void vscode.window.showInformationMessage(
                    SqlFeatures.queryStorePlanVerified(label),
                );
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
        }
        this.updateState();
    }

    private async runQueryStoreHint(queryId: number, hint?: string): Promise<void> {
        const capabilities = this._capabilities;
        const database = capabilities?.database;
        if (!capabilities || !database || !queryStoreInterventionCapabilities(capabilities).hints) {
            this.state.errorMessage = SqlFeatures.queryStoreHintUnavailable;
            this.updateState();
            return;
        }
        await this.readQueryStoreState(capabilities);
        await this.readQueryStoreHint(queryId);
        if (this.state.queryStore?.canConfigure !== true) {
            this.state.errorMessage = SqlFeatures.queryStoreConfigurePermission;
            this.updateState();
            return;
        }
        const reviewedState = queryStoreFingerprint(this.state.queryStore);
        const reviewedHint = queryStoreHintFingerprint(this.state.queryStoreHint);
        let sql: string;
        try {
            sql =
                hint === undefined
                    ? compileClearQueryStoreHint(queryId)
                    : compileQueryStoreHint(queryId, hint);
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
            return;
        }
        const action =
            hint === undefined ? SqlFeatures.queryStoreClearHint : SqlFeatures.queryStoreSetHint;
        const choice = await vscode.window.showWarningMessage(
            SqlFeatures.reviewQueryStoreHint(action, queryId),
            { modal: true, detail: sql },
            SqlFeatures.apply,
            SqlFeatures.generateSql,
        );
        if (choice === SqlFeatures.generateSql) {
            const document = await vscode.workspace.openTextDocument({
                language: "sql",
                content: sql,
            });
            await vscode.window.showTextDocument(document, { preview: false });
            return;
        }
        if (choice !== SqlFeatures.apply) return;
        try {
            await this.readQueryStoreState(capabilities);
            await this.readQueryStoreHint(queryId);
            if (
                queryStoreFingerprint(this.state.queryStore) !== reviewedState ||
                queryStoreHintFingerprint(this.state.queryStoreHint) !== reviewedHint
            ) {
                this.state.errorMessage = SqlFeatures.queryStoreStateChanged;
                this.updateState();
                return;
            }
            await this._runner.query(sql, {
                tag: `sqlDiag.queryStore.${hint === undefined ? "clearHint" : "setHint"}`,
            });
            await this.readQueryStoreHint(queryId);
            const applied = this.state.queryStoreHint?.hint;
            const verified = hint === undefined ? applied === undefined : applied === hint;
            this.state.errorMessage = verified ? undefined : SqlFeatures.queryStoreNotVerified;
            if (verified)
                void vscode.window.showInformationMessage(
                    SqlFeatures.queryStoreHintVerified(action),
                );
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
        }
        this.updateState();
    }

    private async exportCsv(): Promise<void> {
        const result = this.state.result;
        if (!result || result.rows.length === 0) {
            return;
        }

        const header = result.columns.map((c) => c.header).join(",");
        const lines = result.rows.map((row) =>
            result.columns.map((c) => csvCell(row[c.field])).join(","),
        );
        const snapshot = result.snapshot;
        const queryStoreContext = result.queryStoreContext;
        const metadata = [
            "",
            `# ${SqlFeatures.diagnosticsCsv.snapshotMetadata}`,
            `# ${SqlFeatures.diagnosticsCsv.query}: ${result.queryId}`,
            `# ${SqlFeatures.diagnosticsCsv.collected}: ${snapshot.collectionStartedAt} to ${snapshot.collectionEndedAt}`,
            `# ${SqlFeatures.diagnosticsCsv.completeness}: ${snapshot.completeness}`,
            `# ${SqlFeatures.diagnosticsCsv.scope}: ${snapshot.scope.serverName ?? ""} / ${snapshot.scope.database ?? ""}`,
            `# ${SqlFeatures.diagnosticsCsv.window}: ${snapshot.window.kind}${snapshot.window.start ? ` / ${snapshot.window.start}` : ""}${snapshot.window.end ? ` to ${snapshot.window.end}` : ""}`,
            ...(queryStoreContext
                ? [
                      `# ${SqlFeatures.diagnosticsCsv.referenceTime}: ${queryStoreContext.window.referenceAt}`,
                      `# ${SqlFeatures.diagnosticsCsv.currentInterval}: ${queryStoreContext.window.includesCurrentInterval}`,
                      `# ${SqlFeatures.diagnosticsCsv.metric}: ${snapshot.metric ?? SqlFeatures.diagnosticsCsv.none}`,
                      `# ${SqlFeatures.diagnosticsCsv.filters}: ${JSON.stringify(queryStoreContext.filters)}`,
                      `# ${SqlFeatures.diagnosticsCsv.units}`,
                  ]
                : []),
            `# ${SqlFeatures.diagnosticsCsv.aggregation}: ${snapshot.aggregation ?? ""}`,
            `# ${SqlFeatures.diagnosticsCsv.rowCap}: ${snapshot.rowLimit ?? SqlFeatures.diagnosticsCsv.none}`,
            `# ${SqlFeatures.diagnosticsCsv.exclusions}: ${snapshot.exclusions.join("; ") || SqlFeatures.diagnosticsCsv.none}`,
            `# ${SqlFeatures.diagnosticsCsv.coverage}: ${snapshot.coverage.kind}${snapshot.coverage.note ? ` / ${snapshot.coverage.note}` : ""}`,
            ...(snapshot.coverage.observedIntervals === undefined
                ? []
                : [
                      `# ${SqlFeatures.diagnosticsCsv.coverageObserved}: ${snapshot.coverage.observedIntervals}`,
                  ]),
            ...(snapshot.coverage.availableIntervals === undefined
                ? []
                : [
                      `# ${SqlFeatures.diagnosticsCsv.coverageExpected}: ${snapshot.coverage.availableIntervals}`,
                  ]),
            ...(snapshot.coverage.baselineObservedIntervals === undefined
                ? []
                : [
                      `# ${SqlFeatures.diagnosticsCsv.coverageBaselineObserved}: ${snapshot.coverage.baselineObservedIntervals}`,
                  ]),
            ...(snapshot.coverage.baselineAvailableIntervals === undefined
                ? []
                : [
                      `# ${SqlFeatures.diagnosticsCsv.coverageBaselineExpected}: ${snapshot.coverage.baselineAvailableIntervals}`,
                  ]),
        ];
        const document = await vscode.workspace.openTextDocument({
            language: "csv",
            content: [header, ...lines, ...metadata].join("\n"),
        });
        await vscode.window.showTextDocument(document, { preview: false });
    }

    private fail(error: unknown): void {
        this.state.isLoading = false;
        this.state.errorMessage = getErrorMessage(error);
        this.updateState();
    }
}

function sourceFileForSection(section: DiagnosticsSection): string {
    switch (section) {
        case "dmv":
            return "sqlActivity";
        case "querystore":
            return "queryStore";
        case "agent":
            return "sqlAgent";
    }
}

/** Escapes a value for CSV: quotes wrap anything containing a delimiter, and quotes double. */
function csvCell(value: unknown): string {
    const text = cellDisplayText(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function queryStoreFingerprint(state: SqlDiagnosticsState["queryStore"]): string {
    return JSON.stringify([
        state?.access,
        state?.canReadHistory,
        state?.actualState,
        state?.desiredState,
        state?.canConfigure,
        state?.captureMode,
        state?.maxStorageMb,
        state?.runtimeIntervalMinutes,
        state?.flushIntervalSeconds,
        state?.retentionDays,
        state?.waitCaptureMode,
        state?.cleanupMode,
    ]);
}

function queryStoreHintFingerprint(state: SqlDiagnosticsState["queryStoreHint"]): string {
    return JSON.stringify([state?.queryId, state?.hint, state?.state, state?.failureReason]);
}

function queryStorePlanFingerprint(state: SqlDiagnosticsState["queryStorePlan"]): string {
    return JSON.stringify([
        state?.queryId,
        state?.planId,
        state?.isForced,
        state?.forceFailureCount,
        state?.forceFailureReason,
        state?.inspection?.complete,
    ]);
}

function createSnapshot(
    section: DiagnosticsSection,
    server: SqlDiagnosticsState["server"],
    queryId: string,
    params: Record<string, unknown> | undefined,
    rowCount: number,
    truncated: boolean,
    collectionStartedAt: string,
    collectionEndedAt: string,
    queryStoreContext?: QueryStoreInvestigationContext,
    rows: readonly Record<string, unknown>[] = [],
): DiagnosticsSnapshot {
    const effectiveParams = params ?? {};
    const end = new Date(collectionEndedAt);
    const lookbackHours = numericParam(effectiveParams.hours, 24);
    const recentHours = numericParam(effectiveParams.recentHours, 1);
    const baselineHours = numericParam(effectiveParams.baselineHours, recentHours);
    const endTime = Number.isNaN(end.getTime()) ? collectionEndedAt : end.toISOString();
    const hoursAgo = (hours: number) =>
        new Date(end.getTime() - hours * 60 * 60 * 1000).toISOString();

    let window: DiagnosticsSnapshot["window"];
    if (queryStoreContext) {
        window = {
            kind: queryStoreContext.window.kind,
            start: queryStoreContext.window.start,
            end: queryStoreContext.window.end,
            ...(queryStoreContext.window.baselineStart
                ? { baselineStart: queryStoreContext.window.baselineStart }
                : {}),
            ...(queryStoreContext.window.baselineEnd
                ? { baselineEnd: queryStoreContext.window.baselineEnd }
                : {}),
            label: SqlFeatures.diagnosticsQueryStoreWindow(queryStoreContext.window.timezone),
        };
    } else if (queryId === "qds.regressedQueries") {
        window = {
            kind: "comparison",
            start: hoursAgo(recentHours + baselineHours),
            end: endTime,
            baselineStart: hoursAgo(recentHours + baselineHours),
            baselineEnd: hoursAgo(recentHours),
            label: SqlFeatures.diagnosticsQueryStoreComparisonWindow,
        };
    } else if (queryId.startsWith("qds.")) {
        window = {
            kind: "lookback",
            start: hoursAgo(lookbackHours),
            end: endTime,
            label: SqlFeatures.diagnosticsQueryStoreLookback(lookbackHours),
        };
    } else if (queryId === "dmv.waitStats" || queryId === "dmv.waitStatsAzure") {
        window = { kind: "sinceReset", label: SqlFeatures.diagnosticsWaitCounterReset };
    } else if (queryId === "dmv.fileIoStalls") {
        window = { kind: "sinceReset", label: SqlFeatures.diagnosticsStorageCounterReset };
    } else {
        window = { kind: "pointInTime", start: collectionStartedAt, end: endTime };
    }

    const metric =
        queryStoreContext?.metric ??
        (queryId.includes("Cpu")
            ? "cpu"
            : queryId.includes("Reads")
              ? "reads"
              : queryId.includes("Duration") ||
                  queryId.includes("Resource") ||
                  queryId.includes("regressed")
                ? "duration"
                : queryId.includes("wait")
                  ? "waits"
                  : queryId.includes("fileIo")
                    ? "storage"
                    : undefined);
    const aggregation = queryStoreContext
        ? queryStoreContext.aggregation === "total"
            ? "sum"
            : queryStoreContext.aggregation
        : queryId === "qds.highVariation"
          ? "pooledVariation"
          : queryId.startsWith("qds.")
            ? "weightedMean"
            : queryId.includes("topQueries")
              ? "sum"
              : "raw";
    const exclusions: string[] = [];
    if (
        (queryId === "dmv.waitStats" || queryId === "dmv.waitStatsAzure") &&
        effectiveParams.showBackground !== true
    ) {
        exclusions.push("background wait types");
    }
    const top =
        queryStoreContext?.rowLimit ??
        numericParam(effectiveParams.top, undefined) ??
        defaultDmvRowLimit(queryId);
    const coverage = queryStoreContext ? queryStoreCoverageFromRows(rows) : undefined;
    const coveragePartial = queryStoreCoverageIsPartial(coverage);
    return {
        collectionStartedAt,
        collectionEndedAt,
        completeness:
            truncated || coveragePartial ? "partial" : rowCount === 0 ? "empty" : "complete",
        scope: {
            section,
            serverName: server?.serverName,
            database: server?.database,
            targetId: typeof effectiveParams.jobId === "string" ? effectiveParams.jobId : undefined,
        },
        window,
        ...(metric ? { metric } : {}),
        aggregation,
        ...(top !== undefined ? { rowLimit: top } : {}),
        exclusions,
        coverage: queryStoreContext
            ? {
                  kind: "intervals",
                  ...(coverage?.observedIntervals === undefined
                      ? {}
                      : { observedIntervals: coverage.observedIntervals }),
                  ...(coverage?.availableIntervals === undefined
                      ? {}
                      : { availableIntervals: coverage.availableIntervals }),
                  ...(coverage?.baselineObservedIntervals === undefined
                      ? {}
                      : { baselineObservedIntervals: coverage.baselineObservedIntervals }),
                  ...(coverage?.baselineAvailableIntervals === undefined
                      ? {}
                      : { baselineAvailableIntervals: coverage.baselineAvailableIntervals }),
                  note: SqlFeatures.diagnosticsQueryStoreCoverage,
              }
            : queryId.startsWith("qds.")
              ? { kind: "intervals", note: SqlFeatures.diagnosticsQueryStoreCoverage }
              : { kind: "point" },
    };
}

function defaultDmvRowLimit(queryId: string): number | undefined {
    switch (queryId) {
        case "dmv.activeRequests":
            return 200;
        case "dmv.topQueriesByDuration":
        case "dmv.topQueriesByCpu":
        case "dmv.topQueriesByReads":
        case "dmv.topWorkload":
            return 50;
        case "dmv.waitStats":
        case "dmv.waitStatsAzure":
            return 1000;
        case "dmv.missingIndexes":
            return 40;
        default:
            return undefined;
    }
}

function queryStoreCoverageIsPartial(
    coverage: ReturnType<typeof queryStoreCoverageFromRows> | undefined,
): boolean {
    return (
        (coverage?.observedIntervals !== undefined &&
            coverage.availableIntervals !== undefined &&
            coverage.observedIntervals < coverage.availableIntervals) ||
        (coverage?.baselineObservedIntervals !== undefined &&
            coverage.baselineAvailableIntervals !== undefined &&
            coverage.baselineObservedIntervals < coverage.baselineAvailableIntervals)
    );
}

function numericParam(value: unknown, fallback: number | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return fallback;
}

function numericValue(value: unknown): number | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function isPermissionError(message: string): boolean {
    return /permission|denied|not authorized|VIEW DATABASE STATE|ALTER DATABASE/i.test(message);
}

function isWaitQuery(queryId: string): boolean {
    return queryId === "dmv.waitStats" || queryId === "dmv.waitStatsAzure";
}

function isStorageQuery(queryId: string): boolean {
    return queryId === "dmv.fileIoStalls";
}

function waitParamsMatch(
    left: Record<string, unknown> | undefined,
    right: Record<string, unknown> | undefined,
): boolean {
    return (left?.showBackground === true) === (right?.showBackground === true);
}

function storageParamsMatch(
    left: Record<string, unknown> | undefined,
    right: Record<string, unknown> | undefined,
): boolean {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}
