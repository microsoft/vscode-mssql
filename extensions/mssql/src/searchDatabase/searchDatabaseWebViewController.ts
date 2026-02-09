/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    SearchDatabaseWebViewState,
    SearchDatabaseReducers,
    SearchResultItem,
    ObjectTypeFilters,
    ScriptType,
} from "../sharedInterfaces/searchDatabase";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import ConnectionManager from "../controllers/connectionManager";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { IMetadataService } from "../services/metadataService";
import { ApiStatus } from "../sharedInterfaces/webview";
import { MetadataType, ObjectMetadata } from "../sharedInterfaces/metadata";
import { getErrorMessage } from "../utils/utils";
import { ScriptingService } from "../scripting/scriptingService";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";
import { IScriptingObject } from "vscode-mssql";
import * as Constants from "../constants/constants";
import * as LocConstants from "../constants/locConstants";
import { Deferred } from "../protocol";
import { generateGuid } from "../models/utils";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

export class SearchDatabaseWebViewController extends ReactWebviewPanelController<
    SearchDatabaseWebViewState,
    SearchDatabaseReducers
> {
    // Cache for metadata to avoid repeated API calls
    private _metadataCache: Map<string, ObjectMetadata[]> = new Map();
    // Cache for transformed SearchResultItems to avoid re-transforming on every filter change
    private _searchResultItemCache: Map<string, SearchResultItem[]> = new Map();
    // Stable owner URI for this webview instance - used for connection management
    private _ownerUri: string;
    // Unique identifier for this webview instance - used for telemetry correlation
    private _operationId: string;
    // Deferred that resolves when initialization completes (success or error)
    private _initialized: Deferred<void> = new Deferred<void>();

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _metadataService: IMetadataService,
        private _connectionManager: ConnectionManager,
        private _targetNode: TreeNodeInfo,
        private _scriptingService: ScriptingService,
    ) {
        const serverName = _targetNode?.connectionProfile?.server || "Server";
        const databaseName = ObjectExplorerUtils.getDatabaseName(_targetNode) || "master";

        // Generate a unique, stable owner URI for this webview instance (per-panel URI, stable for panel lifetime)
        const instanceId = generateGuid();
        const ownerUri = `searchDatabase://${serverName}/${instanceId}`;

        super(
            context,
            vscodeWrapper,
            "searchDatabase",
            "searchDatabase",
            {
                serverName: serverName,
                connectionUri: "",
                selectedDatabase: databaseName,
                availableDatabases: [],
                searchTerm: "",
                isSearching: false,
                objectTypeFilters: {
                    tables: true,
                    views: true,
                    storedProcedures: true,
                    functions: true,
                },
                availableSchemas: [],
                selectedSchemas: [],
                searchResults: [],
                totalResultCount: 0,
                loadStatus: ApiStatus.Loading,
                errorMessage: undefined,
            },
            {
                title: LocConstants.SearchDatabase.title(serverName),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Search_inverse.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Search.svg",
                    ),
                },
            },
        );

        this._ownerUri = ownerUri;
        this._operationId = generateGuid();
        this.logInfo(
            `SearchDatabaseWebViewController created for server '${serverName}', database '${databaseName}', ownerUri '${ownerUri}'`,
        );
        this.registerRpcHandlers();
        // Wait for the webview to finish bootstrapping before initializing
        // so the loading spinner is visible while connecting and loading metadata
        void this.whenWebviewReady()
            .then(() => this.initialize())
            .catch((err) => {
                this.logError(`Initialization failed: ${getErrorMessage(err)}`);
                this.state.loadStatus = ApiStatus.Error;
                this.state.errorMessage = getErrorMessage(err);
                this.updateState();
            })
            .finally(() => {
                this._initialized.resolve();
            });
    }

    /**
     * Returns a promise that resolves when initialization is complete (success or error).
     * Useful for tests that need to wait for the controller to be ready.
     */
    public get initialized(): Promise<void> {
        return this._initialized.promise;
    }

    /**
     * Clean up resources when the panel is closed
     */
    public override dispose(): void {
        this.logInfo(`Disposing SearchDatabaseWebViewController for ownerUri '${this._ownerUri}'`);

        // Disconnect the connection to avoid accumulating orphaned connections
        // Only disconnect if actually connected - avoid triggering cancel prompts for in-flight connections
        if (this._connectionManager.isConnected(this._ownerUri)) {
            this.logInfo(`Disconnecting active connection for ownerUri '${this._ownerUri}'`);
            void this._connectionManager.disconnect(this._ownerUri);
        }

        // Clear caches for this panel
        this._metadataCache.clear();
        this._searchResultItemCache.clear();

        super.dispose();
    }

    /**
     * Log helpers that automatically prefix every message with the correlation ID
     * so log lines from different Search Database sessions can be distinguished.
     */
    private logInfo(message: string): void {
        this.logger.info(`[${this._operationId}] ${message}`);
    }

    private logError(message: string): void {
        this.logger.error(`[${this._operationId}] ${message}`);
    }

    private logWarn(message: string): void {
        this.logger.warn(`[${this._operationId}] ${message}`);
    }

    private logVerbose(message: string): void {
        this.logger.verbose(`[${this._operationId}] ${message}`);
    }

    /**
     * Initialize the webview by loading databases and setting up connection
     */
    private async initialize(): Promise<void> {
        this.logInfo("Initializing Search Database webview");
        const endActivity = startActivity(
            TelemetryViews.SearchDatabase,
            TelemetryActions.Initialize,
            this._operationId,
            {
                operationId: this._operationId,
            },
        );

        try {
            // Set up connection URI (use stable ownerUri)
            const connectionUri = this.getConnectionUri();
            this.state.connectionUri = connectionUri;

            // Ensure connection is established
            await this.ensureConnection(connectionUri);

            // Load available databases
            await this.loadDatabases();

            // Load initial metadata for selected database
            await this.loadMetadata();

            this.state.loadStatus = ApiStatus.Loaded;
            this.logInfo("Search Database initialization completed successfully");
            this.updateState();

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this._operationId,
            });
        } catch (error) {
            this.logError(`Error initializing Search Database: ${getErrorMessage(error)}`);
            this.state.loadStatus = ApiStatus.Error;
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();

            endActivity.endFailed(
                new Error("Failed to initialize Search Database"),
                true,
                undefined,
                undefined,
                { operationId: this._operationId },
            );
        }
    }

    /**
     * Get the stable connection URI for this webview instance.
     * Uses a single ownerUri per panel to avoid connection accumulation.
     */
    private getConnectionUri(): string {
        return this._ownerUri;
    }

    /**
     * Ensure a connection is established for the given URI and specified database.
     *
     * Handles three connection states:
     * 1. Already connected to the target database — reuses the existing connection.
     * 2. Connected to a different database — disconnects and reconnects to the target.
     * 3. Not connected — initiates a new connection. If a connection attempt is already
     *    in flight (e.g. triggered by the retry reducer racing with initialization),
     *    we poll until it settles rather than starting a duplicate connection request.
     */
    private async ensureConnection(connectionUri: string): Promise<void> {
        const targetDatabase = this.state.selectedDatabase;
        this.logVerbose(
            `Ensuring connection for URI '${connectionUri}', target database '${targetDatabase}'`,
        );

        // If already connected, verify that the connection is using the currently selected database.
        if (this._connectionManager.isConnected(connectionUri)) {
            const connectionInfo = await this._connectionManager.getConnectionInfo(connectionUri);
            const currentDatabase = connectionInfo?.credentials?.database;

            if (currentDatabase === targetDatabase) {
                // Existing connection is already targeting the desired database.
                this.logVerbose(
                    `Already connected to target database '${targetDatabase}', reusing connection`,
                );
                return;
            }

            // Connected, but to a different database. Disconnect so we can reconnect to the correct one.
            this.logVerbose(
                `Connected to '${currentDatabase}' but need '${targetDatabase}', reconnecting`,
            );
            await this._connectionManager.disconnect(connectionUri);
        }

        const connectionCreds = { ...this._targetNode.connectionProfile };
        connectionCreds.database = targetDatabase;

        if (!this._connectionManager.isConnecting(connectionUri)) {
            this.logVerbose(`Connecting to database '${targetDatabase}'`);
            await this._connectionManager.connect(connectionUri, connectionCreds);
        } else {
            // A connection attempt is already in flight. Poll until it completes.
            const maxWaitMs = 30_000;
            const pollIntervalMs = 500;
            let elapsedMs = 0;

            while (
                !this._connectionManager.isConnected(connectionUri) &&
                this._connectionManager.isConnecting(connectionUri) &&
                elapsedMs < maxWaitMs
            ) {
                await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
                elapsedMs += pollIntervalMs;
            }
        }

        if (!this._connectionManager.isConnected(connectionUri)) {
            throw new Error(LocConstants.SearchDatabase.failedToEstablishConnection);
        }

        this.logInfo(`Successfully connected to database '${targetDatabase}'`);
    }

    /**
     * Load available databases from the server
     */
    private async loadDatabases(): Promise<void> {
        try {
            const databases = await this._metadataService.getDatabases(this.state.connectionUri);
            this.state.availableDatabases = databases as string[];
            this.logVerbose(`Loaded ${this.state.availableDatabases.length} databases`);
        } catch (error) {
            this.logError(`Error loading databases: ${getErrorMessage(error)}`);
            // Don't fail initialization if database list fails
            this.state.availableDatabases = [this.state.selectedDatabase];
        }
    }

    /**
     * Load metadata for the currently selected database
     */
    private async loadMetadata(): Promise<void> {
        this.logVerbose(`Loading metadata for database '${this.state.selectedDatabase}'`);
        const cacheKey = `${this.state.connectionUri}:${this.state.selectedDatabase}`;

        // Check cache first
        if (this._metadataCache.has(cacheKey)) {
            this.logVerbose(`Using cached metadata for ${this.state.selectedDatabase}`);

            sendActionEvent(TelemetryViews.SearchDatabase, TelemetryActions.LoadMetadata, {
                operationId: this._operationId,
                source: "cache",
            });

            // Restore schema state from cached metadata
            const cachedMetadata = this._metadataCache.get(cacheKey)!;
            const uniqueSchemas = [
                ...new Set(cachedMetadata.map((obj) => obj.schema).filter(Boolean)),
            ];
            uniqueSchemas.sort((a, b) => a.localeCompare(b));
            this.state.availableSchemas = uniqueSchemas;
            this.state.selectedSchemas = [...uniqueSchemas];
            this.applyFiltersAndSearch();
            this.updateState();
            return;
        }

        const endActivity = startActivity(
            TelemetryViews.SearchDatabase,
            TelemetryActions.LoadMetadata,
            generateGuid(),
            {
                operationId: this._operationId,
                source: "server",
            },
        );

        try {
            this.state.isSearching = true;
            this.updateState();

            const metadata = await this._metadataService.getMetadata(this.state.connectionUri);
            this._metadataCache.set(cacheKey, metadata);

            // Pre-transform all metadata to SearchResultItems and cache them
            // This avoids re-transforming on every filter change
            const searchResultItems = metadata.map((obj) => this.toSearchResultItem(obj));
            this._searchResultItemCache.set(cacheKey, searchResultItems);

            // Extract unique schemas and sort alphabetically
            const uniqueSchemas = [...new Set(metadata.map((obj) => obj.schema).filter(Boolean))];
            uniqueSchemas.sort((a, b) => a.localeCompare(b));
            this.state.availableSchemas = uniqueSchemas;
            // Select all schemas by default
            this.state.selectedSchemas = [...uniqueSchemas];

            this.logVerbose(
                `Loaded ${metadata.length} objects for database ${this.state.selectedDatabase}`,
            );

            this.applyFiltersAndSearch();

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this._operationId,
                objectCount: metadata.length.toString(),
                schemaCount: uniqueSchemas.length.toString(),
            });
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logError(`Error loading metadata: ${errorMessage}`);
            this.state.errorMessage = errorMessage;
            this.state.loadStatus = ApiStatus.Error;

            endActivity.endFailed(
                new Error("Failed to load metadata"),
                true,
                undefined,
                undefined,
                { operationId: this._operationId },
            );

            throw error;
        } finally {
            this.state.isSearching = false;
            this.updateState();
        }
    }

    /**
     * Parse search term for type prefix (t:, v:, f:, sp:) and return the type filter and remaining search text
     */
    private parseSearchPrefix(searchTerm: string): {
        typeFilter: MetadataType | null;
        searchText: string;
    } {
        const trimmed = searchTerm.trim();
        const trimmedLower = trimmed.toLowerCase();

        // Check for type prefixes - use trimmed string for slicing to handle leading whitespace correctly
        if (trimmedLower.startsWith("t:")) {
            return { typeFilter: MetadataType.Table, searchText: trimmed.slice(2).trim() };
        } else if (trimmedLower.startsWith("v:")) {
            return { typeFilter: MetadataType.View, searchText: trimmed.slice(2).trim() };
        } else if (trimmedLower.startsWith("f:")) {
            return { typeFilter: MetadataType.Function, searchText: trimmed.slice(2).trim() };
        } else if (trimmedLower.startsWith("sp:")) {
            return { typeFilter: MetadataType.SProc, searchText: trimmed.slice(3).trim() };
        }

        return { typeFilter: null, searchText: trimmed };
    }

    /**
     * Apply current filters and search term to cached SearchResultItems
     */
    private applyFiltersAndSearch(): void {
        const cacheKey = `${this.state.connectionUri}:${this.state.selectedDatabase}`;
        // Use cached SearchResultItems instead of re-transforming from ObjectMetadata
        const allItems = this._searchResultItemCache.get(cacheKey) || [];

        this.logVerbose(
            `Applying filters and search: searchTerm='${this.state.searchTerm}', totalItems=${allItems.length}, selectedSchemas=${this.state.selectedSchemas.length}, filters=${JSON.stringify(this.state.objectTypeFilters)}`,
        );

        let results = allItems;

        // Parse search term for type prefix
        const { typeFilter: searchTypeFilter, searchText } = this.parseSearchPrefix(
            this.state.searchTerm,
        );

        // Filter by object type - use search prefix if present, otherwise use panel filters
        if (searchTypeFilter !== null) {
            // Search prefix overrides panel filters - only show the specified type
            results = results.filter((item) => item.type === searchTypeFilter);
        } else {
            // No prefix - use panel type filters
            results = results.filter((item) => this.matchesTypeFilterForItem(item));
        }

        // Filter by schema
        if (this.state.selectedSchemas.length > 0) {
            const selectedSchemaSet = new Set(this.state.selectedSchemas);
            results = results.filter((item) => selectedSchemaSet.has(item.schema));
        } else {
            // If no schemas are selected, show no results (user explicitly cleared all)
            results = [];
        }

        // Filter by search text (after removing prefix)
        if (searchText) {
            const searchLower = searchText.toLowerCase();
            results = results.filter((item) => {
                const name = (item.name || "").toLowerCase();
                const schema = (item.schema || "").toLowerCase();
                return name.includes(searchLower) || schema.includes(searchLower);
            });
        }

        this.state.searchResults = results;
        this.state.totalResultCount = results.length;
        this.logVerbose(`Search complete: ${results.length} results match current filters`);
    }

    /**
     * Check if a SearchResultItem matches the current type filters
     */
    private matchesTypeFilterForItem(item: SearchResultItem): boolean {
        const filters = this.state.objectTypeFilters;

        switch (item.type) {
            case MetadataType.Table:
                return filters.tables;
            case MetadataType.View:
                return filters.views;
            case MetadataType.SProc:
                return filters.storedProcedures;
            case MetadataType.Function:
                return filters.functions;
            default:
                this.logWarn(
                    `Unexpected metadata type in matchesTypeFilterForItem: type=${item.type}, friendlyTypeName='${this.getFriendlyTypeName(item.type as MetadataType)}'`,
                );
                return false;
        }
    }

    /**
     * Convert ObjectMetadata to SearchResultItem
     */
    private toSearchResultItem(obj: ObjectMetadata): SearchResultItem {
        return {
            name: obj.name,
            schema: obj.schema,
            type: obj.metadataType,
            typeName: this.getFriendlyTypeName(obj.metadataType),
            metadataTypeName: obj.metadataTypeName,
            fullName: obj.schema ? `${obj.schema}.${obj.name}` : obj.name,
        };
    }

    /**
     * Get a friendly display name for a metadata type
     */
    private getFriendlyTypeName(type: MetadataType): string {
        switch (type) {
            case MetadataType.Table:
                return LocConstants.SearchDatabase.typeTable;
            case MetadataType.View:
                return LocConstants.SearchDatabase.typeView;
            case MetadataType.SProc:
                return LocConstants.SearchDatabase.typeStoredProcedure;
            case MetadataType.Function:
                return LocConstants.SearchDatabase.typeFunction;
            default:
                return LocConstants.SearchDatabase.typeUnknown;
        }
    }

    /**
     * Register RPC handlers for webview actions
     */
    private registerRpcHandlers(): void {
        // Search
        this.registerReducer("search", async (state, payload) => {
            this.logVerbose(`Search requested with term: '${payload.searchTerm}'`);
            state.searchTerm = payload.searchTerm;
            this.applyFiltersAndSearch();

            sendActionEvent(TelemetryViews.SearchDatabase, TelemetryActions.Search, {
                operationId: this._operationId,
                resultCount: state.totalResultCount.toString(),
                hasSearchPrefix: (
                    this.parseSearchPrefix(payload.searchTerm).typeFilter !== null
                ).toString(),
            });

            return state;
        });

        this.registerReducer("clearSearch", async (state) => {
            this.logVerbose("Search cleared");
            state.searchTerm = "";
            this.applyFiltersAndSearch();
            return state;
        });

        // Filters
        this.registerReducer("setDatabase", async (state, payload) => {
            this.logVerbose(
                `Database change requested: '${state.selectedDatabase}' -> '${payload.database}'`,
            );
            if (state.selectedDatabase !== payload.database) {
                const endActivity = startActivity(
                    TelemetryViews.SearchDatabase,
                    TelemetryActions.SetDatabase,
                    generateGuid(),
                    { operationId: this._operationId },
                );

                const previousDatabase = state.selectedDatabase;
                state.selectedDatabase = payload.database;
                state.searchResults = [];
                state.totalResultCount = 0;
                state.availableSchemas = [];
                state.selectedSchemas = [];

                // Use stable connection URI for this webview instance
                const connectionUri = this.getConnectionUri();
                state.connectionUri = connectionUri;

                try {
                    await this.ensureConnection(connectionUri);
                    await this.loadMetadata();

                    endActivity.end(ActivityStatus.Succeeded, {
                        operationId: this._operationId,
                    });
                } catch (error) {
                    this.logError(`Error switching database: ${getErrorMessage(error)}`);

                    state.selectedDatabase = previousDatabase;
                    state.loadStatus = ApiStatus.Error;
                    state.errorMessage = getErrorMessage(error);

                    endActivity.endFailed(
                        new Error("Failed to switch database"),
                        true,
                        undefined,
                        undefined,
                        { operationId: this._operationId },
                    );
                }
            }
            return state;
        });

        this.registerReducer("toggleObjectTypeFilter", async (state, payload) => {
            const filterKey = payload.objectType as keyof ObjectTypeFilters;
            this.logVerbose(
                `Toggling object type filter '${filterKey}': ${state.objectTypeFilters[filterKey]} -> ${!state.objectTypeFilters[filterKey]}`,
            );
            state.objectTypeFilters[filterKey] = !state.objectTypeFilters[filterKey];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("setObjectTypeFilters", async (state, payload) => {
            this.logVerbose(`Setting object type filters: ${JSON.stringify(payload.filters)}`);
            state.objectTypeFilters = { ...payload.filters };
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("toggleSchemaFilter", async (state, payload) => {
            const schema = payload.schema;
            const index = state.selectedSchemas.indexOf(schema);
            const action = index === -1 ? "adding" : "removing";
            this.logVerbose(`Toggling schema filter: ${action} '${schema}'`);
            if (index === -1) {
                state.selectedSchemas = [...state.selectedSchemas, schema];
            } else {
                state.selectedSchemas = state.selectedSchemas.filter((s) => s !== schema);
            }
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("setSchemaFilters", async (state, payload) => {
            this.logVerbose(`Setting schema filters: ${payload.schemas.length} schemas selected`);
            state.selectedSchemas = [...payload.schemas];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("selectAllSchemas", async (state) => {
            this.logVerbose(`Selecting all schemas (${state.availableSchemas.length} schemas)`);
            state.selectedSchemas = [...state.availableSchemas];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("clearSchemaSelection", async (state) => {
            this.logVerbose("Clearing all schema selections");
            state.selectedSchemas = [];
            this.applyFiltersAndSearch();
            return state;
        });

        // Object Actions
        this.registerReducer("scriptObject", async (state, payload) => {
            this.logVerbose(
                `Script object requested: '${payload.object.fullName}' as ${payload.scriptType}`,
            );
            await this.scriptObject(payload.object, payload.scriptType);
            return state;
        });

        this.registerReducer("editData", async (state, payload) => {
            this.logVerbose(`Edit data requested for: '${payload.object.fullName}'`);
            await this.editData(payload.object);
            return state;
        });

        this.registerReducer("modifyTable", async (state, payload) => {
            this.logVerbose(`Modify table requested for: '${payload.object.fullName}'`);
            await this.modifyTable(payload.object);
            return state;
        });

        this.registerReducer("copyObjectName", async (state, payload) => {
            this.logVerbose(`Copying object name: '${payload.object.fullName}'`);
            await vscode.env.clipboard.writeText(payload.object.fullName);
            void vscode.window.showInformationMessage(
                LocConstants.SearchDatabase.copiedToClipboard(payload.object.fullName),
            );

            sendActionEvent(TelemetryViews.SearchDatabase, TelemetryActions.CopyObjectName, {
                operationId: this._operationId,
                objectType: payload.object.metadataTypeName,
            });

            return state;
        });

        // Data refresh
        this.registerReducer("refreshDatabases", async (state) => {
            this.logVerbose("Refreshing databases list");
            await this.loadDatabases();
            return state;
        });

        // Initialization
        this.registerReducer("retry", async (state) => {
            this.logInfo("Retry initialization requested");
            state.loadStatus = ApiStatus.Loading;
            state.errorMessage = undefined;

            try {
                const connectionUri = this.getConnectionUri();
                state.connectionUri = connectionUri;

                await this.ensureConnection(connectionUri);
                await this.loadDatabases();
                await this.loadMetadata();

                state.loadStatus = ApiStatus.Loaded;
                this.logInfo("Retry initialization completed successfully");
            } catch (error) {
                this.logError(`Error during retry initialization: ${getErrorMessage(error)}`);
                state.loadStatus = ApiStatus.Error;
                state.errorMessage = getErrorMessage(error);
            }

            return state;
        });

        this.registerReducer("refreshResults", async (state) => {
            this.logVerbose(`Refreshing results for database '${state.selectedDatabase}'`);

            const endActivity = startActivity(
                TelemetryViews.SearchDatabase,
                TelemetryActions.RefreshResults,
                generateGuid(),
                { operationId: this._operationId },
            );

            // Reset filters and search to initial state
            state.searchTerm = "";
            state.objectTypeFilters = {
                tables: true,
                views: true,
                storedProcedures: true,
                functions: true,
            };

            // Clear caches for current database to force refresh
            const cacheKey = `${state.connectionUri}:${state.selectedDatabase}`;
            this._metadataCache.delete(cacheKey);
            this._searchResultItemCache.delete(cacheKey);

            // Refetch metadata (this will also reset schema filters to all selected)
            try {
                await this.loadMetadata();

                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this._operationId,
                });
            } catch (error) {
                this.logError(`Error refreshing results: ${getErrorMessage(error)}`);

                endActivity.endFailed(
                    new Error("Failed to refresh results"),
                    true,
                    undefined,
                    undefined,
                    { operationId: this._operationId },
                );
            }
            return state;
        });
    }

    /**
     * Map ScriptType to ScriptOperation enum
     */
    private getScriptOperation(scriptType: ScriptType): ScriptOperation {
        switch (scriptType) {
            case "SELECT":
                return ScriptOperation.Select;
            case "CREATE":
                return ScriptOperation.Create;
            case "DROP":
                return ScriptOperation.Delete;
            case "ALTER":
                return ScriptOperation.Alter;
            case "EXECUTE":
                return ScriptOperation.Execute;
            default:
                return ScriptOperation.Select;
        }
    }

    /**
     * Normalize metadata type name for scripting service.
     * The scripting service expects specific SMO URN type names for scripting to work.
     */
    private getScriptingTypeName(metadataTypeName: string, metadataType: MetadataType): string {
        // SMO URN types that should pass through directly:
        // - UserDefinedFunction: scalar functions (FN), table-valued functions (IF, TF)
        // - UserDefinedAggregate: aggregate functions (AF)
        // Also pass through Object Explorer node types for compatibility
        if (
            metadataTypeName === "UserDefinedFunction" ||
            metadataTypeName === "UserDefinedAggregate" ||
            metadataTypeName === "ScalarValuedFunction" ||
            metadataTypeName === "TableValuedFunction" ||
            metadataTypeName === "AggregateFunction" ||
            metadataTypeName === "PartitionFunction"
        ) {
            return metadataTypeName;
        }

        // Fallback for generic "Function" type - defaults to UserDefinedFunction
        // Note: MetadataService should return specific types (UserDefinedFunction or UserDefinedAggregate)
        if (metadataType === MetadataType.Function || metadataTypeName === "Function") {
            return "UserDefinedFunction";
        }

        // Map standard types to their scripting type names
        switch (metadataType) {
            case MetadataType.Table:
                return metadataTypeName || "Table";
            case MetadataType.View:
                return metadataTypeName || "View";
            case MetadataType.SProc:
                return metadataTypeName || "StoredProcedure";
            default:
                return metadataTypeName;
        }
    }

    /**
     * Generate and open a script for the specified object
     */
    private async scriptObject(object: SearchResultItem, scriptType: ScriptType): Promise<void> {
        const endActivity = startActivity(
            TelemetryViews.SearchDatabase,
            TelemetryActions.Script,
            generateGuid(),
            {
                operationId: this._operationId,
                scriptType: scriptType,
                objectType: object.metadataTypeName,
            },
        );

        try {
            this.logVerbose(
                `Scripting object '${object.fullName}' (type: ${object.metadataTypeName}) with script type '${scriptType}'`,
            );

            // Create IScriptingObject from SearchResultItem
            // Normalize the type name for scripting service compatibility
            const scriptingTypeName = this.getScriptingTypeName(
                object.metadataTypeName,
                object.type,
            );
            this.logVerbose(
                `Resolved scripting type name: '${scriptingTypeName}' (from metadataTypeName: '${object.metadataTypeName}')`,
            );

            const scriptingObject: IScriptingObject = {
                type: scriptingTypeName,
                schema: object.schema,
                name: object.name,
            };

            // Get the script operation
            const operation = this.getScriptOperation(scriptType);

            // Get server info from connection manager - use the current connection credentials
            // with the selected database to ensure we get the correct server info
            const connectionCreds = { ...this._targetNode.connectionProfile };
            connectionCreds.database = this.state.selectedDatabase;
            const serverInfo = this._connectionManager.getServerInfo(connectionCreds);

            // Create scripting parameters
            const scriptingParams = this._scriptingService.createScriptingRequestParams(
                serverInfo,
                scriptingObject,
                this.state.connectionUri,
                operation,
            );

            // Generate script
            const script = await this._scriptingService.script(scriptingParams);

            if (script) {
                this.logVerbose(
                    `Script generated successfully for '${object.fullName}', opening in editor`,
                );
                // Open script in a new editor
                const doc = await vscode.workspace.openTextDocument({
                    content: script,
                    language: "sql",
                });
                await vscode.window.showTextDocument(doc);
            } else {
                this.logWarn(`Scripting returned empty result for '${object.fullName}'`);
            }

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this._operationId,
                scriptType: scriptType,
                objectType: object.metadataTypeName,
            });
        } catch (error) {
            this.logError(`Error scripting object '${object.fullName}': ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.SearchDatabase.failedToScriptObject(getErrorMessage(error)),
            );

            endActivity.endFailed(
                new Error("Failed to script object"),
                true,
                undefined,
                undefined,
                {
                    operationId: this._operationId,
                    scriptType: scriptType,
                    objectType: object.metadataTypeName,
                },
            );
        }
    }

    /**
     * Open the Edit Data (Table Explorer) view for the specified table object
     */
    private async editData(object: SearchResultItem): Promise<void> {
        const endActivity = startActivity(
            TelemetryViews.SearchDatabase,
            TelemetryActions.EditData,
            generateGuid(),
            {
                operationId: this._operationId,
                objectType: object.metadataTypeName,
            },
        );

        try {
            this.logVerbose(
                `Opening Edit Data for '${object.fullName}' in database '${this.state.selectedDatabase}'`,
            );
            // Create a synthetic node structure that matches what TableExplorerWebViewController expects
            // The node needs metadata, connectionProfile, and a parent with database metadata
            // so that ObjectExplorerUtils.getDatabaseName can find the database name
            const syntheticNode = {
                metadata: {
                    name: object.name,
                    schema: object.schema,
                    metadataTypeName: object.metadataTypeName,
                },
                connectionProfile: { ...this._targetNode.connectionProfile },
                nodeType: "Table",
                parentNode: {
                    metadata: {
                        name: this.state.selectedDatabase,
                        metadataTypeName: Constants.databaseString,
                    },
                },
            };

            // Execute the tableExplorer command with the synthetic node
            await vscode.commands.executeCommand(Constants.cmdTableExplorer, syntheticNode);

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this._operationId,
            });
        } catch (error) {
            this.logError(`Error opening Edit Data: ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.SearchDatabase.failedToOpenEditData(getErrorMessage(error)),
            );

            endActivity.endFailed(
                new Error("Failed to open Edit Data"),
                true,
                undefined,
                undefined,
                { operationId: this._operationId },
            );
        }
    }

    /**
     * Open the Table Designer (Modify Table) view for the specified table object
     */
    private async modifyTable(object: SearchResultItem): Promise<void> {
        const endActivity = startActivity(
            TelemetryViews.SearchDatabase,
            TelemetryActions.ModifyTable,
            generateGuid(),
            {
                operationId: this._operationId,
                objectType: object.metadataTypeName,
            },
        );

        try {
            this.logVerbose(
                `Opening Modify Table for '${object.fullName}' in database '${this.state.selectedDatabase}'`,
            );
            // Create a synthetic node structure that matches what TableDesignerWebviewController expects
            // The node needs nodeType, label, metadata, connectionProfile, and a parent with database metadata
            // so that getDatabaseNameForNode can find the database name.
            // It also needs updateConnectionProfile method which the controller calls during initialization.
            const connectionProfile = { ...this._targetNode.connectionProfile };
            const syntheticNode = {
                metadata: {
                    name: object.name,
                    schema: object.schema,
                    metadataTypeName: object.metadataTypeName,
                },
                connectionProfile: connectionProfile,
                nodeType: "Table",
                label: object.name,
                parentNode: {
                    metadata: {
                        name: this.state.selectedDatabase,
                        metadataTypeName: Constants.databaseString,
                    },
                },
                updateConnectionProfile: function (value: unknown) {
                    this.connectionProfile = value;
                },
            };

            // Execute the editTable command with the synthetic node
            await vscode.commands.executeCommand(Constants.cmdEditTable, syntheticNode);

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this._operationId,
            });
        } catch (error) {
            this.logError(`Error opening Modify Table: ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.SearchDatabase.failedToOpenModifyTable(getErrorMessage(error)),
            );

            endActivity.endFailed(
                new Error("Failed to open Modify Table"),
                true,
                undefined,
                undefined,
                { operationId: this._operationId },
            );
        }
    }
}
