/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The one entry point for SQL performance data. Copilot and MCP tools and webview dialogs call
 * the same methods and get the same plain-JSON sql-core results, so neither surface owns logic.
 * The service has no commands, UI, or prompts: when it cannot run, it returns a
 * `PerformanceUnavailable` code for the surface to explain, and a plan change runs only when the
 * surface passes back a change that the user approved.
 *
 * Usage:
 *
 *     const target = await performanceService.resolveTarget({ ownerUri, database });
 *     if (isPerformanceUnavailable(target)) { ...show text for target.reason... }
 *     const result = await target.topConsumers({}, { timeoutMs: 15_000, signal });
 */

import {
    PlatformInfo,
    SessionPurpose,
    SqlReadOptions,
    SqlReader,
    detectPlatform,
    listDatabases,
} from "sql-core";
import {
    ActiveActivity,
    AppliedChange,
    ForcedPlanQueriesRunConfig,
    ForcedPlanVerification,
    HighVariationRunConfig,
    OverallResourceConsumptionRunConfig,
    PerfResult,
    PerfRunOptions,
    PlanChangeRequest,
    PlanSummaryGridRunConfig,
    PlanSummaryRunConfig,
    PlanXml,
    PreparedChange,
    QueryInsightsTopQueriesRequest,
    QueryInsightsTopQuery,
    QueryStoreCapabilities,
    QueryStoreMetric,
    QueryStoreReport,
    QueryStoreRunOptions,
    QueryTextResult,
    QueryWaitCategoriesRunConfig,
    RegressedQueriesReport,
    RegressedQueriesRunConfig,
    TopResourceConsumersRunConfig,
    TrackedQueriesRunConfig,
    VerifyForcedPlanRequest,
    WaitStatsQueriesRunConfig,
    WaitStatsRunConfig,
    applyPreparedChange,
    errorResult,
    getActiveRequests,
    prepareForcePlan as prepareForcePlanChange,
    prepareUnforcePlan as prepareUnforcePlanChange,
    probeQueryStore,
    runForcedPlanQueries,
    runHighVariationDetailedSummary,
    runHighVariationSummary,
    runOverallResourceConsumption,
    runPlanSummaryChart,
    runPlanSummaryGrid,
    runPlanXml,
    runQueryInsightsTopQueries,
    runQueryText,
    runQueryWaitCategories,
    runRegressedQueriesDetailedSummary,
    runRegressedQueriesSummary,
    runTopResourceConsumersDetailedSummary,
    runTopResourceConsumersSummary,
    runTrackedQueries,
    runWaitStatsByCategory,
    runWaitStatsQueriesForCategory,
    verifyForcedPlan as readForcedPlanVerification,
} from "sql-core/performance";
import ConnectionManager from "../controllers/connectionManager";
import { PrivatePreviewFeature, previewService } from "../previews/previewService";
import { PreparedConnection } from "../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import {
    PerformanceConnectionReference,
    PerformanceResult,
    PerformanceUnavailable,
    isPerformanceUnavailable,
} from "../sharedInterfaces/performance";
import { TruncationRecorder } from "./dataPlaneSqlReader";
import {
    ConnectionManagerPerformanceResolver,
    PerformanceConnectionResolver,
} from "./performanceConnections";
import {
    PerformanceDataPlaneHost,
    PerformanceSession,
    PerformanceSessionPool,
    unavailable,
} from "./performanceSessionPool";

/** A sql-core provider bound to its arguments: it reads through `reader` on `info`'s platform. */
export type PerformanceProvider<T> = (
    reader: SqlReader,
    info: PlatformInfo,
) => Promise<PerfResult<T>>;

/** The shape of the sql-core Query Store run functions. */
type QueryStoreRun<C, T> = (
    reader: SqlReader,
    info: PlatformInfo,
    config: C,
    options: QueryStoreRunOptions,
) => Promise<PerfResult<T>>;

/** The probe results that let the Query Store run functions skip their metadata probes. */
export interface QueryStoreHints {
    readonly availableMetrics: readonly QueryStoreMetric[];
    readonly isQdsRoAvailable: boolean;
}

const unknownPlatform: PlatformInfo = { platform: "unknown", engineEdition: 0 };

export class PerformanceService {
    /** Detected platforms by connection identity and database. */
    private readonly _platforms = new Map<string, Promise<PlatformInfo>>();
    /** Query Store probe results by connection identity and database. */
    private readonly _queryStoreHints = new Map<
        string,
        QueryStoreHints & { readonly generation: number }
    >();
    private _disposed = false;

    constructor(
        private readonly _resolver: PerformanceConnectionResolver,
        private readonly _pool: PerformanceSessionPool,
    ) {}

    /** Returns why the service cannot run, or `undefined` when it can. Opens nothing. */
    availability(): PerformanceUnavailable | undefined {
        return this._disposed ? unavailable("dataPlaneUnavailable") : this._pool.availability();
    }

    /**
     * Finds the connection, opens its monitoring session, and returns the target to read from.
     * Returns a `PerformanceUnavailable` code when the data plane is off, the connection is not
     * found, or the session does not open.
     */
    async resolveTarget(
        reference: PerformanceConnectionReference,
    ): Promise<PerformanceTarget | PerformanceUnavailable> {
        const blocked = this.availability();
        if (blocked) {
            return blocked;
        }
        const resolved = await this._resolver.resolve(reference);
        if (isPerformanceUnavailable(resolved)) {
            return resolved;
        }
        if (this._disposed) {
            return unavailable("dataPlaneUnavailable");
        }
        const connection = resolved.connection;
        const database = reference.database ?? resolved.database;
        const failure = await this._pool.session(connection, database, "read").ensureOpen();
        if (failure) {
            return failure;
        }
        const key = targetKey(connection, database);
        return new PerformanceTarget(database, {
            session: (purpose) => this._pool.session(connection, database, purpose),
            platform: () => this.platformFor(key, connection, database),
            queryStoreHints: () => this.queryStoreHintsFor(key, connection, database),
            rememberQueryStoreHints: (capabilities) =>
                this.rememberQueryStoreHints(key, connection, database, capabilities),
        });
    }

    dispose(): void {
        this._disposed = true;
        this._platforms.clear();
        this._queryStoreHints.clear();
        this._pool.dispose();
    }

    private platformFor(
        key: string,
        connection: PreparedConnection,
        database: string,
    ): Promise<PlatformInfo> {
        let platform = this._platforms.get(key);
        if (!platform) {
            platform = (async () =>
                detectPlatform(this._pool.session(connection, database, "read")))();
            this._platforms.set(key, platform);
            // A failed detection is not cached; the next call tries again.
            platform.catch(() => {
                if (this._platforms.get(key) === platform) {
                    this._platforms.delete(key);
                }
            });
        }
        return platform;
    }

    /** The cached probe results, while the session that they came from is still open. */
    private queryStoreHintsFor(
        key: string,
        connection: PreparedConnection,
        database: string,
    ): QueryStoreHints | undefined {
        const cached = this._queryStoreHints.get(key);
        if (!cached || this._disposed) {
            return undefined;
        }
        if (cached.generation !== this._pool.session(connection, database, "read").generation) {
            this._queryStoreHints.delete(key);
            return undefined;
        }
        return {
            availableMetrics: cached.availableMetrics,
            isQdsRoAvailable: cached.isQdsRoAvailable,
        };
    }

    private rememberQueryStoreHints(
        key: string,
        connection: PreparedConnection,
        database: string,
        capabilities: QueryStoreCapabilities,
    ): void {
        if (this._disposed) {
            return;
        }
        this._queryStoreHints.set(key, {
            availableMetrics: capabilities.availableMetrics,
            isQdsRoAvailable: capabilities.isQdsRoAvailable,
            generation: this._pool.session(connection, database, "read").generation,
        });
    }
}

interface PerformanceTargetContext {
    session(purpose: SessionPurpose): PerformanceSession;
    platform(): Promise<PlatformInfo>;
    queryStoreHints(): QueryStoreHints | undefined;
    rememberQueryStoreHints(capabilities: QueryStoreCapabilities): void;
}

/**
 * A database to read performance data from. Every method returns the plain-JSON sql-core result
 * unchanged, plus `truncated` when the data plane shortened values. `options` forwards `signal`,
 * `timeoutMs`, and `now` to sql-core.
 */
export class PerformanceTarget {
    constructor(
        readonly database: string,
        private readonly _context: PerformanceTargetContext,
    ) {}

    /** The platform and version of the server. Detected once for each connection and database. */
    platform(): Promise<PlatformInfo> {
        return this._context.platform();
    }

    /** Running requests and blocking chains. */
    activeRequests(options?: SqlReadOptions): Promise<PerformanceResult<ActiveActivity>> {
        return this.run("read", (reader, info) => getActiveRequests(reader, info, options));
    }

    /**
     * The online databases that the connection can see. In Azure SQL Database, a user database
     * sees only itself and `master`.
     */
    databases(options?: SqlReadOptions): Promise<PerformanceResult<string[]>> {
        return this.run("read", async (reader, info) => ({
            status: "ready",
            platform: info.platform,
            observedAtUtc: new Date().toISOString(),
            missing: [],
            data: await listDatabases(reader, info, options),
        }));
    }

    // -----------------------------------------------------------------------------------------
    // Query Store
    //
    // Each method calls one sql-core run function on the "read" session, except applyChange,
    // which uses the "change" session. The results of queryStoreCapabilities are cached for the
    // connection and database and passed to later runs as `availableMetrics` and
    // `isQdsRoAvailable`, so they skip those probes. The cache ends when the session reopens;
    // call queryStoreCapabilities again to refresh it.
    // -----------------------------------------------------------------------------------------

    /** Query Store state, metrics, and replicas. Always reads, and refreshes the cache. */
    async queryStoreCapabilities(
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreCapabilities>> {
        const result = await this.run("read", (reader, info) =>
            probeQueryStore(reader, info, options),
        );
        if (result.data) {
            this._context.rememberQueryStoreHints(result.data);
        }
        return result;
    }

    topConsumers(
        config: TopResourceConsumersRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runTopResourceConsumersSummary, config, options);
    }

    topConsumersDetailed(
        config: TopResourceConsumersRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runTopResourceConsumersDetailedSummary, config, options);
    }

    /** Regressed queries, with `planChanges` that say whether each query has a new plan. */
    regressedQueries(
        config: RegressedQueriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<RegressedQueriesReport>> {
        return this.queryStore(runRegressedQueriesSummary, config, options);
    }

    regressedQueriesDetailed(
        config: RegressedQueriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<RegressedQueriesReport>> {
        return this.queryStore(runRegressedQueriesDetailedSummary, config, options);
    }

    highVariation(
        config: HighVariationRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runHighVariationSummary, config, options);
    }

    highVariationDetailed(
        config: HighVariationRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runHighVariationDetailedSummary, config, options);
    }

    overallConsumption(
        config: OverallResourceConsumptionRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runOverallResourceConsumption, config, options);
    }

    forcedPlans(
        config: ForcedPlanQueriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runForcedPlanQueries, config, options);
    }

    trackedQueries(
        config: TrackedQueriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runTrackedQueries, config, options);
    }

    planSummaryChart(
        config: PlanSummaryRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runPlanSummaryChart, config, options);
    }

    planSummaryGrid(
        config: PlanSummaryGridRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runPlanSummaryGrid, config, options);
    }

    waitStatsByCategory(
        config: WaitStatsRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runWaitStatsByCategory, config, options);
    }

    waitStatsQueriesForCategory(
        config: WaitStatsQueriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runWaitStatsQueriesForCategory, config, options);
    }

    queryWaitCategories(
        config: QueryWaitCategoriesRunConfig,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryStoreReport>> {
        return this.queryStore(runQueryWaitCategories, config, options);
    }

    queryText(
        config: { readonly queryId: number | bigint | string },
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryTextResult>> {
        return this.queryStore(runQueryText, config, options);
    }

    /** Showplan XML. When the data plane shortens it, `truncated` lists the `query_plan` value. */
    planXml(
        config: { readonly planId: number | bigint | string },
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<PlanXml>> {
        return this.queryStore(runPlanXml, config, options);
    }

    /** Top queries from Query Insights, on Fabric Data Warehouse and the SQL analytics endpoint. */
    queryInsightsTopQueries(
        request: QueryInsightsTopQueriesRequest,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<QueryInsightsTopQuery[]>> {
        return this.run("read", (reader, info) =>
            runQueryInsightsTopQueries(reader, info, request, options),
        );
    }

    // -----------------------------------------------------------------------------------------
    // Plan changes: prepare, approve in the surface, apply, verify
    // -----------------------------------------------------------------------------------------

    /**
     * Reads the state and returns a change that forces the plan, with its blockers, warnings, and
     * exact SQL. It changes nothing. The surface shows it to the user for approval.
     */
    prepareForcePlan(
        request: PlanChangeRequest,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<PreparedChange>> {
        return this.queryStore(prepareForcePlanChange, request, options);
    }

    /** Like {@link prepareForcePlan}, for a change that stops forcing the plan. */
    prepareUnforcePlan(
        request: PlanChangeRequest,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<PreparedChange>> {
        return this.queryStore(prepareUnforcePlanChange, request, options);
    }

    /**
     * Runs a change on the "change" session. Pass only a `PreparedChange` that
     * {@link prepareForcePlan} or {@link prepareUnforcePlan} returned and that the user approved
     * in the surface: the service never asks for approval and never builds a change itself.
     * sql-core reads the state again and refuses the change (`applied: false`, with `blockers`)
     * when the state is not the same as `prepared.prior` or the SQL is not the SQL for the
     * target. A failed change is not retried. Pass `appliedAtUtc` to {@link verifyForcedPlan}.
     */
    applyChange(
        prepared: PreparedChange,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<AppliedChange>> {
        return this.queryStore(applyPreparedChange, prepared, options, "change");
    }

    /** Whether the plan is forced and which plans the query ran with since `request.since`. */
    verifyForcedPlan(
        request: VerifyForcedPlanRequest,
        options?: PerfRunOptions,
    ): Promise<PerformanceResult<ForcedPlanVerification>> {
        return this.queryStore(readForcedPlanVerification, request, options);
    }

    /**
     * Runs a sql-core provider on this target's session for `purpose`. A provider that throws,
     * or a platform that cannot be detected, returns an error result instead.
     */
    async run<T>(
        purpose: SessionPurpose,
        provider: PerformanceProvider<T>,
    ): Promise<PerformanceResult<T>> {
        let info: PlatformInfo;
        try {
            info = await this.platform();
        } catch (error) {
            return errorResult<T>(unknownPlatform, error, new Date());
        }
        let recorder: TruncationRecorder | undefined;
        let result: PerfResult<T>;
        try {
            recorder = new TruncationRecorder(this._context.session(purpose));
            result = await provider(recorder, info);
        } catch (error) {
            result = errorResult<T>(info, error, new Date());
        }
        return recorder && recorder.truncated.length > 0
            ? { ...result, truncated: recorder.truncated }
            : result;
    }

    /** Runs a Query Store run function with the caller's options and the cached probe results. */
    private queryStore<C, T>(
        runFunction: QueryStoreRun<C, T>,
        config: C,
        options: PerfRunOptions | undefined,
        purpose: SessionPurpose = "read",
    ): Promise<PerformanceResult<T>> {
        const runOptions: QueryStoreRunOptions = {
            ...options,
            ...this._context.queryStoreHints(),
        };
        return this.run(purpose, (reader, info) => runFunction(reader, info, config, runOptions));
    }
}

/** Composes the service for the extension host. Called once at activation. */
export function createPerformanceService(connectionManager: ConnectionManager): PerformanceService {
    return new PerformanceService(
        new ConnectionManagerPerformanceResolver(connectionManager),
        new PerformanceSessionPool(createDataPlaneHost()),
    );
}

/**
 * The data plane facts for the pool. SQL Tools Service starts the data plane only at startup, so
 * the settings are also read now, at activation, to tell a needed reload apart.
 */
export function createDataPlaneHost(): PerformanceDataPlaneHost {
    const isEnabled = () =>
        previewService.isPrivatePreviewEnabled(PrivatePreviewFeature.SqlDataPlane);
    const enabledAtActivation = isEnabled();
    return {
        isEnabled,
        wasEnabledAtActivation: () => enabledAtActivation,
        serviceForProfile: (profileFingerprint) =>
            SqlDataPlaneService.get().serviceForProfile(profileFingerprint),
    };
}

function targetKey(connection: PreparedConnection, database: string): string {
    return JSON.stringify([connection.serverFingerprint, database]);
}
