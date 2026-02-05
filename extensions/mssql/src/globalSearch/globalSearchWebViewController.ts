/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    GlobalSearchWebViewState,
    GlobalSearchReducers,
    SearchResultItem,
    ObjectTypeFilters,
    ScriptType,
} from "../sharedInterfaces/globalSearch";
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
import { generateGuid } from "../models/utils";

export class GlobalSearchWebViewController extends ReactWebviewPanelController<
    GlobalSearchWebViewState,
    GlobalSearchReducers
> {
    // Cache for metadata to avoid repeated API calls
    private _metadataCache: Map<string, ObjectMetadata[]> = new Map();
    // Cache for transformed SearchResultItems to avoid re-transforming on every filter change
    private _searchResultItemCache: Map<string, SearchResultItem[]> = new Map();
    // Stable owner URI for this webview instance - used for connection management
    private _ownerUri: string;

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
        const ownerUri = `globalSearch://${serverName}/${instanceId}`;

        super(
            context,
            vscodeWrapper,
            "globalSearch",
            "globalSearch",
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
                title: LocConstants.GlobalSearch.title(serverName),
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
        this.logger.info(
            `GlobalSearchWebViewController created for server '${serverName}', database '${databaseName}', ownerUri '${ownerUri}'`,
        );
        this.registerRpcHandlers();
        void this.initialize();
    }

    /**
     * Clean up resources when the panel is closed
     */
    public override dispose(): void {
        this.logger.info(`Disposing GlobalSearchWebViewController for ownerUri '${this._ownerUri}'`);

        // Disconnect the connection to avoid accumulating orphaned connections
        // Only disconnect if actually connected - avoid triggering cancel prompts for in-flight connections
        if (this._connectionManager.isConnected(this._ownerUri)) {
            this.logger.info(`Disconnecting active connection for ownerUri '${this._ownerUri}'`);
            void this._connectionManager.disconnect(this._ownerUri);
        }

        // Clear caches for this panel
        this._metadataCache.clear();
        this._searchResultItemCache.clear();

        super.dispose();
    }

    /**
     * Initialize the webview by loading databases and setting up connection
     */
    private async initialize(): Promise<void> {
        this.logger.info("Initializing Search Database webview");
        try {
            // Guard: ensure _targetNode is defined (command can be invoked without a node)
            if (!this._targetNode?.connectionProfile) {
                this.logger.error("Search Database requires an Object Explorer node to be selected");
                this.state.loadStatus = ApiStatus.Error;
                this.state.errorMessage = LocConstants.GlobalSearch.noNodeSelected;
                this.updateState();
                return;
            }

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
            this.logger.info("Search Database initialization completed successfully");
            this.updateState();
        } catch (error) {
            this.logger.error(`Error initializing Search Database: ${getErrorMessage(error)}`);
            this.state.loadStatus = ApiStatus.Error;
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
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
     * Ensure a connection is established for the given URI
     */
    private async ensureConnection(connectionUri: string): Promise<void> {
        const targetDatabase = this.state.selectedDatabase;
        this.logger.info(
            `Ensuring connection for URI '${connectionUri}', target database '${targetDatabase}'`,
        );

        // If already connected, verify that the connection is using the currently selected database.
        if (this._connectionManager.isConnected(connectionUri)) {
            const connectionInfo = await this._connectionManager.getConnectionInfo(connectionUri);
            const currentDatabase = connectionInfo?.credentials?.database;

            if (currentDatabase === targetDatabase) {
                // Existing connection is already targeting the desired database.
                this.logger.info(
                    `Already connected to target database '${targetDatabase}', reusing connection`,
                );
                return;
            }

            // Connected, but to a different database. Disconnect so we can reconnect to the correct one.
            this.logger.info(
                `Connected to '${currentDatabase}' but need '${targetDatabase}', reconnecting`,
            );
            await this._connectionManager.disconnect(connectionUri);
        }

        const connectionCreds = { ...this._targetNode.connectionProfile };
        connectionCreds.database = targetDatabase;

        if (!this._connectionManager.isConnecting(connectionUri)) {
            this.logger.info(`Connecting to database '${targetDatabase}'`);
            await this._connectionManager.connect(connectionUri, connectionCreds);
        }

        if (!this._connectionManager.isConnected(connectionUri)) {
            throw new Error(LocConstants.GlobalSearch.failedToEstablishConnection);
        }

        this.logger.info(`Successfully connected to database '${targetDatabase}'`);
    }

    /**
     * Load available databases from the server
     */
    private async loadDatabases(): Promise<void> {
        try {
            const databases = await this._metadataService.getDatabases(this.state.connectionUri);
            this.state.availableDatabases = databases as string[];
            this.logger.info(`Loaded ${this.state.availableDatabases.length} databases`);
        } catch (error) {
            this.logger.error(`Error loading databases: ${getErrorMessage(error)}`);
            // Don't fail initialization if database list fails
            this.state.availableDatabases = [this.state.selectedDatabase];
        }
    }

    /**
     * Load metadata for the currently selected database
     */
    private async loadMetadata(): Promise<void> {
        this.logger.info(`Loading metadata for database '${this.state.selectedDatabase}'`);
        const cacheKey = `${this.state.connectionUri}:${this.state.selectedDatabase}`;

        // Check cache first
        if (this._metadataCache.has(cacheKey)) {
            this.logger.info(`Using cached metadata for ${this.state.selectedDatabase}`);
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

            this.logger.info(
                `Loaded ${metadata.length} objects for database ${this.state.selectedDatabase}`,
            );

            this.applyFiltersAndSearch();
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logger.error(`Error loading metadata: ${errorMessage}`);
            this.state.errorMessage = errorMessage;
            this.state.loadStatus = ApiStatus.Error;
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

        this.logger.info(
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
        this.logger.info(`Search complete: ${results.length} results match current filters`);
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
                return LocConstants.GlobalSearch.typeTable;
            case MetadataType.View:
                return LocConstants.GlobalSearch.typeView;
            case MetadataType.SProc:
                return LocConstants.GlobalSearch.typeStoredProcedure;
            case MetadataType.Function:
                return LocConstants.GlobalSearch.typeFunction;
            default:
                return LocConstants.GlobalSearch.typeUnknown;
        }
    }

    /**
     * Register RPC handlers for webview actions
     */
    private registerRpcHandlers(): void {
        // Search
        this.registerReducer("search", async (state, payload) => {
            this.logger.info(`Search requested with term: '${payload.searchTerm}'`);
            state.searchTerm = payload.searchTerm;
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("clearSearch", async (state) => {
            this.logger.info("Search cleared");
            state.searchTerm = "";
            this.applyFiltersAndSearch();
            return state;
        });

        // Filters
        this.registerReducer("setDatabase", async (state, payload) => {
            this.logger.info(
                `Database change requested: '${state.selectedDatabase}' -> '${payload.database}'`,
            );
            if (state.selectedDatabase !== payload.database) {
                state.selectedDatabase = payload.database;
                state.searchResults = [];
                state.totalResultCount = 0;
                state.availableSchemas = [];
                state.selectedSchemas = [];

                // Use stable connection URI for this webview instance
                const connectionUri = this.getConnectionUri();
                state.connectionUri = connectionUri;

                try {
                    // Disconnect to reconnect with new database context
                    await this._connectionManager.disconnect(connectionUri);
                    await this.ensureConnection(connectionUri);
                    await this.loadMetadata();
                } catch (error) {
                    this.logger.error(`Error switching database: ${getErrorMessage(error)}`);
                }
            }
            return state;
        });

        this.registerReducer("toggleObjectTypeFilter", async (state, payload) => {
            const filterKey = payload.objectType as keyof ObjectTypeFilters;
            this.logger.info(
                `Toggling object type filter '${filterKey}': ${state.objectTypeFilters[filterKey]} -> ${!state.objectTypeFilters[filterKey]}`,
            );
            state.objectTypeFilters[filterKey] = !state.objectTypeFilters[filterKey];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("setObjectTypeFilters", async (state, payload) => {
            this.logger.info(
                `Setting object type filters: ${JSON.stringify(payload.filters)}`,
            );
            state.objectTypeFilters = { ...payload.filters };
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("toggleSchemaFilter", async (state, payload) => {
            const schema = payload.schema;
            const index = state.selectedSchemas.indexOf(schema);
            const action = index === -1 ? "adding" : "removing";
            this.logger.info(`Toggling schema filter: ${action} '${schema}'`);
            if (index === -1) {
                state.selectedSchemas = [...state.selectedSchemas, schema];
            } else {
                state.selectedSchemas = state.selectedSchemas.filter((s) => s !== schema);
            }
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("setSchemaFilters", async (state, payload) => {
            this.logger.info(
                `Setting schema filters: ${payload.schemas.length} schemas selected`,
            );
            state.selectedSchemas = [...payload.schemas];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("selectAllSchemas", async (state) => {
            this.logger.info(
                `Selecting all schemas (${state.availableSchemas.length} schemas)`,
            );
            state.selectedSchemas = [...state.availableSchemas];
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("clearSchemaSelection", async (state) => {
            this.logger.info("Clearing all schema selections");
            state.selectedSchemas = [];
            this.applyFiltersAndSearch();
            return state;
        });

        // Object Actions
        this.registerReducer("scriptObject", async (state, payload) => {
            this.logger.info(
                `Script object requested: '${payload.object.fullName}' as ${payload.scriptType}`,
            );
            await this.scriptObject(payload.object, payload.scriptType);
            return state;
        });

        this.registerReducer("editData", async (state, payload) => {
            this.logger.info(`Edit data requested for: '${payload.object.fullName}'`);
            await this.editData(payload.object);
            return state;
        });

        this.registerReducer("modifyTable", async (state, payload) => {
            this.logger.info(`Modify table requested for: '${payload.object.fullName}'`);
            await this.modifyTable(payload.object);
            return state;
        });

        this.registerReducer("copyObjectName", async (state, payload) => {
            this.logger.info(`Copying object name: '${payload.object.fullName}'`);
            await vscode.env.clipboard.writeText(payload.object.fullName);
            void vscode.window.showInformationMessage(
                LocConstants.GlobalSearch.copiedToClipboard(payload.object.fullName),
            );
            return state;
        });

        // Data refresh
        this.registerReducer("refreshDatabases", async (state) => {
            this.logger.info("Refreshing databases list");
            await this.loadDatabases();
            return state;
        });

        this.registerReducer("refreshResults", async (state) => {
            this.logger.info(
                `Refreshing results for database '${state.selectedDatabase}'`,
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
            } catch (error) {
                this.logger.error(`Error refreshing results: ${getErrorMessage(error)}`);
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
        try {
            this.logger.info(
                `Scripting object '${object.fullName}' (type: ${object.metadataTypeName}) with script type '${scriptType}'`,
            );

            // Ensure connection is established before scripting
            await this.ensureConnection(this.state.connectionUri);

            // Create IScriptingObject from SearchResultItem
            // Normalize the type name for scripting service compatibility
            const scriptingTypeName = this.getScriptingTypeName(
                object.metadataTypeName,
                object.type,
            );
            this.logger.info(
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
                this.logger.info(
                    `Script generated successfully for '${object.fullName}', opening in editor`,
                );
                // Open script in a new editor
                const doc = await vscode.workspace.openTextDocument({
                    content: script,
                    language: "sql",
                });
                await vscode.window.showTextDocument(doc);
            } else {
                this.logger.warn(`Scripting returned empty result for '${object.fullName}'`);
            }
        } catch (error) {
            this.logger.error(`Error scripting object '${object.fullName}': ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.GlobalSearch.failedToScriptObject(getErrorMessage(error)),
            );
        }
    }

    /**
     * Open the Edit Data (Table Explorer) view for the specified table object
     */
    private async editData(object: SearchResultItem): Promise<void> {
        try {
            this.logger.info(
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
        } catch (error) {
            this.logger.error(`Error opening Edit Data: ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.GlobalSearch.failedToOpenEditData(getErrorMessage(error)),
            );
        }
    }

    /**
     * Open the Table Designer (Modify Table) view for the specified table object
     */
    private async modifyTable(object: SearchResultItem): Promise<void> {
        try {
            this.logger.info(
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
        } catch (error) {
            this.logger.error(`Error opening Modify Table: ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(
                LocConstants.GlobalSearch.failedToOpenModifyTable(getErrorMessage(error)),
            );
        }
    }
}
