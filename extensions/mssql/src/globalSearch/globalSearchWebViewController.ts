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
} from "../sharedInterfaces/globalSearch";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import ConnectionManager from "../controllers/connectionManager";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { IMetadataService } from "../services/metadataService";
import { ApiStatus } from "../sharedInterfaces/webview";
import { MetadataType, ObjectMetadata } from "../sharedInterfaces/metadata";
import { getErrorMessage } from "../utils/utils";

export class GlobalSearchWebViewController extends ReactWebviewPanelController<
    GlobalSearchWebViewState,
    GlobalSearchReducers
> {
    // Cache for metadata to avoid repeated API calls
    private _metadataCache: Map<string, ObjectMetadata[]> = new Map();

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _metadataService: IMetadataService,
        private _connectionManager: ConnectionManager,
        private _targetNode: TreeNodeInfo,
    ) {
        const serverName = _targetNode?.connectionProfile?.server || "Server";
        const databaseName = ObjectExplorerUtils.getDatabaseName(_targetNode) || "master";

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
                searchResults: [],
                totalResultCount: 0,
                loadStatus: ApiStatus.Loading,
                errorMessage: undefined,
            },
            {
                title: `Global Search - ${serverName}`,
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

        this.registerRpcHandlers();
        void this.initialize();
    }

    /**
     * Initialize the webview by loading databases and setting up connection
     */
    private async initialize(): Promise<void> {
        try {
            // Set up connection URI
            const connectionUri = this.generateConnectionUri();
            this.state.connectionUri = connectionUri;

            // Ensure connection is established
            await this.ensureConnection(connectionUri);

            // Load available databases
            await this.loadDatabases();

            // Load initial metadata for selected database
            await this.loadMetadata();

            this.state.loadStatus = ApiStatus.Loaded;
            this.updateState();
        } catch (error) {
            this.logger.error(`Error initializing Global Search: ${getErrorMessage(error)}`);
            this.state.loadStatus = ApiStatus.Error;
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
        }
    }

    /**
     * Generate a unique connection URI for this webview instance
     */
    private generateConnectionUri(): string {
        const timestamp = Date.now();
        return `globalSearch://${this.state.serverName}/${this.state.selectedDatabase}_${timestamp}`;
    }

    /**
     * Ensure a connection is established for the given URI
     */
    private async ensureConnection(connectionUri: string): Promise<void> {
        if (this._connectionManager.isConnected(connectionUri)) {
            return;
        }

        const connectionCreds = { ...this._targetNode.connectionProfile };
        connectionCreds.database = this.state.selectedDatabase;

        if (!this._connectionManager.isConnecting(connectionUri)) {
            await this._connectionManager.connect(connectionUri, connectionCreds);
        }
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
        const cacheKey = `${this.state.connectionUri}:${this.state.selectedDatabase}`;

        // Check cache first
        if (this._metadataCache.has(cacheKey)) {
            this.logger.info(`Using cached metadata for ${this.state.selectedDatabase}`);
            this.applyFiltersAndSearch();
            return;
        }

        try {
            this.state.isSearching = true;
            this.updateState();

            const metadata = await this._metadataService.getMetadata(this.state.connectionUri);
            this._metadataCache.set(cacheKey, metadata);

            this.logger.info(
                `Loaded ${metadata.length} objects for database ${this.state.selectedDatabase}`,
            );

            this.applyFiltersAndSearch();
        } catch (error) {
            this.logger.error(`Error loading metadata: ${getErrorMessage(error)}`);
            this.state.errorMessage = getErrorMessage(error);
        } finally {
            this.state.isSearching = false;
            this.updateState();
        }
    }

    /**
     * Apply current filters and search term to cached metadata
     */
    private applyFiltersAndSearch(): void {
        const cacheKey = `${this.state.connectionUri}:${this.state.selectedDatabase}`;
        const metadata = this._metadataCache.get(cacheKey) || [];

        let results = metadata;

        // Filter by object type
        results = results.filter((obj) => this.matchesTypeFilter(obj));

        // Filter by search term
        if (this.state.searchTerm.trim()) {
            const searchLower = this.state.searchTerm.toLowerCase();
            results = results.filter((obj) => {
                const name = (obj.name || "").toLowerCase();
                const schema = (obj.schema || "").toLowerCase();
                return name.includes(searchLower) || schema.includes(searchLower);
            });
        }

        // Transform to SearchResultItem
        this.state.searchResults = results.map((obj) => this.toSearchResultItem(obj));
        this.state.totalResultCount = this.state.searchResults.length;

        this.updateState();
    }

    /**
     * Check if an object matches the current type filters
     */
    private matchesTypeFilter(obj: ObjectMetadata): boolean {
        const filters = this.state.objectTypeFilters;

        switch (obj.metadataType) {
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
            fullName: obj.schema ? `${obj.schema}.${obj.name}` : obj.name,
        };
    }

    /**
     * Get a friendly display name for a metadata type
     */
    private getFriendlyTypeName(type: MetadataType): string {
        switch (type) {
            case MetadataType.Table:
                return "Table";
            case MetadataType.View:
                return "View";
            case MetadataType.SProc:
                return "Stored Procedure";
            case MetadataType.Function:
                return "Function";
            default:
                return "Unknown";
        }
    }

    /**
     * Register RPC handlers for webview actions
     */
    private registerRpcHandlers(): void {
        // Search
        this.registerReducer("search", async (state, payload) => {
            state.searchTerm = payload.searchTerm;
            this.applyFiltersAndSearch();
            return state;
        });

        this.registerReducer("clearSearch", async (state) => {
            state.searchTerm = "";
            this.applyFiltersAndSearch();
            return state;
        });

        // Filters
        this.registerReducer("setDatabase", async (state, payload) => {
            if (state.selectedDatabase !== payload.database) {
                state.selectedDatabase = payload.database;
                state.searchResults = [];
                state.totalResultCount = 0;

                // Update connection for new database
                const connectionUri = this.generateConnectionUri();
                state.connectionUri = connectionUri;

                await this.ensureConnection(connectionUri);
                await this.loadMetadata();
            }
            return state;
        });

        this.registerReducer("toggleObjectTypeFilter", async (state, payload) => {
            const filterKey = payload.objectType as keyof ObjectTypeFilters;
            state.objectTypeFilters[filterKey] = !state.objectTypeFilters[filterKey];
            this.applyFiltersAndSearch();
            return state;
        });

        // Object Actions
        this.registerReducer("scriptObject", async (state, payload) => {
            await this.scriptObject(payload.object, payload.scriptType);
            return state;
        });

        this.registerReducer("copyObjectName", async (state, payload) => {
            await vscode.env.clipboard.writeText(payload.object.fullName);
            void vscode.window.showInformationMessage(
                `Copied "${payload.object.fullName}" to clipboard`,
            );
            return state;
        });

        // Data refresh
        this.registerReducer("refreshDatabases", async (state) => {
            await this.loadDatabases();
            return state;
        });

        this.registerReducer("refreshResults", async (state) => {
            // Clear cache for current database to force refresh
            const cacheKey = `${state.connectionUri}:${state.selectedDatabase}`;
            this._metadataCache.delete(cacheKey);
            await this.loadMetadata();
            return state;
        });
    }

    /**
     * Generate and open a script for the specified object
     */
    private async scriptObject(
        object: SearchResultItem,
        scriptType: "CREATE" | "DROP" | "SELECT",
    ): Promise<void> {
        try {
            let script = "";

            switch (scriptType) {
                case "SELECT":
                    script = `SELECT TOP (1000) * FROM [${object.schema}].[${object.name}]`;
                    break;
                case "CREATE":
                    // TODO: Implement using ScriptingService
                    void vscode.window.showInformationMessage(
                        "Script as CREATE not yet implemented",
                    );
                    return;
                case "DROP":
                    // TODO: Implement using ScriptingService
                    void vscode.window.showInformationMessage(
                        "Script as DROP not yet implemented",
                    );
                    return;
            }

            // Open script in a new editor
            const doc = await vscode.workspace.openTextDocument({
                content: script,
                language: "sql",
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            this.logger.error(`Error scripting object: ${getErrorMessage(error)}`);
            void vscode.window.showErrorMessage(`Failed to script object: ${getErrorMessage(error)}`);
        }
    }
}
