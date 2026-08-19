/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as utils from "../models/utils";

import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

import { WebviewPanelController } from "../controllers/webviewPanelController";
import {
    ExtractTarget,
    SchemaCompareEndpointType,
    SchemaCompareReducers,
    SchemaCompareServer,
    SchemaCompareWebViewState,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
} from "../sharedInterfaces/schemaCompare";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import ConnectionManager from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";
import {
    cancel,
    compare,
    generateScript,
    generateOperationId,
    includeExcludeNode,
    openScmp,
    publishDatabaseChanges,
    publishProjectChanges,
    saveScmp,
    getSchemaCompareEndpointTypeString,
    showOpenDialogForScmp,
    showSaveDialogForScmp,
    showOpenDialogForDacpacOrSqlProj,
    includeExcludeAllNodes,
} from "./schemaCompareUtils";
import { DiffEntry } from "vscode-mssql";
import { sendActionEvent, startActivity, sendErrorEvent } from "extension-toolkit/vscode";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import * as locConstants from "../constants/locConstants";
import { triggerSchemaCompareAutomatic, triggerSchemaCompareManual } from "../constants/constants";
import { getErrorMessage } from "../utils/utils";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { UserSurvey } from "../nps/userSurvey";
import { getConnectionDisplayName } from "../models/connectionInfo";
import { buildDatabaseOptions } from "../utils/databaseUtils";

const SCHEMA_COMPARE_VIEW_ID = "schemaCompare";

export class SchemaCompareWebViewController extends WebviewPanelController<
    SchemaCompareWebViewState,
    SchemaCompareReducers
> {
    private static readonly SQL_DATABASE_PROJECTS_EXTENSION_ID =
        "ms-mssql.sql-database-projects-vscode";
    private operationId: string;
    private readonly connectionUris = new Map<string, string>();
    private databaseListRequestGeneration = 0;
    private readonly databaseListCache = new Map<string, string[]>();

    constructor(
        context: vscode.ExtensionContext,
        sourceNode:
            | ConnectionNode
            | TreeNodeInfo
            | mssql.SchemaCompareEndpointInfo
            | string
            | undefined,
        targetNode:
            | ConnectionNode
            | TreeNodeInfo
            | mssql.SchemaCompareEndpointInfo
            | string
            | undefined,
        runComparison: boolean,
        private readonly schemaCompareService: mssql.ISchemaCompareService,
        private readonly connectionMgr: ConnectionManager,
        schemaCompareOptionsResult: mssql.SchemaCompareOptionsResult,
        title: string,
    ) {
        super(
            context,
            SCHEMA_COMPARE_VIEW_ID,
            SCHEMA_COMPARE_VIEW_ID,
            {
                isSqlProjectExtensionInstalled: false,
                isComparisonInProgress: false,
                isApplyInProgress: false,
                applySucceeded: false,
                applyFailed: false,
                isIncludeExcludeAllOperationInProgress: false,
                activeServers: {},
                databases: [],
                databaseListConnectionId: "",
                isDatabaseListLoading: false,
                databaseListError: "",
                defaultDeploymentOptionsResult: structuredClone(schemaCompareOptionsResult),
                intermediaryOptionsResult: undefined,
                endpointsSwitched: false,
                auxiliaryEndpointInfo: undefined,
                sourceEndpointInfo: undefined,
                targetEndpointInfo: undefined,
                scmpSourceExcludes: [],
                scmpTargetExcludes: [],
                originalSourceExcludes: new Map<string, DiffEntry>(),
                originalTargetExcludes: new Map<string, DiffEntry>(),
                sourceTargetSwitched: false,
                schemaCompareResult: undefined,
                generateScriptResultStatus: undefined,
                publishDatabaseChangesResultStatus: undefined,
                schemaComparePublishProjectResult: undefined,
                schemaCompareIncludeExcludeResult: undefined,
                schemaCompareOpenScmpResult: undefined,
                saveScmpResultStatus: undefined,
                cancelResultStatus: undefined,
            },
            {
                title: title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_light.svg",
                    ),
                },
            },
        );

        this.operationId = generateOperationId();
        this.logger.info(
            `SchemaCompareWebViewController created with operation ID: ${this.operationId} - OperationId: ${this.operationId}`,
        );

        void this.start(sourceNode, targetNode, runComparison);
        this.registerRpcHandlers();

        this.registerDisposable(
            this.connectionMgr.onConnectionsChanged(async () => {
                this.state.activeServers = await this.getAvailableServersList();
                this.updateState();
            }),
        );
    }

    /**
     * Starts the schema comparison process. Schema compare can get started with four contexts for the source:
     * 1. undefined
     * 2. Connection profile
     * 3. Dacpac
     * 4. Project
     * @param sourceContext can be undefined, connection profile, dacpac, or project.
     * @param targetContext can be undefined, connection profile, dacpac, or project.
     * @param comparisonResult Result of a previous comparison, if available.
     */
    public async start(
        sourceContext:
            | ConnectionNode
            | TreeNodeInfo
            | mssql.SchemaCompareEndpointInfo
            | string
            | undefined,
        targetContext:
            | ConnectionNode
            | TreeNodeInfo
            | mssql.SchemaCompareEndpointInfo
            | string
            | undefined,
        runComparison: boolean,
        comparisonResult: mssql.SchemaCompareResult = undefined,
    ): Promise<void> {
        this.logger.debug(
            `Starting schema comparison with sourceContext type: ${sourceContext ? typeof sourceContext : "undefined"} - OperationId: ${this.operationId}`,
        );

        // Resolve source and target endpoints
        const source = await this.resolveEndpointInfo(sourceContext);
        let target = undefined;
        if (targetContext !== undefined) {
            target = await this.resolveEndpointInfo(targetContext);
        }

        await this.launch(source, target, runComparison, comparisonResult);
    }

    /**
     * Resolves the schema compare endpoint info from the given context.
     * Handles TreeNodeInfo(from server/database nodes), dacpac path, and project path.
     */
    private async resolveEndpointInfo(
        context: any,
    ): Promise<mssql.SchemaCompareEndpointInfo | undefined> {
        if (this.isTreeNodeInfoType(context)) {
            const node = context as TreeNodeInfo;
            if (node?.connectionProfile) {
                this.logger.debug(
                    `Using connection profile: ${node.connectionProfile.server} - OperationId: ${this.operationId}`,
                );
                return await this.getEndpointInfoFromConnectionProfile(
                    node.connectionProfile,
                    context,
                );
            }
        } else if (context && typeof context === "string" && context.endsWith(".dacpac")) {
            this.logger.debug(`Using dacpac: ${context} - OperationId: ${this.operationId}`);
            return this.getEndpointInfoFromDacpac(context as string);
        } else if (context && typeof context === "string" && context.endsWith(".sqlproj")) {
            this.logger.debug(`Using project: ${context} - OperationId: ${this.operationId}`);
            return await this.getEndpointInfoFromProject(context as string);
        } else if (context && typeof context === "object") {
            return context as mssql.SchemaCompareEndpointInfo;
        } else {
            this.logger.debug(`No context provided - OperationId: ${this.operationId}`);
            return undefined;
        }
    }

    /**
     * Primary functional entrypoint for opening the schema comparison window, and optionally running it.
     * @param source
     * @param target
     * @param runComparison whether to immediately run the schema comparison.  Requires both source and target to be specified.  Cannot be true when comparisonResult is set.
     * @param comparisonResult a pre-computed schema comparison result to display.  Cannot be set when runComparison is true.
     */
    public async launch(
        source: mssql.SchemaCompareEndpointInfo | undefined,
        target: mssql.SchemaCompareEndpointInfo | undefined,
        runComparison: boolean = false,
        comparisonResult: mssql.SchemaCompareResult | undefined,
    ): Promise<void> {
        this.logger.debug(
            `Launching schema comparison with runComparison=${runComparison}, has source=${!!source}, has target=${!!target}, has comparisonResult=${!!comparisonResult} - OperationId: ${this.operationId}`,
        );

        if (runComparison && comparisonResult) {
            throw new Error(
                "Cannot both pass a comparison result and request a new comparison be run.",
            );
        }

        this.state.sourceEndpointInfo = source;
        this.state.targetEndpointInfo = target;
        this.updateState(this.state);

        // Trigger automatic comparison if requested
        if (runComparison && source && target) {
            this.logger.debug(
                `Auto-starting schema comparison as runComparison=true - OperationId: ${this.operationId}`,
            );

            await this.schemaCompare(
                {
                    sourceEndpointInfo: source,
                    targetEndpointInfo: target,
                    deploymentOptions:
                        this.state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
                },
                this.state,
                triggerSchemaCompareAutomatic,
            );
        }
    }

    private async getEndpointInfoFromConnectionProfile(
        connectionProfile: IConnectionProfile,
        sourceContext: any,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        let ownerUri = await this.connectionMgr.getUriForConnection(connectionProfile);
        let user = connectionProfile.user;
        if (!user) {
            user = locConstants.SchemaCompare.defaultUserName;
        }

        const source = {
            endpointType: SchemaCompareEndpointType.Database,
            serverDisplayName: `${connectionProfile.server} (${user})`,
            serverName: connectionProfile.server,
            databaseName: ObjectExplorerUtils.getDatabaseName(sourceContext),
            ownerUri: ownerUri,
            connectionId: connectionProfile.id || ownerUri,
            packageFilePath: "",
            connectionDetails: {
                options: {
                    database: connectionProfile.database,
                },
            },
            connectionName: connectionProfile.profileName ? connectionProfile.profileName : "",
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: ExtractTarget.schemaObjectType,
        };

        return source;
    }

    private getEndpointInfoFromDacpac(sourceDacpac: string): mssql.SchemaCompareEndpointInfo {
        const source = {
            endpointType: SchemaCompareEndpointType.Dacpac,
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            packageFilePath: sourceDacpac,
            connectionDetails: undefined,
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: ExtractTarget.schemaObjectType,
        };

        return source;
    }

    private async getEndpointInfoFromProject(
        projectFilePath: string,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        const source = {
            endpointType: SchemaCompareEndpointType.Project,
            projectFilePath: projectFilePath,
            extractTarget: ExtractTarget.schemaObjectType,
            targetScripts: await this.getProjectScriptFiles(projectFilePath),
            dataSchemaProvider: await this.getDatabaseSchemaProvider(projectFilePath),
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            packageFilePath: "",
            connectionDetails: undefined,
        };

        return source;
    }

    private async getProjectScriptFiles(projectFilePath: string): Promise<string[]> {
        this.logger.debug(
            `Getting project script files for: ${projectFilePath} - OperationId: ${this.operationId}`,
        );
        let scriptFiles: string[] = [];

        try {
            const databaseProjectsExtension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );
            if (databaseProjectsExtension) {
                this.logger.debug(
                    `SQL Database Projects extension found, activating... - OperationId: ${this.operationId}`,
                );
                scriptFiles = await (
                    await databaseProjectsExtension.activate()
                ).getProjectScriptFiles(projectFilePath);

                this.logger.debug(
                    `Retrieved ${scriptFiles.length} script files from project - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `SQL Database Projects extension not found, cannot get project scripts - OperationId: ${this.operationId}`,
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to get project script files: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
            );
            sendErrorEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GetDatabaseProjectScriptFiles,
                new Error(`Failed to get project script files: ${getErrorMessage(error)}`),
                true,
                undefined,
                undefined,
                {
                    operationId: this.operationId,
                },
            );
        }

        return scriptFiles;
    }

    private async getDatabaseSchemaProvider(projectFilePath: string): Promise<string> {
        this.logger.debug(
            `Getting database schema provider for project: ${projectFilePath} - OperationId: ${this.operationId}`,
        );
        let provider = "";

        try {
            const databaseProjectsExtension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );

            if (databaseProjectsExtension) {
                this.logger.debug(
                    `SQL Database Projects extension found, activating... - OperationId: ${this.operationId}`,
                );
                provider = await (
                    await databaseProjectsExtension.activate()
                ).getProjectDatabaseSchemaProvider(projectFilePath);
                this.logger.debug(
                    `Retrieved database schema provider: ${provider || "empty"} - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `SQL Database Projects extension not found, cannot get database schema provider - OperationId: ${this.operationId}`,
                );
            }
        } catch (error) {
            this.logger.error(
                `Failed to get database schema provider: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
            );
            sendErrorEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GetDatabaseProjectSchemaProvider,
                new Error(`Failed to get database schema provider: ${getErrorMessage(error)}`),
                true,
                undefined,
                undefined,
                {
                    operationId: this.operationId,
                },
            );
        }

        return provider;
    }

    private isTreeNodeInfoType(node: any): boolean {
        if (node instanceof TreeNodeInfo) {
            return true;
        }

        return false;
    }

    private registerRpcHandlers(): void {
        this.registerReducer("isSqlProjectExtensionInstalled", async (state) => {
            this.logger.debug(
                `Checking if SQL Database Projects extension is installed - OperationId: ${this.operationId}`,
            );

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.SqlProjectInstalledVerification,
                generateOperationId(),
                {
                    operationId: this.operationId,
                },
            );

            const extension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );

            if (extension) {
                if (!extension.isActive) {
                    this.logger.debug(
                        `SQL Database Projects extension found but not activated, activating... - OperationId: ${this.operationId}`,
                    );
                    await extension.activate();

                    endActivity.update({
                        message: "SQL Database Projects extension activated",
                    });
                }

                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this.operationId,
                    isSqlProjectExtensionInstalled: "true",
                });

                this.logger.debug(
                    `SQL Database Projects extension is installed and activated - OperationId: ${this.operationId}`,
                );
                state.isSqlProjectExtensionInstalled = true;
            } else {
                this.logger.debug(
                    `SQL Database Projects extension is not installed - OperationId: ${this.operationId}`,
                );

                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this.operationId,
                    isSqlProjectExtensionInstalled: "false",
                });

                state.isSqlProjectExtensionInstalled = false;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("listActiveServers", async (state) => {
            this.logger.debug(`Listing SQL connections - OperationId: ${this.operationId}`);
            const activeServers = await this.getAvailableServersList();

            const serverCount = Object.keys(activeServers).length;
            this.logger.debug(
                `Found ${serverCount} SQL connection(s) - OperationId: ${this.operationId}`,
            );
            sendActionEvent(TelemetryViews.SchemaCompare, TelemetryActions.ListingActiveServers, {
                operationId: this.operationId,
                serverCount: serverCount.toString(),
            });

            state.activeServers = activeServers;
            this.updateState(state);

            return state;
        });

        this.registerReducer("listDatabasesForActiveServer", async (state, payload) => {
            const requestGeneration = ++this.databaseListRequestGeneration;
            const connectionDatabaseName =
                payload.connectionDatabaseName ??
                state.activeServers[payload.connectionUri]?.database ??
                "";
            const databaseCacheKey =
                this.connectionUris.get(payload.connectionUri) ?? payload.connectionUri;
            this.logger.debug(
                `Listing databases for server connection: ${payload.connectionUri} - OperationId: ${this.operationId}`,
            );

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.ListingDatabasesForActiveServer,
                generateOperationId(),
                {
                    operationId: this.operationId,
                },
            );

            state.databaseListConnectionId = payload.connectionUri;
            state.databaseListError = "";

            const cachedDatabases = this.databaseListCache.get(databaseCacheKey);
            if (cachedDatabases) {
                const databaseNames = this.includeConnectionDatabase(
                    cachedDatabases,
                    connectionDatabaseName,
                );
                state.databases = this.buildDatabaseOptions(databaseNames);
                state.isDatabaseListLoading = false;
                this.updateState(state);
                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this.operationId,
                    databaseCount: state.databases.length.toString(),
                    cacheHit: "true",
                });
                return state;
            }

            state.databases = this.buildDatabaseOptions(
                connectionDatabaseName ? [connectionDatabaseName] : [],
            );
            state.isDatabaseListLoading = true;
            this.updateState(state);

            try {
                const connectionUri = await this.connectToServer(payload.connectionUri);
                if (requestGeneration !== this.databaseListRequestGeneration) {
                    endActivity.end(ActivityStatus.Canceled);
                    return state;
                }

                const databases = this.includeConnectionDatabase(
                    await this.connectionMgr.listDatabases(connectionUri),
                    connectionDatabaseName,
                );
                if (requestGeneration !== this.databaseListRequestGeneration) {
                    endActivity.end(ActivityStatus.Canceled);
                    return state;
                }
                this.databaseListCache.set(connectionUri, [...databases]);
                this.logger.debug(
                    `Found ${databases.length} database(s) on server - OperationId: ${this.operationId}`,
                );

                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this.operationId,
                    databaseCount: databases.length.toString(),
                });

                state.databases = this.buildDatabaseOptions(databases);
                state.isDatabaseListLoading = false;
                state.databaseListError = "";
            } catch (error) {
                if (requestGeneration !== this.databaseListRequestGeneration) {
                    endActivity.end(ActivityStatus.Canceled);
                    return state;
                }
                this.logger.error(
                    `Error listing databases: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(
                        `Failed to list databases for active server: ${getErrorMessage(error)}`,
                    ),
                    true,
                    undefined,
                    undefined,
                    {
                        operationId: this.operationId,
                    },
                );
                state.isDatabaseListLoading = false;
                state.databaseListError = getErrorMessage(error);
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("selectFile", async (state, payload) => {
            this.logger.debug(
                `Selecting ${payload.fileType} file for ${payload.endpointType} endpoint - OperationId: ${this.operationId}`,
            );

            let endpointFilePath = "";
            if (payload.endpoint) {
                endpointFilePath =
                    payload.endpoint.packageFilePath || payload.endpoint.projectFilePath;
                this.logger.debug(
                    `Using existing file path as starting point: ${endpointFilePath} - OperationId: ${this.operationId}`,
                );
            }

            const filters = {
                Files: [payload.fileType],
            };

            this.logger.debug(
                `Opening file dialog with filters: ${JSON.stringify(filters)} - OperationId: ${this.operationId}`,
            );
            const filePath = await showOpenDialogForDacpacOrSqlProj(endpointFilePath, filters);

            if (filePath) {
                this.logger.debug(`Selected file: ${filePath} - OperationId: ${this.operationId}`);

                const updatedEndpointInfo =
                    payload.fileType === "dacpac"
                        ? this.getEndpointInfoFromDacpac(filePath)
                        : await this.getEndpointInfoFromProject(filePath);

                state.auxiliaryEndpointInfo = updatedEndpointInfo;

                if (payload.fileType === "sqlproj") {
                    if (payload.endpointType === "target") {
                        this.logger.debug(
                            `Setting extract target to schemaObjectType for target project - OperationId: ${this.operationId}`,
                        );
                        state.auxiliaryEndpointInfo.extractTarget = ExtractTarget.schemaObjectType;
                    }
                }

                this.updateState(state);
            } else {
                this.logger.debug(
                    `File selection canceled by user - OperationId: ${this.operationId}`,
                );
            }

            return state;
        });

        this.registerReducer("confirmSelectedSchema", async (state, payload) => {
            this.logger.debug(
                `Confirming selected schema for ${payload.endpointType} endpoint - OperationId: ${this.operationId}`,
            );

            if (payload.endpointType === "source") {
                this.logger.debug(
                    `Setting source endpoint info from auxiliary endpoint info - OperationId: ${this.operationId}`,
                );
                state.sourceEndpointInfo = state.auxiliaryEndpointInfo;
            } else {
                if (state.auxiliaryEndpointInfo) {
                    this.logger.debug(
                        `Setting target endpoint info from auxiliary endpoint info - OperationId: ${this.operationId}`,
                    );
                    state.targetEndpointInfo = state.auxiliaryEndpointInfo;
                }

                if (state.targetEndpointInfo?.endpointType === SchemaCompareEndpointType.Project) {
                    this.logger.debug(
                        `Setting target extract target to ${payload.folderStructure} - OperationId: ${this.operationId}`,
                    );
                    state.targetEndpointInfo.extractTarget = this.mapExtractTargetEnum(
                        payload.folderStructure,
                    );
                }
            }

            this.logger.debug(
                `Clearing auxiliary endpoint info - OperationId: ${this.operationId}`,
            );
            state.auxiliaryEndpointInfo = undefined;
            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSelectedDatabase", async (state, payload) => {
            this.logger.debug(
                `Confirming selected database for ${payload.endpointType} endpoint: ${payload.databaseName} - OperationId: ${this.operationId}`,
            );

            const connectionUri = this.connectionUris.get(payload.serverConnectionUri);
            if (!connectionUri) {
                this.logger.error(
                    `Saved connection not found: ${payload.serverConnectionUri} - OperationId: ${this.operationId}`,
                );
                return state;
            }

            const connection = this.connectionMgr.getConnectionInfo(connectionUri);
            this.logger.debug(
                `Using connection: ${connectionUri} - OperationId: ${this.operationId}`,
            );

            if (!connection) {
                this.logger.error(
                    `Connection not found: ${connectionUri} - OperationId: ${this.operationId}`,
                );
                return state;
            }

            const { profile: connectionProfile, score } =
                await this.connectionMgr.findMatchingProfile(
                    connection.credentials as IConnectionProfile,
                );
            if (!connectionProfile || score === utils.MatchScore.NotMatch) {
                this.logger.error(
                    `Saved connection profile not found for: ${payload.serverConnectionUri} - OperationId: ${this.operationId}`,
                );
                return state;
            }

            let user = connectionProfile.user;
            if (!user) {
                user = locConstants.SchemaCompare.defaultUserName;
                this.logger.debug(
                    `Using default user name: ${user} - OperationId: ${this.operationId}`,
                );
            }

            const endpointInfo = {
                endpointType: SchemaCompareEndpointType.Database,
                serverDisplayName: `${connectionProfile.server} (${user})`,
                serverName: connectionProfile.server,
                databaseName: payload.databaseName,
                ownerUri: connectionUri,
                connectionId: connectionProfile.id || payload.serverConnectionUri,
                packageFilePath: "",
                connectionDetails: {
                    options: {
                        database: connectionProfile.database,
                    },
                },
                connectionName: connectionProfile.profileName ? connectionProfile.profileName : "",
                projectFilePath: "",
                targetScripts: [],
                dataSchemaProvider: "",
                extractTarget: ExtractTarget.schemaObjectType,
            };

            if (payload.endpointType === "source") {
                this.logger.debug(`Setting as source endpoint - OperationId: ${this.operationId}`);
                state.sourceEndpointInfo = endpointInfo;
            } else {
                this.logger.debug(`Setting as target endpoint - OperationId: ${this.operationId}`);
                state.targetEndpointInfo = endpointInfo;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("setIntermediarySchemaOptions", async (state) => {
            this.logger.debug(
                `Setting intermediary schema options - OperationId: ${this.operationId}`,
            );
            state.intermediaryOptionsResult = structuredClone(state.defaultDeploymentOptionsResult);
            this.logger.debug(
                `Cloned deployment options for editing - OperationId: ${this.operationId}`,
            );

            this.updateState(state);

            return state;
        });

        this.registerReducer("intermediaryIncludeObjectTypesOptionsChanged", (state, payload) => {
            this.logger.debug(
                `Updating object type inclusion option: ${payload.key} - OperationId: ${this.operationId}`,
            );

            const deploymentOptions = state.intermediaryOptionsResult.defaultDeploymentOptions;
            const excludeObjectTypeOptions = deploymentOptions.excludeObjectTypes.value;

            const optionIndex = excludeObjectTypeOptions.findIndex(
                (o) => o.toLowerCase() === payload.key.toLowerCase(),
            );

            const isFound = optionIndex !== -1;
            if (isFound) {
                this.logger.debug(
                    `Removing object type from exclusion list: ${payload.key} - OperationId: ${this.operationId}`,
                );
                excludeObjectTypeOptions.splice(optionIndex, 1);
            } else {
                this.logger.debug(
                    `Adding object type to exclusion list: ${payload.key} - OperationId: ${this.operationId}`,
                );
                excludeObjectTypeOptions.push(payload.key);
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("intermediaryIncludeObjectTypesBulkChanged", (state, payload) => {
            this.logger.debug(
                `Bulk updating object type inclusion options: ${payload.keys.join(", ")} - OperationId: ${this.operationId}`,
            );

            const deploymentOptions = state.intermediaryOptionsResult.defaultDeploymentOptions;
            const excludeObjectTypeOptions = deploymentOptions.excludeObjectTypes.value;

            payload.keys.forEach((key) => {
                const optionIndex = excludeObjectTypeOptions.findIndex(
                    (o) => o.toLowerCase() === key.toLowerCase(),
                );
                const isFound = optionIndex !== -1;

                if (payload.checked) {
                    // If we want to check (include) the option, remove it from exclude list
                    if (isFound) {
                        excludeObjectTypeOptions.splice(optionIndex, 1);
                    }
                } else {
                    // If we want to uncheck (exclude) the option, add it to exclude list
                    if (!isFound) {
                        excludeObjectTypeOptions.push(key);
                    }
                }
            });

            this.logger.debug(
                `Bulk changed ${payload.keys.length} object types to ${payload.checked ? "included" : "excluded"} - OperationId: ${this.operationId}`,
            );

            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSchemaOptions", async (state, payload) => {
            this.logger.debug(
                `Confirming schema comparison options - OperationId: ${this.operationId}`,
            );

            state.defaultDeploymentOptionsResult.defaultDeploymentOptions = structuredClone(
                state.intermediaryOptionsResult.defaultDeploymentOptions,
            );
            this.logger.debug(
                `Applied intermediary options to default deployment options - OperationId: ${this.operationId}`,
            );
            state.intermediaryOptionsResult = undefined;

            this.updateState(state);

            const yesItem: vscode.MessageItem = {
                title: locConstants.SchemaCompare.Yes,
            };

            const noItem: vscode.MessageItem = {
                title: locConstants.SchemaCompare.No,
                isCloseAffordance: true,
            };

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.OptionsChanged,
                generateOperationId(),
                {
                    operationId: this.operationId,
                },
            );

            this.logger.debug(
                `Sent telemetry event for options changed - OperationId: ${this.operationId}`,
            );

            if (payload.optionsChanged) {
                this.logger.debug(
                    `Options were changed, prompting user to run comparison again - OperationId: ${this.operationId}`,
                );
                vscode.window
                    .showInformationMessage(
                        locConstants.SchemaCompare.optionsChangedMessage,
                        { modal: true },
                        yesItem,
                        noItem,
                    )
                    .then(async (result) => {
                        if (result.title === locConstants.SchemaCompare.Yes) {
                            this.logger.debug(
                                `User chose to run comparison with new options - OperationId: ${this.operationId}`,
                            );

                            endActivity.update({
                                operationId: this.operationId,
                                message: "User chose to run comparison with new options",
                            });

                            const payload = {
                                sourceEndpointInfo: state.sourceEndpointInfo,
                                targetEndpointInfo: state.targetEndpointInfo,
                                deploymentOptions:
                                    state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
                            };
                            await this.schemaCompare(payload, state);

                            endActivity.end(ActivityStatus.Succeeded, {
                                operationId: this.operationId,
                                message: "Comparison run with new options",
                            });
                        } else {
                            this.logger.debug(
                                `User chose not to run comparison with new options - OperationId: ${this.operationId}`,
                            );

                            endActivity.end(ActivityStatus.Succeeded, {
                                operationId: this.operationId,
                                message: "User chose not to run comparison",
                            });
                        }
                    });
            } else {
                this.logger.debug(`No options were changed - OperationId: ${this.operationId}`);

                endActivity.end(ActivityStatus.Succeeded, {
                    operationId: this.operationId,
                    message: "No options were changed",
                });
            }

            return state;
        });

        this.registerReducer("intermediaryGeneralOptionsChanged", (state, payload) => {
            this.logger.debug(
                `Changing general option: ${payload.key} - OperationId: ${this.operationId}`,
            );

            const generalOptionsDictionary =
                state.intermediaryOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary;
            const oldValue = generalOptionsDictionary[payload.key].value;
            generalOptionsDictionary[payload.key].value = !oldValue;

            this.logger.debug(
                `Changed option ${payload.key} from ${oldValue} to ${!oldValue} - OperationId: ${this.operationId}`,
            );

            this.updateState(state);
            return state;
        });

        this.registerReducer("intermediaryGeneralOptionsBulkChanged", (state, payload) => {
            this.logger.debug(
                `Bulk changing general options: ${payload.keys.join(", ")} - OperationId: ${this.operationId}`,
            );

            const generalOptionsDictionary =
                state.intermediaryOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary;

            payload.keys.forEach((key) => {
                if (generalOptionsDictionary[key]) {
                    generalOptionsDictionary[key].value = payload.checked;
                }
            });

            this.logger.debug(
                `Bulk changed ${payload.keys.length} options to ${payload.checked} - OperationId: ${this.operationId}`,
            );

            this.updateState(state);
            return state;
        });

        this.registerReducer("switchEndpoints", async (state, payload) => {
            this.logger.debug(
                `Switching source and target endpoints - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Switch,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    oldSourceType: payload.newSourceEndpointInfo
                        ? getSchemaCompareEndpointTypeString(
                              payload.newSourceEndpointInfo.endpointType,
                          )
                        : "None",
                    oldTargetType: payload.newTargetEndpointInfo
                        ? getSchemaCompareEndpointTypeString(
                              payload.newTargetEndpointInfo.endpointType,
                          )
                        : "None",
                },
            );

            const sourceType = payload.newSourceEndpointInfo
                ? getSchemaCompareEndpointTypeString(payload.newSourceEndpointInfo.endpointType)
                : "None";
            const targetType = payload.newTargetEndpointInfo
                ? getSchemaCompareEndpointTypeString(payload.newTargetEndpointInfo.endpointType)
                : "None";
            this.logger.debug(
                `New source endpoint type: ${sourceType} - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `New target endpoint type: ${targetType} - OperationId: ${this.operationId}`,
            );

            state.sourceEndpointInfo = payload.newSourceEndpointInfo;
            state.targetEndpointInfo = payload.newTargetEndpointInfo;
            state.endpointsSwitched = true;

            this.updateState(state);

            this.logger.debug(`Successfully switched endpoints - OperationId: ${this.operationId}`);
            endActivity.end(ActivityStatus.Succeeded, {
                elapsedTime: (Date.now() - startTime).toString(),
                operationId: this.operationId,
                newSourceType: sourceType,
                newTargetType: targetType,
            });

            return state;
        });

        this.registerReducer("resetEndpointsSwitched", async (state) => {
            state.endpointsSwitched = false;
            this.updateState(state);
            return state;
        });

        this.registerReducer("compare", async (state, payload) => {
            return await this.schemaCompare(payload, state, triggerSchemaCompareManual);
        });

        this.registerReducer("generateScript", async (state, payload) => {
            this.logger.info(
                `Generating script for schema changes with operation ID: ${this.operationId}`,
            );
            this.logger.debug(
                `Generate script reducer invoked with payload - hasTargetServerName: ${!!payload?.targetServerName}, hasTargetDatabaseName: ${!!payload?.targetDatabaseName} - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `Current state - sourceEndpoint: ${state.sourceEndpointInfo?.endpointType || "undefined"}, targetEndpoint: ${state.targetEndpointInfo?.endpointType || "undefined"}, hasCompareResult: ${!!state.schemaCompareResult} - OperationId: ${this.operationId}`,
            );

            if (state.schemaCompareResult) {
                this.logger.debug(
                    `Schema compare result has ${state.schemaCompareResult.differences?.length || 0} differences - OperationId: ${this.operationId}`,
                );
            }

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GenerateScript,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    sourceType: getSchemaCompareEndpointTypeString(
                        state.sourceEndpointInfo?.endpointType,
                    ),
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo?.endpointType,
                    ),
                    hasTargetServerName: (!!payload?.targetServerName).toString(),
                    hasTargetDatabaseName: (!!payload?.targetDatabaseName).toString(),
                },
            );

            this.logger.debug(`Starting script generation - OperationId: ${this.operationId}`);
            this.logger.debug(
                `Calling generateScript with TaskExecutionMode.script - OperationId: ${this.operationId}`,
            );

            const result = await generateScript(
                this.operationId,
                TaskExecutionMode.script,
                payload,
                this.schemaCompareService,
                this.logger,
            );

            this.logger.debug(
                `Generate script service call completed - success: ${result?.success}, hasErrorMessage: ${!!result?.errorMessage} - OperationId: ${this.operationId}`,
            );

            if (result) {
                this.logger.debug(
                    `Generate script result object keys: ${Object.keys(result).join(", ")} - OperationId: ${this.operationId}`,
                );
                this.logger.debug(
                    `Generate script result details: ${JSON.stringify(result)} - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `Generate script returned null or undefined result - OperationId: ${this.operationId}`,
                );
            }

            if (result && result.errorMessage) {
                this.logger.warn(
                    `Generate script result contains error message: ${result.errorMessage} - OperationId: ${this.operationId}`,
                );
            }

            if (!result || !result.success) {
                this.logger.error(
                    `Failed to generate script: ${result?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                );
                endActivity.endFailed(
                    new Error(
                        `Failed to generate script: ${result?.errorMessage || "Unknown error"}`,
                    ),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.generateScriptErrorMessage(result?.errorMessage),
                );
            } else {
                this.logger.info(
                    `Successfully generated script - OperationId: ${this.operationId}`,
                );
                this.logger.debug(
                    `Script generation completed, updating state with result - OperationId: ${this.operationId}`,
                );
            }

            endActivity.end(ActivityStatus.Succeeded, {
                elapsedTime: (Date.now() - startTime).toString(),
                operationId: this.operationId,
            });

            this.logger.debug(
                `Setting state.generateScriptResultStatus with result - OperationId: ${this.operationId}`,
            );
            state.generateScriptResultStatus = result;

            this.logger.debug(
                `Generate script reducer completed, returning updated state - OperationId: ${this.operationId}`,
            );
            return state;
        });

        this.registerReducer("publishChanges", async (state, payload) => {
            this.logger.info(`Publishing changes requested with operation ID: ${this.operationId}`);
            this.logger.debug(
                `Target endpoint type: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Publish,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    sourceType: getSchemaCompareEndpointTypeString(
                        state.sourceEndpointInfo.endpointType,
                    ),
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                },
            );

            const actionCounts = this.getIncludedUpdateActionCounts(
                state.schemaCompareResult?.differences,
            );

            if (state.schemaCompareResult?.differences) {
                const updateActionBreakdown = {
                    numDiffsDeleted: actionCounts[SchemaUpdateAction.Delete],
                    numDiffsAdded: actionCounts[SchemaUpdateAction.Add],
                    numDiffsChanged: actionCounts[SchemaUpdateAction.Change],
                };
                endActivity.update({
                    operationId: this.operationId,
                    updateActionSummary: JSON.stringify(updateActionBreakdown),
                });
            }

            this.logger.debug(
                `Starting publish operation to ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
            );

            state.isApplyInProgress = true;
            state.applySucceeded = false;
            state.applyFailed = false;
            this.updateState(state);

            let publishResult: mssql.ResultStatus | undefined = undefined;

            try {
                switch (state.targetEndpointInfo.endpointType) {
                    case SchemaCompareEndpointType.Database:
                        this.logger.debug(
                            `Publishing changes to database ${state.targetEndpointInfo.databaseName} - OperationId: ${this.operationId}`,
                        );

                        endActivity.update({
                            publishType: "Database",
                            OperationId: this.operationId,
                        });

                        publishResult = await publishDatabaseChanges(
                            this.operationId,
                            TaskExecutionMode.execute,
                            payload,
                            this.schemaCompareService,
                        );

                        endActivity.end(ActivityStatus.Succeeded, {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            targetType: getSchemaCompareEndpointTypeString(
                                state.targetEndpointInfo.endpointType,
                            ),
                        });
                        break;

                    case SchemaCompareEndpointType.Project:
                        this.logger.debug(
                            `Publishing changes to project ${state.targetEndpointInfo.projectFilePath} - OperationId: ${this.operationId}`,
                        );
                        endActivity.update({
                            publishType: "Project",
                            OperationId: this.operationId,
                        });

                        publishResult = await publishProjectChanges(
                            this.operationId,
                            {
                                targetProjectPath: state.targetEndpointInfo.projectFilePath,
                                targetFolderStructure: state.targetEndpointInfo.extractTarget,
                                taskExecutionMode: TaskExecutionMode.execute,
                            },
                            this.schemaCompareService,
                        );

                        endActivity.end(ActivityStatus.Succeeded, {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            targetType: getSchemaCompareEndpointTypeString(
                                state.targetEndpointInfo.endpointType,
                            ),
                        });
                        break;

                    case SchemaCompareEndpointType.Dacpac: // Dacpac is an invalid publish target
                    default:
                        const errorMsg = `Unsupported SchemaCompareEndpointType: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`;
                        this.logger.error(`${errorMsg} - OperationId: ${this.operationId}`);

                        endActivity.endFailed(new Error(errorMsg), true, undefined, undefined, {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            publishType: "Invalid",
                            targetType: getSchemaCompareEndpointTypeString(
                                state.targetEndpointInfo.endpointType,
                            ),
                        });

                        throw new Error(errorMsg);
                }
            } catch (error) {
                this.logger.error(
                    `Exception during publish operation: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );
                endActivity.endFailed(
                    new Error(`Exception during publish operation: ${getErrorMessage(error)}`),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                        targetType: getSchemaCompareEndpointTypeString(
                            state.targetEndpointInfo.endpointType,
                        ),
                    },
                );

                void vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.schemaCompareApplyFailed(getErrorMessage(error)),
                );
                state.isApplyInProgress = false;
                state.applyFailed = true;
                state.schemaCompareResult = undefined;
                return state;
            }

            if (!publishResult || !publishResult.success || publishResult.errorMessage) {
                this.logger.error(
                    `Publish operation failed: ${publishResult?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                );
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: publishResult?.errorMessage,
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                });

                void vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.schemaCompareApplyFailed(
                        publishResult?.errorMessage ?? "",
                    ),
                );
                state.isApplyInProgress = false;
                state.applyFailed = true;
                state.schemaCompareResult = undefined;
                return state;
            }

            void UserSurvey.getInstance().promptUserForNPSFeedback(SCHEMA_COMPARE_VIEW_ID);

            endActivity.end(ActivityStatus.Succeeded, {
                endTime: Date.now().toString(),
                operationId: this.operationId,
                targetType: getSchemaCompareEndpointTypeString(
                    state.targetEndpointInfo.endpointType,
                ),
            });

            state.isApplyInProgress = false;
            state.applySucceeded = true;
            state.applyFailed = false;
            state.schemaCompareResult = undefined;
            return state;
        });

        this.registerReducer("publishDatabaseChanges", async (state, payload) => {
            this.logger.info(`Publishing database changes with operation ID: ${this.operationId}`);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.PublishDatabaseChanges,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const result = await publishDatabaseChanges(
                    this.operationId,
                    TaskExecutionMode.execute,
                    payload,
                    this.schemaCompareService,
                );

                if (result.success) {
                    this.logger.info(
                        `Successfully published database changes - OperationId: ${this.operationId}`,
                    );

                    endActivity.end(ActivityStatus.Succeeded, {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    });
                } else {
                    this.logger.error(
                        `Failed to publish database changes: ${result.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                    );

                    endActivity.endFailed(
                        new Error(`Failed to publish database changes: ${result.errorMessage}`),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                        },
                    );
                }

                state.publishDatabaseChangesResultStatus = result;
            } catch (error) {
                this.logger.error(
                    `Exception during database publish: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(
                        `An exception occurred during database publish: ${getErrorMessage(error)}`,
                    ),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );
            }

            return state;
        });

        this.registerReducer("publishProjectChanges", async (state, payload) => {
            this.logger.info(`Publishing project changes with operation ID: ${this.operationId}`);
            this.logger.debug(
                `Target project path: ${payload.targetProjectPath} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.PublishProjectChanges,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            try {
                const result = await publishProjectChanges(
                    this.operationId,
                    payload,
                    this.schemaCompareService,
                );

                if (result.success) {
                    this.logger.debug(
                        `Successfully published project changes - OperationId: ${this.operationId}`,
                    );

                    endActivity.end(ActivityStatus.Succeeded, {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    });
                } else {
                    this.logger.error(
                        `Failed to publish project changes: ${result.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                    );

                    endActivity.endFailed(
                        new Error(`Failed to publish project changes: ${result.errorMessage}`),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                        },
                    );
                }

                state.schemaComparePublishProjectResult = result;
            } catch (error) {
                this.logger.error(
                    `Exception during project publish: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(
                        `An exception occurred during project publish: ${getErrorMessage(error)}`,
                    ),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );
            }

            return state;
        });

        this.registerReducer("resetOptions", async (state) => {
            this.logger.debug(
                `Resetting schema compare options to defaults - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.ResetOptions,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            state.intermediaryOptionsResult = structuredClone(state.defaultDeploymentOptionsResult);
            this.logger.debug(`Reset options to defaults - OperationId: ${this.operationId}`);

            endActivity.end(ActivityStatus.Succeeded, {
                elapsedTime: (Date.now() - startTime).toString(),
                operationId: this.operationId,
            });

            return state;
        });

        this.registerReducer("includeExcludeNode", async (state, payload) => {
            const diffEntry = payload.diffEntry;
            const diffEntryName = this.formatEntryName(
                diffEntry.sourceValue ? diffEntry.sourceValue : diffEntry.targetValue,
            );

            this.logger.debug(
                `${payload.includeRequest ? "Including" : "Excluding"} node: ${diffEntryName} (ID: ${payload.id}) - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `Diff entry type: ${payload.diffEntry.name}, update action: ${this.getSchemaUpdateActionString(payload.diffEntry.updateAction)} - OperationId: ${this.operationId}`,
            );

            if (state.schemaCompareResult) {
                this.logger.debug(
                    `Total differences in state: ${state.schemaCompareResult.differences?.length || 0} - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `No schema compare result in state - OperationId: ${this.operationId}`,
                );
            }

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.IncludeExcludeNode,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    requestType: payload.includeRequest ? "Include" : "Exclude",
                    diffEntryType: payload.diffEntry.name,
                    diffActionType: this.getSchemaUpdateActionString(
                        payload.diffEntry.updateAction,
                    ),
                },
            );

            this.logger.debug(
                `Calling includeExcludeNode service - OperationId: ${this.operationId}`,
            );
            const result = await includeExcludeNode(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
                this.logger,
            );

            this.logger.debug(
                `includeExcludeNode service returned - success: ${result?.success}, elapsed: ${Date.now() - startTime}ms - OperationId: ${this.operationId}`,
            );

            if (result.success) {
                this.logger.debug(
                    `Successfully ${payload.includeRequest ? "included" : "excluded"} node with ${result.affectedDependencies?.length || 0} affected dependencies - OperationId: ${this.operationId}`,
                );

                if (result.affectedDependencies && result.affectedDependencies.length > 0) {
                    this.logger.debug(
                        `Affected dependencies count: ${result.affectedDependencies.length} - OperationId: ${this.operationId}`,
                    );
                }

                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                    affectedDependenciesCount: (
                        result.affectedDependencies?.length || 0
                    ).toString(),
                });

                state.schemaCompareIncludeExcludeResult = result;

                if (state.schemaCompareResult) {
                    this.logger.debug(
                        `Updating node at index ${payload.id} - OperationId: ${this.operationId}`,
                    );
                    state.schemaCompareResult.differences[payload.id].included =
                        payload.includeRequest;

                    this.logger.debug(
                        `Updating ${result.affectedDependencies?.length || 0} affected dependencies in the UI state - OperationId: ${this.operationId}`,
                    );

                    const updateStartTime = Date.now();
                    let foundCount = 0;
                    let notFoundCount = 0;

                    result.affectedDependencies.forEach((difference, depIndex) => {
                        const index = state.schemaCompareResult.differences.findIndex(
                            (d) =>
                                d.sourceValue === difference.sourceValue &&
                                d.targetValue === difference.targetValue &&
                                d.updateAction === difference.updateAction &&
                                d.name === difference.name,
                        );

                        if (index !== -1) {
                            foundCount++;
                            if (depIndex < 5) {
                                // Log first 5 dependencies only
                                this.logger.debug(
                                    `Updated dependency ${depIndex + 1}/${result.affectedDependencies.length} at index ${index} to included=${payload.includeRequest} - OperationId: ${this.operationId}`,
                                );
                            }
                            state.schemaCompareResult.differences[index].included =
                                payload.includeRequest;
                        } else {
                            notFoundCount++;
                            if (notFoundCount <= 3) {
                                // Log first 3 not found only
                                this.logger.warn(
                                    `Could not find dependency ${depIndex + 1} in schema compare results - OperationId: ${this.operationId}`,
                                );
                            }
                        }
                    });

                    const updateElapsed = Date.now() - updateStartTime;
                    this.logger.debug(
                        `Updated ${foundCount} dependencies, ${notFoundCount} not found, took ${updateElapsed}ms - OperationId: ${this.operationId}`,
                    );
                }

                this.logger.debug(
                    `Calling updateState to refresh UI - OperationId: ${this.operationId}`,
                );
                this.updateState(state);
                this.logger.debug(
                    `includeExcludeNode completed successfully - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `Failed to ${payload.includeRequest ? "include" : "exclude"} node: ${result.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                );

                if (result.blockingDependencies) {
                    const diffEntryName = this.formatEntryName(
                        diffEntry.sourceValue ? diffEntry.sourceValue : diffEntry.targetValue,
                    );

                    const blockingDependencyNames = result.blockingDependencies
                        .map((blockingEntry) => {
                            return this.formatEntryName(
                                blockingEntry.sourceValue
                                    ? blockingEntry.sourceValue
                                    : blockingEntry.targetValue,
                            );
                        })
                        .filter((name) => name !== "");

                    this.logger.warn(
                        `Operation blocked by dependencies: ${blockingDependencyNames.join(", ")} - OperationId: ${this.operationId}`,
                    );

                    endActivity.endFailed(
                        new Error("Operation was blocked by dependencies"),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            diffEntryType: payload.diffEntry.name,
                            diffActionType: this.getSchemaUpdateActionString(
                                payload.diffEntry.updateAction,
                            ),
                        },
                    );

                    let message = "";
                    if (blockingDependencyNames.length > 0) {
                        message = payload.includeRequest
                            ? locConstants.SchemaCompare.cannotIncludeEntryWithBlockingDependency(
                                  diffEntryName,
                                  blockingDependencyNames.join(", "),
                              )
                            : locConstants.SchemaCompare.cannotExcludeEntryWithBlockingDependency(
                                  diffEntryName,
                                  blockingDependencyNames.join(", "),
                              );
                    } else {
                        message = payload.includeRequest
                            ? locConstants.SchemaCompare.cannotIncludeEntry(diffEntryName)
                            : locConstants.SchemaCompare.cannotExcludeEntry(diffEntryName);
                    }

                    vscode.window.showWarningMessage(message);
                } else {
                    vscode.window.showWarningMessage(result.errorMessage);

                    endActivity.endFailed(
                        new Error(
                            `Failed to ${payload.includeRequest ? "include" : "exclude"} node: ${result.errorMessage || "Unknown error"}`,
                        ),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            diffEntryType: payload.diffEntry.name,
                            diffActionType: this.getSchemaUpdateActionString(
                                payload.diffEntry.updateAction,
                            ),
                        },
                    );
                }
            }

            return state;
        });

        this.registerReducer("includeExcludeAllNodes", async (state, payload) => {
            this.logger.debug(
                `${payload.includeRequest ? "Including" : "Excluding"} all nodes - OperationId: ${this.operationId}`,
            );

            if (state.schemaCompareResult) {
                const totalDiffs = state.schemaCompareResult.differences?.length || 0;
                const includedCount =
                    state.schemaCompareResult.differences?.filter((d) => d.included).length || 0;
                this.logger.debug(
                    `Current state - Total differences: ${totalDiffs}, Currently included: ${includedCount} - OperationId: ${this.operationId}`,
                );
            } else {
                this.logger.warn(
                    `No schema compare result in state - OperationId: ${this.operationId}`,
                );
            }

            state.isIncludeExcludeAllOperationInProgress = true;
            this.logger.debug(
                `Set operation in progress flag, updating UI - OperationId: ${this.operationId}`,
            );
            this.updateState(state);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.IncludeExcludeAllNodes,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    requestType: payload.includeRequest ? "Include all" : "Exclude all",
                    totalDifferences: (
                        state.schemaCompareResult?.differences?.length || 0
                    ).toString(),
                },
            );

            try {
                this.logger.debug(
                    `Calling includeExcludeAllNodes service - OperationId: ${this.operationId}`,
                );
                const result = await includeExcludeAllNodes(
                    this.operationId,
                    TaskExecutionMode.execute,
                    payload,
                    this.schemaCompareService,
                    this.logger,
                );

                const serviceElapsed = Date.now() - startTime;
                this.logger.debug(
                    `includeExcludeAllNodes service returned after ${serviceElapsed}ms - success: ${result?.success} - OperationId: ${this.operationId}`,
                );

                this.state.isIncludeExcludeAllOperationInProgress = false;

                if (result.success) {
                    const count = result.allIncludedOrExcludedDifferences?.length || 0;
                    this.logger.debug(
                        `Successfully ${payload.includeRequest ? "included" : "excluded"} all nodes (${count} differences) - OperationId: ${this.operationId}`,
                    );

                    if (result.allIncludedOrExcludedDifferences) {
                        const includedAfter = result.allIncludedOrExcludedDifferences.filter(
                            (d) => d.included,
                        ).length;
                        this.logger.debug(
                            `Result includes ${includedAfter} included differences out of ${count} total - OperationId: ${this.operationId}`,
                        );
                    }

                    this.logger.debug(
                        `Replacing state differences with result - OperationId: ${this.operationId}`,
                    );
                    state.schemaCompareResult.differences = result.allIncludedOrExcludedDifferences;

                    const includedCount =
                        result.allIncludedOrExcludedDifferences?.filter((d) => d.included).length ||
                        0;
                    const excludedCount = count - includedCount;

                    endActivity.end(ActivityStatus.Succeeded, {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                        differenceCount: count.toString(),
                        includedCount: includedCount.toString(),
                        excludedCount: excludedCount.toString(),
                    });

                    this.logger.debug(
                        `includeExcludeAllNodes completed successfully - OperationId: ${this.operationId}`,
                    );
                } else {
                    this.logger.error(
                        `Failed to ${payload.includeRequest ? "include" : "exclude"} all nodes: ${result.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                    );

                    endActivity.endFailed(
                        new Error(
                            `Failed to ${payload.includeRequest ? "include" : "exclude"} all nodes: ${result.errorMessage || "Unknown error"}`,
                        ),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            errorMessage: result.errorMessage,
                        },
                    );
                }
            } catch (error) {
                const errorElapsed = Date.now() - startTime;
                this.logger.error(
                    `Exception during ${payload.includeRequest ? "include" : "exclude"} all operation after ${errorElapsed}ms: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                // Check if error message contains stack overflow indicators
                const errorMsg = getErrorMessage(error);
                if (
                    errorMsg.toLowerCase().includes("stack") ||
                    errorMsg.toLowerCase().includes("overflow")
                ) {
                    this.logger.error(
                        `STACK OVERFLOW DETECTED in includeExcludeAllNodes operation - OperationId: ${this.operationId}`,
                    );
                }

                endActivity.endFailed(
                    new Error(getErrorMessage(error)),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                        errorMessage: getErrorMessage(error),
                    },
                );

                this.state.isIncludeExcludeAllOperationInProgress = false;
            }

            this.logger.debug(
                `Updating state after includeExcludeAllNodes operation - OperationId: ${this.operationId}`,
            );
            this.updateState(state);
            return state;
        });

        this.registerReducer("openScmp", async (state) => {
            this.logger.debug(
                `Opening schema comparison (.scmp) file - OperationId: ${this.operationId}`,
            );

            const selectedFilePath = await showOpenDialogForScmp();

            if (!selectedFilePath) {
                this.logger.debug(
                    `File selection canceled by user - OperationId: ${this.operationId}`,
                );
                return state;
            }

            this.logger.debug(
                `Selected file path length: ${selectedFilePath?.length || 0} characters - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `File extension: ${selectedFilePath?.split(".").pop() || "unknown"} - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.OpenScmp,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            this.logger.debug(
                `Calling openScmp service to open schema comparison file - OperationId: ${this.operationId}`,
            );
            const result = await openScmp(selectedFilePath, this.schemaCompareService, this.logger);

            this.logger.debug(
                `openScmp service call completed - success: ${result?.success}, hasErrorMessage: ${!!result?.errorMessage} - OperationId: ${this.operationId}`,
            );

            if (result) {
                this.logger.debug(
                    `Result object keys: ${Object.keys(result).join(", ")} - OperationId: ${this.operationId}`,
                );
                this.logger.debug(
                    `Has sourceEndpointInfo: ${!!result.sourceEndpointInfo}, Has targetEndpointInfo: ${!!result.targetEndpointInfo} - OperationId: ${this.operationId}`,
                );

                if (result.sourceEndpointInfo) {
                    this.logger.debug(
                        `Source endpoint type: ${getSchemaCompareEndpointTypeString(result.sourceEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
                    );
                }

                if (result.targetEndpointInfo) {
                    this.logger.debug(
                        `Target endpoint type: ${getSchemaCompareEndpointTypeString(result.targetEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
                    );
                }
            } else {
                this.logger.warn(
                    `openScmp returned null or undefined result - OperationId: ${this.operationId}`,
                );
            }

            if (!result || !result.success) {
                this.logger.error(
                    `Failed to open schema comparison file: ${result?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                );
                endActivity.endFailed(
                    new Error(result?.errorMessage || "Unknown error"),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        errorMessage: result?.errorMessage,
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.openScmpErrorMessage(result?.errorMessage),
                );
                return state;
            }

            this.logger.debug(
                `Successfully opened schema comparison file, constructing endpoint info - OperationId: ${this.operationId}`,
            );

            // construct source endpoint info
            this.logger.debug(
                `Constructing source endpoint info - OperationId: ${this.operationId}`,
            );
            state.sourceEndpointInfo = await this.constructEndpointInfo(
                result.sourceEndpointInfo,
                "source",
            );

            this.logger.debug(
                `Source endpoint constructed - type: ${getSchemaCompareEndpointTypeString(state.sourceEndpointInfo?.endpointType)} - OperationId: ${this.operationId}`,
            );

            // construct target endpoint info
            this.logger.debug(
                `Constructing target endpoint info - OperationId: ${this.operationId}`,
            );
            state.targetEndpointInfo = await this.constructEndpointInfo(
                result.targetEndpointInfo,
                "target",
            );

            this.logger.debug(
                `Target endpoint constructed - type: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo?.endpointType)} - OperationId: ${this.operationId}`,
            );

            this.logger.debug(
                `Setting deployment options from loaded file - OperationId: ${this.operationId}`,
            );
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions =
                result.deploymentOptions;

            // Update intermediaryOptionsResult to ensure UI reflects loaded options
            state.intermediaryOptionsResult = structuredClone(state.defaultDeploymentOptionsResult);

            this.logger.debug(
                `Loading excluded elements - source: ${result.excludedSourceElements?.length || 0}, target: ${result.excludedTargetElements?.length || 0} - OperationId: ${this.operationId}`,
            );
            state.scmpSourceExcludes = result.excludedSourceElements;
            state.scmpTargetExcludes = result.excludedTargetElements;
            state.sourceTargetSwitched =
                result.originalTargetName !== state.targetEndpointInfo.databaseName;

            this.logger.debug(
                `Source/Target switched: ${state.sourceTargetSwitched} - OperationId: ${this.operationId}`,
            );

            // Reset the schema comparison result similarly to what happens in Azure Data Studio.
            state.schemaCompareResult = undefined;

            this.logger.debug(
                `Successfully completed loading .scmp file - OperationId: ${this.operationId}`,
            );

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
                elapsedTime: (Date.now() - startTime).toString(),
                sourceType: getSchemaCompareEndpointTypeString(
                    state.sourceEndpointInfo.endpointType,
                ),
                targetType: getSchemaCompareEndpointTypeString(
                    state.targetEndpointInfo.endpointType,
                ),
            });

            state.schemaCompareOpenScmpResult = result;
            this.updateState(state);

            this.logger.debug(
                `openScmp reducer completed, state updated - OperationId: ${this.operationId}`,
            );

            return state;
        });

        this.registerReducer("saveScmp", async (state) => {
            this.logger.info(
                `Saving schema comparison (.scmp) file - OperationId: ${this.operationId}`,
            );

            const saveFilePath = await showSaveDialogForScmp();

            if (!saveFilePath) {
                this.logger.debug(
                    `Save file operation canceled by user - OperationId: ${this.operationId}`,
                );
                return state;
            }

            this.logger.debug(
                `Saving schema comparison to: ${saveFilePath} - OperationId: ${this.operationId}`,
            );

            const sourceExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalSourceExcludes,
            );
            const targetExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalTargetExcludes,
            );

            this.logger.debug(
                `Prepared ${sourceExcludes.length} source excludes and ${targetExcludes.length} target excludes - OperationId: ${this.operationId}`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.SaveScmp,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    sourceType: getSchemaCompareEndpointTypeString(
                        state.sourceEndpointInfo?.endpointType,
                    ),
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo?.endpointType,
                    ),
                },
            );

            this.logger.debug(`Calling saveScmp service - OperationId: ${this.operationId}`);
            const result = await saveScmp(
                state.sourceEndpointInfo,
                state.targetEndpointInfo,
                TaskExecutionMode.execute,
                state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
                saveFilePath,
                sourceExcludes,
                targetExcludes,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                this.logger.error(
                    `Failed to save schema comparison file: ${result?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                );
                endActivity.endFailed(
                    new Error(
                        `Failed to save schema comparison file: ${result?.errorMessage || "Unknown error"}`,
                    ),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        errorMessage: result?.errorMessage,
                        operationId: this.operationId,
                    },
                );

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.saveScmpErrorMessage(result?.errorMessage),
                );
            } else {
                this.logger.info(
                    `Successfully saved schema comparison file - OperationId: ${this.operationId}`,
                );
            }

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
                elapsedTime: (Date.now() - startTime).toString(),
            });

            state.saveScmpResultStatus = result;
            this.updateState(state);

            return state;
        });

        this.registerReducer("cancel", async (state) => {
            this.logger.info(`Cancelling schema comparison operation with ID: ${this.operationId}`);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Cancel,
                generateOperationId(),
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                    sourceType: getSchemaCompareEndpointTypeString(
                        state.sourceEndpointInfo?.endpointType,
                    ),
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo?.endpointType,
                    ),
                },
            );

            try {
                const result = await cancel(this.operationId, this.schemaCompareService);

                if (!result || !result.success) {
                    this.logger.error(
                        `Failed to cancel operation: ${result?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
                    );
                    endActivity.endFailed(
                        new Error(`Failed to cancel: ${result?.errorMessage || "unknown error"}`),
                        true,
                        undefined,
                        undefined,
                        {
                            elapsedTime: (Date.now() - startTime).toString(),
                            operationId: this.operationId,
                            errorMessage: result?.errorMessage,
                        },
                    );

                    vscode.window.showErrorMessage(
                        locConstants.SchemaCompare.cancelErrorMessage(result?.errorMessage),
                    );

                    return state;
                }

                this.logger.debug(
                    `Successfully cancelled schema comparison operation - OperationId: ${this.operationId}`,
                );
                endActivity.end(ActivityStatus.Succeeded, {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                });

                state.isComparisonInProgress = false;
                state.cancelResultStatus = result;
                this.updateState(state);
            } catch (error) {
                this.logger.error(
                    `Exception during cancel operation: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                );

                endActivity.endFailed(
                    new Error(getErrorMessage(error)),
                    true,
                    undefined,
                    undefined,
                    {
                        elapsedTime: (Date.now() - startTime).toString(),
                        operationId: this.operationId,
                    },
                );
            }

            return state;
        });
    }

    private formatEntryName(nameParts: string[] | undefined | null): string {
        if (nameParts === undefined || nameParts === null || nameParts.length === 0) {
            return "";
        }
        return nameParts.join(".");
    }

    private mapExtractTargetEnum(folderStructure: string): ExtractTarget {
        switch (folderStructure) {
            case "File":
                return ExtractTarget.file;
            case "Flat":
                return ExtractTarget.flat;
            case "Object Type":
                return ExtractTarget.objectType;
            case "Schema":
                return ExtractTarget.schema;
            case "Schema/Object Type":
            default:
                return ExtractTarget.schemaObjectType;
        }
    }

    /**
     * Returns saved profiles using their profile ID as the picker value.
     */
    private async getAvailableServersList(): Promise<{
        [connectionId: string]: SchemaCompareServer;
    }> {
        const activeServers: { [connectionId: string]: SchemaCompareServer } = {};
        this.connectionUris.clear();

        try {
            const savedConnections = await this.connectionMgr.connectionStore.readAllConnections();
            for (const connection of savedConnections) {
                const profile = connection as IConnectionProfile;
                const connectionId = profile.id || `${profile.server}_${profile.database || ""}`;

                activeServers[connectionId] = {
                    profileName: profile.profileName || getConnectionDisplayName(profile),
                    server: profile.server,
                    ...(profile.database ? { database: profile.database } : {}),
                };
            }
        } catch (error) {
            this.logger.error(
                `Failed to list saved connections: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
            );
        }

        return activeServers;
    }

    private includeConnectionDatabase(
        databases: string[],
        connectionDatabaseName: string,
    ): string[] {
        const result = [...databases];
        if (connectionDatabaseName && !result.includes(connectionDatabaseName)) {
            result.unshift(connectionDatabaseName);
        }
        return result;
    }

    private buildDatabaseOptions(databases: string[]) {
        return buildDatabaseOptions(databases, {
            userDatabases: locConstants.ConnectionDialog.userDatabasesGroup,
            systemDatabases: locConstants.ConnectionDialog.systemDatabasesGroup,
        });
    }

    private async connectToServer(connectionId: string): Promise<string> {
        const savedConnections = await this.connectionMgr.connectionStore.readAllConnections();
        const profile = savedConnections.find((connection) => {
            const savedProfile = connection as IConnectionProfile;
            const savedConnectionId =
                savedProfile.id || `${savedProfile.server}_${savedProfile.database || ""}`;
            return savedConnectionId === connectionId;
        }) as IConnectionProfile | undefined;

        if (!profile) {
            throw new Error(locConstants.SchemaCompare.savedConnectionNotFound(connectionId));
        }

        const existingConnectionUri = this.connectionMgr.getUriForConnection(profile);
        if (existingConnectionUri && this.connectionMgr.isConnected(existingConnectionUri)) {
            this.connectionUris.set(connectionId, existingConnectionUri);
            return existingConnectionUri;
        }
        this.connectionUris.delete(connectionId);

        const connectionUri = utils.generateQueryUri().toString();
        let connectionError = "";
        if (
            !(await this.connectionMgr.connect(connectionUri, profile, {
                shouldHandleErrors: false,
                onError: (errorMessage) => {
                    connectionError = errorMessage;
                },
            }))
        ) {
            throw new Error(connectionError || locConstants.SchemaCompare.failedToConnectToServer);
        }

        this.connectionUris.set(connectionId, connectionUri);
        return connectionUri;
    }

    private async schemaCompare(
        payload: {
            sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
            targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
            deploymentOptions: mssql.DeploymentOptions;
        },
        state: SchemaCompareWebViewState,
        triggerSource?: string,
    ) {
        this.logger.info(`Starting schema comparison with operation ID: ${this.operationId}`);
        this.logger.debug(
            `Source endpoint type: ${getSchemaCompareEndpointTypeString(payload.sourceEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
        );
        this.logger.debug(
            `Target endpoint type: ${getSchemaCompareEndpointTypeString(payload.targetEndpointInfo.endpointType)} - OperationId: ${this.operationId}`,
        );

        state.isComparisonInProgress = true;
        state.applySucceeded = false;
        state.applyFailed = false;
        this.updateState(state);

        const startTime = Date.now();
        const endActivity = startActivity(
            TelemetryViews.SchemaCompare,
            TelemetryActions.Compare,
            generateOperationId(),
            {
                startTime: startTime.toString(),
                operationId: this.operationId,
                sourceType: getSchemaCompareEndpointTypeString(
                    payload.sourceEndpointInfo.endpointType,
                ),
                targetType: getSchemaCompareEndpointTypeString(
                    payload.targetEndpointInfo.endpointType,
                ),
                triggerSource: triggerSource,
            },
        );

        if (payload.sourceEndpointInfo.endpointType === SchemaCompareEndpointType.Project) {
            this.logger.debug(
                `Getting project script files for source: ${payload.sourceEndpointInfo.projectFilePath} - OperationId: ${this.operationId}`,
            );
            payload.sourceEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.sourceEndpointInfo.projectFilePath,
            );
        }
        if (payload.targetEndpointInfo.endpointType === SchemaCompareEndpointType.Project) {
            this.logger.debug(
                `Getting project script files for target: ${payload.targetEndpointInfo.projectFilePath} - OperationId: ${this.operationId}`,
            );
            payload.targetEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.targetEndpointInfo.projectFilePath,
            );
        }

        const booleanOptionsAsStrings: { [key: string]: string } = {};

        const generalOptionsDictionary =
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary;

        for (const key in generalOptionsDictionary) {
            if (generalOptionsDictionary.hasOwnProperty(key)) {
                booleanOptionsAsStrings[key] = generalOptionsDictionary[key].value.toString();
            }
        }

        endActivity.update({
            operationId: this.operationId,
            generalOptionsConfig: JSON.stringify(booleanOptionsAsStrings),
        });

        const objectTypesDictionary =
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions.objectTypesDictionary;
        const includedObjectTypesTelemetryDictionary: { [key: string]: string } = {};

        for (const key in objectTypesDictionary) {
            if (objectTypesDictionary.hasOwnProperty(key)) {
                includedObjectTypesTelemetryDictionary[key] = "Included";
            }
        }

        const excludeObjectTypes =
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions.excludeObjectTypes.value;

        excludeObjectTypes.forEach((type) => {
            const matchingKey = Object.keys(objectTypesDictionary).find(
                (key) => key.toLowerCase() === type.toLowerCase(),
            );

            if (matchingKey) {
                includedObjectTypesTelemetryDictionary[matchingKey] = "Excluded";
            }
        });

        endActivity.update({
            operationId: this.operationId,
            includeObjectTypesConfig: JSON.stringify(includedObjectTypesTelemetryDictionary),
        });

        this.logger.info(`Executing schema comparison with operation ID: ${this.operationId}`);
        const result = await compare(
            this.operationId,
            TaskExecutionMode.execute,
            payload,
            this.schemaCompareService,
        );

        state.isComparisonInProgress = false;

        if (!result || !result.success) {
            this.logger.error(
                `Schema comparison failed: ${result?.errorMessage || "Unknown error"} - OperationId: ${this.operationId}`,
            );
            endActivity.endFailed(
                new Error(`Schema comparison failed: ${result?.errorMessage || "Unknown error"}`),
                true,
                undefined,
                undefined,
                {
                    elapsedTime: (Date.now() - startTime).toString(),
                    operationId: this.operationId,
                },
            );

            vscode.window.showErrorMessage(
                locConstants.SchemaCompare.compareErrorMessage(result?.errorMessage),
            );

            return state;
        }

        const diffTypeFrequencies = this.countTargetObjectTypeFrequencies(result.differences);
        const stringifiedFrequencies: { [key: string]: number } = {};

        for (const key in diffTypeFrequencies) {
            if (diffTypeFrequencies.hasOwnProperty(key)) {
                stringifiedFrequencies[key] = diffTypeFrequencies[key];
            }
        }
        endActivity.update({
            operationId: this.operationId,
            compareObjectTypeSummary: JSON.stringify(stringifiedFrequencies),
        });

        this.logger.info(
            `Schema comparison completed successfully with ${result.differences?.length || 0} differences found - OperationId: ${this.operationId}`,
        );
        endActivity.end(ActivityStatus.Succeeded, {
            elapsedTime: (Date.now() - startTime).toString(),
            operationId: this.operationId,
        });

        const finalDifferences = this.getAllObjectTypeDifferences(result);
        this.logger.debug(
            `Filtered to ${finalDifferences.length} object type differences - OperationId: ${this.operationId}`,
        );
        result.differences = finalDifferences;
        state.schemaCompareResult = result;
        state.endpointsSwitched = false;
        this.updateState(state);

        return state;
    }

    private async constructEndpointInfo(
        endpoint: mssql.SchemaCompareEndpointInfo,
        caller: string,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        this.logger.debug(
            `constructEndpointInfo called for ${caller} endpoint - OperationId: ${this.operationId}`,
        );

        if (!endpoint) {
            this.logger.error(
                `Endpoint is null or undefined for ${caller} - OperationId: ${this.operationId}`,
            );
        } else {
            this.logger.debug(
                `Endpoint type: ${getSchemaCompareEndpointTypeString(endpoint.endpointType)} (${endpoint.endpointType}) - OperationId: ${this.operationId}`,
            );
        }

        let ownerUri;
        let endpointInfo;
        if (endpoint && endpoint.endpointType === SchemaCompareEndpointType.Database) {
            this.logger.debug(
                `Processing Database endpoint for ${caller} - OperationId: ${this.operationId}`,
            );

            const connectionOptions = endpoint.connectionDetails?.options ?? {};
            const connInfo = {
                ...connectionOptions,
                server: connectionOptions.server || endpoint.serverName,
                database: connectionOptions.database || endpoint.databaseName,
            } as mssql.IConnectionInfo;

            this.logger.debug(
                `Has connectionDetails: ${!!endpoint.connectionDetails}, Has options: ${!!endpoint.connectionDetails?.options} - OperationId: ${this.operationId}`,
            );

            const { profile: connectionProfile, score } =
                await this.connectionMgr.findMatchingProfile(connInfo as IConnectionProfile);
            let isConnected = false;

            if (connectionProfile && score !== utils.MatchScore.NotMatch) {
                const connectionCredentials = {
                    ...connectionProfile,
                    database: connInfo.database,
                };
                ownerUri = this.connectionMgr.getUriForScmpConnection(connectionCredentials);
                isConnected = Boolean(ownerUri && this.connectionMgr.isConnected(ownerUri));

                this.logger.debug(
                    `Got owner URI from existing connection: ${isConnected} - OperationId: ${this.operationId}`,
                );

                if (!isConnected) {
                    this.logger.debug(
                        `No existing connection found, connecting saved profile for ${caller} - OperationId: ${this.operationId}`,
                    );
                    ownerUri = utils.generateQueryUri().toString();

                    try {
                        isConnected = await this.connectionMgr.connect(
                            ownerUri,
                            connectionCredentials,
                            {
                                connectionSource: "schemaCompare",
                            },
                        );
                    } catch (error) {
                        this.logger.error(
                            `Exception during connection attempt for ${caller}: ${getErrorMessage(error)} - OperationId: ${this.operationId}`,
                        );
                        vscode.window.showErrorMessage(
                            locConstants.SchemaCompare.connectionFailed(getErrorMessage(error)),
                        );
                    }

                    this.logger.debug(
                        `Connection attempt result for ${caller}: ${isConnected} - OperationId: ${this.operationId}`,
                    );

                    if (!isConnected) {
                        this.logger.warn(
                            `Failed to connect to database for ${caller}, removing invalid connection - OperationId: ${this.operationId}`,
                        );
                        delete this.connectionMgr.activeConnections[ownerUri];
                    }
                } else {
                    this.logger.debug(
                        `Using existing connection for ${caller} - OperationId: ${this.operationId}`,
                    );
                }
            } else {
                this.logger.warn(
                    `No saved connection profile found for ${caller} - OperationId: ${this.operationId}`,
                );
                vscode.window.showErrorMessage(
                    locConstants.PublishProject.ProfileLoadedConnectionFailed(connInfo.server),
                );
            }

            if (isConnected && ownerUri && connectionProfile) {
                this.logger.debug(
                    `Successfully created Database endpoint info for ${caller} - OperationId: ${this.operationId}`,
                );
                endpointInfo = {
                    endpointType: SchemaCompareEndpointType.Database,
                    serverDisplayName: `${connInfo.server} (${connectionProfile.user || locConstants.SchemaCompare.defaultUserName})`,
                    serverName: connInfo.server,
                    databaseName: connInfo.database,
                    ownerUri: ownerUri,
                    connectionId: connectionProfile.id || ownerUri,
                    packageFilePath: "",
                    connectionDetails: {
                        options: {
                            database: connectionProfile.database,
                        },
                    },
                    connectionName: connectionProfile.profileName
                        ? connectionProfile.profileName
                        : "",
                    projectFilePath: "",
                    targetScripts: [],
                    dataSchemaProvider: "",
                    extractTarget: ExtractTarget.schemaObjectType,
                };
            } else {
                this.logger.warn(
                    `Failed to create valid Database endpoint for ${caller}, creating empty endpoint - OperationId: ${this.operationId}`,
                );
                endpointInfo = {
                    endpointType: SchemaCompareEndpointType.Database,
                    serverDisplayName: "",
                    serverName: "",
                    databaseName: "",
                    ownerUri: "",
                    packageFilePath: "",
                    connectionDetails: undefined,
                    connectionName: "",
                    projectFilePath: "",
                    targetScripts: [],
                    dataSchemaProvider: "",
                    extractTarget: ExtractTarget.schemaObjectType,
                };
            }
        } else if (endpoint.endpointType === SchemaCompareEndpointType.Project) {
            this.logger.debug(
                `Processing Project endpoint for ${caller} - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `Project file path length: ${endpoint.projectFilePath?.length || 0} - OperationId: ${this.operationId}`,
            );
            endpointInfo = {
                endpointType: endpoint.endpointType,
                packageFilePath: "",
                serverDisplayName: "",
                serverName: "",
                databaseName: "",
                ownerUri: "",
                connectionDetails: undefined,
                projectFilePath: endpoint.projectFilePath,
                targetScripts: [],
                dataSchemaProvider: endpoint.dataSchemaProvider,
                extractTarget: endpoint.extractTarget,
            };
            this.logger.debug(
                `Successfully created Project endpoint info for ${caller} - OperationId: ${this.operationId}`,
            );
        } else {
            this.logger.debug(
                `Processing Dacpac/other endpoint type for ${caller} - detected type: ${getSchemaCompareEndpointTypeString(endpoint.endpointType)} - OperationId: ${this.operationId}`,
            );
            this.logger.debug(
                `Package file path length: ${endpoint.packageFilePath?.length || 0} - OperationId: ${this.operationId}`,
            );
            endpointInfo = {
                endpointType:
                    endpoint.endpointType === SchemaCompareEndpointType.Database
                        ? SchemaCompareEndpointType.Database
                        : SchemaCompareEndpointType.Dacpac,
                serverDisplayName: "",
                serverName: "",
                databaseName: "",
                ownerUri: "",
                packageFilePath: endpoint.packageFilePath,
                connectionDetails: undefined,
            };
            this.logger.debug(
                `Successfully created Dacpac endpoint info for ${caller} - OperationId: ${this.operationId}`,
            );
        }

        this.logger.debug(
            `constructEndpointInfo completed for ${caller} - final type: ${getSchemaCompareEndpointTypeString(endpointInfo.endpointType)} - OperationId: ${this.operationId}`,
        );
        return endpointInfo;
    }

    private getAllObjectTypeDifferences(result: mssql.SchemaCompareResult): DiffEntry[] {
        this.logger.debug(
            `Filtering differences from schema comparison result - OperationId: ${this.operationId}`,
        );

        let finalDifferences: DiffEntry[] = [];
        let differences = result.differences;

        if (!differences) {
            this.logger.warn(
                `No differences found in schema comparison result - OperationId: ${this.operationId}`,
            );
            return finalDifferences;
        }

        this.logger.debug(
            `Processing ${differences.length} total differences - OperationId: ${this.operationId}`,
        );

        differences.forEach((difference) => {
            if (difference.differenceType === SchemaDifferenceType.Object) {
                if (
                    (difference.sourceValue !== null && difference.sourceValue.length > 0) ||
                    (difference.targetValue !== null && difference.targetValue.length > 0)
                ) {
                    finalDifferences.push(difference);
                    this.logger.debug(
                        `Including difference: ${difference.name} with update action ${difference.updateAction} - OperationId: ${this.operationId}`,
                    );
                }
            }
        });

        this.logger.debug(
            `Found ${finalDifferences.length} object type differences out of ${differences.length} total differences - OperationId: ${this.operationId}`,
        );
        return finalDifferences;
    }

    private getIncludedUpdateActionCounts(
        differences: DiffEntry[] | undefined,
    ): Record<SchemaUpdateAction, number> {
        const actionCounts = {
            [SchemaUpdateAction.Delete]: 0,
            [SchemaUpdateAction.Change]: 0,
            [SchemaUpdateAction.Add]: 0,
        };

        differences
            ?.filter((difference) => difference.included)
            .forEach((difference) => actionCounts[difference.updateAction]++);

        return actionCounts;
    }

    /**
     * Converts excluded diff entries into object ids which are needed to save them in an scmp
     */
    private convertExcludesToObjectIds(
        excludedDiffEntries: Map<string, mssql.DiffEntry>,
    ): mssql.SchemaCompareObjectId[] {
        let result = [];
        excludedDiffEntries.forEach((value: mssql.DiffEntry) => {
            result.push({
                nameParts: value.sourceValue ? value.sourceValue : value.targetValue,
                sqlObjectType: `Microsoft.Data.Tools.Schema.Sql.SchemaModel.${value.name}`,
            });
        });

        return result;
    }

    /**
     * Converts a SchemaUpdateAction enum value to its string representation
     * @param updateAction The SchemaUpdateAction enum value
     * @returns The string name of the enum value
     */
    private getSchemaUpdateActionString(updateAction: SchemaUpdateAction): string {
        switch (updateAction) {
            case SchemaUpdateAction.Delete:
                return "Delete";
            case SchemaUpdateAction.Change:
                return "Change";
            case SchemaUpdateAction.Add:
                return "Add";
            default:
                return "";
        }
    }

    /**
     * Counts the frequency of each targetObjectType in a schema comparison result.
     *
     * @param differences The differences array from the schema compare result
     * @returns An object mapping each object type to its frequency count
     */
    private countTargetObjectTypeFrequencies(differences: DiffEntry[]): { [key: string]: number } {
        const frequencyCounts: { [key: string]: number } = {};

        differences.forEach((difference) => {
            const objectType = this.extractObjectTypeFromSourceType(
                difference.sourceObjectType || difference.targetObjectType,
            );

            // Use a standardized form of the object type for counting
            const typeKey = objectType || "Unknown";

            frequencyCounts[typeKey] = (frequencyCounts[typeKey] || 0) + 1;
        });

        return frequencyCounts;
    }

    /**
     * Extracts the object type name from a fully qualified source object type
     * For example: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable" -> "SqlTable"
     */
    private extractObjectTypeFromSourceType(diffType: string): string {
        if (!diffType) {
            return undefined;
        }

        // Extract the last part of the fully qualified type name
        const parts = diffType.split(".");
        return parts[parts.length - 1] || diffType;
    }
}
