/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import * as utils from "../models/utils";

import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    ExtractTarget,
    SchemaCompareEndpointType,
    SchemaCompareReducers,
    SchemaCompareWebViewState,
    SchemaDifferenceType,
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
    getDefaultOptions,
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
import VscodeWrapper from "../controllers/vscodeWrapper";
import { DiffEntry } from "vscode-mssql";
import { sendActionEvent, startActivity, sendErrorEvent } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { deepClone } from "../models/utils";
import { isNullOrUndefined } from "util";
import * as locConstants from "../constants/locConstants";
import { IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { cmdAddObjectExplorer } from "../constants/constants";
import { getErrorMessage } from "../utils/utils";

export class SchemaCompareWebViewController extends ReactWebviewPanelController<
    SchemaCompareWebViewState,
    SchemaCompareReducers
> {
    private static readonly SQL_DATABASE_PROJECTS_EXTENSION_ID =
        "ms-mssql.sql-database-projects-vscode";
    private operationId: string;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        node: any,
        private readonly schemaCompareService: mssql.ISchemaCompareService,
        private readonly connectionMgr: ConnectionManager,
        schemaCompareOptionsResult: mssql.SchemaCompareOptionsResult,
        title: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaCompare",
            "schemaCompare",
            {
                isSqlProjectExtensionInstalled: false,
                isComparisonInProgress: false,
                isIncludeExcludeAllOperationInProgress: false,
                activeServers: {},
                databases: [],
                defaultDeploymentOptionsResult: schemaCompareOptionsResult,
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
                waitingForNewConnection: false,
                pendingConnectionEndpointType: null,
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
            `SchemaCompareWebViewController created with operation ID: ${this.operationId}`,
        );

        if (node && !this.isTreeNodeInfoType(node)) {
            node = this.getFullSqlProjectsPathFromNode(node);
        }

        void this.start(node);
        this.registerRpcHandlers();

        this.registerDisposable(
            this.connectionMgr.onConnectionsChanged(async () => {
                const activeServers = this.getActiveServersList();

                // Check if we're waiting for a new connection and auto-select it
                if (
                    this.state.waitingForNewConnection &&
                    this.state.pendingConnectionEndpointType
                ) {
                    const newConnections = this.findNewConnections(
                        this.state.activeServers,
                        activeServers,
                    );
                    if (newConnections.length > 0) {
                        // Update active servers first so the UI has the latest list
                        this.state.activeServers = activeServers;

                        // Auto-select the first new connection
                        const newConnectionUri = newConnections[0];
                        await this.autoSelectNewConnection(
                            newConnectionUri,
                            this.state.pendingConnectionEndpointType,
                        );
                    }
                } else {
                    // Update active servers if we're not waiting for a new connection
                    this.state.activeServers = activeServers;
                }

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
     * @param comparisonResult Result of a previous comparison, if available.
     */
    public async start(
        sourceContext: any,
        comparisonResult: mssql.SchemaCompareResult = undefined,
    ): Promise<void> {
        this.logger.info(
            `Starting schema comparison with sourceContext type: ${sourceContext ? typeof sourceContext : "undefined"}`,
        );
        let source: mssql.SchemaCompareEndpointInfo;

        const node = sourceContext as TreeNodeInfo;
        if (node.connectionProfile) {
            this.logger.verbose(
                `Using connection profile as source: ${node.connectionProfile.server}`,
            );
            source = await this.getEndpointInfoFromConnectionProfile(
                node.connectionProfile,
                sourceContext,
            );
        } else if (
            sourceContext &&
            (sourceContext as string) &&
            (sourceContext as string).endsWith(".dacpac")
        ) {
            this.logger.verbose(`Using dacpac as source: ${sourceContext}`);
            source = this.getEndpointInfoFromDacpac(sourceContext as string);
        } else if (sourceContext) {
            this.logger.verbose(`Using project as source: ${sourceContext}`);
            source = await this.getEndpointInfoFromProject(sourceContext as string);
        } else {
            this.logger.verbose("No source context provided");
        }

        await this.launch(source, undefined, false, comparisonResult);
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
        this.logger.info(
            `Launching schema comparison with runComparison=${runComparison}, has source=${!!source}, has target=${!!target}, has comparisonResult=${!!comparisonResult}`,
        );

        if (runComparison && comparisonResult) {
            throw new Error(
                "Cannot both pass a comparison result and request a new comparison be run.",
            );
        }

        this.state.sourceEndpointInfo = source;
        this.state.targetEndpointInfo = target;
        this.updateState(this.state);
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
            packageFilePath: "",
            connectionDetails: undefined,
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
        this.logger.verbose(`Getting project script files for: ${projectFilePath}`);
        let scriptFiles: string[] = [];

        try {
            const databaseProjectsExtension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );
            if (databaseProjectsExtension) {
                this.logger.verbose(`SQL Database Projects extension found, activating...`);
                scriptFiles = await (
                    await databaseProjectsExtension.activate()
                ).getProjectScriptFiles(projectFilePath);
                this.logger.verbose(`Retrieved ${scriptFiles.length} script files from project`);
            } else {
                this.logger.warn(
                    `SQL Database Projects extension not found, cannot get project scripts`,
                );
            }
        } catch (error) {
            this.logger.error(`Failed to get project script files: ${getErrorMessage(error)}`);
            sendErrorEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GetDatabaseProjectScriptFiles,
                error,
            );
        }

        return scriptFiles;
    }

    private async getDatabaseSchemaProvider(projectFilePath: string): Promise<string> {
        this.logger.verbose(`Getting database schema provider for project: ${projectFilePath}`);
        let provider = "";

        try {
            const databaseProjectsExtension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );

            if (databaseProjectsExtension) {
                this.logger.verbose(`SQL Database Projects extension found, activating...`);
                provider = await (
                    await databaseProjectsExtension.activate()
                ).getProjectDatabaseSchemaProvider(projectFilePath);
                this.logger.verbose(`Retrieved database schema provider: ${provider || "empty"}`);
            } else {
                this.logger.warn(
                    `SQL Database Projects extension not found, cannot get database schema provider`,
                );
            }
        } catch (error) {
            this.logger.error(`Failed to get database schema provider: ${getErrorMessage(error)}`);
            sendErrorEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GetDatabaseProjectSchemaProvider,
                error,
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

    private getFullSqlProjectsPathFromNode(node: any): string {
        return node.treeDataProvider?.roots[0]?.projectFileUri?.fsPath ?? "";
    }

    private registerRpcHandlers(): void {
        this.registerReducer("isSqlProjectExtensionInstalled", async (state) => {
            this.logger.verbose(`Checking if SQL Database Projects extension is installed`);

            const extension = vscode.extensions.getExtension(
                SchemaCompareWebViewController.SQL_DATABASE_PROJECTS_EXTENSION_ID,
            );

            if (extension) {
                if (!extension.isActive) {
                    this.logger.verbose(
                        `SQL Database Projects extension found but not activated, activating...`,
                    );
                    await extension.activate();
                }
                this.logger.info(`SQL Database Projects extension is installed and activated`);
                state.isSqlProjectExtensionInstalled = true;
            } else {
                this.logger.info(`SQL Database Projects extension is not installed`);
                state.isSqlProjectExtensionInstalled = false;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("listActiveServers", (state) => {
            this.logger.verbose(`Listing active SQL servers`);
            const activeServers = this.getActiveServersList();

            const serverCount = Object.keys(activeServers).length;
            this.logger.info(`Found ${serverCount} active SQL server connection(s)`);

            state.activeServers = activeServers;
            this.updateState(state);

            return state;
        });

        this.registerReducer("listDatabasesForActiveServer", async (state, payload) => {
            this.logger.info(`Listing databases for server connection: ${payload.connectionUri}`);

            let databases: string[] = [];
            try {
                databases = await this.connectionMgr.listDatabases(payload.connectionUri);
                this.logger.info(`Found ${databases.length} database(s) on server`);
            } catch (error) {
                this.logger.error(`Error listing databases: ${getErrorMessage(error)}`);
                console.error("Error listing databases:", error);
                sendErrorEvent(
                    TelemetryViews.SchemaCompare,
                    TelemetryActions.ListingDatabasesForActiveServer,
                    error,
                );
            }

            state.databases = databases;
            this.updateState(state);

            return state;
        });

        this.registerReducer("openAddNewConnectionDialog", (state, payload) => {
            this.logger.info(`Opening new connection dialog for ${payload.endpointType} endpoint`);

            state.waitingForNewConnection = true;
            state.pendingConnectionEndpointType = payload.endpointType;

            this.logger.verbose(`Executing command: ${cmdAddObjectExplorer}`);
            vscode.commands.executeCommand(cmdAddObjectExplorer);

            return state;
        });

        this.registerReducer("selectFile", async (state, payload) => {
            this.logger.info(
                `Selecting ${payload.fileType} file for ${payload.endpointType} endpoint`,
            );

            let endpointFilePath = "";
            if (payload.endpoint) {
                endpointFilePath =
                    payload.endpoint.packageFilePath || payload.endpoint.projectFilePath;
                this.logger.verbose(
                    `Using existing file path as starting point: ${endpointFilePath}`,
                );
            }

            const filters = {
                Files: [payload.fileType],
            };

            this.logger.verbose(`Opening file dialog with filters: ${JSON.stringify(filters)}`);
            const filePath = await showOpenDialogForDacpacOrSqlProj(endpointFilePath, filters);

            if (filePath) {
                this.logger.info(`Selected file: ${filePath}`);

                const updatedEndpointInfo =
                    payload.fileType === "dacpac"
                        ? this.getEndpointInfoFromDacpac(filePath)
                        : await this.getEndpointInfoFromProject(filePath);

                state.auxiliaryEndpointInfo = updatedEndpointInfo;

                if (payload.fileType === "sqlproj") {
                    if (payload.endpointType === "target") {
                        this.logger.verbose(
                            `Setting extract target to schemaObjectType for target project`,
                        );
                        state.auxiliaryEndpointInfo.extractTarget = ExtractTarget.schemaObjectType;
                    }
                }

                this.updateState(state);
            } else {
                this.logger.info(`File selection canceled by user`);
            }

            return state;
        });

        this.registerReducer("confirmSelectedSchema", async (state, payload) => {
            this.logger.info(`Confirming selected schema for ${payload.endpointType} endpoint`);

            if (payload.endpointType === "source") {
                this.logger.info(`Setting source endpoint info from auxiliary endpoint info`);
                state.sourceEndpointInfo = state.auxiliaryEndpointInfo;
            } else {
                if (state.auxiliaryEndpointInfo) {
                    this.logger.info(`Setting target endpoint info from auxiliary endpoint info`);
                    state.targetEndpointInfo = state.auxiliaryEndpointInfo;
                }

                if (state.targetEndpointInfo?.endpointType === SchemaCompareEndpointType.Project) {
                    this.logger.info(`Setting target extract target to ${payload.folderStructure}`);
                    state.targetEndpointInfo.extractTarget = this.mapExtractTargetEnum(
                        payload.folderStructure,
                    );
                }
            }

            this.logger.verbose(`Clearing auxiliary endpoint info`);
            state.auxiliaryEndpointInfo = undefined;
            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSelectedDatabase", (state, payload) => {
            this.logger.info(
                `Confirming selected database for ${payload.endpointType} endpoint: ${payload.databaseName}`,
            );

            const connection = this.connectionMgr.activeConnections[payload.serverConnectionUri];
            this.logger.verbose(`Using connection: ${payload.serverConnectionUri}`);

            const connectionProfile = connection.credentials as IConnectionProfile;

            let user = connectionProfile.user;
            if (!user) {
                user = locConstants.SchemaCompare.defaultUserName;
                this.logger.verbose(`Using default user name: ${user}`);
            }

            const endpointInfo = {
                endpointType: SchemaCompareEndpointType.Database,
                serverDisplayName: `${connectionProfile.server} (${user})`,
                serverName: connectionProfile.server,
                databaseName: payload.databaseName,
                ownerUri: payload.serverConnectionUri,
                packageFilePath: "",
                connectionDetails: undefined,
                connectionName: connectionProfile.profileName ? connectionProfile.profileName : "",
                projectFilePath: "",
                targetScripts: [],
                dataSchemaProvider: "",
                extractTarget: ExtractTarget.schemaObjectType,
            };

            if (payload.endpointType === "source") {
                this.logger.info(`Setting as source endpoint`);
                state.sourceEndpointInfo = endpointInfo;
            } else {
                this.logger.info(`Setting as target endpoint`);
                state.targetEndpointInfo = endpointInfo;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("setIntermediarySchemaOptions", async (state) => {
            this.logger.verbose(`Setting intermediary schema options`);
            state.intermediaryOptionsResult = deepClone(state.defaultDeploymentOptionsResult);
            this.logger.info(`Cloned deployment options for editing`);

            this.updateState(state);

            return state;
        });

        this.registerReducer("intermediaryIncludeObjectTypesOptionsChanged", (state, payload) => {
            this.logger.verbose(`Updating object type inclusion option: ${payload.key}`);

            const deploymentOptions = state.intermediaryOptionsResult.defaultDeploymentOptions;
            const excludeObjectTypeOptions = deploymentOptions.excludeObjectTypes.value;

            const optionIndex = excludeObjectTypeOptions.findIndex(
                (o) => o.toLowerCase() === payload.key.toLowerCase(),
            );

            const isFound = optionIndex !== -1;
            if (isFound) {
                this.logger.info(`Removing object type from exclusion list: ${payload.key}`);
                excludeObjectTypeOptions.splice(optionIndex, 1);
            } else {
                this.logger.info(`Adding object type to exclusion list: ${payload.key}`);
                excludeObjectTypeOptions.push(payload.key);
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSchemaOptions", async (state, payload) => {
            this.logger.info(`Confirming schema comparison options`);

            state.defaultDeploymentOptionsResult.defaultDeploymentOptions = deepClone(
                state.intermediaryOptionsResult.defaultDeploymentOptions,
            );
            this.logger.verbose(`Applied intermediary options to default deployment options`);
            state.intermediaryOptionsResult = undefined;

            this.updateState(state);

            const yesItem: vscode.MessageItem = {
                title: locConstants.SchemaCompare.Yes,
            };

            const noItem: vscode.MessageItem = {
                title: locConstants.SchemaCompare.No,
                isCloseAffordance: true,
            };

            sendActionEvent(TelemetryViews.SchemaCompare, TelemetryActions.OptionsChanged);
            this.logger.verbose(`Sent telemetry event for options changed`);

            if (payload.optionsChanged) {
                this.logger.info(`Options were changed, prompting user to run comparison again`);
                vscode.window
                    .showInformationMessage(
                        locConstants.SchemaCompare.optionsChangedMessage,
                        { modal: true },
                        yesItem,
                        noItem,
                    )
                    .then(async (result) => {
                        if (result.title === locConstants.SchemaCompare.Yes) {
                            this.logger.info(`User chose to run comparison with new options`);
                            const payload = {
                                sourceEndpointInfo: state.sourceEndpointInfo,
                                targetEndpointInfo: state.targetEndpointInfo,
                                deploymentOptions:
                                    state.defaultDeploymentOptionsResult.defaultDeploymentOptions,
                            };
                            await this.schemaCompare(payload, state);

                            sendActionEvent(
                                TelemetryViews.SchemaCompare,
                                TelemetryActions.OptionsChanged,
                            );
                        } else {
                            this.logger.info(`User chose not to run comparison with new options`);
                        }
                    });
            } else {
                this.logger.info(`No options were changed`);
            }

            return state;
        });

        this.registerReducer("intermediaryGeneralOptionsChanged", (state, payload) => {
            this.logger.verbose(`Changing general option: ${payload.key}`);

            const generalOptionsDictionary =
                state.intermediaryOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary;
            const oldValue = generalOptionsDictionary[payload.key].value;
            generalOptionsDictionary[payload.key].value = !oldValue;

            this.logger.info(`Changed option ${payload.key} from ${oldValue} to ${!oldValue}`);

            this.updateState(state);
            return state;
        });

        this.registerReducer("switchEndpoints", async (state, payload) => {
            this.logger.info(`Switching source and target endpoints`);

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Switch,
                this.operationId,
            );

            const sourceType = getSchemaCompareEndpointTypeString(
                payload.newSourceEndpointInfo.endpointType,
            );
            const targetType = getSchemaCompareEndpointTypeString(
                payload.newTargetEndpointInfo.endpointType,
            );
            this.logger.verbose(`New source endpoint type: ${sourceType}`);
            this.logger.verbose(`New target endpoint type: ${targetType}`);

            state.sourceEndpointInfo = payload.newSourceEndpointInfo;
            state.targetEndpointInfo = payload.newTargetEndpointInfo;
            state.endpointsSwitched = true;

            this.updateState(state);

            this.logger.info(`Successfully switched endpoints`);
            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
            });

            return state;
        });

        this.registerReducer("compare", async (state, payload) => {
            return await this.schemaCompare(payload, state);
        });

        this.registerReducer("generateScript", async (state, payload) => {
            this.logger.info(
                `Generating script for schema changes with operation ID: ${this.operationId}`,
            );

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GenerateScript,
                this.operationId,
                {
                    startTime: Date.now().toString(),
                    operationId: this.operationId,
                },
            );

            this.logger.verbose(`Starting script generation`);
            const result = await generateScript(
                this.operationId,
                TaskExecutionMode.script,
                payload,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                this.logger.error(
                    `Failed to generate script: ${result?.errorMessage || "Unknown error"}`,
                );
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result?.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.generateScriptErrorMessage(result?.errorMessage),
                );
            } else {
                this.logger.info(`Successfully generated script`);
            }

            endActivity.end(ActivityStatus.Succeeded, {
                endTime: Date.now().toString(),
                operationId: this.operationId,
            });

            state.generateScriptResultStatus = result;
            return state;
        });

        this.registerReducer("publishChanges", async (state, payload) => {
            this.logger.info(`Publishing changes requested with operation ID: ${this.operationId}`);
            this.logger.verbose(
                `Target endpoint type: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`,
            );

            const yes = locConstants.SchemaCompare.Yes;
            const result = await vscode.window.showWarningMessage(
                locConstants.SchemaCompare.areYouSureYouWantToUpdateTheTarget,
                { modal: true },
                yes,
            );

            if (result !== yes) {
                this.logger.info(`User canceled publishing changes`);
                return state;
            }

            this.logger.info(
                `Starting publish operation to ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`,
            );
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Publish,
                this.operationId,
                {
                    startTime: Date.now().toString(),
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                },
            );

            let publishResult: mssql.ResultStatus | undefined = undefined;

            try {
                switch (state.targetEndpointInfo.endpointType) {
                    case SchemaCompareEndpointType.Database:
                        this.logger.info(
                            `Publishing changes to database ${state.targetEndpointInfo.databaseName}`,
                        );
                        publishResult = await publishDatabaseChanges(
                            this.operationId,
                            TaskExecutionMode.execute,
                            payload,
                            this.schemaCompareService,
                        );
                        break;

                    case SchemaCompareEndpointType.Project:
                        this.logger.info(
                            `Publishing changes to project ${state.targetEndpointInfo.projectFilePath}`,
                        );
                        publishResult = await publishProjectChanges(
                            this.operationId,
                            {
                                targetProjectPath: state.targetEndpointInfo.projectFilePath,
                                targetFolderStructure: state.targetEndpointInfo.extractTarget,
                                taskExecutionMode: TaskExecutionMode.execute,
                            },
                            this.schemaCompareService,
                        );
                        break;

                    case SchemaCompareEndpointType.Dacpac: // Dacpac is an invalid publish target
                    default:
                        const errorMsg = `Unsupported SchemaCompareEndpointType: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`;
                        this.logger.error(errorMsg);
                        throw new Error(errorMsg);
                }
            } catch (error) {
                this.logger.error(`Exception during publish operation: ${getErrorMessage(error)}`);
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: getErrorMessage(error),
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.schemaCompareApplyFailed(getErrorMessage(error)),
                );

                return state;
            }

            if (!publishResult || !publishResult.success || publishResult.errorMessage) {
                this.logger.error(
                    `Publish operation failed: ${publishResult?.errorMessage || "Unknown error"}`,
                );
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: publishResult?.errorMessage,
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.schemaCompareApplyFailed(
                        publishResult?.errorMessage,
                    ),
                );

                return state;
            }

            endActivity.end(ActivityStatus.Succeeded, {
                endTime: Date.now().toString(),
                operationId: this.operationId,
                targetType: getSchemaCompareEndpointTypeString(
                    state.targetEndpointInfo.endpointType,
                ),
            });

            return state;
        });

        this.registerReducer("publishDatabaseChanges", async (state, payload) => {
            this.logger.info(`Publishing database changes with operation ID: ${this.operationId}`);

            try {
                const result = await publishDatabaseChanges(
                    this.operationId,
                    TaskExecutionMode.execute,
                    payload,
                    this.schemaCompareService,
                );

                if (result.success) {
                    this.logger.info(`Successfully published database changes`);
                } else {
                    this.logger.error(
                        `Failed to publish database changes: ${result.errorMessage || "Unknown error"}`,
                    );
                }

                state.publishDatabaseChangesResultStatus = result;
            } catch (error) {
                this.logger.error(`Exception during database publish: ${getErrorMessage(error)}`);
            }

            return state;
        });

        this.registerReducer("publishProjectChanges", async (state, payload) => {
            this.logger.info(`Publishing project changes with operation ID: ${this.operationId}`);
            this.logger.verbose(`Target project path: ${payload.targetProjectPath}`);

            try {
                const result = await publishProjectChanges(
                    this.operationId,
                    payload,
                    this.schemaCompareService,
                );

                if (result.success) {
                    this.logger.info(`Successfully published project changes`);
                } else {
                    this.logger.error(
                        `Failed to publish project changes: ${result.errorMessage || "Unknown error"}`,
                    );
                }

                state.schemaComparePublishProjectResult = result;
            } catch (error) {
                this.logger.error(`Exception during project publish: ${getErrorMessage(error)}`);
            }

            return state;
        });

        this.registerReducer("resetOptions", async (state) => {
            this.logger.info(`Resetting schema compare options to defaults`);

            try {
                const result = await getDefaultOptions(this.schemaCompareService);
                this.logger.verbose(`Retrieved default options from schema compare service`);

                state.intermediaryOptionsResult = deepClone(result);
                this.logger.info(`Reset options to defaults`);
                this.updateState(state);

                sendActionEvent(TelemetryViews.SchemaCompare, TelemetryActions.ResetOptions);
            } catch (error) {
                this.logger.error(`Failed to reset options: ${getErrorMessage(error)}`);
            }

            return state;
        });

        this.registerReducer("includeExcludeNode", async (state, payload) => {
            const diffEntry = payload.diffEntry;
            const diffEntryName = this.formatEntryName(
                diffEntry.sourceValue ? diffEntry.sourceValue : diffEntry.targetValue,
            );

            this.logger.info(
                `${payload.includeRequest ? "Including" : "Excluding"} node: ${diffEntryName} (ID: ${payload.id})`,
            );

            const result = await includeExcludeNode(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
            );

            if (result.success) {
                this.logger.info(
                    `Successfully ${payload.includeRequest ? "included" : "excluded"} node with ${result.affectedDependencies.length} affected dependencies`,
                );
                state.schemaCompareIncludeExcludeResult = result;

                if (state.schemaCompareResult) {
                    state.schemaCompareResult.differences[payload.id].included =
                        payload.includeRequest;

                    this.logger.verbose(`Updating affected dependencies in the UI state`);
                    result.affectedDependencies.forEach((difference) => {
                        const index = state.schemaCompareResult.differences.findIndex(
                            (d) =>
                                d.sourceValue === difference.sourceValue &&
                                d.targetValue === difference.targetValue &&
                                d.updateAction === difference.updateAction &&
                                d.name === difference.name,
                        );

                        if (index !== -1) {
                            this.logger.verbose(
                                `Updated dependency at index ${index} to included=${payload.includeRequest}`,
                            );
                            state.schemaCompareResult.differences[index].included =
                                payload.includeRequest;
                        } else {
                            this.logger.warn(`Could not find dependency in schema compare results`);
                        }
                    });
                }

                this.updateState(state);
            } else {
                this.logger.warn(
                    `Failed to ${payload.includeRequest ? "include" : "exclude"} node: ${result.errorMessage || "Unknown error"}`,
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
                        `Operation blocked by dependencies: ${blockingDependencyNames.join(", ")}`,
                    );

                    let message: string = "";
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
                }
            }

            return state;
        });

        this.registerReducer("includeExcludeAllNodes", async (state, payload) => {
            this.logger.info(`${payload.includeRequest ? "Including" : "Excluding"} all nodes`);

            state.isIncludeExcludeAllOperationInProgress = true;
            this.updateState(state);

            try {
                const result = await includeExcludeAllNodes(
                    this.operationId,
                    TaskExecutionMode.execute,
                    payload,
                    this.schemaCompareService,
                );

                this.state.isIncludeExcludeAllOperationInProgress = false;

                if (result.success) {
                    const count = result.allIncludedOrExcludedDifferences.length;
                    this.logger.info(
                        `Successfully ${payload.includeRequest ? "included" : "excluded"} all nodes (${count} differences)`,
                    );
                    state.schemaCompareResult.differences = result.allIncludedOrExcludedDifferences;
                } else {
                    this.logger.error(
                        `Failed to ${payload.includeRequest ? "include" : "exclude"} all nodes: ${result.errorMessage || "Unknown error"}`,
                    );
                }
            } catch (error) {
                this.logger.error(
                    `Exception during ${payload.includeRequest ? "include" : "exclude"} all operation: ${getErrorMessage(error)}`,
                );
                this.state.isIncludeExcludeAllOperationInProgress = false;
            }

            this.updateState(state);
            return state;
        });

        this.registerReducer("openScmp", async (state) => {
            this.logger.info(`Opening schema comparison (.scmp) file`);

            const selectedFilePath = await showOpenDialogForScmp();

            if (!selectedFilePath) {
                this.logger.info(`File selection canceled by user`);
                return state;
            }

            this.logger.info(`Selected file: ${selectedFilePath}`);

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.OpenScmp,
                this.operationId,
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            this.logger.verbose(`Opening schema comparison from file`);
            const result = await openScmp(selectedFilePath, this.schemaCompareService);

            if (!result || !result.success) {
                this.logger.error(
                    `Failed to open schema comparison file: ${result?.errorMessage || "Unknown error"}`,
                );
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result?.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.openScmpErrorMessage(result?.errorMessage),
                );
                return state;
            }

            this.logger.info(`Successfully opened schema comparison file`);

            // construct source endpoint info
            state.sourceEndpointInfo = await this.constructEndpointInfo(
                result.sourceEndpointInfo,
                "source",
            );

            // construct target endpoint info
            state.targetEndpointInfo = await this.constructEndpointInfo(
                result.targetEndpointInfo,
                "target",
            );

            state.defaultDeploymentOptionsResult.defaultDeploymentOptions =
                result.deploymentOptions;

            // Update intermediaryOptionsResult to ensure UI reflects loaded options
            state.intermediaryOptionsResult = deepClone(state.defaultDeploymentOptionsResult);

            state.scmpSourceExcludes = result.excludedSourceElements;
            state.scmpTargetExcludes = result.excludedTargetElements;
            state.sourceTargetSwitched =
                result.originalTargetName !== state.targetEndpointInfo.databaseName;
            // Reset the schema comparison result similarly to what happens in Azure Data Studio.
            state.schemaCompareResult = undefined;

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
                elapsedTime: (Date.now() - startTime).toString(),
            });

            state.schemaCompareOpenScmpResult = result;
            this.updateState(state);

            return state;
        });

        this.registerReducer("saveScmp", async (state) => {
            this.logger.info(`Saving schema comparison (.scmp) file`);

            const saveFilePath = await showSaveDialogForScmp();

            if (!saveFilePath) {
                this.logger.info(`Save file operation canceled by user`);
                return state;
            }

            this.logger.info(`Saving schema comparison to: ${saveFilePath}`);

            const sourceExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalSourceExcludes,
            );
            const targetExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalTargetExcludes,
            );

            this.logger.verbose(
                `Prepared ${sourceExcludes.length} source excludes and ${targetExcludes.length} target excludes`,
            );

            const startTime = Date.now();
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.SaveScmp,
                this.operationId,
                {
                    startTime: startTime.toString(),
                    operationId: this.operationId,
                },
            );

            this.logger.verbose(`Calling saveScmp service`);
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
                    `Failed to save schema comparison file: ${result?.errorMessage || "Unknown error"}`,
                );
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result?.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.saveScmpErrorMessage(result?.errorMessage),
                );
            } else {
                this.logger.info(`Successfully saved schema comparison file`);
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

            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Cancel,
                this.operationId,
                {
                    startTime: Date.now().toString(),
                },
            );

            try {
                const result = await cancel(this.operationId, this.schemaCompareService);

                if (!result || !result.success) {
                    this.logger.error(
                        `Failed to cancel operation: ${result?.errorMessage || "Unknown error"}`,
                    );
                    endActivity.endFailed(undefined, false, undefined, undefined, {
                        errorMessage: result?.errorMessage,
                        operationId: this.operationId,
                    });

                    vscode.window.showErrorMessage(
                        locConstants.SchemaCompare.cancelErrorMessage(result?.errorMessage),
                    );

                    return state;
                }

                this.logger.info(`Successfully cancelled schema comparison operation`);
                endActivity.end(ActivityStatus.Succeeded);

                state.isComparisonInProgress = false;
                state.cancelResultStatus = result;
                this.updateState(state);
            } catch (error) {
                this.logger.error(`Exception during cancel operation: ${getErrorMessage(error)}`);
            }

            return state;
        });
    }

    private formatEntryName(nameParts: string[]): string {
        if (isNullOrUndefined(nameParts) || nameParts.length === 0) {
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

    private findNewConnections(
        oldActiveServers: { [connectionUri: string]: { profileName: string; server: string } },
        newActiveServers: { [connectionUri: string]: { profileName: string; server: string } },
    ): string[] {
        const newConnections: string[] = [];

        for (const connectionUri in newActiveServers) {
            if (!(connectionUri in oldActiveServers)) {
                newConnections.push(connectionUri);
            }
        }

        return newConnections;
    }

    private async autoSelectNewConnection(
        connectionUri: string,
        endpointType: "source" | "target",
    ): Promise<void> {
        this.logger.info(
            `Auto-selecting new connection for ${endpointType} endpoint: ${connectionUri}`,
        );

        try {
            // Get the list of databases for the new connection
            this.logger.verbose(`Retrieving databases for connection: ${connectionUri}`);
            const databases = await this.connectionMgr.listDatabases(connectionUri);
            this.logger.verbose(`Found ${databases.length} databases on server`);

            // If there are databases, select the first one
            if (databases.length > 0) {
                const databaseName = databases[0];
                this.logger.info(`Auto-selecting database: ${databaseName}`);

                // Create the endpoint info for the new connection
                const connection = this.connectionMgr.activeConnections[connectionUri];
                const connectionProfile = connection?.credentials as IConnectionProfile;

                if (connectionProfile) {
                    this.logger.verbose(
                        `Creating endpoint info from connection profile: ${connectionProfile.server}`,
                    );
                    let user = connectionProfile.user;
                    if (!user) {
                        user = locConstants.SchemaCompare.defaultUserName;
                        this.logger.verbose(`Using default user name: ${user}`);
                    }

                    const endpointInfo = {
                        endpointType: SchemaCompareEndpointType.Database,
                        serverDisplayName: `${connectionProfile.server} (${user})`,
                        serverName: connectionProfile.server,
                        databaseName: databaseName,
                        ownerUri: connectionUri,
                        packageFilePath: "",
                        connectionDetails: undefined,
                        connectionName: connectionProfile.profileName
                            ? connectionProfile.profileName
                            : "",
                        projectFilePath: "",
                        targetScripts: [],
                        dataSchemaProvider: "",
                        extractTarget: ExtractTarget.schemaObjectType,
                    };

                    if (endpointType === "source") {
                        this.logger.info(`Setting connection as source endpoint`);
                        this.state.sourceEndpointInfo = endpointInfo;
                    } else {
                        this.logger.info(`Setting connection as target endpoint`);
                        this.state.targetEndpointInfo = endpointInfo;
                    }

                    // Update the databases list for the UI
                    this.state.databases = databases;
                } else {
                    this.logger.warn(
                        `No connection profile found for connection URI: ${connectionUri}`,
                    );
                }
            } else {
                this.logger.warn(`No databases found for connection: ${connectionUri}`);
            }
        } catch (error) {
            this.logger.error(`Error auto-selecting new connection: ${getErrorMessage(error)}`);
        } finally {
            // Reset the waiting state
            this.logger.verbose(`Resetting waiting state`);
            this.state.waitingForNewConnection = false;
            this.state.pendingConnectionEndpointType = null;
        }
    }

    private getActiveServersList(): {
        [connectionUri: string]: { profileName: string; server: string };
    } {
        const activeServers: { [connectionUri: string]: { profileName: string; server: string } } =
            {};
        const activeConnections = this.connectionMgr.activeConnections;
        Object.keys(activeConnections).forEach((connectionUri) => {
            let credentials = activeConnections[connectionUri]
                .credentials as IConnectionDialogProfile;

            activeServers[connectionUri] = {
                profileName: credentials.profileName ?? "",
                server: credentials.server,
            };
        });

        return activeServers;
    }

    private async schemaCompare(
        payload: {
            sourceEndpointInfo: mssql.SchemaCompareEndpointInfo;
            targetEndpointInfo: mssql.SchemaCompareEndpointInfo;
            deploymentOptions: mssql.DeploymentOptions;
        },
        state: SchemaCompareWebViewState,
    ) {
        this.logger.info(`Starting schema comparison with operation ID: ${this.operationId}`);
        this.logger.verbose(
            `Source endpoint type: ${getSchemaCompareEndpointTypeString(payload.sourceEndpointInfo.endpointType)}`,
        );
        this.logger.verbose(
            `Target endpoint type: ${getSchemaCompareEndpointTypeString(payload.targetEndpointInfo.endpointType)}`,
        );

        state.isComparisonInProgress = true;
        this.updateState(state);

        const endActivity = startActivity(
            TelemetryViews.SchemaCompare,
            TelemetryActions.Compare,
            this.operationId,
            {
                startTime: Date.now().toString(),
            },
        );

        if (payload.sourceEndpointInfo.endpointType === SchemaCompareEndpointType.Project) {
            this.logger.logDebug(
                `Getting project script files for source: ${payload.sourceEndpointInfo.projectFilePath}`,
            );
            payload.sourceEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.sourceEndpointInfo.projectFilePath,
            );
        }
        if (payload.targetEndpointInfo.endpointType === SchemaCompareEndpointType.Project) {
            this.logger.logDebug(
                `Getting project script files for target: ${payload.targetEndpointInfo.projectFilePath}`,
            );
            payload.targetEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.targetEndpointInfo.projectFilePath,
            );
        }

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
                `Schema comparison failed: ${result?.errorMessage || "Unknown error"}`,
            );
            endActivity.endFailed(undefined, false, undefined, undefined, {
                errorMessage: result?.errorMessage,
                operationId: this.operationId,
            });

            vscode.window.showErrorMessage(
                locConstants.SchemaCompare.compareErrorMessage(result?.errorMessage),
            );

            return state;
        }

        this.logger.info(
            `Schema comparison completed successfully with ${result.differences?.length || 0} differences found`,
        );
        endActivity.end(ActivityStatus.Succeeded);

        const finalDifferences = this.getAllObjectTypeDifferences(result);
        this.logger.verbose(`Filtered to ${finalDifferences.length} object type differences`);
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
        let ownerUri;
        let endpointInfo;
        if (endpoint && endpoint.endpointType === SchemaCompareEndpointType.Database) {
            const connInfo = endpoint.connectionDetails.options as mssql.IConnectionInfo;

            ownerUri = this.connectionMgr.getUriForScmpConnection(connInfo);

            let isConnected = ownerUri ? true : false;
            if (!ownerUri) {
                ownerUri = utils.generateQueryUri().toString();

                isConnected = await this.connectionMgr.connect(ownerUri, connInfo);

                if (!isConnected) {
                    // Invoking connect will add an active connection that isn't valid, hence removing it.
                    delete this.connectionMgr.activeConnections[ownerUri];
                }
            }

            const connection = this.connectionMgr.activeConnections[ownerUri];
            const connectionProfile = connection?.credentials as IConnectionProfile;

            if (isConnected && ownerUri && connectionProfile) {
                endpointInfo = {
                    endpointType: SchemaCompareEndpointType.Database,
                    serverDisplayName: `${connInfo.server} (${connectionProfile.user || locConstants.SchemaCompare.defaultUserName})`,
                    serverName: connInfo.server,
                    databaseName: connInfo.database,
                    ownerUri: ownerUri,
                    packageFilePath: "",
                    connectionDetails: undefined,
                    connectionName: connectionProfile.profileName
                        ? connectionProfile.profileName
                        : "",
                    projectFilePath: "",
                    targetScripts: [],
                    dataSchemaProvider: "",
                    extractTarget: ExtractTarget.schemaObjectType,
                };
            } else {
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
        } else {
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
        }

        return endpointInfo;
    }

    private getAllObjectTypeDifferences(result: mssql.SchemaCompareResult): DiffEntry[] {
        this.logger.verbose(`Filtering differences from schema comparison result`);

        let finalDifferences: DiffEntry[] = [];
        let differences = result.differences;

        if (!differences) {
            this.logger.warn(`No differences found in schema comparison result`);
            return finalDifferences;
        }

        this.logger.verbose(`Processing ${differences.length} total differences`);

        differences.forEach((difference) => {
            if (difference.differenceType === SchemaDifferenceType.Object) {
                if (
                    (difference.sourceValue !== null && difference.sourceValue.length > 0) ||
                    (difference.targetValue !== null && difference.targetValue.length > 0)
                ) {
                    finalDifferences.push(difference);
                    this.logger.logDebug(
                        `Including difference: ${difference.name} with update action ${difference.updateAction}`,
                    );
                }
            }
        });

        this.logger.info(
            `Found ${finalDifferences.length} object type differences out of ${differences.length} total differences`,
        );
        return finalDifferences;
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
}
