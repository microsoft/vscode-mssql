/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SimpleExecuteResult } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";
import * as Constants from "../constants/constants";
import ConnectionManager, { ConnectionInfo } from "../controllers/connectionManager";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { logger2 } from "../models/logger2";
import { InlineCompletionDebugSchemaContextOverrides } from "../sharedInterfaces/inlineCompletionDebug";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";
import { inlineCompletionDebugStore } from "./inlineCompletionDebug/inlineCompletionDebugStore";

const schemaContextRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void,
    void
>("query/simpleexecute");

const defaultCacheTtlMs = 30 * 60 * 1000;
const schemaContextFetchWaitTimeoutMs = 5 * 60 * 1000;
const schemaContextFetchTimeoutBackoffTtlMs = 15 * 60 * 1000;
const errorBackoffTtlMs = [30 * 1000, 60 * 1000, 120 * 1000, 300 * 1000];
const maxCacheEntries = 32;
const minimumPromptBudgetChars = 4096;
const sqlUnlimitedCap = 1000000;

export type SqlInlineCompletionSchemaBudgetProfileId =
    | "tight"
    | "balanced"
    | "generous"
    | "unlimited"
    | "custom";
export type SqlInlineCompletionSchemaSizeKind = "small" | "medium" | "large" | "outlier";
export type SqlInlineCompletionColumnRepresentation = "compact" | "types" | "verbose";
type SchemaBudgetProfileId = SqlInlineCompletionSchemaBudgetProfileId;
type SchemaSizeKind = SqlInlineCompletionSchemaSizeKind;
type ColumnRepresentation = SqlInlineCompletionColumnRepresentation;
export type SqlInlineCompletionPromptMessageOrder = "rules-then-data" | "data-then-rules";
export type SqlInlineCompletionSchemaContextChannel = "inline-with-data" | "separate-message";

interface RawSchemaName {
    name?: string;
}

interface RawObjectColumn {
    name?: string;
    definition?: string;
    isPrimaryKey?: boolean | number;
    referencedTable?: string;
    referencedColumn?: string;
}

interface RawForeignKey {
    column?: string;
    referencedTable?: string;
    referencedColumn?: string;
}

interface RawSchemaObject {
    schema?: string;
    name?: string;
    columns?: RawObjectColumn[];
    foreignKeys?: RawForeignKey[];
}

interface RawRoutineParameter {
    name?: string;
    definition?: string;
    direction?: string;
}

interface RawRoutine {
    schema?: string;
    name?: string;
    type?: string;
    typeDescription?: string;
    returnType?: string;
    parameters?: RawRoutineParameter[];
    returnColumns?: RawObjectColumn[];
}

interface RawMasterSymbol {
    schema?: string;
    name?: string;
}

interface RawSchemaContextPayload {
    server?: string;
    database?: string;
    defaultSchema?: string;
    engineEdition?: number | string;
    engineEditionName?: string;
    totalTableCount?: number | string;
    totalViewCount?: number | string;
    totalRoutineCount?: number | string;
    schemas?: RawSchemaName[];
    tables?: RawSchemaObject[];
    views?: RawSchemaObject[];
    routines?: RawRoutine[];
    tableNameOnlyInventory?: RawMasterSymbol[];
    viewNameOnlyInventory?: RawMasterSymbol[];
    routineNameOnlyInventory?: RawMasterSymbol[];
    systemObjects?: RawSchemaObject[];
    masterSymbols?: RawMasterSymbol[];
}

interface CacheEntry {
    connectionFingerprint: string;
    expiresAt: number;
    value: SqlInlineCompletionSchemaContext | undefined;
    failureCount: number;
}

interface InFlightEntry {
    connectionFingerprint: string;
    promise: Promise<SqlInlineCompletionSchemaContext | undefined>;
}

export interface SqlInlineCompletionForeignKey {
    column: string;
    referencedTable: string;
    referencedColumn: string;
}

export interface SqlInlineCompletionSchemaObject {
    name: string;
    columns: string[];
    columnDefinitions?: string[];
    primaryKeyColumns?: string[];
    foreignKeys?: SqlInlineCompletionForeignKey[];
}

export interface SqlInlineCompletionRoutineParameter {
    name: string;
    definition?: string;
    direction?: string;
}

export interface SqlInlineCompletionRoutine {
    name: string;
    type: string;
    typeDescription?: string;
    parameters: SqlInlineCompletionRoutineParameter[];
    returnType?: string;
    returnColumns?: string[];
    returnColumnDefinitions?: string[];
}

export interface SqlInlineCompletionSchemaContextSelectionMetadata {
    budgetProfile: SchemaBudgetProfileId;
    schemaSizeKind: SchemaSizeKind;
    schemaSizeSummary: string;
    columnRepresentation: ColumnRepresentation;
    inventoryChunkSize: number;
    maxPromptChars: number;
    maxPromptTokens?: number;
    includeRoutines: boolean;
    degradationSteps: string[];
}

export interface SqlInlineCompletionSchemaContext {
    server?: string;
    database?: string;
    defaultSchema?: string;
    engineEdition?: number;
    engineEditionName?: string;
    totalTableCount?: number;
    totalViewCount?: number;
    totalRoutineCount?: number;
    schemas: string[];
    tables: SqlInlineCompletionSchemaObject[];
    views: SqlInlineCompletionSchemaObject[];
    routines?: SqlInlineCompletionRoutine[];
    tableNameOnlyInventory?: string[];
    viewNameOnlyInventory?: string[];
    routineNameOnlyInventory?: string[];
    masterSymbols: string[];
    systemObjects?: SqlInlineCompletionSchemaObject[];
    inferredSystemQuery?: boolean;
    selectionMetadata?: SqlInlineCompletionSchemaContextSelectionMetadata;
}

export interface SqlInlineCompletionSchemaBudgetOverrides {
    maxSchemas?: number;
    maxTables?: number;
    maxViews?: number;
    maxColumnsPerObject?: number;
    smallSchemaMaxColumnsPerObject?: number;
    largeSchemaMaxColumnsPerObject?: number;
    maxFetchedTables?: number;
    maxFetchedViews?: number;
    maxTableNameOnlyInventory?: number;
    maxViewNameOnlyInventory?: number;
    largeTableNameOnlyInventory?: number;
    largeViewNameOnlyInventory?: number;
    outlierNameOnlyInventory?: number;
    maxFetchedSchemas?: number;
    maxSystemObjects?: number;
    maxMasterSymbols?: number;
    maxForeignKeys?: number;
    maxSchemaContextRelevanceTerms?: number;
    maxRoutines?: number;
    maxFetchedRoutines?: number;
    maxRoutineNameOnlyInventory?: number;
    largeRoutineNameOnlyInventory?: number;
    maxParametersPerRoutine?: number;
    maxPromptChars?: number;
    maxPromptTokens?: number;
    smallSchemaThreshold?: number;
    largeSchemaThreshold?: number;
    outlierSchemaThreshold?: number;
    foreignKeyExpansionDepth?: number;
    foreignKeyExpansionObjectCap?: number;
    columnNameRelevanceWeight?: number;
    defaultSchemaWeight?: number;
    inventoryChunkSize?: number;
    cacheTtlMs?: number;
}

export interface SqlInlineCompletionResolvedSchemaBudget {
    maxSchemas: number;
    maxTables: number;
    maxViews: number;
    maxColumnsPerObject: number;
    smallSchemaMaxColumnsPerObject: number;
    largeSchemaMaxColumnsPerObject: number;
    maxFetchedTables: number;
    maxFetchedViews: number;
    maxTableNameOnlyInventory: number;
    maxViewNameOnlyInventory: number;
    largeTableNameOnlyInventory: number;
    largeViewNameOnlyInventory: number;
    outlierNameOnlyInventory: number;
    maxFetchedSchemas: number;
    maxSystemObjects: number;
    maxMasterSymbols: number;
    maxForeignKeys: number;
    maxSchemaContextRelevanceTerms: number;
    maxRoutines: number;
    maxFetchedRoutines: number;
    maxRoutineNameOnlyInventory: number;
    largeRoutineNameOnlyInventory: number;
    maxParametersPerRoutine: number;
    maxPromptChars: number;
    maxPromptTokens?: number;
    smallSchemaThreshold: number;
    largeSchemaThreshold: number;
    outlierSchemaThreshold: number;
    foreignKeyExpansionDepth: 0 | 1 | 2;
    foreignKeyExpansionObjectCap: number;
    columnNameRelevanceWeight: number;
    defaultSchemaWeight: number;
    inventoryChunkSize: number;
    cacheTtlMs: number;
    includeRoutines: boolean;
    schemaSizeAdaptive: boolean;
    relevanceTermRecencyBias: boolean;
    columnRepresentation: ColumnRepresentation;
}

export interface SqlInlineCompletionSchemaContextRuntimeSettings {
    budgetProfile: SchemaBudgetProfileId;
    budget: SqlInlineCompletionResolvedSchemaBudget;
    messageOrder: SqlInlineCompletionPromptMessageOrder;
    schemaContextChannel: SqlInlineCompletionSchemaContextChannel;
    fetchCacheKey: string;
}

interface SchemaBudgetProfile extends SqlInlineCompletionResolvedSchemaBudget {
    profileId: Exclude<SchemaBudgetProfileId, "custom">;
}

interface EffectiveSelectionBudget extends SqlInlineCompletionResolvedSchemaBudget {
    schemaSizeKind: SchemaSizeKind;
}

interface SchemaRelevanceTerm {
    text: string;
    weight: number;
    order: number;
}

interface RankedValue<T> {
    value: T;
    index: number;
    name: string;
    relevanceScore: number;
}

class SchemaContextParseError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "SchemaContextParseError";
    }
}

class SchemaContextFetchTimeoutError extends Error {
    public constructor() {
        super(`Timed out waiting ${schemaContextFetchWaitTimeoutMs} ms for schema context fetch.`);
        this.name = "SchemaContextFetchTimeoutError";
    }
}

const schemaBudgetProfiles: Record<
    Exclude<SchemaBudgetProfileId, "custom">,
    SchemaBudgetProfile
> = {
    tight: {
        profileId: "tight",
        maxSchemas: 16,
        maxTables: 6,
        maxViews: 4,
        maxColumnsPerObject: 8,
        smallSchemaMaxColumnsPerObject: 96,
        largeSchemaMaxColumnsPerObject: 5,
        maxFetchedTables: 48,
        maxFetchedViews: 24,
        maxTableNameOnlyInventory: 32,
        maxViewNameOnlyInventory: 16,
        largeTableNameOnlyInventory: 96,
        largeViewNameOnlyInventory: 48,
        outlierNameOnlyInventory: 96,
        maxFetchedSchemas: 32,
        maxSystemObjects: 24,
        maxMasterSymbols: 8,
        maxForeignKeys: 12,
        maxSchemaContextRelevanceTerms: 18,
        maxRoutines: 4,
        maxFetchedRoutines: 32,
        maxRoutineNameOnlyInventory: 16,
        largeRoutineNameOnlyInventory: 48,
        maxParametersPerRoutine: 8,
        maxPromptChars: 10000,
        maxPromptTokens: 2500,
        smallSchemaThreshold: 24,
        largeSchemaThreshold: 400,
        outlierSchemaThreshold: 5000,
        foreignKeyExpansionDepth: 1,
        foreignKeyExpansionObjectCap: 8,
        columnNameRelevanceWeight: 0.28,
        defaultSchemaWeight: 9000,
        inventoryChunkSize: 8,
        cacheTtlMs: defaultCacheTtlMs,
        includeRoutines: true,
        schemaSizeAdaptive: true,
        relevanceTermRecencyBias: true,
        columnRepresentation: "compact",
    },
    balanced: {
        profileId: "balanced",
        maxSchemas: 24,
        maxTables: 12,
        maxViews: 8,
        maxColumnsPerObject: 12,
        smallSchemaMaxColumnsPerObject: 160,
        largeSchemaMaxColumnsPerObject: 7,
        maxFetchedTables: 76,
        maxFetchedViews: 40,
        maxTableNameOnlyInventory: 64,
        maxViewNameOnlyInventory: 32,
        largeTableNameOnlyInventory: 160,
        largeViewNameOnlyInventory: 80,
        outlierNameOnlyInventory: 160,
        maxFetchedSchemas: 64,
        maxSystemObjects: 36,
        maxMasterSymbols: 12,
        maxForeignKeys: 24,
        maxSchemaContextRelevanceTerms: 24,
        maxRoutines: 8,
        maxFetchedRoutines: 56,
        maxRoutineNameOnlyInventory: 32,
        largeRoutineNameOnlyInventory: 80,
        maxParametersPerRoutine: 12,
        maxPromptChars: 18000,
        maxPromptTokens: 4500,
        smallSchemaThreshold: 40,
        largeSchemaThreshold: 800,
        outlierSchemaThreshold: 7500,
        foreignKeyExpansionDepth: 1,
        foreignKeyExpansionObjectCap: 16,
        columnNameRelevanceWeight: 0.36,
        defaultSchemaWeight: 12000,
        inventoryChunkSize: 8,
        cacheTtlMs: defaultCacheTtlMs,
        includeRoutines: true,
        schemaSizeAdaptive: true,
        relevanceTermRecencyBias: true,
        columnRepresentation: "verbose",
    },
    generous: {
        profileId: "generous",
        maxSchemas: 48,
        maxTables: 20,
        maxViews: 12,
        maxColumnsPerObject: 18,
        smallSchemaMaxColumnsPerObject: 256,
        largeSchemaMaxColumnsPerObject: 10,
        maxFetchedTables: 160,
        maxFetchedViews: 96,
        maxTableNameOnlyInventory: 128,
        maxViewNameOnlyInventory: 64,
        largeTableNameOnlyInventory: 320,
        largeViewNameOnlyInventory: 160,
        outlierNameOnlyInventory: 256,
        maxFetchedSchemas: 96,
        maxSystemObjects: 48,
        maxMasterSymbols: 16,
        maxForeignKeys: 48,
        maxSchemaContextRelevanceTerms: 40,
        maxRoutines: 12,
        maxFetchedRoutines: 96,
        maxRoutineNameOnlyInventory: 64,
        largeRoutineNameOnlyInventory: 160,
        maxParametersPerRoutine: 16,
        maxPromptChars: 32000,
        maxPromptTokens: 8000,
        smallSchemaThreshold: 72,
        largeSchemaThreshold: 1500,
        outlierSchemaThreshold: 10000,
        foreignKeyExpansionDepth: 2,
        foreignKeyExpansionObjectCap: 24,
        columnNameRelevanceWeight: 0.45,
        defaultSchemaWeight: 15000,
        inventoryChunkSize: 10,
        cacheTtlMs: defaultCacheTtlMs,
        includeRoutines: true,
        schemaSizeAdaptive: true,
        relevanceTermRecencyBias: true,
        columnRepresentation: "verbose",
    },
    unlimited: {
        profileId: "unlimited",
        maxSchemas: 256,
        maxTables: 200,
        maxViews: 100,
        maxColumnsPerObject: 128,
        smallSchemaMaxColumnsPerObject: 512,
        largeSchemaMaxColumnsPerObject: 32,
        maxFetchedTables: 1000,
        maxFetchedViews: 500,
        maxTableNameOnlyInventory: 1000,
        maxViewNameOnlyInventory: 500,
        largeTableNameOnlyInventory: 1500,
        largeViewNameOnlyInventory: 750,
        outlierNameOnlyInventory: 512,
        maxFetchedSchemas: 512,
        maxSystemObjects: 96,
        maxMasterSymbols: 32,
        maxForeignKeys: 256,
        maxSchemaContextRelevanceTerms: 96,
        maxRoutines: 80,
        maxFetchedRoutines: 500,
        maxRoutineNameOnlyInventory: 500,
        largeRoutineNameOnlyInventory: 750,
        maxParametersPerRoutine: 64,
        maxPromptChars: 100000,
        maxPromptTokens: 24000,
        smallSchemaThreshold: 300,
        largeSchemaThreshold: 3000,
        outlierSchemaThreshold: 20000,
        foreignKeyExpansionDepth: 2,
        foreignKeyExpansionObjectCap: 120,
        columnNameRelevanceWeight: 0.5,
        defaultSchemaWeight: 18000,
        inventoryChunkSize: 12,
        cacheTtlMs: defaultCacheTtlMs,
        includeRoutines: true,
        schemaSizeAdaptive: true,
        relevanceTermRecencyBias: true,
        columnRepresentation: "verbose",
    },
};

export class SqlInlineCompletionSchemaContextService implements vscode.Disposable {
    private readonly _logger = logger2.withPrefix("SqlInlineSchemaContext");
    private readonly _cache = new Map<string, CacheEntry>();
    private readonly _inFlight = new Map<string, InFlightEntry>();
    private readonly _errorFailuresByCacheKey = new Map<string, number>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _client: SqlToolsServiceClient,
    ) {
        this._disposables.push(
            this._connectionManager.onConnectionsChanged(() => {
                this.evictDisconnectedCacheEntries();
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsSchemaContext,
                    )
                ) {
                    this.clearCache();
                }
            }),
            vscode.commands.registerCommand(
                Constants.cmdCopilotInlineCompletionRefreshSchemaContext,
                () => {
                    this.clearCache();
                },
            ),
        );
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._cache.clear();
        this._inFlight.clear();
        this._errorFailuresByCacheKey.clear();
    }

    public clearCache(): void {
        if (
            this._cache.size === 0 &&
            this._inFlight.size === 0 &&
            this._errorFailuresByCacheKey.size === 0
        ) {
            return;
        }

        this._logger.debug("Clearing inline completion schema context cache");
        this._cache.clear();
        this._inFlight.clear();
        this._errorFailuresByCacheKey.clear();
    }

    public async getSchemaContext(
        document: vscode.TextDocument,
        relevanceText?: string,
        modelMaxInputTokens?: number,
        debugSchemaContextOverrides?: InlineCompletionDebugSchemaContextOverrides | null,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        const ownerUri = document.uri.toString();
        return this.getSchemaContextForOwnerUri(
            ownerUri,
            relevanceText ?? document.getText(),
            modelMaxInputTokens,
            debugSchemaContextOverrides,
        );
    }

    public async getSchemaContextForOwnerUri(
        ownerUri: string,
        relevanceText?: string,
        modelMaxInputTokens?: number,
        debugSchemaContextOverrides?: InlineCompletionDebugSchemaContextOverrides | null,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        const connectionInfo = this._connectionManager.getConnectionInfo(ownerUri);

        if (!connectionInfo?.credentials) {
            this._logger.debug(
                "Skipping schema context fetch because the editor has no active connection",
            );
            this.sendSchemaContextTelemetry("noConnection", undefined, undefined);
            return undefined;
        }

        const settings = getSqlInlineCompletionSchemaContextRuntimeSettings(
            modelMaxInputTokens,
            debugSchemaContextOverrides,
        );
        const relevanceTerms = extractSchemaContextRelevanceTerms(
            relevanceText ?? "",
            settings.budget,
        );
        const connectionFingerprint = this.createConnectionFingerprint(connectionInfo);
        const cacheKey = this.createCacheKey(connectionFingerprint, settings.fetchCacheKey);
        const now = Date.now();
        const cachedEntry = this._cache.get(cacheKey);
        if (cachedEntry && cachedEntry.expiresAt > now) {
            this.touchCacheEntry(cacheKey, cachedEntry, settings.budget.cacheTtlMs);
            const selectedContext = selectSchemaContextForPrompt(
                cachedEntry.value,
                relevanceTerms,
                settings,
            );
            this._logger.debug("Using cached schema context for inline completion");
            this.sendSchemaContextTelemetry(
                "cacheHit",
                selectedContext,
                settings,
                cachedEntry.failureCount,
            );
            return selectedContext;
        }

        if (cachedEntry) {
            this._cache.delete(cacheKey);
        }

        const existingFetch = this._inFlight.get(cacheKey);
        if (existingFetch) {
            const fetchedContext = await this.waitForSchemaContextFetch(
                cacheKey,
                connectionFingerprint,
                existingFetch.promise,
                settings,
                connectionInfo,
            );
            return selectSchemaContextForPrompt(fetchedContext, relevanceTerms, settings);
        }

        const fetchPromise = this.fetchAndCacheSchemaContext(
            cacheKey,
            connectionFingerprint,
            ownerUri,
            connectionInfo,
            settings,
        );
        this._inFlight.set(cacheKey, {
            connectionFingerprint,
            promise: fetchPromise,
        });
        const fetchedContext = await this.waitForSchemaContextFetch(
            cacheKey,
            connectionFingerprint,
            fetchPromise,
            settings,
            connectionInfo,
        );
        const selectedContext = selectSchemaContextForPrompt(
            fetchedContext,
            relevanceTerms,
            settings,
        );
        if (fetchedContext) {
            this.sendSchemaContextTelemetry("cacheMissFetched", selectedContext, settings);
        }
        return selectedContext;
    }

    private async waitForSchemaContextFetch(
        cacheKey: string,
        connectionFingerprint: string,
        fetchPromise: Promise<SqlInlineCompletionSchemaContext | undefined>,
        settings: SqlInlineCompletionSchemaContextRuntimeSettings,
        connectionInfo: ConnectionInfo,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        try {
            return await withSchemaContextFetchTimeout(fetchPromise);
        } catch (error) {
            if (!(error instanceof SchemaContextFetchTimeoutError)) {
                throw error;
            }

            const failureCount = this.cacheFailure(
                cacheKey,
                connectionFingerprint,
                () => schemaContextFetchTimeoutBackoffTtlMs,
            );
            this._logger.warn(
                `Timed out waiting for inline completion schema context after ` +
                    `${schemaContextFetchWaitTimeoutMs} ms; using no schema context for ` +
                    `${schemaContextFetchTimeoutBackoffTtlMs} ms while the background fetch continues`,
            );
            this.sendSchemaContextTelemetry("cacheMissFailed", undefined, settings, failureCount);
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.InlineCompletionSchemaContext,
                error,
                false,
                undefined,
                undefined,
                {
                    stage: "fetchTimeout",
                    failureCountBucket: getCountBucket(failureCount),
                    budgetProfile: settings.budgetProfile,
                },
                undefined,
                undefined,
                connectionInfo.serverInfo,
            );
            return undefined;
        }
    }

    private async fetchAndCacheSchemaContext(
        cacheKey: string,
        connectionFingerprint: string,
        ownerUri: string,
        connectionInfo: ConnectionInfo,
        settings: SqlInlineCompletionSchemaContextRuntimeSettings,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        const startedAt = Date.now();
        try {
            this._logger.debug("Fetching schema context for inline completion");
            await this._connectionManager.refreshAzureAccountToken(ownerUri);
            const tokenRefreshedAt = Date.now();

            const result = await this._client.sendRequest(schemaContextRequest, {
                ownerUri,
                queryString: buildSchemaContextQuery(settings.budget),
            });
            const fetchedAt = Date.now();

            const parsed = this.parseSchemaContext(result, settings.budget);
            const parsedAt = Date.now();
            this.cacheSuccess(cacheKey, connectionFingerprint, parsed, settings.budget.cacheTtlMs);
            this._logger.debug(
                `Fetched schema context for inline completion in ${parsedAt - startedAt} ms ` +
                    `(token ${tokenRefreshedAt - startedAt} ms, query ${
                        fetchedAt - tokenRefreshedAt
                    } ms, parse ${parsedAt - fetchedAt} ms, ` +
                    `tables ${parsed?.tables.length ?? 0}, views ${parsed?.views.length ?? 0}, ` +
                    `routines ${parsed?.routines?.length ?? 0})`,
            );
            return parsed;
        } catch (error) {
            const stage = error instanceof SchemaContextParseError ? "parseError" : "fetchError";
            const errorMessage = getErrorMessage(error);
            this._logger.warn(
                `Failed to fetch inline completion schema context (${stage}) after ${
                    Date.now() - startedAt
                } ms: ${errorMessage}`,
            );
            const failureCount = this.cacheFailure(cacheKey, connectionFingerprint);

            this.sendSchemaContextTelemetry("cacheMissFailed", undefined, settings, failureCount);
            sendErrorEvent(
                TelemetryViews.MssqlCopilot,
                TelemetryActions.InlineCompletionSchemaContext,
                error instanceof Error ? error : new Error(errorMessage),
                false,
                undefined,
                undefined,
                {
                    stage,
                    failureCountBucket: getCountBucket(failureCount),
                    budgetProfile: settings.budgetProfile,
                },
                undefined,
                undefined,
                connectionInfo.serverInfo,
            );
            return undefined;
        } finally {
            this._inFlight.delete(cacheKey);
        }
    }

    private parseSchemaContext(
        result: SimpleExecuteResult | undefined,
        budget: SqlInlineCompletionResolvedSchemaBudget,
    ): SqlInlineCompletionSchemaContext | undefined {
        const serializedContext = getSerializedSchemaContext(result);
        if (!serializedContext) {
            return undefined;
        }

        let rawValue: unknown;
        try {
            rawValue = JSON.parse(serializedContext);
        } catch (error) {
            throw new SchemaContextParseError(
                `Unable to parse schema context JSON: ${getErrorMessage(error)}`,
            );
        }

        validateRawSchemaContextPayload(rawValue);
        const rawContext = rawValue as RawSchemaContextPayload;
        const context: SqlInlineCompletionSchemaContext = {
            server: normalizeOptionalString(rawContext.server),
            database: normalizeOptionalString(rawContext.database),
            defaultSchema: normalizeOptionalString(rawContext.defaultSchema),
            engineEdition: normalizeOptionalNumber(rawContext.engineEdition),
            engineEditionName: normalizeOptionalString(rawContext.engineEditionName),
            totalTableCount: normalizeOptionalNumber(rawContext.totalTableCount),
            totalViewCount: normalizeOptionalNumber(rawContext.totalViewCount),
            totalRoutineCount: normalizeOptionalNumber(rawContext.totalRoutineCount),
            schemas: normalizeSchemaNames(rawContext.schemas, budget.maxFetchedSchemas),
            tables: normalizeSchemaObjects(
                rawContext.tables,
                budget.maxFetchedTables,
                budget.smallSchemaMaxColumnsPerObject,
                true,
                budget.maxForeignKeys,
            ),
            views: normalizeSchemaObjects(
                rawContext.views,
                budget.maxFetchedViews,
                budget.smallSchemaMaxColumnsPerObject,
                true,
                0,
            ),
            routines: budget.includeRoutines
                ? normalizeRoutines(
                      rawContext.routines,
                      budget.maxFetchedRoutines,
                      budget.maxParametersPerRoutine,
                      budget.smallSchemaMaxColumnsPerObject,
                  )
                : [],
            tableNameOnlyInventory: normalizeMasterSymbols(
                rawContext.tableNameOnlyInventory,
                Math.max(budget.maxTableNameOnlyInventory, budget.largeTableNameOnlyInventory),
            ),
            viewNameOnlyInventory: normalizeMasterSymbols(
                rawContext.viewNameOnlyInventory,
                Math.max(budget.maxViewNameOnlyInventory, budget.largeViewNameOnlyInventory),
            ),
            routineNameOnlyInventory: budget.includeRoutines
                ? normalizeMasterSymbols(
                      rawContext.routineNameOnlyInventory,
                      Math.max(
                          budget.maxRoutineNameOnlyInventory,
                          budget.largeRoutineNameOnlyInventory,
                      ),
                  )
                : [],
            masterSymbols: normalizeMasterSymbols(
                rawContext.masterSymbols,
                budget.maxMasterSymbols,
            ),
            systemObjects: normalizeSchemaObjects(
                rawContext.systemObjects,
                budget.maxSystemObjects,
                budget.maxColumnsPerObject,
                false,
                0,
            ),
        };

        if (
            !context.server &&
            !context.database &&
            context.schemas.length === 0 &&
            context.tables.length === 0 &&
            context.views.length === 0 &&
            (context.routines?.length ?? 0) === 0 &&
            (context.tableNameOnlyInventory?.length ?? 0) === 0 &&
            (context.viewNameOnlyInventory?.length ?? 0) === 0 &&
            (context.routineNameOnlyInventory?.length ?? 0) === 0 &&
            context.masterSymbols.length === 0 &&
            (context.systemObjects?.length ?? 0) === 0
        ) {
            return undefined;
        }

        return context;
    }

    private createConnectionFingerprint(connectionInfo: ConnectionInfo): string {
        const credentials = connectionInfo.credentials;
        return [
            normalizeCacheKeyPart(credentials.server),
            normalizeCacheKeyPart(credentials.database),
            normalizeCacheKeyPart(credentials.user),
            normalizeCacheKeyPart(credentials.authenticationType),
        ].join("|");
    }

    private createCacheKey(connectionFingerprint: string, fetchCacheKey: string): string {
        return `${connectionFingerprint}|${fetchCacheKey}`;
    }

    private cacheSuccess(
        cacheKey: string,
        connectionFingerprint: string,
        value: SqlInlineCompletionSchemaContext | undefined,
        cacheTtlMs: number,
    ): void {
        this._errorFailuresByCacheKey.delete(cacheKey);
        this._cache.set(cacheKey, {
            connectionFingerprint,
            expiresAt: Date.now() + cacheTtlMs,
            value,
            failureCount: 0,
        });
        this.enforceCacheLimit();
    }

    private cacheFailure(
        cacheKey: string,
        connectionFingerprint: string,
        getBackoffTtlMs: (failureCount: number) => number = getErrorBackoffTtlMs,
    ): number {
        const failureCount = (this._errorFailuresByCacheKey.get(cacheKey) ?? 0) + 1;
        this._errorFailuresByCacheKey.set(cacheKey, failureCount);
        this._cache.set(cacheKey, {
            connectionFingerprint,
            expiresAt: Date.now() + getBackoffTtlMs(failureCount),
            value: undefined,
            failureCount,
        });
        this.enforceCacheLimit();
        return failureCount;
    }

    private touchCacheEntry(cacheKey: string, entry: CacheEntry, cacheTtlMs: number): void {
        this._cache.delete(cacheKey);
        this._cache.set(cacheKey, {
            ...entry,
            expiresAt: Date.now() + cacheTtlMs,
        });
    }

    private enforceCacheLimit(): void {
        while (this._cache.size > maxCacheEntries) {
            const oldestKey = this._cache.keys().next().value;
            if (oldestKey === undefined) {
                return;
            }
            this._cache.delete(oldestKey);
            this._errorFailuresByCacheKey.delete(oldestKey);
        }
    }

    private evictDisconnectedCacheEntries(): void {
        const liveConnectionFingerprints = this.getLiveConnectionFingerprints();
        let evictedCount = 0;

        for (const [cacheKey, entry] of [...this._cache.entries()]) {
            if (!liveConnectionFingerprints.has(entry.connectionFingerprint)) {
                this._cache.delete(cacheKey);
                this._errorFailuresByCacheKey.delete(cacheKey);
                evictedCount++;
            }
        }

        for (const [cacheKey, entry] of [...this._inFlight.entries()]) {
            if (!liveConnectionFingerprints.has(entry.connectionFingerprint)) {
                this._inFlight.delete(cacheKey);
            }
        }

        if (evictedCount > 0) {
            this._logger.debug(
                `Evicted ${evictedCount} stale inline completion schema context cache entries`,
            );
        }
    }

    private getLiveConnectionFingerprints(): Set<string> {
        const liveConnectionFingerprints = new Set<string>();
        const activeConnections = this._connectionManager.activeConnections;

        for (const fileUri of Object.keys(activeConnections)) {
            const connectionInfo = activeConnections[fileUri];
            if (connectionInfo?.credentials) {
                liveConnectionFingerprints.add(this.createConnectionFingerprint(connectionInfo));
            }
        }

        return liveConnectionFingerprints;
    }

    private sendSchemaContextTelemetry(
        stage: "cacheHit" | "cacheMissFetched" | "cacheMissFailed" | "noConnection",
        context: SqlInlineCompletionSchemaContext | undefined,
        settings: SqlInlineCompletionSchemaContextRuntimeSettings | undefined,
        failureCount: number = 0,
    ): void {
        const payloadSize = context ? JSON.stringify(context).length : 0;
        const objectCount = (context?.tables.length ?? 0) + (context?.views.length ?? 0);
        const routineCount = context?.routines?.length ?? 0;
        const systemObjectCount = context?.systemObjects?.length ?? 0;
        const foreignKeyCount = (context?.tables ?? []).reduce(
            (sum, table) => sum + (table.foreignKeys?.length ?? 0),
            0,
        );
        const inventoryCount =
            (context?.tableNameOnlyInventory?.length ?? 0) +
            (context?.viewNameOnlyInventory?.length ?? 0) +
            (context?.routineNameOnlyInventory?.length ?? 0);

        sendActionEvent(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.InlineCompletionSchemaContext,
            {
                stage,
                hasContext: (!!context).toString(),
                fallbackWithoutMetadata: (!context).toString(),
                payloadSizeBucket: getSizeBucket(payloadSize),
                objectCountBucket: getCountBucket(objectCount),
                routineCountBucket: getCountBucket(routineCount),
                inventoryCountBucket: getCountBucket(inventoryCount),
                systemObjectCountBucket: getCountBucket(systemObjectCount),
                masterSymbolCountBucket: getCountBucket(context?.masterSymbols.length ?? 0),
                foreignKeyCountBucket: getCountBucket(foreignKeyCount),
                engineEdition: context?.engineEdition?.toString() ?? "unknown",
                engineEditionName: context?.engineEditionName ?? "unknown",
                failureCountBucket: getCountBucket(failureCount),
                budgetProfile:
                    context?.selectionMetadata?.budgetProfile ??
                    settings?.budgetProfile ??
                    "unknown",
                schemaSizeKind: context?.selectionMetadata?.schemaSizeKind ?? "unknown",
                degradationStepCountBucket: getCountBucket(
                    context?.selectionMetadata?.degradationSteps.length ?? 0,
                ),
                columnRepresentation:
                    context?.selectionMetadata?.columnRepresentation ??
                    settings?.budget.columnRepresentation ??
                    "unknown",
            },
        );
    }
}

export function getSqlInlineCompletionSchemaContextRuntimeSettings(
    modelMaxInputTokens?: number,
    debugSchemaContextOverrides?: InlineCompletionDebugSchemaContextOverrides | null,
): SqlInlineCompletionSchemaContextRuntimeSettings {
    const workspaceSettings = asRecord(
        vscode.workspace
            .getConfiguration()
            .get<unknown>(Constants.configCopilotInlineCompletionsSchemaContext, {}),
    );
    const debugSettings =
        debugSchemaContextOverrides === undefined
            ? getDebugSchemaContextSettings()
            : asRecord(debugSchemaContextOverrides ?? {});
    const mergedSettings = mergeSettingsRecords(workspaceSettings, debugSettings);
    const configuredProfile = normalizeBudgetProfileId(readString(mergedSettings, "budgetProfile"));
    const profileId = configuredProfile ?? "balanced";
    const baseProfile =
        profileId === "custom" ? schemaBudgetProfiles.balanced : schemaBudgetProfiles[profileId];
    const budget = resolveBudget(baseProfile, mergedSettings, modelMaxInputTokens);
    const messageOrder = normalizeMessageOrder(readString(mergedSettings, "messageOrder"));
    const schemaContextChannel = normalizeSchemaContextChannel(
        readString(mergedSettings, "schemaContextChannel"),
    );

    return {
        budgetProfile: profileId,
        budget,
        messageOrder,
        schemaContextChannel,
        fetchCacheKey: createFetchCacheKey(profileId, budget),
    };
}

function getDebugSchemaContextSettings(): Record<string, unknown> {
    return asRecord(inlineCompletionDebugStore.getOverrides().schemaContext ?? {});
}

function mergeSettingsRecords(
    workspaceSettings: Record<string, unknown>,
    debugSettings: Record<string, unknown>,
): Record<string, unknown> {
    const workspaceBudgetOverrides = asRecord(workspaceSettings.budgetOverrides ?? {});
    const debugBudgetOverrides = asRecord(debugSettings.budgetOverrides ?? {});
    return {
        ...workspaceSettings,
        ...debugSettings,
        budgetOverrides: {
            ...workspaceBudgetOverrides,
            ...debugBudgetOverrides,
        },
    };
}

function resolveBudget(
    baseProfile: SchemaBudgetProfile,
    settings: Record<string, unknown>,
    modelMaxInputTokens: number | undefined,
): SqlInlineCompletionResolvedSchemaBudget {
    const budgetOverrides = asRecord(settings.budgetOverrides ?? {});
    const rawColumnRepresentation = readString(settings, "columnRepresentation");
    const columnRepresentation = normalizeColumnRepresentation(
        rawColumnRepresentation,
        baseProfile.columnRepresentation,
    );
    const budget: SqlInlineCompletionResolvedSchemaBudget = {
        ...baseProfile,
        maxSchemas: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxSchemas",
            baseProfile.maxSchemas,
        ),
        maxTables: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxTables",
            baseProfile.maxTables,
        ),
        maxViews: readIntegerOverride(settings, budgetOverrides, "maxViews", baseProfile.maxViews),
        maxColumnsPerObject: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxColumnsPerObject",
            baseProfile.maxColumnsPerObject,
        ),
        smallSchemaMaxColumnsPerObject: readIntegerOverride(
            settings,
            budgetOverrides,
            "smallSchemaMaxColumnsPerObject",
            baseProfile.smallSchemaMaxColumnsPerObject,
        ),
        largeSchemaMaxColumnsPerObject: readIntegerOverride(
            settings,
            budgetOverrides,
            "largeSchemaMaxColumnsPerObject",
            baseProfile.largeSchemaMaxColumnsPerObject,
        ),
        maxFetchedTables: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxFetchedTables",
            baseProfile.maxFetchedTables,
        ),
        maxFetchedViews: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxFetchedViews",
            baseProfile.maxFetchedViews,
        ),
        maxTableNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxTableNameOnlyInventory",
            baseProfile.maxTableNameOnlyInventory,
        ),
        maxViewNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxViewNameOnlyInventory",
            baseProfile.maxViewNameOnlyInventory,
        ),
        largeTableNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "largeTableNameOnlyInventory",
            baseProfile.largeTableNameOnlyInventory,
        ),
        largeViewNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "largeViewNameOnlyInventory",
            baseProfile.largeViewNameOnlyInventory,
        ),
        outlierNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "outlierNameOnlyInventory",
            baseProfile.outlierNameOnlyInventory,
        ),
        maxFetchedSchemas: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxFetchedSchemas",
            baseProfile.maxFetchedSchemas,
        ),
        maxSystemObjects: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxSystemObjects",
            baseProfile.maxSystemObjects,
        ),
        maxMasterSymbols: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxMasterSymbols",
            baseProfile.maxMasterSymbols,
        ),
        maxForeignKeys: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxForeignKeys",
            baseProfile.maxForeignKeys,
        ),
        maxSchemaContextRelevanceTerms: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxSchemaContextRelevanceTerms",
            baseProfile.maxSchemaContextRelevanceTerms,
        ),
        maxRoutines: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxRoutines",
            baseProfile.maxRoutines,
        ),
        maxFetchedRoutines: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxFetchedRoutines",
            baseProfile.maxFetchedRoutines,
        ),
        maxRoutineNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxRoutineNameOnlyInventory",
            baseProfile.maxRoutineNameOnlyInventory,
        ),
        largeRoutineNameOnlyInventory: readIntegerOverride(
            settings,
            budgetOverrides,
            "largeRoutineNameOnlyInventory",
            baseProfile.largeRoutineNameOnlyInventory,
        ),
        maxParametersPerRoutine: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxParametersPerRoutine",
            baseProfile.maxParametersPerRoutine,
        ),
        maxPromptChars: readIntegerOverride(
            settings,
            budgetOverrides,
            "maxPromptChars",
            baseProfile.maxPromptChars,
        ),
        maxPromptTokens: readOptionalIntegerOverride(
            settings,
            budgetOverrides,
            "maxPromptTokens",
            baseProfile.maxPromptTokens,
        ),
        smallSchemaThreshold: readIntegerOverride(
            settings,
            budgetOverrides,
            "smallSchemaThreshold",
            baseProfile.smallSchemaThreshold,
        ),
        largeSchemaThreshold: readIntegerOverride(
            settings,
            budgetOverrides,
            "largeSchemaThreshold",
            baseProfile.largeSchemaThreshold,
        ),
        outlierSchemaThreshold: readIntegerOverride(
            settings,
            budgetOverrides,
            "outlierSchemaThreshold",
            baseProfile.outlierSchemaThreshold,
        ),
        foreignKeyExpansionDepth: normalizeForeignKeyExpansionDepth(
            readIntegerOverride(
                settings,
                budgetOverrides,
                "foreignKeyExpansionDepth",
                baseProfile.foreignKeyExpansionDepth,
            ),
        ),
        foreignKeyExpansionObjectCap: readIntegerOverride(
            settings,
            budgetOverrides,
            "foreignKeyExpansionObjectCap",
            baseProfile.foreignKeyExpansionObjectCap,
        ),
        columnNameRelevanceWeight: readNumberOverride(
            settings,
            budgetOverrides,
            "columnNameRelevanceWeight",
            baseProfile.columnNameRelevanceWeight,
        ),
        defaultSchemaWeight: readNumberOverride(
            settings,
            budgetOverrides,
            "defaultSchemaWeight",
            baseProfile.defaultSchemaWeight,
        ),
        inventoryChunkSize: readIntegerOverride(
            settings,
            budgetOverrides,
            "inventoryChunkSize",
            baseProfile.inventoryChunkSize,
        ),
        cacheTtlMs: readIntegerOverride(
            settings,
            budgetOverrides,
            "cacheTtlMs",
            baseProfile.cacheTtlMs,
        ),
        includeRoutines: readBoolean(settings, "includeRoutines", baseProfile.includeRoutines),
        schemaSizeAdaptive: readBoolean(
            settings,
            "schemaSizeAdaptive",
            baseProfile.schemaSizeAdaptive,
        ),
        relevanceTermRecencyBias: readBoolean(
            settings,
            "relevanceTermRecencyBias",
            baseProfile.relevanceTermRecencyBias,
        ),
        columnRepresentation,
    };

    budget.maxFetchedTables = Math.max(
        budget.maxFetchedTables,
        budget.maxTables + budget.maxTableNameOnlyInventory,
    );
    budget.maxFetchedViews = Math.max(
        budget.maxFetchedViews,
        budget.maxViews + budget.maxViewNameOnlyInventory,
    );
    budget.maxFetchedRoutines = Math.max(
        budget.maxFetchedRoutines,
        budget.maxRoutines + budget.maxRoutineNameOnlyInventory,
    );
    budget.smallSchemaMaxColumnsPerObject = Math.max(
        budget.smallSchemaMaxColumnsPerObject,
        budget.maxColumnsPerObject,
    );
    budget.largeSchemaMaxColumnsPerObject = Math.min(
        budget.largeSchemaMaxColumnsPerObject,
        budget.maxColumnsPerObject,
    );
    budget.maxPromptChars = Math.max(minimumPromptBudgetChars, budget.maxPromptChars);
    budget.cacheTtlMs = Math.max(30 * 1000, budget.cacheTtlMs);
    budget.inventoryChunkSize = Math.max(1, budget.inventoryChunkSize);
    budget.columnNameRelevanceWeight = Math.max(0, budget.columnNameRelevanceWeight);
    budget.defaultSchemaWeight = Math.max(0, budget.defaultSchemaWeight);

    if (modelMaxInputTokens && Number.isFinite(modelMaxInputTokens) && modelMaxInputTokens > 0) {
        const modelDerivedPromptTokenBudget = Math.max(512, Math.floor(modelMaxInputTokens * 0.55));
        budget.maxPromptTokens = Math.min(
            budget.maxPromptTokens ?? modelDerivedPromptTokenBudget,
            modelDerivedPromptTokenBudget,
        );
        budget.maxPromptChars = Math.min(
            budget.maxPromptChars,
            Math.max(minimumPromptBudgetChars, budget.maxPromptTokens * 4),
        );
    }

    return budget;
}

function createFetchCacheKey(
    profileId: SchemaBudgetProfileId,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): string {
    return [
        profileId,
        budget.maxFetchedSchemas,
        budget.maxFetchedTables,
        budget.maxFetchedViews,
        budget.maxFetchedRoutines,
        budget.smallSchemaMaxColumnsPerObject,
        budget.maxSystemObjects,
        budget.maxMasterSymbols,
        budget.maxForeignKeys,
        budget.maxParametersPerRoutine,
        budget.includeRoutines ? "routines" : "noRoutines",
    ].join(":");
}

function normalizeBudgetProfileId(value: string | undefined): SchemaBudgetProfileId | undefined {
    switch (value?.trim().toLowerCase()) {
        case "tight":
        case "balanced":
        case "generous":
        case "unlimited":
        case "custom":
            return value.trim().toLowerCase() as SchemaBudgetProfileId;
        default:
            return undefined;
    }
}

function normalizeColumnRepresentation(
    value: string | undefined,
    fallback: ColumnRepresentation,
): ColumnRepresentation {
    switch (value?.trim().toLowerCase()) {
        case "compact":
            return "compact";
        case "types":
            return "types";
        case "verbose":
            return "verbose";
        case "auto":
        case undefined:
        case "":
            return fallback;
        default:
            return fallback;
    }
}

function normalizeMessageOrder(value: string | undefined): SqlInlineCompletionPromptMessageOrder {
    return value?.trim().toLowerCase() === "data-then-rules"
        ? "data-then-rules"
        : "rules-then-data";
}

function normalizeSchemaContextChannel(
    value: string | undefined,
): SqlInlineCompletionSchemaContextChannel {
    return value?.trim().toLowerCase() === "separate-message"
        ? "separate-message"
        : "inline-with-data";
}

function normalizeForeignKeyExpansionDepth(value: number): 0 | 1 | 2 {
    if (value <= 0) {
        return 0;
    }
    if (value >= 2) {
        return 2;
    }
    return 1;
}

function readIntegerOverride(
    settings: Record<string, unknown>,
    budgetOverrides: Record<string, unknown>,
    key: keyof SqlInlineCompletionSchemaBudgetOverrides,
    fallback: number,
): number {
    return normalizePositiveInteger(budgetOverrides[key] ?? settings[key], fallback);
}

function readOptionalIntegerOverride(
    settings: Record<string, unknown>,
    budgetOverrides: Record<string, unknown>,
    key: keyof SqlInlineCompletionSchemaBudgetOverrides,
    fallback: number | undefined,
): number | undefined {
    const rawValue = budgetOverrides[key] ?? settings[key];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        return fallback;
    }
    return normalizePositiveInteger(rawValue, fallback ?? 0) || fallback;
}

function readNumberOverride(
    settings: Record<string, unknown>,
    budgetOverrides: Record<string, unknown>,
    key: keyof SqlInlineCompletionSchemaBudgetOverrides,
    fallback: number,
): number {
    const value = budgetOverrides[key] ?? settings[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

function readBoolean(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = settings[key];
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        if (value.toLowerCase() === "true") {
            return true;
        }
        if (value.toLowerCase() === "false") {
            return false;
        }
    }
    return fallback;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function getSerializedSchemaContext(result: SimpleExecuteResult | undefined): string | undefined {
    const serializedContext = result?.rows
        ?.map((row) => row?.[0]?.displayValue ?? "")
        .join("")
        .trim();

    return serializedContext || undefined;
}

function validateRawSchemaContextPayload(value: unknown): void {
    if (!isRecord(value)) {
        throw new SchemaContextParseError("Schema context payload was not a JSON object");
    }

    assertArrayProperty(value, "schemas");
    assertArrayProperty(value, "tables");
    assertArrayProperty(value, "views");
    assertArrayProperty(value, "routines");
    assertArrayProperty(value, "tableNameOnlyInventory");
    assertArrayProperty(value, "viewNameOnlyInventory");
    assertArrayProperty(value, "routineNameOnlyInventory");
    assertArrayProperty(value, "systemObjects");
    assertArrayProperty(value, "masterSymbols");
}

function assertArrayProperty(record: Record<string, unknown>, propertyName: string): void {
    const value = record[propertyName];
    if (value !== undefined && !Array.isArray(value)) {
        throw new SchemaContextParseError(
            `Schema context property ${propertyName} was not an array`,
        );
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeSchemaNames(schemas: RawSchemaName[] | undefined, limit: number): string[] {
    const uniqueSchemas = new Map<string, string>();
    for (const schema of schemas ?? []) {
        const normalized = normalizeOptionalString(schema.name);
        if (!normalized) {
            continue;
        }

        uniqueSchemas.set(normalized.toLowerCase(), normalized);
        if (uniqueSchemas.size >= limit) {
            break;
        }
    }

    return [...uniqueSchemas.values()];
}

function normalizeSchemaObjects(
    objects: RawSchemaObject[] | undefined,
    maxObjectCount: number,
    maxColumnCount: number,
    includeColumnDefinitions: boolean,
    maxForeignKeyCount: number,
): SqlInlineCompletionSchemaObject[] {
    const normalizedObjects: SqlInlineCompletionSchemaObject[] = [];
    const seenObjectNames = new Set<string>();

    for (const object of objects ?? []) {
        if (normalizedObjects.length >= maxObjectCount) {
            break;
        }

        const qualifiedName = toQualifiedName(object.schema, object.name);
        if (!qualifiedName) {
            continue;
        }

        const objectKey = qualifiedName.toLowerCase();
        if (seenObjectNames.has(objectKey)) {
            continue;
        }

        const columnMetadata = normalizeObjectColumns(
            object.columns,
            object.foreignKeys,
            maxColumnCount,
            includeColumnDefinitions,
            maxForeignKeyCount,
        );
        const normalizedObject: SqlInlineCompletionSchemaObject = {
            name: qualifiedName,
            columns: columnMetadata.columns,
        };

        if (columnMetadata.columnDefinitions.length > 0) {
            normalizedObject.columnDefinitions = columnMetadata.columnDefinitions;
        }

        if (columnMetadata.primaryKeyColumns.length > 0) {
            normalizedObject.primaryKeyColumns = columnMetadata.primaryKeyColumns;
        }

        if (columnMetadata.foreignKeys.length > 0) {
            normalizedObject.foreignKeys = columnMetadata.foreignKeys;
        }

        seenObjectNames.add(objectKey);
        normalizedObjects.push(normalizedObject);
    }

    return normalizedObjects;
}

function normalizeObjectColumns(
    columns: RawObjectColumn[] | undefined,
    explicitForeignKeys: RawForeignKey[] | undefined,
    maxColumnCount: number,
    includeColumnDefinitions: boolean,
    maxForeignKeyCount: number,
): {
    columns: string[];
    columnDefinitions: string[];
    primaryKeyColumns: string[];
    foreignKeys: SqlInlineCompletionForeignKey[];
} {
    const seenColumns = new Set<string>();
    const normalizedColumns: string[] = [];
    const columnDefinitions: string[] = [];
    const primaryKeyColumns: string[] = [];
    const foreignKeys: SqlInlineCompletionForeignKey[] = [];
    const seenForeignKeys = new Set<string>();

    for (const column of columns ?? []) {
        if (normalizedColumns.length >= maxColumnCount) {
            break;
        }

        const normalizedColumn = normalizeOptionalString(column.name);
        if (!normalizedColumn) {
            continue;
        }

        const columnKey = normalizedColumn.toLowerCase();
        if (seenColumns.has(columnKey)) {
            continue;
        }

        seenColumns.add(columnKey);
        normalizedColumns.push(normalizedColumn);

        const isPrimaryKey = normalizeBoolean(column.isPrimaryKey);
        if (isPrimaryKey) {
            primaryKeyColumns.push(normalizedColumn);
        }

        const referencedTable = normalizeOptionalString(column.referencedTable);
        const referencedColumn = normalizeOptionalString(column.referencedColumn);
        if (referencedTable && referencedColumn) {
            addForeignKey(
                foreignKeys,
                seenForeignKeys,
                normalizedColumn,
                referencedTable,
                referencedColumn,
                maxForeignKeyCount,
            );
        }

        if (includeColumnDefinitions) {
            let definition = normalizeOptionalString(column.definition) ?? normalizedColumn;
            if (isPrimaryKey && !/\bPK\b/i.test(definition)) {
                definition += " PK";
            }
            if (referencedTable && referencedColumn && !/\bFK\s*->/i.test(definition)) {
                definition += ` FK->${referencedTable}.${referencedColumn}`;
            }
            columnDefinitions.push(definition);
        }
    }

    for (const foreignKey of explicitForeignKeys ?? []) {
        const column = normalizeOptionalString(foreignKey.column);
        const referencedTable = normalizeOptionalString(foreignKey.referencedTable);
        const referencedColumn = normalizeOptionalString(foreignKey.referencedColumn);
        if (column && referencedTable && referencedColumn) {
            addForeignKey(
                foreignKeys,
                seenForeignKeys,
                column,
                referencedTable,
                referencedColumn,
                maxForeignKeyCount,
            );
        }
    }

    return {
        columns: normalizedColumns,
        columnDefinitions,
        primaryKeyColumns,
        foreignKeys,
    };
}

function addForeignKey(
    foreignKeys: SqlInlineCompletionForeignKey[],
    seenForeignKeys: Set<string>,
    column: string,
    referencedTable: string,
    referencedColumn: string,
    maxForeignKeyCount: number,
): void {
    if (maxForeignKeyCount <= 0 || foreignKeys.length >= maxForeignKeyCount) {
        return;
    }

    const key = `${column}|${referencedTable}|${referencedColumn}`.toLowerCase();
    if (seenForeignKeys.has(key)) {
        return;
    }

    seenForeignKeys.add(key);
    foreignKeys.push({
        column,
        referencedTable,
        referencedColumn,
    });
}

function normalizeRoutines(
    routines: RawRoutine[] | undefined,
    maxRoutineCount: number,
    maxParameterCount: number,
    maxReturnColumnCount: number,
): SqlInlineCompletionRoutine[] {
    const normalizedRoutines: SqlInlineCompletionRoutine[] = [];
    const seenRoutineNames = new Set<string>();

    for (const routine of routines ?? []) {
        if (normalizedRoutines.length >= maxRoutineCount) {
            break;
        }

        const qualifiedName = toQualifiedName(routine.schema, routine.name);
        if (!qualifiedName) {
            continue;
        }

        const routineKey = qualifiedName.toLowerCase();
        if (seenRoutineNames.has(routineKey)) {
            continue;
        }

        seenRoutineNames.add(routineKey);
        const normalizedRoutine: SqlInlineCompletionRoutine = {
            name: qualifiedName,
            type: normalizeOptionalString(routine.type) ?? "ROUTINE",
            parameters: normalizeRoutineParameters(routine.parameters, maxParameterCount),
        };

        const typeDescription = normalizeOptionalString(routine.typeDescription);
        if (typeDescription) {
            normalizedRoutine.typeDescription = typeDescription;
        }

        const returnType = normalizeOptionalString(routine.returnType);
        if (returnType) {
            normalizedRoutine.returnType = returnType;
        }

        const returnColumnMetadata = normalizeObjectColumns(
            routine.returnColumns,
            undefined,
            maxReturnColumnCount,
            true,
            0,
        );
        if (returnColumnMetadata.columns.length > 0) {
            normalizedRoutine.returnColumns = returnColumnMetadata.columns;
        }
        if (returnColumnMetadata.columnDefinitions.length > 0) {
            normalizedRoutine.returnColumnDefinitions = returnColumnMetadata.columnDefinitions;
        }

        normalizedRoutines.push(normalizedRoutine);
    }

    return normalizedRoutines;
}

function normalizeRoutineParameters(
    parameters: RawRoutineParameter[] | undefined,
    maxParameterCount: number,
): SqlInlineCompletionRoutineParameter[] {
    const normalizedParameters: SqlInlineCompletionRoutineParameter[] = [];
    const seenParameters = new Set<string>();

    for (const parameter of parameters ?? []) {
        if (normalizedParameters.length >= maxParameterCount) {
            break;
        }

        const name = normalizeOptionalString(parameter.name);
        if (!name) {
            continue;
        }

        const key = name.toLowerCase();
        if (seenParameters.has(key)) {
            continue;
        }

        seenParameters.add(key);
        const normalizedParameter: SqlInlineCompletionRoutineParameter = { name };
        const definition = normalizeOptionalString(parameter.definition);
        if (definition) {
            normalizedParameter.definition = definition;
        }
        const direction = normalizeOptionalString(parameter.direction);
        if (direction) {
            normalizedParameter.direction = direction;
        }
        normalizedParameters.push(normalizedParameter);
    }

    return normalizedParameters;
}

function normalizeMasterSymbols(symbols: RawMasterSymbol[] | undefined, limit: number): string[] {
    const normalizedSymbols: string[] = [];
    const seenSymbols = new Set<string>();

    for (const symbol of symbols ?? []) {
        if (normalizedSymbols.length >= limit) {
            break;
        }

        const qualifiedName = toQualifiedName(symbol.schema, symbol.name);
        if (!qualifiedName) {
            continue;
        }

        const symbolKey = qualifiedName.toLowerCase();
        if (seenSymbols.has(symbolKey)) {
            continue;
        }

        seenSymbols.add(symbolKey);
        normalizedSymbols.push(qualifiedName);
    }

    return normalizedSymbols;
}

function toQualifiedName(schema: string | undefined, name: string | undefined): string | undefined {
    const normalizedName = normalizeOptionalString(name);
    if (!normalizedName) {
        return undefined;
    }

    const normalizedSchema = normalizeOptionalString(schema);
    return normalizedSchema ? `${normalizedSchema}.${normalizedName}` : normalizedName;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function normalizeOptionalNumber(value: number | string | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
        return Math.max(0, Math.floor(fallback));
    }

    return Math.max(0, Math.floor(parsed));
}

function normalizeBoolean(value: boolean | number | undefined): boolean {
    return value === true || value === 1;
}

function selectSchemaContextForPrompt(
    context: SqlInlineCompletionSchemaContext | undefined,
    relevanceTerms: SchemaRelevanceTerm[],
    settings: SqlInlineCompletionSchemaContextRuntimeSettings,
): SqlInlineCompletionSchemaContext | undefined {
    if (!context) {
        return undefined;
    }

    const effectiveBudget = getEffectiveSelectionBudget(context, settings.budget);
    const metadata = createSelectionMetadata(settings, effectiveBudget, context);

    if (effectiveBudget.schemaSizeKind === "outlier") {
        return enforcePromptBudget(
            buildOutlierSchemaContext(context, relevanceTerms, effectiveBudget, metadata),
            effectiveBudget,
        );
    }

    const rankedTables = rankSchemaObjects(
        context.tables,
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    );
    const selectedTables = selectDetailedTablesWithForeignKeyExpansion(
        rankedTables,
        context.tables,
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    );
    const rankedViews = rankSchemaObjects(
        context.views,
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    );
    const rankedRoutines = rankRoutines(
        context.routines ?? [],
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    );

    const selectedViews = rankedViews.slice(0, effectiveBudget.maxViews);
    const selectedRoutines = settings.budget.includeRoutines
        ? rankedRoutines.slice(0, effectiveBudget.maxRoutines)
        : [];
    const selectedTableNames = new Set(selectedTables.map((table) => table.name.toLowerCase()));
    const selectedViewNames = new Set(selectedViews.map((view) => view.name.toLowerCase()));
    const selectedRoutineNames = new Set(
        selectedRoutines.map((routine) => routine.name.toLowerCase()),
    );

    const tableNameOnlyInventory = rankQualifiedNames(
        uniqueStringsByLowerCase([
            ...rankedTables.slice(effectiveBudget.maxTables).map((table) => table.name),
            ...(context.tableNameOnlyInventory ?? []),
        ]).filter((tableName) => !selectedTableNames.has(tableName.toLowerCase())),
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    ).slice(0, effectiveBudget.maxTableNameOnlyInventory);
    const viewNameOnlyInventory = rankQualifiedNames(
        uniqueStringsByLowerCase([
            ...rankedViews.slice(effectiveBudget.maxViews).map((view) => view.name),
            ...(context.viewNameOnlyInventory ?? []),
        ]).filter((viewName) => !selectedViewNames.has(viewName.toLowerCase())),
        relevanceTerms,
        context.defaultSchema,
        effectiveBudget,
    ).slice(0, effectiveBudget.maxViewNameOnlyInventory);
    const routineNameOnlyInventory = settings.budget.includeRoutines
        ? rankQualifiedNames(
              uniqueStringsByLowerCase([
                  ...rankedRoutines
                      .slice(effectiveBudget.maxRoutines)
                      .map((routine) => routine.name),
                  ...(context.routineNameOnlyInventory ?? []),
              ]).filter((routineName) => !selectedRoutineNames.has(routineName.toLowerCase())),
              relevanceTerms,
              context.defaultSchema,
              effectiveBudget,
          ).slice(0, effectiveBudget.maxRoutineNameOnlyInventory)
        : [];

    return enforcePromptBudget(
        {
            ...context,
            selectionMetadata: metadata,
            schemas: rankSchemasForPrompt(
                context.schemas,
                [
                    ...context.tables.map((table) => table.name),
                    ...context.views.map((view) => view.name),
                    ...(context.routines ?? []).map((routine) => routine.name),
                    ...(context.tableNameOnlyInventory ?? []),
                    ...(context.viewNameOnlyInventory ?? []),
                    ...(context.routineNameOnlyInventory ?? []),
                ],
                relevanceTerms,
                context.defaultSchema,
                effectiveBudget,
            ).slice(0, effectiveBudget.maxSchemas),
            tables: selectedTables.map((table) =>
                trimSchemaObjectForPrompt(
                    table,
                    effectiveBudget,
                    effectiveBudget.maxColumnsPerObject,
                ),
            ),
            views: selectedViews.map((view) =>
                trimSchemaObjectForPrompt(
                    view,
                    effectiveBudget,
                    effectiveBudget.maxColumnsPerObject,
                ),
            ),
            routines: selectedRoutines.map((routine) =>
                trimRoutineForPrompt(routine, effectiveBudget),
            ),
            tableNameOnlyInventory,
            viewNameOnlyInventory,
            routineNameOnlyInventory,
            systemObjects: (context.systemObjects ?? [])
                .slice(0, effectiveBudget.maxSystemObjects)
                .map((object) =>
                    trimSchemaObjectForPrompt(
                        object,
                        effectiveBudget,
                        effectiveBudget.maxColumnsPerObject,
                    ),
                ),
            masterSymbols: context.masterSymbols.slice(0, effectiveBudget.maxMasterSymbols),
        },
        effectiveBudget,
    );
}

function getEffectiveSelectionBudget(
    context: SqlInlineCompletionSchemaContext,
    baseBudget: SqlInlineCompletionResolvedSchemaBudget,
): EffectiveSelectionBudget {
    const schemaSizeKind = getSchemaSizeKind(context, baseBudget);
    const effectiveBudget: EffectiveSelectionBudget = {
        ...baseBudget,
        schemaSizeKind,
    };

    if (!baseBudget.schemaSizeAdaptive) {
        return effectiveBudget;
    }

    if (schemaSizeKind === "small") {
        effectiveBudget.maxTables = Math.max(
            baseBudget.maxTables,
            Math.min(context.totalTableCount ?? context.tables.length, context.tables.length),
        );
        effectiveBudget.maxViews = Math.max(
            baseBudget.maxViews,
            Math.min(context.totalViewCount ?? context.views.length, context.views.length),
        );
        effectiveBudget.maxRoutines = Math.max(
            baseBudget.maxRoutines,
            Math.min(
                context.totalRoutineCount ?? context.routines?.length ?? 0,
                context.routines?.length ?? 0,
            ),
        );
        effectiveBudget.maxColumnsPerObject = baseBudget.smallSchemaMaxColumnsPerObject;
        effectiveBudget.maxForeignKeys = Math.max(baseBudget.maxForeignKeys, 512);
        effectiveBudget.maxTableNameOnlyInventory = 0;
        effectiveBudget.maxViewNameOnlyInventory = 0;
        effectiveBudget.maxRoutineNameOnlyInventory = 0;
        return effectiveBudget;
    }

    if (schemaSizeKind === "large") {
        effectiveBudget.maxColumnsPerObject = Math.min(
            baseBudget.maxColumnsPerObject,
            baseBudget.largeSchemaMaxColumnsPerObject,
        );
        effectiveBudget.maxTableNameOnlyInventory = Math.max(
            baseBudget.maxTableNameOnlyInventory,
            baseBudget.largeTableNameOnlyInventory,
        );
        effectiveBudget.maxViewNameOnlyInventory = Math.max(
            baseBudget.maxViewNameOnlyInventory,
            baseBudget.largeViewNameOnlyInventory,
        );
        effectiveBudget.maxRoutineNameOnlyInventory = Math.max(
            baseBudget.maxRoutineNameOnlyInventory,
            baseBudget.largeRoutineNameOnlyInventory,
        );
        effectiveBudget.columnRepresentation = "compact";
        return effectiveBudget;
    }

    if (schemaSizeKind === "outlier") {
        effectiveBudget.maxTables = 0;
        effectiveBudget.maxViews = 0;
        effectiveBudget.maxRoutines = 0;
        effectiveBudget.maxColumnsPerObject = 0;
        effectiveBudget.maxForeignKeys = 0;
        effectiveBudget.maxTableNameOnlyInventory = baseBudget.outlierNameOnlyInventory;
        effectiveBudget.maxViewNameOnlyInventory = Math.floor(
            baseBudget.outlierNameOnlyInventory / 2,
        );
        effectiveBudget.maxRoutineNameOnlyInventory = Math.floor(
            baseBudget.outlierNameOnlyInventory / 2,
        );
        effectiveBudget.columnRepresentation = "compact";
    }

    return effectiveBudget;
}

function getSchemaSizeKind(
    context: SqlInlineCompletionSchemaContext,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): SchemaSizeKind {
    const totalTableCount = context.totalTableCount ?? context.tables.length;
    const totalViewCount = context.totalViewCount ?? context.views.length;
    const totalRoutineCount = budget.includeRoutines
        ? (context.totalRoutineCount ?? context.routines?.length ?? 0)
        : 0;
    const totalObjectCount = totalTableCount + totalViewCount + totalRoutineCount;

    if (!budget.schemaSizeAdaptive) {
        return "medium";
    }

    if (
        totalTableCount <= budget.maxTables &&
        totalViewCount <= budget.maxViews &&
        totalRoutineCount <= budget.maxRoutines &&
        totalObjectCount <= budget.smallSchemaThreshold
    ) {
        return "small";
    }

    if (totalObjectCount >= budget.outlierSchemaThreshold) {
        return "outlier";
    }

    if (totalObjectCount >= budget.largeSchemaThreshold) {
        return "large";
    }

    return "medium";
}

function createSelectionMetadata(
    settings: SqlInlineCompletionSchemaContextRuntimeSettings,
    budget: EffectiveSelectionBudget,
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContextSelectionMetadata {
    const totalTableCount = context.totalTableCount ?? context.tables.length;
    const totalViewCount = context.totalViewCount ?? context.views.length;
    const totalRoutineCount = budget.includeRoutines
        ? (context.totalRoutineCount ?? context.routines?.length ?? 0)
        : 0;
    const totalObjectCount = totalTableCount + totalViewCount + totalRoutineCount;

    return {
        budgetProfile: settings.budgetProfile,
        schemaSizeKind: budget.schemaSizeKind,
        schemaSizeSummary: `schema size ${budget.schemaSizeKind}: ${totalTableCount} tables, ${totalViewCount} views, ${totalRoutineCount} routines (${totalObjectCount} total user objects)`,
        columnRepresentation: budget.columnRepresentation,
        inventoryChunkSize: budget.inventoryChunkSize,
        maxPromptChars: budget.maxPromptChars,
        maxPromptTokens: budget.maxPromptTokens,
        includeRoutines: budget.includeRoutines,
        degradationSteps: [],
    };
}

function buildOutlierSchemaContext(
    context: SqlInlineCompletionSchemaContext,
    relevanceTerms: SchemaRelevanceTerm[],
    budget: EffectiveSelectionBudget,
    metadata: SqlInlineCompletionSchemaContextSelectionMetadata,
): SqlInlineCompletionSchemaContext {
    const allTableNames = uniqueStringsByLowerCase([
        ...context.tables.map((table) => table.name),
        ...(context.tableNameOnlyInventory ?? []),
    ]);
    const allViewNames = uniqueStringsByLowerCase([
        ...context.views.map((view) => view.name),
        ...(context.viewNameOnlyInventory ?? []),
    ]);
    const allRoutineNames = uniqueStringsByLowerCase([
        ...(context.routines ?? []).map((routine) => routine.name),
        ...(context.routineNameOnlyInventory ?? []),
    ]);

    metadata.degradationSteps.push("outlierInventoryOnly");
    return {
        ...context,
        selectionMetadata: metadata,
        schemas: rankSchemasForPrompt(
            context.schemas,
            [...allTableNames, ...allViewNames, ...allRoutineNames],
            relevanceTerms,
            context.defaultSchema,
            budget,
        ).slice(0, Math.min(budget.maxSchemas, 12)),
        tables: [],
        views: [],
        routines: [],
        tableNameOnlyInventory: rankQualifiedNames(
            allTableNames,
            relevanceTerms,
            context.defaultSchema,
            budget,
        ).slice(0, budget.maxTableNameOnlyInventory),
        viewNameOnlyInventory: rankQualifiedNames(
            allViewNames,
            relevanceTerms,
            context.defaultSchema,
            budget,
        ).slice(0, budget.maxViewNameOnlyInventory),
        routineNameOnlyInventory: budget.includeRoutines
            ? rankQualifiedNames(
                  allRoutineNames,
                  relevanceTerms,
                  context.defaultSchema,
                  budget,
              ).slice(0, budget.maxRoutineNameOnlyInventory)
            : [],
        systemObjects: (context.systemObjects ?? []).slice(
            0,
            Math.min(budget.maxSystemObjects, 24),
        ),
        masterSymbols: context.masterSymbols.slice(0, Math.min(budget.maxMasterSymbols, 8)),
    };
}

function selectDetailedTablesWithForeignKeyExpansion(
    rankedTables: SqlInlineCompletionSchemaObject[],
    allTables: SqlInlineCompletionSchemaObject[],
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: EffectiveSelectionBudget,
): SqlInlineCompletionSchemaObject[] {
    const selectedByName = new Map<string, SqlInlineCompletionSchemaObject>();
    const tableByName = new Map<string, SqlInlineCompletionSchemaObject>();
    const maxDetailedTables = Math.max(0, budget.maxTables);
    const expansionReserve = getForeignKeyExpansionReserve(budget, maxDetailedTables);
    const initialTableCount = Math.max(0, maxDetailedTables - expansionReserve);

    for (const table of allTables) {
        tableByName.set(table.name.toLowerCase(), table);
    }

    for (const table of rankedTables.slice(0, initialTableCount)) {
        selectedByName.set(table.name.toLowerCase(), table);
    }

    if (expansionReserve > 0) {
        const reverseReferenceMap = buildReverseForeignKeyReferenceMap(allTables);
        let frontier = [...selectedByName.values()];

        for (let depth = 0; depth < budget.foreignKeyExpansionDepth; depth++) {
            const nextFrontier: SqlInlineCompletionSchemaObject[] = [];
            for (const table of frontier) {
                for (const relatedTableName of getRelatedForeignKeyTableNames(
                    table,
                    reverseReferenceMap,
                )) {
                    if (selectedByName.size >= maxDetailedTables) {
                        break;
                    }

                    const relatedTable = tableByName.get(relatedTableName.toLowerCase());
                    if (!relatedTable || selectedByName.has(relatedTable.name.toLowerCase())) {
                        continue;
                    }

                    selectedByName.set(relatedTable.name.toLowerCase(), relatedTable);
                    nextFrontier.push(relatedTable);
                }
            }
            if (nextFrontier.length === 0 || selectedByName.size >= maxDetailedTables) {
                break;
            }
            frontier = nextFrontier;
        }
    }

    for (const table of rankedTables) {
        if (selectedByName.size >= maxDetailedTables) {
            break;
        }

        if (!selectedByName.has(table.name.toLowerCase())) {
            selectedByName.set(table.name.toLowerCase(), table);
        }
    }

    return rankSchemaObjects(
        [...selectedByName.values()],
        relevanceTerms,
        defaultSchema,
        budget,
    ).slice(0, maxDetailedTables);
}

function getForeignKeyExpansionReserve(
    budget: EffectiveSelectionBudget,
    maxDetailedTables: number,
): number {
    if (
        budget.foreignKeyExpansionDepth <= 0 ||
        budget.foreignKeyExpansionObjectCap <= 0 ||
        maxDetailedTables <= 1
    ) {
        return 0;
    }

    return Math.max(
        1,
        Math.min(
            Math.ceil(maxDetailedTables * 0.25),
            budget.foreignKeyExpansionObjectCap,
            maxDetailedTables - 1,
        ),
    );
}

function buildReverseForeignKeyReferenceMap(
    tables: SqlInlineCompletionSchemaObject[],
): Map<string, string[]> {
    const reverseReferenceMap = new Map<string, string[]>();
    for (const table of tables) {
        for (const foreignKey of table.foreignKeys ?? []) {
            const referencedKey = foreignKey.referencedTable.toLowerCase();
            const existing = reverseReferenceMap.get(referencedKey) ?? [];
            existing.push(table.name);
            reverseReferenceMap.set(referencedKey, existing);
        }
    }
    return reverseReferenceMap;
}

function getRelatedForeignKeyTableNames(
    table: SqlInlineCompletionSchemaObject,
    reverseReferenceMap: Map<string, string[]>,
): string[] {
    return uniqueStringsByLowerCase([
        ...(table.foreignKeys ?? []).map((foreignKey) => foreignKey.referencedTable),
        ...(reverseReferenceMap.get(table.name.toLowerCase()) ?? []),
    ]);
}

function trimSchemaObjectForPrompt(
    object: SqlInlineCompletionSchemaObject,
    budget: EffectiveSelectionBudget,
    maxColumns: number,
): SqlInlineCompletionSchemaObject {
    const trimmed: SqlInlineCompletionSchemaObject = {
        name: object.name,
        columns: object.columns.slice(0, maxColumns),
    };

    if (budget.columnRepresentation === "verbose" && object.columnDefinitions?.length) {
        trimmed.columnDefinitions = object.columnDefinitions.slice(0, maxColumns);
    }

    if (object.primaryKeyColumns?.length) {
        trimmed.primaryKeyColumns = object.primaryKeyColumns.filter((column) =>
            trimmed.columns.some(
                (selectedColumn) => selectedColumn.toLowerCase() === column.toLowerCase(),
            ),
        );
    }

    if (object.foreignKeys?.length && budget.maxForeignKeys > 0) {
        trimmed.foreignKeys = object.foreignKeys
            .filter((foreignKey) =>
                trimmed.columns.some(
                    (selectedColumn) =>
                        selectedColumn.toLowerCase() === foreignKey.column.toLowerCase(),
                ),
            )
            .slice(0, budget.maxForeignKeys);
    }

    return trimmed;
}

function trimRoutineForPrompt(
    routine: SqlInlineCompletionRoutine,
    budget: EffectiveSelectionBudget,
): SqlInlineCompletionRoutine {
    const trimmed: SqlInlineCompletionRoutine = {
        name: routine.name,
        type: routine.type,
        parameters: routine.parameters.slice(0, budget.maxParametersPerRoutine),
    };
    if (routine.typeDescription) {
        trimmed.typeDescription = routine.typeDescription;
    }
    if (routine.returnType) {
        trimmed.returnType = routine.returnType;
    }
    if (routine.returnColumns?.length) {
        trimmed.returnColumns = routine.returnColumns.slice(0, budget.maxColumnsPerObject);
    }
    if (budget.columnRepresentation === "verbose" && routine.returnColumnDefinitions?.length) {
        trimmed.returnColumnDefinitions = routine.returnColumnDefinitions.slice(
            0,
            budget.maxColumnsPerObject,
        );
    }
    return trimmed;
}

function enforcePromptBudget(
    context: SqlInlineCompletionSchemaContext,
    budget: EffectiveSelectionBudget,
): SqlInlineCompletionSchemaContext {
    if (getSchemaContextPayloadSize(context) <= budget.maxPromptChars) {
        return context;
    }

    let current = cloneSchemaContextWithMetadata(context);
    current = addDegradationStep(dropForeignKeys(current), "dropForeignKeys");
    if (getSchemaContextPayloadSize(current) <= budget.maxPromptChars) {
        return current;
    }

    current = addDegradationStep(dropColumnDefinitions(current), "dropColumnTypes");
    if (getSchemaContextPayloadSize(current) <= budget.maxPromptChars) {
        return current;
    }

    current = addDegradationStep(dropInventory(current), "dropInventory");
    if (getSchemaContextPayloadSize(current) <= budget.maxPromptChars) {
        return current;
    }

    current = addDegradationStep(dropNonDefaultSchemaNames(current), "dropNonDefaultSchemaNames");
    if (getSchemaContextPayloadSize(current) <= budget.maxPromptChars) {
        return current;
    }

    current = addDegradationStep(
        shrinkDefaultSchemaNamesToFit(current, budget),
        "shrinkDefaultSchemaNames",
    );
    return current;
}

function cloneSchemaContextWithMetadata(
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContext {
    return {
        ...context,
        selectionMetadata: context.selectionMetadata
            ? {
                  ...context.selectionMetadata,
                  degradationSteps: [...context.selectionMetadata.degradationSteps],
              }
            : undefined,
    };
}

function addDegradationStep(
    context: SqlInlineCompletionSchemaContext,
    step: string,
): SqlInlineCompletionSchemaContext {
    if (!context.selectionMetadata) {
        return context;
    }

    if (!context.selectionMetadata.degradationSteps.includes(step)) {
        context.selectionMetadata = {
            ...context.selectionMetadata,
            degradationSteps: [...context.selectionMetadata.degradationSteps, step],
        };
    }

    return context;
}

function dropForeignKeys(
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContext {
    return {
        ...context,
        tables: context.tables.map((table) => ({
            ...table,
            columnDefinitions: table.columnDefinitions?.map((definition) =>
                definition.replace(/\s+FK->[^,\s)]+/gi, ""),
            ),
            foreignKeys: undefined,
        })),
    };
}

function dropColumnDefinitions(
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContext {
    return {
        ...context,
        tables: context.tables.map(({ columnDefinitions, ...table }) => table),
        views: context.views.map(({ columnDefinitions, ...view }) => view),
        systemObjects: context.systemObjects?.map(({ columnDefinitions, ...object }) => object),
        routines: context.routines?.map(({ returnColumnDefinitions, ...routine }) => routine),
        selectionMetadata: context.selectionMetadata
            ? {
                  ...context.selectionMetadata,
                  columnRepresentation: "compact",
              }
            : undefined,
    };
}

function dropInventory(
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContext {
    return {
        ...context,
        tableNameOnlyInventory: [],
        viewNameOnlyInventory: [],
        routineNameOnlyInventory: [],
    };
}

function dropNonDefaultSchemaNames(
    context: SqlInlineCompletionSchemaContext,
): SqlInlineCompletionSchemaContext {
    const defaultSchema = context.defaultSchema;
    return {
        ...context,
        schemas: defaultSchema
            ? context.schemas.filter((schema) => isDefaultSchema(schema, defaultSchema))
            : [],
        tables: context.tables.filter((table) =>
            isQualifiedNameInDefaultSchema(table.name, defaultSchema),
        ),
        views: context.views.filter((view) =>
            isQualifiedNameInDefaultSchema(view.name, defaultSchema),
        ),
        routines: context.routines?.filter((routine) =>
            isQualifiedNameInDefaultSchema(routine.name, defaultSchema),
        ),
        tableNameOnlyInventory: context.tableNameOnlyInventory?.filter((name) =>
            isQualifiedNameInDefaultSchema(name, defaultSchema),
        ),
        viewNameOnlyInventory: context.viewNameOnlyInventory?.filter((name) =>
            isQualifiedNameInDefaultSchema(name, defaultSchema),
        ),
        routineNameOnlyInventory: context.routineNameOnlyInventory?.filter((name) =>
            isQualifiedNameInDefaultSchema(name, defaultSchema),
        ),
    };
}

function shrinkDefaultSchemaNamesToFit(
    context: SqlInlineCompletionSchemaContext,
    budget: EffectiveSelectionBudget,
): SqlInlineCompletionSchemaContext {
    let current = cloneSchemaContextWithMetadata(context);
    while (getSchemaContextPayloadSize(current) > budget.maxPromptChars) {
        const totalItems =
            current.tables.length +
            current.views.length +
            (current.routines?.length ?? 0) +
            (current.tableNameOnlyInventory?.length ?? 0) +
            (current.viewNameOnlyInventory?.length ?? 0) +
            (current.routineNameOnlyInventory?.length ?? 0);
        if (totalItems <= 3) {
            break;
        }

        current = {
            ...current,
            tables: current.tables.slice(0, Math.max(1, Math.floor(current.tables.length * 0.75))),
            views: current.views.slice(0, Math.max(0, Math.floor(current.views.length * 0.75))),
            routines: current.routines?.slice(
                0,
                Math.max(0, Math.floor((current.routines?.length ?? 0) * 0.75)),
            ),
            tableNameOnlyInventory: current.tableNameOnlyInventory?.slice(
                0,
                Math.max(0, Math.floor((current.tableNameOnlyInventory?.length ?? 0) * 0.75)),
            ),
            viewNameOnlyInventory: current.viewNameOnlyInventory?.slice(
                0,
                Math.max(0, Math.floor((current.viewNameOnlyInventory?.length ?? 0) * 0.75)),
            ),
            routineNameOnlyInventory: current.routineNameOnlyInventory?.slice(
                0,
                Math.max(0, Math.floor((current.routineNameOnlyInventory?.length ?? 0) * 0.75)),
            ),
        };
    }

    return current;
}

function getSchemaContextPayloadSize(context: SqlInlineCompletionSchemaContext): number {
    return JSON.stringify(context).length;
}

function rankSchemaObjects(
    objects: SqlInlineCompletionSchemaObject[],
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): SqlInlineCompletionSchemaObject[] {
    return objects
        .map((object, index) => ({
            value: object,
            index,
            name: object.name,
            relevanceScore: getObjectRelevanceScore(object, relevanceTerms, defaultSchema, budget),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function rankRoutines(
    routines: SqlInlineCompletionRoutine[],
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): SqlInlineCompletionRoutine[] {
    return routines
        .map((routine, index) => ({
            value: routine,
            index,
            name: routine.name,
            relevanceScore: getRoutineRelevanceScore(
                routine,
                relevanceTerms,
                defaultSchema,
                budget,
            ),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function rankQualifiedNames(
    names: string[],
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): string[] {
    return names
        .map((name, index) => ({
            value: name,
            index,
            name,
            relevanceScore: getQualifiedNameRelevanceScore(
                name,
                relevanceTerms,
                defaultSchema,
                budget,
            ),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function rankSchemasForPrompt(
    schemas: string[],
    objectNames: string[],
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): string[] {
    const objectScoreBySchema = new Map<string, number>();
    for (const objectName of objectNames) {
        const [schemaName] = splitQualifiedName(objectName);
        if (!schemaName) {
            continue;
        }

        const score = Math.floor(
            getQualifiedNameRelevanceScore(objectName, relevanceTerms, defaultSchema, budget) / 10,
        );
        if (score <= 0) {
            continue;
        }

        const schemaKey = schemaName.toLowerCase();
        objectScoreBySchema.set(
            schemaKey,
            Math.max(objectScoreBySchema.get(schemaKey) ?? 0, score),
        );
    }

    return schemas
        .map((schema, index) => ({
            value: schema,
            index,
            name: schema,
            relevanceScore:
                getSchemaNameRelevanceScore(schema, relevanceTerms, defaultSchema, budget) +
                (objectScoreBySchema.get(schema.toLowerCase()) ?? 0),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function compareRankedQualifiedNames<T extends RankedValue<unknown>>(
    left: T,
    right: T,
    defaultSchema: string | undefined,
): number {
    const leftHasRelevance = left.relevanceScore > 0 ? 0 : 1;
    const rightHasRelevance = right.relevanceScore > 0 ? 0 : 1;
    if (leftHasRelevance !== rightHasRelevance) {
        return leftHasRelevance - rightHasRelevance;
    }

    if (left.relevanceScore !== right.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
    }

    const [leftSchema] = splitQualifiedName(left.name);
    const [rightSchema] = splitQualifiedName(right.name);
    const leftDefaultRank = isDefaultSchema(leftSchema, defaultSchema) ? 0 : 1;
    const rightDefaultRank = isDefaultSchema(rightSchema, defaultSchema) ? 0 : 1;
    if (leftDefaultRank !== rightDefaultRank) {
        return leftDefaultRank - rightDefaultRank;
    }

    const nameComparison = compareCaseInsensitive(left.name, right.name);
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return left.index - right.index;
}

function getObjectRelevanceScore(
    object: SqlInlineCompletionSchemaObject,
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): number {
    const nameScore = getQualifiedNameRelevanceScore(
        object.name,
        relevanceTerms,
        defaultSchema,
        budget,
    );
    const columnScore = getColumnCollectionRelevanceScore(object.columns, relevanceTerms, budget);
    return nameScore + columnScore;
}

function getRoutineRelevanceScore(
    routine: SqlInlineCompletionRoutine,
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): number {
    const nameScore = getQualifiedNameRelevanceScore(
        routine.name,
        relevanceTerms,
        defaultSchema,
        budget,
    );
    const parameterScore = getColumnCollectionRelevanceScore(
        routine.parameters.map((parameter) => parameter.name),
        relevanceTerms,
        budget,
    );
    const returnColumnScore = getColumnCollectionRelevanceScore(
        routine.returnColumns ?? [],
        relevanceTerms,
        budget,
    );
    return nameScore + parameterScore + returnColumnScore;
}

function getColumnCollectionRelevanceScore(
    columns: string[],
    relevanceTerms: SchemaRelevanceTerm[],
    budget: SqlInlineCompletionResolvedSchemaBudget,
): number {
    if (
        columns.length === 0 ||
        relevanceTerms.length === 0 ||
        budget.columnNameRelevanceWeight <= 0
    ) {
        return 0;
    }

    let relevanceScore = 0;
    const normalizedColumns = columns
        .map((column) => normalizeRelevanceTerm(column))
        .filter((column): column is string => !!column);

    for (const column of normalizedColumns) {
        for (const term of relevanceTerms) {
            const matchWeight = getSingleNameTermMatchWeight(term.text, column);
            if (matchWeight > 0) {
                relevanceScore += Math.floor(
                    matchWeight * budget.columnNameRelevanceWeight * term.weight,
                );
            }
        }
    }

    return relevanceScore;
}

function getQualifiedNameRelevanceScore(
    qualifiedName: string,
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): number {
    const [schemaName, objectName] = splitQualifiedName(qualifiedName);
    const normalizedSchemaName = normalizeRelevanceTerm(schemaName);
    const normalizedObjectName = normalizeRelevanceTerm(objectName);
    const normalizedQualifiedName = normalizeRelevanceTerm(qualifiedName);
    let relevanceScore = isDefaultSchema(schemaName, defaultSchema)
        ? budget.defaultSchemaWeight
        : 0;

    for (const term of relevanceTerms) {
        const priority = budget.maxSchemaContextRelevanceTerms - term.order;
        const matchWeight = getQualifiedNameTermMatchWeight(
            term.text,
            normalizedSchemaName,
            normalizedObjectName,
            normalizedQualifiedName,
        );
        if (matchWeight > 0) {
            relevanceScore += Math.floor(
                (matchWeight + priority * 100 + term.text.length) * term.weight,
            );
        }
    }

    return relevanceScore;
}

function getQualifiedNameTermMatchWeight(
    term: string,
    normalizedSchemaName: string | undefined,
    normalizedObjectName: string | undefined,
    normalizedQualifiedName: string | undefined,
): number {
    if (normalizedQualifiedName === term) {
        return 120000;
    }

    if (normalizedObjectName === term) {
        return 90000;
    }

    if (normalizedSchemaName === term) {
        return 75000;
    }

    if (normalizedQualifiedName?.startsWith(term)) {
        return 60000;
    }

    if (normalizedObjectName?.startsWith(term)) {
        return 45000;
    }

    if (normalizedSchemaName?.startsWith(term)) {
        return 38000;
    }

    if (normalizedQualifiedName?.includes(term)) {
        return 24000;
    }

    if (normalizedObjectName?.includes(term)) {
        return 18000;
    }

    if (normalizedSchemaName?.includes(term)) {
        return 12000;
    }

    return 0;
}

function getSchemaNameRelevanceScore(
    schemaName: string,
    relevanceTerms: SchemaRelevanceTerm[],
    defaultSchema: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): number {
    const normalizedSchemaName = normalizeRelevanceTerm(schemaName);
    let relevanceScore = isDefaultSchema(schemaName, defaultSchema)
        ? budget.defaultSchemaWeight
        : 0;
    for (const term of relevanceTerms) {
        const priority = budget.maxSchemaContextRelevanceTerms - term.order;
        const matchWeight = getSchemaTermMatchWeight(term.text, normalizedSchemaName);
        if (matchWeight > 0) {
            relevanceScore += Math.floor(
                (matchWeight + priority * 100 + term.text.length) * term.weight,
            );
        }
    }

    return relevanceScore;
}

function getSchemaTermMatchWeight(term: string, normalizedSchemaName: string | undefined): number {
    if (normalizedSchemaName === term) {
        return 80000;
    }

    if (normalizedSchemaName?.startsWith(term)) {
        return 42000;
    }

    if (normalizedSchemaName?.includes(term)) {
        return 18000;
    }

    return 0;
}

function getSingleNameTermMatchWeight(term: string, normalizedName: string): number {
    if (normalizedName === term) {
        return 18000;
    }

    if (normalizedName.startsWith(term)) {
        return 10000;
    }

    if (normalizedName.includes(term)) {
        return 5000;
    }

    return 0;
}

function splitQualifiedName(qualifiedName: string): [string | undefined, string] {
    const separatorIndex = qualifiedName.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === qualifiedName.length - 1) {
        return [undefined, qualifiedName];
    }

    return [qualifiedName.slice(0, separatorIndex), qualifiedName.slice(separatorIndex + 1)];
}

function isDefaultSchema(
    schemaName: string | undefined,
    defaultSchema: string | undefined,
): boolean {
    return (
        !!schemaName && !!defaultSchema && schemaName.toLowerCase() === defaultSchema.toLowerCase()
    );
}

function isQualifiedNameInDefaultSchema(
    qualifiedName: string,
    defaultSchema: string | undefined,
): boolean {
    const [schemaName] = splitQualifiedName(qualifiedName);
    return isDefaultSchema(schemaName, defaultSchema);
}

function compareCaseInsensitive(left: string, right: string): number {
    const normalizedLeft = left.toLowerCase();
    const normalizedRight = right.toLowerCase();
    if (normalizedLeft < normalizedRight) {
        return -1;
    }
    if (normalizedLeft > normalizedRight) {
        return 1;
    }
    return 0;
}

function uniqueStringsByLowerCase(values: string[]): string[] {
    const uniqueValues: string[] = [];
    const seenValues = new Set<string>();
    for (const value of values) {
        const key = value.toLowerCase();
        if (seenValues.has(key)) {
            continue;
        }

        seenValues.add(key);
        uniqueValues.push(value);
    }

    return uniqueValues;
}

function extractSchemaContextRelevanceTerms(
    text: string | undefined,
    budget: SqlInlineCompletionResolvedSchemaBudget,
): SchemaRelevanceTerm[] {
    if (!text) {
        return [];
    }

    const termsByText = new Map<string, SchemaRelevanceTerm>();
    let order = 0;
    const pushTerm = (term: string | undefined, offset: number): void => {
        if (!term || term.length < 3 || term.length > 64) {
            return;
        }

        const weight = getRelevanceTermWeight(text, offset, budget.relevanceTermRecencyBias);
        const existing = termsByText.get(term);
        if (existing) {
            existing.weight = Math.max(existing.weight, weight);
            return;
        }

        termsByText.set(term, {
            text: term,
            weight,
            order: order++,
        });
    };

    const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/g;
    for (const match of text.matchAll(identifierPattern)) {
        const identifier = match[0];
        const offset = match.index ?? 0;
        const normalizedIdentifier = normalizeRelevanceTerm(identifier);
        pushTerm(normalizedIdentifier, offset);

        for (const part of splitIdentifierIntoParts(identifier)) {
            for (const variant of expandRelevanceTokenVariants(part, false)) {
                pushTerm(variant, offset);
            }
        }
    }

    const contentTokensWithOffsets = getContentTokensWithOffsets(text);
    for (const token of contentTokensWithOffsets) {
        for (const variant of expandRelevanceTokenVariants(token.text, true)) {
            pushTerm(variant, token.offset);
        }
    }

    for (let index = 0; index < contentTokensWithOffsets.length; index++) {
        const first = contentTokensWithOffsets[index];
        const second = contentTokensWithOffsets[index + 1];
        const third = contentTokensWithOffsets[index + 2];
        if (second) {
            pushTerm(normalizeRelevanceTerm(`${first.text}${second.text}`), first.offset);
        }
        if (second && third) {
            pushTerm(
                normalizeRelevanceTerm(`${first.text}${second.text}${third.text}`),
                first.offset,
            );
        }
    }

    return [...termsByText.values()]
        .sort((left, right) => right.weight - left.weight || left.order - right.order)
        .slice(0, budget.maxSchemaContextRelevanceTerms)
        .map((term, index) => ({ ...term, order: index }));
}

function getRelevanceTermWeight(text: string, offset: number, recencyBias: boolean): number {
    if (!recencyBias || text.length === 0) {
        return 1;
    }

    const relativePosition = Math.max(0, Math.min(1, offset / text.length));
    return 1 + relativePosition * 2;
}

function getContentTokensWithOffsets(text: string): { text: string; offset: number }[] {
    const tokens: { text: string; offset: number }[] = [];
    const tokenPattern = /[A-Za-z0-9_]+/g;
    for (const match of text.matchAll(tokenPattern)) {
        const token = match[0];
        const offset = match.index ?? 0;
        for (const part of splitIdentifierIntoParts(token)) {
            const normalizedPart = part.trim().toLowerCase();
            if (normalizedPart.length < 3 || schemaContextStopWords.has(normalizedPart)) {
                continue;
            }
            tokens.push({ text: normalizedPart, offset });
        }
    }

    return tokens;
}

function splitIdentifierIntoParts(identifier: string): string[] {
    return identifier
        .split(".")
        .flatMap((segment) => segment.split("_"))
        .flatMap((segment) =>
            segment
                .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                .split(/\s+/)
                .filter((part) => part.length > 0),
        );
}

function expandRelevanceTokenVariants(token: string, includeStem: boolean): string[] {
    const normalizedToken = normalizeRelevanceTerm(token);
    if (!normalizedToken) {
        return [];
    }

    const variants = new Set<string>([normalizedToken]);
    const singular = singularizeRelevanceToken(normalizedToken);
    if (singular) {
        variants.add(singular);
    }

    if (includeStem) {
        const stem = buildLooseRelevanceStem(singular ?? normalizedToken);
        if (stem) {
            variants.add(stem);
        }
    }

    return [...variants];
}

function normalizeRelevanceTerm(term: string | undefined): string | undefined {
    if (!term) {
        return undefined;
    }

    const normalized = term.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized.length >= 3 ? normalized : undefined;
}

function singularizeRelevanceToken(token: string): string | undefined {
    if (token.length < 4) {
        return undefined;
    }

    if (token.endsWith("ies") && token.length > 4) {
        return `${token.slice(0, -3)}y`;
    }

    if (
        token.endsWith("s") &&
        !token.endsWith("ss") &&
        !token.endsWith("us") &&
        !token.endsWith("is")
    ) {
        return token.slice(0, -1);
    }

    return undefined;
}

function buildLooseRelevanceStem(token: string): string | undefined {
    if (token.length < 6) {
        return undefined;
    }

    const suffixes = ["ing", "ers", "er", "ion", "ions", "ment", "ments", "al", "als", "ed"];
    for (const suffix of suffixes) {
        if (token.endsWith(suffix) && token.length - suffix.length >= 5) {
            return token.slice(0, -suffix.length);
        }
    }

    if (token.endsWith("e") && token.length > 5) {
        return token.slice(0, -1);
    }

    return undefined;
}

const schemaContextStopWords = new Set([
    "a",
    "all",
    "an",
    "and",
    "are",
    "by",
    "can",
    "current",
    "currently",
    "database",
    "details",
    "find",
    "for",
    "from",
    "get",
    "give",
    "how",
    "in",
    "is",
    "list",
    "me",
    "of",
    "query",
    "queries",
    "schema",
    "schemas",
    "show",
    "table",
    "tables",
    "that",
    "the",
    "their",
    "this",
    "those",
    "to",
    "using",
    "what",
    "which",
    "with",
    "write",
]);

function normalizeCacheKeyPart(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
}

function getErrorBackoffTtlMs(failureCount: number): number {
    const index = Math.min(Math.max(failureCount, 1), errorBackoffTtlMs.length) - 1;
    return errorBackoffTtlMs[index];
}

function withSchemaContextFetchTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new SchemaContextFetchTimeoutError());
        }, schemaContextFetchWaitTimeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

function getSizeBucket(size: number): string {
    if (size === 0) {
        return "0";
    }

    if (size <= 1024) {
        return "1-1k";
    }

    if (size <= 2048) {
        return "1k-2k";
    }

    if (size <= 4096) {
        return "2k-4k";
    }

    if (size <= 8192) {
        return "4k-8k";
    }

    if (size <= 16384) {
        return "8k-16k";
    }

    return "16k+";
}

function getCountBucket(count: number): string {
    if (count === 0) {
        return "0";
    }

    if (count <= 5) {
        return "1-5";
    }

    if (count <= 10) {
        return "6-10";
    }

    if (count <= 20) {
        return "11-20";
    }

    if (count <= 100) {
        return "21-100";
    }

    return "100+";
}

function sqlInt(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }

    return Math.min(sqlUnlimitedCap, Math.floor(value));
}

function buildSchemaContextQuery(budget: SqlInlineCompletionResolvedSchemaBudget): string {
    const maxFetchColumnsPerObject = Math.max(
        budget.maxColumnsPerObject,
        budget.smallSchemaMaxColumnsPerObject,
    );
    const maxFetchForeignKeys = Math.max(
        budget.maxForeignKeys,
        budget.foreignKeyExpansionObjectCap * 4,
    );

    return `
SET NOCOUNT ON;

DECLARE @engineEdition int = TRY_CONVERT(int, SERVERPROPERTY(N'EngineEdition'));
DECLARE @engineEditionName nvarchar(128) = CASE @engineEdition
    WHEN 2 THEN N'SQL Server Standard'
    WHEN 3 THEN N'SQL Server Enterprise/Developer'
    WHEN 4 THEN N'SQL Server Express'
    WHEN 5 THEN N'Azure SQL Database'
    WHEN 6 THEN N'Azure Synapse Analytics (dedicated SQL pool) / Fabric Data Warehouse'
    WHEN 8 THEN N'Azure SQL Managed Instance'
    WHEN 9 THEN N'Azure SQL Edge'
    WHEN 11 THEN N'Azure Synapse serverless SQL pool / Microsoft Fabric'
    WHEN 12 THEN N'Fabric SQL Database'
    ELSE CONCAT(N'Unknown engine edition ', COALESCE(CONVERT(nvarchar(20), @engineEdition), N'NULL'))
END;

-- Engine-edition branches:
-- 2/3/4 = SQL Server on-prem or IaaS, and 8 = Azure SQL Managed Instance: full metadata branch. Server-level sys.* catalog views are included when exposed in the current DB.
-- 5 = Azure SQL Database, 6 = Synapse dedicated SQL pool / Fabric Data Warehouse, 9 = Azure SQL Edge, 11 = Synapse serverless SQL pool / Microsoft Fabric, 12 = Fabric SQL Database: contained branch. No master.sys.* reference is compiled.
DECLARE @canAccessMaster bit = CASE WHEN @engineEdition IN (2, 3, 4, 8) THEN 1 ELSE 0 END;
DECLARE @hasBroadDmvSurface bit = CASE WHEN @engineEdition IN (2, 3, 4, 5, 8) THEN 1 ELSE 0 END;
DECLARE @defaultSchema sysname = COALESCE(CAST(SCHEMA_NAME() AS sysname), N'dbo');
DECLARE @includeRoutines bit = ${budget.includeRoutines ? 1 : 0};
DECLARE @maxFetchedSchemas int = ${sqlInt(budget.maxFetchedSchemas)};
DECLARE @maxFetchedTables int = ${sqlInt(budget.maxFetchedTables)};
DECLARE @maxFetchedViews int = ${sqlInt(budget.maxFetchedViews)};
DECLARE @maxFetchedRoutines int = ${sqlInt(budget.maxFetchedRoutines)};
DECLARE @maxColumnsPerObject int = ${sqlInt(maxFetchColumnsPerObject)};
DECLARE @maxTableNameOnlyInventory int = ${sqlInt(
        Math.max(budget.maxTableNameOnlyInventory, budget.largeTableNameOnlyInventory),
    )};
DECLARE @maxViewNameOnlyInventory int = ${sqlInt(
        Math.max(budget.maxViewNameOnlyInventory, budget.largeViewNameOnlyInventory),
    )};
DECLARE @maxRoutineNameOnlyInventory int = ${sqlInt(
        Math.max(budget.maxRoutineNameOnlyInventory, budget.largeRoutineNameOnlyInventory),
    )};
DECLARE @maxMasterSymbols int = ${sqlInt(budget.maxMasterSymbols)};
DECLARE @maxSystemObjects int = ${sqlInt(budget.maxSystemObjects)};
DECLARE @maxForeignKeys int = ${sqlInt(maxFetchForeignKeys)};
DECLARE @maxParametersPerRoutine int = ${sqlInt(budget.maxParametersPerRoutine)};
DECLARE @schemaContextJson nvarchar(max);

WITH preferredSystemObjects AS (
    -- scope=all: catalog/info-schema objects that are broadly valid when present.
    -- scope=broad: SQL Server, Azure SQL DB, and Managed Instance diagnostic surface.
    -- scope=full: SQL Server and Managed Instance only.
    SELECT 1 AS sortOrder, N'sys' AS schema_name, N'dm_exec_requests' AS object_name, N'[{"name":"session_id"},{"name":"request_id"},{"name":"status"},{"name":"command"},{"name":"database_id"},{"name":"blocking_session_id"},{"name":"wait_type"},{"name":"wait_time"},{"name":"cpu_time"},{"name":"total_elapsed_time"},{"name":"sql_handle"},{"name":"plan_handle"}]' AS columns_json, N'broad' AS scope
    UNION ALL SELECT 2, N'sys', N'dm_exec_sessions', N'[{"name":"session_id"},{"name":"login_time"},{"name":"host_name"},{"name":"program_name"},{"name":"login_name"},{"name":"status"},{"name":"database_id"},{"name":"cpu_time"},{"name":"memory_usage"},{"name":"reads"},{"name":"writes"},{"name":"last_request_end_time"}]', N'broad'
    UNION ALL SELECT 3, N'sys', N'dm_exec_connections', N'[{"name":"session_id"},{"name":"connect_time"},{"name":"net_transport"},{"name":"protocol_type"},{"name":"client_net_address"},{"name":"local_net_address"},{"name":"local_tcp_port"},{"name":"most_recent_sql_handle"}]', N'broad'
    UNION ALL SELECT 4, N'sys', N'dm_exec_query_stats', N'[{"name":"sql_handle"},{"name":"plan_handle"},{"name":"creation_time"},{"name":"last_execution_time"},{"name":"execution_count"},{"name":"total_worker_time"},{"name":"total_elapsed_time"},{"name":"total_logical_reads"},{"name":"total_logical_writes"}]', N'broad'
    UNION ALL SELECT 5, N'sys', N'dm_exec_sql_text', N'[{"name":"sql_handle"},{"name":"dbid"},{"name":"objectid"},{"name":"number"},{"name":"encrypted"},{"name":"text"}]', N'broad'
    UNION ALL SELECT 6, N'sys', N'dm_exec_query_plan', N'[{"name":"plan_handle"},{"name":"dbid"},{"name":"objectid"},{"name":"number"},{"name":"encrypted"},{"name":"query_plan"}]', N'broad'
    UNION ALL SELECT 7, N'sys', N'dm_os_wait_stats', N'[{"name":"wait_type"},{"name":"waiting_tasks_count"},{"name":"wait_time_ms"},{"name":"max_wait_time_ms"},{"name":"signal_wait_time_ms"}]', N'full'
    UNION ALL SELECT 8, N'sys', N'dm_os_performance_counters', N'[{"name":"object_name"},{"name":"counter_name"},{"name":"instance_name"},{"name":"cntr_value"},{"name":"cntr_type"}]', N'full'
    UNION ALL SELECT 9, N'sys', N'dm_os_memory_clerks', N'[{"name":"type"},{"name":"name"},{"name":"memory_node_id"},{"name":"pages_kb"},{"name":"virtual_memory_reserved_kb"},{"name":"virtual_memory_committed_kb"}]', N'full'
    UNION ALL SELECT 10, N'sys', N'dm_db_index_usage_stats', N'[{"name":"database_id"},{"name":"object_id"},{"name":"index_id"},{"name":"user_seeks"},{"name":"user_scans"},{"name":"user_lookups"},{"name":"user_updates"},{"name":"last_user_seek"},{"name":"last_user_scan"}]', N'broad'
    UNION ALL SELECT 11, N'sys', N'dm_db_missing_index_details', N'[{"name":"index_handle"},{"name":"database_id"},{"name":"object_id"},{"name":"equality_columns"},{"name":"inequality_columns"},{"name":"included_columns"},{"name":"statement"}]', N'broad'
    UNION ALL SELECT 12, N'sys', N'dm_db_index_physical_stats', N'[{"name":"database_id"},{"name":"object_id"},{"name":"index_id"},{"name":"partition_number"},{"name":"index_type_desc"},{"name":"alloc_unit_type_desc"},{"name":"avg_fragmentation_in_percent"},{"name":"page_count"}]', N'broad'
    UNION ALL SELECT 13, N'sys', N'dm_tran_locks', N'[{"name":"resource_type"},{"name":"resource_database_id"},{"name":"resource_associated_entity_id"},{"name":"request_mode"},{"name":"request_type"},{"name":"request_status"},{"name":"request_session_id"}]', N'broad'
    UNION ALL SELECT 14, N'sys', N'master_files', N'[{"name":"database_id"},{"name":"file_id"},{"name":"type_desc"},{"name":"name"},{"name":"physical_name"},{"name":"state_desc"},{"name":"size"},{"name":"max_size"}]', N'full'
    UNION ALL SELECT 15, N'sys', N'server_principals', N'[{"name":"principal_id"},{"name":"name"},{"name":"type_desc"},{"name":"is_disabled"},{"name":"create_date"},{"name":"modify_date"},{"name":"default_database_name"}]', N'full'
    UNION ALL SELECT 16, N'sys', N'sql_logins', N'[{"name":"principal_id"},{"name":"name"},{"name":"is_disabled"},{"name":"is_policy_checked"},{"name":"is_expiration_checked"},{"name":"default_database_name"}]', N'full'
    UNION ALL SELECT 17, N'sys', N'server_role_members', N'[{"name":"role_principal_id"},{"name":"member_principal_id"}]', N'full'
    UNION ALL SELECT 18, N'sys', N'endpoints', N'[{"name":"endpoint_id"},{"name":"name"},{"name":"protocol_desc"},{"name":"type_desc"},{"name":"state_desc"},{"name":"is_admin_endpoint"}]', N'full'
    UNION ALL SELECT 20, N'sys', N'databases', N'[{"name":"database_id"},{"name":"name"},{"name":"state_desc"},{"name":"compatibility_level"},{"name":"collation_name"},{"name":"recovery_model_desc"},{"name":"create_date"}]', N'all'
    UNION ALL SELECT 21, N'sys', N'objects', N'[{"name":"object_id"},{"name":"name"},{"name":"schema_id"},{"name":"type"},{"name":"type_desc"},{"name":"create_date"},{"name":"modify_date"}]', N'all'
    UNION ALL SELECT 22, N'sys', N'columns', N'[{"name":"object_id"},{"name":"column_id"},{"name":"name"},{"name":"user_type_id"},{"name":"max_length"},{"name":"precision"},{"name":"scale"},{"name":"is_nullable"}]', N'all'
    UNION ALL SELECT 23, N'sys', N'tables', N'[{"name":"object_id"},{"name":"name"},{"name":"schema_id"},{"name":"type_desc"},{"name":"create_date"},{"name":"modify_date"},{"name":"is_ms_shipped"}]', N'all'
    UNION ALL SELECT 24, N'sys', N'views', N'[{"name":"object_id"},{"name":"name"},{"name":"schema_id"},{"name":"type_desc"},{"name":"create_date"},{"name":"modify_date"},{"name":"is_ms_shipped"}]', N'all'
    UNION ALL SELECT 25, N'sys', N'indexes', N'[{"name":"object_id"},{"name":"index_id"},{"name":"name"},{"name":"type_desc"},{"name":"is_unique"},{"name":"is_primary_key"},{"name":"is_disabled"}]', N'all'
    UNION ALL SELECT 26, N'sys', N'index_columns', N'[{"name":"object_id"},{"name":"index_id"},{"name":"index_column_id"},{"name":"column_id"},{"name":"key_ordinal"},{"name":"is_included_column"}]', N'all'
    UNION ALL SELECT 27, N'sys', N'partitions', N'[{"name":"partition_id"},{"name":"object_id"},{"name":"index_id"},{"name":"partition_number"},{"name":"rows"},{"name":"data_compression_desc"}]', N'all'
    UNION ALL SELECT 28, N'sys', N'allocation_units', N'[{"name":"allocation_unit_id"},{"name":"type_desc"},{"name":"container_id"},{"name":"data_pages"},{"name":"used_pages"},{"name":"total_pages"}]', N'all'
    UNION ALL SELECT 29, N'sys', N'foreign_keys', N'[{"name":"object_id"},{"name":"name"},{"name":"parent_object_id"},{"name":"referenced_object_id"},{"name":"delete_referential_action_desc"},{"name":"update_referential_action_desc"}]', N'all'
    UNION ALL SELECT 30, N'sys', N'foreign_key_columns', N'[{"name":"constraint_object_id"},{"name":"constraint_column_id"},{"name":"parent_object_id"},{"name":"parent_column_id"},{"name":"referenced_object_id"},{"name":"referenced_column_id"}]', N'all'
    UNION ALL SELECT 31, N'sys', N'schemas', N'[{"name":"schema_id"},{"name":"name"},{"name":"principal_id"}]', N'all'
    UNION ALL SELECT 32, N'sys', N'types', N'[{"name":"user_type_id"},{"name":"system_type_id"},{"name":"name"},{"name":"schema_id"},{"name":"max_length"},{"name":"precision"},{"name":"scale"},{"name":"is_nullable"}]', N'all'
    UNION ALL SELECT 33, N'sys', N'procedures', N'[{"name":"object_id"},{"name":"name"},{"name":"schema_id"},{"name":"type_desc"},{"name":"create_date"},{"name":"modify_date"}]', N'all'
    UNION ALL SELECT 34, N'sys', N'parameters', N'[{"name":"object_id"},{"name":"parameter_id"},{"name":"name"},{"name":"user_type_id"},{"name":"max_length"},{"name":"precision"},{"name":"scale"},{"name":"is_output"}]', N'all'
    UNION ALL SELECT 40, N'INFORMATION_SCHEMA', N'TABLES', N'[{"name":"TABLE_CATALOG"},{"name":"TABLE_SCHEMA"},{"name":"TABLE_NAME"},{"name":"TABLE_TYPE"}]', N'all'
    UNION ALL SELECT 41, N'INFORMATION_SCHEMA', N'COLUMNS', N'[{"name":"TABLE_CATALOG"},{"name":"TABLE_SCHEMA"},{"name":"TABLE_NAME"},{"name":"COLUMN_NAME"},{"name":"ORDINAL_POSITION"},{"name":"DATA_TYPE"},{"name":"IS_NULLABLE"}]', N'all'
    UNION ALL SELECT 42, N'INFORMATION_SCHEMA', N'VIEWS', N'[{"name":"TABLE_CATALOG"},{"name":"TABLE_SCHEMA"},{"name":"TABLE_NAME"},{"name":"VIEW_DEFINITION"}]', N'all'
    UNION ALL SELECT 43, N'INFORMATION_SCHEMA', N'ROUTINES', N'[{"name":"SPECIFIC_SCHEMA"},{"name":"SPECIFIC_NAME"},{"name":"ROUTINE_SCHEMA"},{"name":"ROUTINE_NAME"},{"name":"ROUTINE_TYPE"},{"name":"DATA_TYPE"}]', N'all'
),
systemObjects AS (
    SELECT
        p.sortOrder,
        p.schema_name,
        p.object_name,
        p.columns_json,
        ROW_NUMBER() OVER (ORDER BY p.sortOrder) AS systemRank
    FROM preferredSystemObjects p
    WHERE (
            p.scope = N'all'
            OR (p.scope = N'broad' AND @hasBroadDmvSurface = 1)
            OR (p.scope = N'full' AND @canAccessMaster = 1)
        )
      AND EXISTS (
            SELECT 1
            FROM sys.all_objects o
            INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE s.name = p.schema_name
              AND o.name = p.object_name
        )
),
masterSymbols AS (
    -- Full and contained branches both avoid compiling master.sys.* to keep one query safe on Fabric/Synapse. Full engines get in-database sys.master_files/sys.server_principals/etc. above when exposed.
    SELECT
        CAST(NULL AS int) AS sortOrder,
        CAST(NULL AS sysname) AS schema_name,
        CAST(NULL AS sysname) AS object_name
    WHERE 1 = 0
),
rankedSchemas AS (
    SELECT
        s.name,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE WHEN s.name = @defaultSchema THEN 0 ELSE 1 END,
                s.name
        ) AS schemaRank
    FROM sys.schemas s
    WHERE s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
),
rankedTables AS (
    SELECT
        t.object_id,
        s.name AS schema_name,
        t.name AS object_name,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE WHEN s.name = @defaultSchema THEN 0 ELSE 1 END,
                s.name,
                t.name
        ) AS objectRank
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
),
rankedViews AS (
    SELECT
        v.object_id,
        s.name AS schema_name,
        v.name AS object_name,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE WHEN s.name = @defaultSchema THEN 0 ELSE 1 END,
                s.name,
                v.name
        ) AS objectRank
    FROM sys.views v
    INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
    WHERE v.is_ms_shipped = 0
),
rankedRoutines AS (
    SELECT
        o.object_id,
        s.name AS schema_name,
        o.name AS object_name,
        o.type AS routine_type,
        o.type_desc AS type_description,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE WHEN s.name = @defaultSchema THEN 0 ELSE 1 END,
                CASE WHEN o.type IN (N'P', N'PC') THEN 0 ELSE 1 END,
                s.name,
                o.name
        ) AS routineRank
    FROM sys.objects o
    INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
    WHERE @includeRoutines = 1
      AND o.is_ms_shipped = 0
      AND o.type IN (N'P', N'PC', N'FN', N'IF', N'TF', N'FS', N'FT')
),
primaryKeyColumns AS (
    SELECT
        ic.object_id,
        ic.column_id,
        MIN(ic.key_ordinal) AS key_ordinal
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id
       AND ic.index_id = i.index_id
    WHERE i.is_primary_key = 1
    GROUP BY ic.object_id, ic.column_id
),
rankedForeignKeys AS (
    SELECT
        fkc.parent_object_id,
        parentColumn.name AS parent_column_name,
        referencedSchema.name + N'.' + referencedTable.name AS referenced_table_name,
        referencedColumn.name AS referenced_column_name,
        ROW_NUMBER() OVER (
            ORDER BY
                parentSchema.name,
                parentTable.name,
                foreignKey.name,
                fkc.constraint_column_id
        ) AS foreignKeyRank
    FROM sys.foreign_key_columns fkc
    INNER JOIN sys.foreign_keys foreignKey
        ON foreignKey.object_id = fkc.constraint_object_id
    INNER JOIN sys.tables parentTable
        ON parentTable.object_id = fkc.parent_object_id
    INNER JOIN sys.schemas parentSchema
        ON parentSchema.schema_id = parentTable.schema_id
    INNER JOIN rankedTables rankedParent
        ON rankedParent.object_id = fkc.parent_object_id
       AND rankedParent.objectRank <= @maxFetchedTables
    INNER JOIN sys.columns parentColumn
        ON parentColumn.object_id = fkc.parent_object_id
       AND parentColumn.column_id = fkc.parent_column_id
    INNER JOIN sys.tables referencedTable
        ON referencedTable.object_id = fkc.referenced_object_id
    INNER JOIN sys.schemas referencedSchema
        ON referencedSchema.schema_id = referencedTable.schema_id
    INNER JOIN sys.columns referencedColumn
        ON referencedColumn.object_id = fkc.referenced_object_id
       AND referencedColumn.column_id = fkc.referenced_column_id
),
rankedColumnForeignKeys AS (
    SELECT
        rfk.parent_object_id,
        rfk.parent_column_name,
        rfk.referenced_table_name,
        rfk.referenced_column_name,
        rfk.foreignKeyRank,
        ROW_NUMBER() OVER (
            PARTITION BY rfk.parent_object_id, rfk.parent_column_name
            ORDER BY rfk.foreignKeyRank
        ) AS columnForeignKeyRank
    FROM rankedForeignKeys rfk
    WHERE rfk.foreignKeyRank <= @maxForeignKeys
)
SELECT @schemaContextJson = (
    SELECT
        @@SERVERNAME AS [server],
        DB_NAME() AS [database],
        @defaultSchema AS [defaultSchema],
        @engineEdition AS [engineEdition],
        @engineEditionName AS [engineEditionName],
        (SELECT COUNT(*) FROM rankedTables) AS [totalTableCount],
        (SELECT COUNT(*) FROM rankedViews) AS [totalViewCount],
        (SELECT COUNT(*) FROM rankedRoutines) AS [totalRoutineCount],
        JSON_QUERY((
            SELECT rs.name AS [name]
            FROM rankedSchemas rs
            WHERE rs.schemaRank <= @maxFetchedSchemas
            ORDER BY rs.schemaRank
            FOR JSON PATH
        )) AS [schemas],
        JSON_QUERY((
            SELECT
                rt.schema_name AS [schema],
                rt.object_name AS [name],
                JSON_QUERY((
                    SELECT TOP (@maxColumnsPerObject)
                        c.name AS [name],
                        c.name + N' ' +
                            CASE
                                WHEN ty.name IN (N'nvarchar', N'nchar') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length / 2) END + N')'
                                WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length) END + N')'
                                WHEN ty.name IN (N'decimal', N'numeric') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.precision) + N',' + CONVERT(nvarchar(10), c.scale) + N')'
                                WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.scale) + N')'
                                ELSE ty.name
                            END +
                            CASE WHEN c.is_nullable = 0 THEN N' NOT NULL' ELSE N'' END AS [definition],
                        CAST(CASE WHEN primaryKey.key_ordinal IS NULL THEN 0 ELSE 1 END AS bit) AS [isPrimaryKey],
                        fk.referenced_table_name AS [referencedTable],
                        fk.referenced_column_name AS [referencedColumn]
                    FROM sys.columns c
                    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                    LEFT JOIN primaryKeyColumns primaryKey
                        ON primaryKey.object_id = c.object_id
                       AND primaryKey.column_id = c.column_id
                    LEFT JOIN rankedColumnForeignKeys fk
                        ON fk.parent_object_id = c.object_id
                       AND fk.parent_column_name = c.name
                       AND fk.columnForeignKeyRank = 1
                    WHERE c.object_id = rt.object_id
                    ORDER BY
                        CASE WHEN primaryKey.key_ordinal IS NULL THEN 1 ELSE 0 END,
                        primaryKey.key_ordinal,
                        c.column_id
                    FOR JSON PATH
                )) AS [columns],
                JSON_QUERY((
                    SELECT TOP (@maxForeignKeys)
                        rfk.parent_column_name AS [column],
                        rfk.referenced_table_name AS [referencedTable],
                        rfk.referenced_column_name AS [referencedColumn]
                    FROM rankedForeignKeys rfk
                    WHERE rfk.parent_object_id = rt.object_id
                      AND rfk.foreignKeyRank <= @maxForeignKeys
                    ORDER BY rfk.foreignKeyRank
                    FOR JSON PATH
                )) AS [foreignKeys]
            FROM rankedTables rt
            WHERE rt.objectRank <= @maxFetchedTables
            ORDER BY rt.objectRank
            FOR JSON PATH
        )) AS [tables],
        JSON_QUERY((
            SELECT
                rv.schema_name AS [schema],
                rv.object_name AS [name],
                JSON_QUERY((
                    SELECT TOP (@maxColumnsPerObject)
                        c.name AS [name],
                        c.name + N' ' +
                            CASE
                                WHEN ty.name IN (N'nvarchar', N'nchar') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length / 2) END + N')'
                                WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length) END + N')'
                                WHEN ty.name IN (N'decimal', N'numeric') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.precision) + N',' + CONVERT(nvarchar(10), c.scale) + N')'
                                WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.scale) + N')'
                                ELSE ty.name
                            END +
                            CASE WHEN c.is_nullable = 0 THEN N' NOT NULL' ELSE N'' END AS [definition]
                    FROM sys.columns c
                    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                    WHERE c.object_id = rv.object_id
                    ORDER BY c.column_id
                    FOR JSON PATH
                )) AS [columns]
            FROM rankedViews rv
            WHERE rv.objectRank <= @maxFetchedViews
            ORDER BY rv.objectRank
            FOR JSON PATH
        )) AS [views],
        JSON_QUERY((
            SELECT
                rr.schema_name AS [schema],
                rr.object_name AS [name],
                rr.routine_type AS [type],
                rr.type_description AS [typeDescription],
                CASE
                    WHEN rr.routine_type IN (N'IF', N'TF', N'FT') THEN N'TABLE'
                    ELSE returnType.name
                END AS [returnType],
                JSON_QUERY((
                    SELECT TOP (@maxParametersPerRoutine)
                        p.name AS [name],
                        p.name + N' ' +
                            CASE
                                WHEN ty.name IN (N'nvarchar', N'nchar') THEN ty.name + N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length / 2) END + N')'
                                WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN ty.name + N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), p.max_length) END + N')'
                                WHEN ty.name IN (N'decimal', N'numeric') THEN ty.name + N'(' + CONVERT(nvarchar(10), p.precision) + N',' + CONVERT(nvarchar(10), p.scale) + N')'
                                WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN ty.name + N'(' + CONVERT(nvarchar(10), p.scale) + N')'
                                ELSE ty.name
                            END +
                            CASE WHEN p.is_output = 1 THEN N' OUTPUT' ELSE N'' END AS [definition],
                        CASE WHEN p.is_output = 1 THEN N'OUTPUT' ELSE N'INPUT' END AS [direction]
                    FROM sys.parameters p
                    INNER JOIN sys.types ty ON ty.user_type_id = p.user_type_id
                    WHERE p.object_id = rr.object_id
                      AND p.parameter_id > 0
                    ORDER BY p.parameter_id
                    FOR JSON PATH
                )) AS [parameters],
                JSON_QUERY((
                    SELECT TOP (@maxColumnsPerObject)
                        c.name AS [name],
                        c.name + N' ' +
                            CASE
                                WHEN ty.name IN (N'nvarchar', N'nchar') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length / 2) END + N')'
                                WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(nvarchar(10), c.max_length) END + N')'
                                WHEN ty.name IN (N'decimal', N'numeric') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.precision) + N',' + CONVERT(nvarchar(10), c.scale) + N')'
                                WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN ty.name + N'(' + CONVERT(nvarchar(10), c.scale) + N')'
                                ELSE ty.name
                            END +
                            CASE WHEN c.is_nullable = 0 THEN N' NOT NULL' ELSE N'' END AS [definition]
                    FROM sys.columns c
                    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                    WHERE c.object_id = rr.object_id
                      AND rr.routine_type IN (N'IF', N'TF', N'FT')
                    ORDER BY c.column_id
                    FOR JSON PATH
                )) AS [returnColumns]
            FROM rankedRoutines rr
            LEFT JOIN sys.parameters returnParameter
                ON returnParameter.object_id = rr.object_id
               AND returnParameter.parameter_id = 0
            LEFT JOIN sys.types returnType
                ON returnType.user_type_id = returnParameter.user_type_id
            WHERE rr.routineRank <= @maxFetchedRoutines
            ORDER BY rr.routineRank
            FOR JSON PATH
        )) AS [routines],
        JSON_QUERY((
            SELECT TOP (@maxTableNameOnlyInventory)
                rt.schema_name AS [schema],
                rt.object_name AS [name]
            FROM rankedTables rt
            WHERE rt.objectRank > @maxFetchedTables
            ORDER BY rt.objectRank
            FOR JSON PATH
        )) AS [tableNameOnlyInventory],
        JSON_QUERY((
            SELECT TOP (@maxViewNameOnlyInventory)
                rv.schema_name AS [schema],
                rv.object_name AS [name]
            FROM rankedViews rv
            WHERE rv.objectRank > @maxFetchedViews
            ORDER BY rv.objectRank
            FOR JSON PATH
        )) AS [viewNameOnlyInventory],
        JSON_QUERY((
            SELECT TOP (@maxRoutineNameOnlyInventory)
                rr.schema_name AS [schema],
                rr.object_name AS [name]
            FROM rankedRoutines rr
            WHERE rr.routineRank > @maxFetchedRoutines
            ORDER BY rr.routineRank
            FOR JSON PATH
        )) AS [routineNameOnlyInventory],
        JSON_QUERY((
            SELECT
                so.schema_name AS [schema],
                so.object_name AS [name],
                JSON_QUERY(so.columns_json) AS [columns]
            FROM systemObjects so
            WHERE so.systemRank <= @maxSystemObjects
            ORDER BY so.systemRank
            FOR JSON PATH
        )) AS [systemObjects],
        JSON_QUERY((
            SELECT TOP (@maxMasterSymbols)
                ms.schema_name AS [schema],
                ms.object_name AS [name]
            FROM masterSymbols ms
            ORDER BY ms.sortOrder, ms.schema_name, ms.object_name
            FOR JSON PATH
        )) AS [masterSymbols]
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
);

WITH schemaContextChunks AS (
    SELECT 1 AS chunkStart
    WHERE @schemaContextJson IS NOT NULL AND LEN(@schemaContextJson) > 0
    UNION ALL
    SELECT chunkStart + 4000
    FROM schemaContextChunks
    WHERE chunkStart + 4000 <= LEN(@schemaContextJson)
)
SELECT SUBSTRING(@schemaContextJson, chunkStart, 4000) AS schemaContextJson
FROM schemaContextChunks
ORDER BY chunkStart
OPTION (MAXRECURSION 0);
`.trim();
}
