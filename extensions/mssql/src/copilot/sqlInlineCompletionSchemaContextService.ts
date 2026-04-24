/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SimpleExecuteResult } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";
import ConnectionManager, { ConnectionInfo } from "../controllers/connectionManager";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { logger2 } from "../models/logger2";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";

const schemaContextRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void,
    void
>("query/simpleexecute");

const cacheTtlMs = 5 * 60 * 1000;
const errorBackoffTtlMs = [30 * 1000, 60 * 1000, 120 * 1000, 300 * 1000];
const maxCacheEntries = 32;
const maxSchemas = 24;
const maxTables = 12;
const maxViews = 8;
const maxColumnsPerObject = 12;
const maxTableNameOnlyInventory = 64;
const maxViewNameOnlyInventory = 32;
const maxFetchedSchemas = 64;
const maxFetchedTables = maxTables + maxTableNameOnlyInventory;
const maxFetchedViews = maxViews + maxViewNameOnlyInventory;
const maxMasterSymbols = 12;
const maxSystemObjects = 36;
const maxForeignKeys = 24;
const maxSchemaContextRelevanceTerms = 24;

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
    schemas?: RawSchemaName[];
    tables?: RawSchemaObject[];
    views?: RawSchemaObject[];
    tableNameOnlyInventory?: RawMasterSymbol[];
    viewNameOnlyInventory?: RawMasterSymbol[];
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

export interface SqlInlineCompletionSchemaContext {
    server?: string;
    database?: string;
    defaultSchema?: string;
    engineEdition?: number;
    engineEditionName?: string;
    totalTableCount?: number;
    totalViewCount?: number;
    schemas: string[];
    tables: SqlInlineCompletionSchemaObject[];
    views: SqlInlineCompletionSchemaObject[];
    tableNameOnlyInventory?: string[];
    viewNameOnlyInventory?: string[];
    masterSymbols: string[];
    systemObjects?: SqlInlineCompletionSchemaObject[];
    inferredSystemQuery?: boolean;
}

class SchemaContextParseError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "SchemaContextParseError";
    }
}

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
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        const ownerUri = document.uri.toString();
        const connectionInfo = this._connectionManager.getConnectionInfo(ownerUri);

        if (!connectionInfo?.credentials) {
            this._logger.debug(
                "Skipping schema context fetch because the editor has no active connection",
            );
            this.sendSchemaContextTelemetry("noConnection", undefined);
            return undefined;
        }

        const connectionFingerprint = this.createConnectionFingerprint(connectionInfo);
        const relevanceTerms = extractSchemaContextRelevanceTerms(
            relevanceText ?? document.getText(),
        );
        const cacheKey = this.createCacheKey(connectionFingerprint);
        const now = Date.now();
        const cachedEntry = this._cache.get(cacheKey);
        if (cachedEntry && cachedEntry.expiresAt > now) {
            this.touchCacheEntry(cacheKey, cachedEntry);
            const selectedContext = selectSchemaContextForPrompt(cachedEntry.value, relevanceTerms);
            this._logger.debug("Using cached schema context for inline completion");
            this.sendSchemaContextTelemetry("cacheHit", selectedContext, cachedEntry.failureCount);
            return selectedContext;
        }

        if (cachedEntry) {
            this._cache.delete(cacheKey);
        }

        const existingFetch = this._inFlight.get(cacheKey);
        if (existingFetch) {
            const fetchedContext = await existingFetch.promise;
            return selectSchemaContextForPrompt(fetchedContext, relevanceTerms);
        }

        const fetchPromise = this.fetchAndCacheSchemaContext(
            cacheKey,
            connectionFingerprint,
            ownerUri,
            connectionInfo,
        );
        this._inFlight.set(cacheKey, {
            connectionFingerprint,
            promise: fetchPromise,
        });
        const fetchedContext = await fetchPromise;
        const selectedContext = selectSchemaContextForPrompt(fetchedContext, relevanceTerms);
        if (fetchedContext) {
            this.sendSchemaContextTelemetry("cacheMissFetched", selectedContext);
        }
        return selectedContext;
    }

    private async fetchAndCacheSchemaContext(
        cacheKey: string,
        connectionFingerprint: string,
        ownerUri: string,
        connectionInfo: ConnectionInfo,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        try {
            this._logger.debug("Fetching schema context for inline completion");
            await this._connectionManager.refreshAzureAccountToken(ownerUri);

            const result = await this._client.sendRequest(schemaContextRequest, {
                ownerUri,
                queryString: buildSchemaContextQuery(),
            });

            const parsed = this.parseSchemaContext(result);
            this.cacheSuccess(cacheKey, connectionFingerprint, parsed);
            return parsed;
        } catch (error) {
            const stage = error instanceof SchemaContextParseError ? "parseError" : "fetchError";
            const errorMessage = getErrorMessage(error);
            this._logger.warn(
                `Failed to fetch inline completion schema context (${stage}): ${errorMessage}`,
            );
            const failureCount = this.cacheFailure(cacheKey, connectionFingerprint);

            this.sendSchemaContextTelemetry("cacheMissFailed", undefined, failureCount);
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
            schemas: normalizeSchemaNames(rawContext.schemas, maxFetchedSchemas),
            tables: normalizeSchemaObjects(
                rawContext.tables,
                maxFetchedTables,
                maxColumnsPerObject,
                true,
            ),
            views: normalizeSchemaObjects(
                rawContext.views,
                maxFetchedViews,
                maxColumnsPerObject,
                false,
            ),
            tableNameOnlyInventory: normalizeMasterSymbols(
                rawContext.tableNameOnlyInventory,
                maxTableNameOnlyInventory,
            ),
            viewNameOnlyInventory: normalizeMasterSymbols(
                rawContext.viewNameOnlyInventory,
                maxViewNameOnlyInventory,
            ),
            masterSymbols: normalizeMasterSymbols(rawContext.masterSymbols, maxMasterSymbols),
            systemObjects: normalizeSchemaObjects(
                rawContext.systemObjects,
                maxSystemObjects,
                maxColumnsPerObject,
                false,
            ),
        };

        if (
            !context.server &&
            !context.database &&
            context.schemas.length === 0 &&
            context.tables.length === 0 &&
            context.views.length === 0 &&
            (context.tableNameOnlyInventory?.length ?? 0) === 0 &&
            (context.viewNameOnlyInventory?.length ?? 0) === 0 &&
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

    private createCacheKey(connectionFingerprint: string): string {
        return connectionFingerprint;
    }

    private cacheSuccess(
        cacheKey: string,
        connectionFingerprint: string,
        value: SqlInlineCompletionSchemaContext | undefined,
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

    private cacheFailure(cacheKey: string, connectionFingerprint: string): number {
        const failureCount = (this._errorFailuresByCacheKey.get(cacheKey) ?? 0) + 1;
        this._errorFailuresByCacheKey.set(cacheKey, failureCount);
        this._cache.set(cacheKey, {
            connectionFingerprint,
            expiresAt: Date.now() + getErrorBackoffTtlMs(failureCount),
            value: undefined,
            failureCount,
        });
        this.enforceCacheLimit();
        return failureCount;
    }

    private touchCacheEntry(cacheKey: string, entry: CacheEntry): void {
        this._cache.delete(cacheKey);
        this._cache.set(cacheKey, entry);
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
        failureCount: number = 0,
    ): void {
        const payloadSize = context ? JSON.stringify(context).length : 0;
        const objectCount = (context?.tables.length ?? 0) + (context?.views.length ?? 0);
        const systemObjectCount = context?.systemObjects?.length ?? 0;
        const foreignKeyCount = (context?.tables ?? []).reduce(
            (sum, table) => sum + (table.foreignKeys?.length ?? 0),
            0,
        );

        sendActionEvent(
            TelemetryViews.MssqlCopilot,
            TelemetryActions.InlineCompletionSchemaContext,
            {
                stage,
                hasContext: (!!context).toString(),
                fallbackWithoutMetadata: (!context).toString(),
                payloadSizeBucket: getSizeBucket(payloadSize),
                objectCountBucket: getCountBucket(objectCount),
                systemObjectCountBucket: getCountBucket(systemObjectCount),
                masterSymbolCountBucket: getCountBucket(context?.masterSymbols.length ?? 0),
                foreignKeyCountBucket: getCountBucket(foreignKeyCount),
                engineEdition: context?.engineEdition?.toString() ?? "unknown",
                engineEditionName: context?.engineEditionName ?? "unknown",
                failureCountBucket: getCountBucket(failureCount),
            },
        );
    }
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
    assertArrayProperty(value, "tableNameOnlyInventory");
    assertArrayProperty(value, "viewNameOnlyInventory");
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
            addForeignKey(foreignKeys, seenForeignKeys, column, referencedTable, referencedColumn);
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
): void {
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

function normalizeBoolean(value: boolean | number | undefined): boolean {
    return value === true || value === 1;
}

function selectSchemaContextForPrompt(
    context: SqlInlineCompletionSchemaContext | undefined,
    relevanceTerms: string[],
): SqlInlineCompletionSchemaContext | undefined {
    if (!context) {
        return undefined;
    }

    const rankedTables = rankSchemaObjects(context.tables, relevanceTerms, context.defaultSchema);
    const rankedViews = rankSchemaObjects(context.views, relevanceTerms, context.defaultSchema);
    const selectedTables = rankedTables.slice(0, maxTables);
    const selectedViews = rankedViews.slice(0, maxViews);
    const selectedTableNames = new Set(selectedTables.map((table) => table.name.toLowerCase()));
    const selectedViewNames = new Set(selectedViews.map((view) => view.name.toLowerCase()));

    const tableNameOnlyInventory = rankQualifiedNames(
        uniqueStringsByLowerCase([
            ...rankedTables.slice(maxTables).map((table) => table.name),
            ...(context.tableNameOnlyInventory ?? []),
        ]).filter((tableName) => !selectedTableNames.has(tableName.toLowerCase())),
        relevanceTerms,
        context.defaultSchema,
    ).slice(0, maxTableNameOnlyInventory);
    const viewNameOnlyInventory = rankQualifiedNames(
        uniqueStringsByLowerCase([
            ...rankedViews.slice(maxViews).map((view) => view.name),
            ...(context.viewNameOnlyInventory ?? []),
        ]).filter((viewName) => !selectedViewNames.has(viewName.toLowerCase())),
        relevanceTerms,
        context.defaultSchema,
    ).slice(0, maxViewNameOnlyInventory);

    return {
        ...context,
        schemas: rankSchemasForPrompt(
            context.schemas,
            [
                ...context.tables.map((table) => table.name),
                ...context.views.map((view) => view.name),
                ...(context.tableNameOnlyInventory ?? []),
                ...(context.viewNameOnlyInventory ?? []),
            ],
            relevanceTerms,
            context.defaultSchema,
        ).slice(0, maxSchemas),
        tables: selectedTables,
        views: selectedViews,
        tableNameOnlyInventory,
        viewNameOnlyInventory,
    };
}

function rankSchemaObjects(
    objects: SqlInlineCompletionSchemaObject[],
    relevanceTerms: string[],
    defaultSchema: string | undefined,
): SqlInlineCompletionSchemaObject[] {
    return objects
        .map((object, index) => ({
            value: object,
            index,
            name: object.name,
            relevanceScore: getQualifiedNameRelevanceScore(object.name, relevanceTerms),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function rankQualifiedNames(
    names: string[],
    relevanceTerms: string[],
    defaultSchema: string | undefined,
): string[] {
    return names
        .map((name, index) => ({
            value: name,
            index,
            name,
            relevanceScore: getQualifiedNameRelevanceScore(name, relevanceTerms),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function rankSchemasForPrompt(
    schemas: string[],
    objectNames: string[],
    relevanceTerms: string[],
    defaultSchema: string | undefined,
): string[] {
    const objectScoreBySchema = new Map<string, number>();
    for (const objectName of objectNames) {
        const [schemaName] = splitQualifiedName(objectName);
        if (!schemaName) {
            continue;
        }

        const score = Math.floor(getQualifiedNameRelevanceScore(objectName, relevanceTerms) / 10);
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
                getSchemaNameRelevanceScore(schema, relevanceTerms) +
                (objectScoreBySchema.get(schema.toLowerCase()) ?? 0),
        }))
        .sort((a, b) => compareRankedQualifiedNames(a, b, defaultSchema))
        .map((ranked) => ranked.value);
}

function compareRankedQualifiedNames<
    T extends { index: number; name: string; relevanceScore: number },
>(left: T, right: T, defaultSchema: string | undefined): number {
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

function getQualifiedNameRelevanceScore(qualifiedName: string, relevanceTerms: string[]): number {
    if (relevanceTerms.length === 0) {
        return 0;
    }

    const [schemaName, objectName] = splitQualifiedName(qualifiedName);
    const normalizedSchemaName = normalizeRelevanceTerm(schemaName);
    const normalizedObjectName = normalizeRelevanceTerm(objectName);
    const normalizedQualifiedName = normalizeRelevanceTerm(qualifiedName);
    let relevanceScore = 0;

    for (const [index, term] of relevanceTerms.entries()) {
        const priority = maxSchemaContextRelevanceTerms - index;
        const matchWeight = getQualifiedNameTermMatchWeight(
            term,
            normalizedSchemaName,
            normalizedObjectName,
            normalizedQualifiedName,
        );
        if (matchWeight > 0) {
            relevanceScore += matchWeight + priority * 100 + term.length;
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

function getSchemaNameRelevanceScore(schemaName: string, relevanceTerms: string[]): number {
    if (relevanceTerms.length === 0) {
        return 0;
    }

    const normalizedSchemaName = normalizeRelevanceTerm(schemaName);
    let relevanceScore = 0;
    for (const [index, term] of relevanceTerms.entries()) {
        const priority = maxSchemaContextRelevanceTerms - index;
        const matchWeight = getSchemaTermMatchWeight(term, normalizedSchemaName);
        if (matchWeight > 0) {
            relevanceScore += matchWeight + priority * 100 + term.length;
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

function extractSchemaContextRelevanceTerms(text: string | undefined): string[] {
    if (!text) {
        return [];
    }

    const terms: string[] = [];
    const seenTerms = new Set<string>();

    const pushTerm = (term: string | undefined): void => {
        if (!term || term.length < 3 || term.length > 64 || seenTerms.has(term)) {
            return;
        }

        seenTerms.add(term);
        terms.push(term);
    };

    const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/g;
    for (const match of text.matchAll(identifierPattern)) {
        const identifier = match[0];
        const normalizedIdentifier = normalizeRelevanceTerm(identifier);
        pushTerm(normalizedIdentifier);

        for (const part of splitIdentifierIntoParts(identifier)) {
            for (const variant of expandRelevanceTokenVariants(part, false)) {
                pushTerm(variant);
            }
        }
    }

    const contentTokens = text
        .split(/[^A-Za-z0-9_]+/)
        .flatMap((token) => splitIdentifierIntoParts(token))
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 3)
        .filter((token) => !schemaContextStopWords.has(token));

    for (const token of contentTokens) {
        for (const variant of expandRelevanceTokenVariants(token, true)) {
            pushTerm(variant);
        }
    }

    for (let index = 0; index < contentTokens.length; index++) {
        const twoWordPhrase = normalizeRelevanceTerm(
            `${contentTokens[index]}${contentTokens[index + 1] ?? ""}`,
        );
        pushTerm(twoWordPhrase);

        const threeWordPhrase = normalizeRelevanceTerm(
            `${contentTokens[index]}${contentTokens[index + 1] ?? ""}${contentTokens[index + 2] ?? ""}`,
        );
        pushTerm(threeWordPhrase);
    }

    return terms.slice(0, maxSchemaContextRelevanceTerms);
}

function splitIdentifierIntoParts(identifier: string): string[] {
    const parts = identifier
        .split(".")
        .flatMap((segment) => segment.split("_"))
        .flatMap((segment) =>
            segment
                .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                .split(/\s+/)
                .filter((part) => part.length > 0),
        );

    return parts;
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

    return "8k+";
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

    return "20+";
}

function buildSchemaContextQuery(): string {
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
DECLARE @maxFetchedSchemas int = ${maxFetchedSchemas};
DECLARE @maxFetchedTables int = ${maxFetchedTables};
DECLARE @maxFetchedViews int = ${maxFetchedViews};
DECLARE @maxColumnsPerObject int = ${maxColumnsPerObject};
DECLARE @maxTableNameOnlyInventory int = ${maxTableNameOnlyInventory};
DECLARE @maxViewNameOnlyInventory int = ${maxViewNameOnlyInventory};
DECLARE @maxMasterSymbols int = ${maxMasterSymbols};
DECLARE @maxSystemObjects int = ${maxSystemObjects};
DECLARE @maxForeignKeys int = ${maxForeignKeys};

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
SELECT (
    SELECT
        @@SERVERNAME AS [server],
        DB_NAME() AS [database],
        @defaultSchema AS [defaultSchema],
        @engineEdition AS [engineEdition],
        @engineEditionName AS [engineEditionName],
        (SELECT COUNT(*) FROM rankedTables) AS [totalTableCount],
        (SELECT COUNT(*) FROM rankedViews) AS [totalViewCount],
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
                        c.name AS [name]
                    FROM sys.columns c
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
) AS schemaContextJson;
`.trim();
}
