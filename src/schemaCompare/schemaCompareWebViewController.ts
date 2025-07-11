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
    SchemaCompareReducers,
    SchemaCompareWebViewState,
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
import { TaskExecutionMode, DiffEntry } from "vscode-mssql";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { deepClone } from "../models/utils";
import { isNullOrUndefined } from "util";
import * as locConstants from "../constants/locConstants";
import { IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { cmdAddObjectExplorer } from "../constants/constants";

export class SchemaCompareWebViewController extends ReactWebviewPanelController<
    SchemaCompareWebViewState,
    SchemaCompareReducers
> {
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

        if (node && !this.isTreeNodeInfoType(node)) {
            node = this.getFullSqlProjectsPathFromNode(node);
        }

        void this.start(node);
        this.registerRpcHandlers();

        this.registerDisposable(
            this.connectionMgr.onConnectionsChanged(() => {
                const activeServers = this.getActiveServersList();
                this.state.activeServers = activeServers;

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
        let source: mssql.SchemaCompareEndpointInfo;

        const node = sourceContext as TreeNodeInfo;
        if (node.connectionProfile) {
            source = await this.getEndpointInfoFromConnectionProfile(
                node.connectionProfile,
                sourceContext,
            );
        } else if (
            sourceContext &&
            (sourceContext as string) &&
            (sourceContext as string).endsWith(".dacpac")
        ) {
            source = this.getEndpointInfoFromDacpac(sourceContext as string);
        } else if (sourceContext) {
            source = await this.getEndpointInfoFromProject(sourceContext as string);
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
            endpointType: mssql.SchemaCompareEndpointType.Database,
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
            extractTarget: mssql.ExtractTarget.schemaObjectType,
        };

        return source;
    }

    private getEndpointInfoFromDacpac(sourceDacpac: string): mssql.SchemaCompareEndpointInfo {
        const source = {
            endpointType: mssql.SchemaCompareEndpointType.Dacpac,
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            packageFilePath: sourceDacpac,
            connectionDetails: undefined,
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: mssql.ExtractTarget.schemaObjectType,
        };

        return source;
    }

    private async getEndpointInfoFromProject(
        projectFilePath: string,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        const source = {
            endpointType: mssql.SchemaCompareEndpointType.Project,
            projectFilePath: projectFilePath,
            extractTarget: mssql.ExtractTarget.schemaObjectType,
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
        let scriptFiles: string[] = [];

        const databaseProjectsExtension = vscode.extensions.getExtension(
            "ms-mssql.sql-database-projects-vscode",
        );
        if (databaseProjectsExtension) {
            scriptFiles = await (
                await databaseProjectsExtension.activate()
            ).getProjectScriptFiles(projectFilePath);
        }

        return scriptFiles;
    }

    private async getDatabaseSchemaProvider(projectFilePath: string): Promise<string> {
        let provider = "";

        const databaseProjectsExtension = vscode.extensions.getExtension(
            "ms-mssql.sql-database-projects-vscode",
        );

        if (databaseProjectsExtension) {
            provider = await (
                await databaseProjectsExtension.activate()
            ).getProjectDatabaseSchemaProvider(projectFilePath);
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
            const extension = vscode.extensions.getExtension(
                "ms-mssql.sql-database-projects-vscode",
            );

            if (extension) {
                if (!extension.isActive) {
                    await extension.activate();
                }
                state.isSqlProjectExtensionInstalled = true;
            } else {
                state.isSqlProjectExtensionInstalled = false;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("listActiveServers", (state) => {
            const activeServers = this.getActiveServersList();

            state.activeServers = activeServers;
            this.updateState(state);

            return state;
        });

        this.registerReducer("listDatabasesForActiveServer", async (state, payload) => {
            let databases: string[] = [];
            try {
                databases = await this.connectionMgr.listDatabases(payload.connectionUri);
            } catch (error) {
                console.error("Error listing databases:", error);
            }

            state.databases = databases;
            this.updateState(state);

            return state;
        });

        this.registerReducer("openAddNewConnectionDialog", (state) => {
            vscode.commands.executeCommand(cmdAddObjectExplorer);

            return state;
        });

        this.registerReducer("selectFile", async (state, payload) => {
            let endpointFilePath = "";
            if (payload.endpoint) {
                endpointFilePath =
                    payload.endpoint.packageFilePath || payload.endpoint.projectFilePath;
            }

            const filters = {
                Files: [payload.fileType],
            };

            const filePath = await showOpenDialogForDacpacOrSqlProj(endpointFilePath, filters);

            if (filePath) {
                const updatedEndpointInfo =
                    payload.fileType === "dacpac"
                        ? this.getEndpointInfoFromDacpac(filePath)
                        : await this.getEndpointInfoFromProject(filePath);

                state.auxiliaryEndpointInfo = updatedEndpointInfo;

                if (payload.fileType === "sqlproj") {
                    if (payload.endpointType === "target") {
                        state.auxiliaryEndpointInfo.extractTarget =
                            mssql.ExtractTarget.schemaObjectType;
                    }
                }

                this.updateState(state);
            }

            return state;
        });

        this.registerReducer("confirmSelectedSchema", async (state, payload) => {
            if (payload.endpointType === "source") {
                state.sourceEndpointInfo = state.auxiliaryEndpointInfo;
            } else {
                if (state.auxiliaryEndpointInfo) {
                    state.targetEndpointInfo = state.auxiliaryEndpointInfo;
                }

                if (
                    state.targetEndpointInfo?.endpointType ===
                    mssql.SchemaCompareEndpointType.Project
                ) {
                    state.targetEndpointInfo.extractTarget = this.mapExtractTargetEnum(
                        payload.folderStructure,
                    );
                }
            }

            state.auxiliaryEndpointInfo = undefined;
            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSelectedDatabase", (state, payload) => {
            const connection = this.connectionMgr.activeConnections[payload.serverConnectionUri];

            const connectionProfile = connection.credentials as IConnectionProfile;

            let user = connectionProfile.user;
            if (!user) {
                user = locConstants.SchemaCompare.defaultUserName;
            }

            const endpointInfo = {
                endpointType: mssql.SchemaCompareEndpointType.Database,
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
                extractTarget: mssql.ExtractTarget.schemaObjectType,
            };

            if (payload.endpointType === "source") {
                state.sourceEndpointInfo = endpointInfo;
            } else {
                state.targetEndpointInfo = endpointInfo;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("setIntermediarySchemaOptions", async (state) => {
            state.intermediaryOptionsResult = deepClone(state.defaultDeploymentOptionsResult);

            this.updateState(state);

            return state;
        });

        this.registerReducer("intermediaryIncludeObjectTypesOptionsChanged", (state, payload) => {
            const deploymentOptions = state.intermediaryOptionsResult.defaultDeploymentOptions;
            const excludeObjectTypeOptions = deploymentOptions.excludeObjectTypes.value;

            const optionIndex = excludeObjectTypeOptions.findIndex(
                (o) => o.toLowerCase() === payload.key.toLowerCase(),
            );

            const isFound = optionIndex !== -1;
            if (isFound) {
                excludeObjectTypeOptions.splice(optionIndex, 1);
            } else {
                excludeObjectTypeOptions.push(payload.key);
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("confirmSchemaOptions", async (state, payload) => {
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions = deepClone(
                state.intermediaryOptionsResult.defaultDeploymentOptions,
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

            sendActionEvent(TelemetryViews.SchemaCompare, TelemetryActions.OptionsChanged);

            if (payload.optionsChanged) {
                vscode.window
                    .showInformationMessage(
                        locConstants.SchemaCompare.optionsChangedMessage,
                        { modal: true },
                        yesItem,
                        noItem,
                    )
                    .then(async (result) => {
                        if (result.title === locConstants.SchemaCompare.Yes) {
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
                        }
                    });
            }

            return state;
        });

        this.registerReducer("intermediaryGeneralOptionsChanged", (state, payload) => {
            const generalOptionsDictionary =
                state.intermediaryOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary;
            generalOptionsDictionary[payload.key].value =
                !generalOptionsDictionary[payload.key].value;

            this.updateState(state);
            return state;
        });

        this.registerReducer("switchEndpoints", async (state, payload) => {
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Switch,
                this.operationId,
            );

            state.sourceEndpointInfo = payload.newSourceEndpointInfo;
            state.targetEndpointInfo = payload.newTargetEndpointInfo;
            state.endpointsSwitched = true;

            this.updateState(state);

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
            });

            return state;
        });

        this.registerReducer("compare", async (state, payload) => {
            return await this.schemaCompare(payload, state);
        });

        this.registerReducer("generateScript", async (state, payload) => {
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.GenerateScript,
                this.operationId,
                {
                    startTime: Date.now().toString(),
                    operationId: this.operationId,
                },
            );

            const result = await generateScript(
                this.operationId,
                TaskExecutionMode.script,
                payload,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.generateScriptErrorMessage(result.errorMessage),
                );
            }

            endActivity.end(ActivityStatus.Succeeded, {
                endTime: Date.now().toString(),
                operationId: this.operationId,
            });

            state.generateScriptResultStatus = result;
            return state;
        });

        this.registerReducer("publishChanges", async (state, payload) => {
            const yes = locConstants.SchemaCompare.Yes;
            const result = await vscode.window.showWarningMessage(
                locConstants.SchemaCompare.areYouSureYouWantToUpdateTheTarget,
                { modal: true },
                yes,
            );

            if (result !== yes) {
                return state;
            }

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

            switch (state.targetEndpointInfo.endpointType) {
                case mssql.SchemaCompareEndpointType.Database:
                    publishResult = await publishDatabaseChanges(
                        this.operationId,
                        TaskExecutionMode.execute,
                        payload,
                        this.schemaCompareService,
                    );
                    break;

                case mssql.SchemaCompareEndpointType.Project:
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

                case mssql.SchemaCompareEndpointType.Dacpac: // Dacpac is an invalid publish target
                default:
                    throw new Error(
                        `Unsupported SchemaCompareEndpointType: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`,
                    );
            }

            if (!publishResult || !publishResult.success || publishResult.errorMessage) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: publishResult.errorMessage,
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.schemaCompareApplyFailed(publishResult.errorMessage),
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
            const result = await publishDatabaseChanges(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
            );

            state.publishDatabaseChangesResultStatus = result;
            return state;
        });

        this.registerReducer("publishProjectChanges", async (state, payload) => {
            const result = await publishProjectChanges(
                this.operationId,
                payload,
                this.schemaCompareService,
            );

            state.schemaComparePublishProjectResult = result;
            return state;
        });

        this.registerReducer("resetOptions", async (state) => {
            const result = await getDefaultOptions(this.schemaCompareService);

            state.intermediaryOptionsResult = deepClone(result);
            this.updateState(state);

            sendActionEvent(TelemetryViews.SchemaCompare, TelemetryActions.ResetOptions);

            return state;
        });

        this.registerReducer("includeExcludeNode", async (state, payload) => {
            const result = await includeExcludeNode(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
            );

            if (result.success) {
                state.schemaCompareIncludeExcludeResult = result;

                if (state.schemaCompareResult) {
                    state.schemaCompareResult.differences[payload.id].included =
                        payload.includeRequest;

                    result.affectedDependencies.forEach((difference) => {
                        const index = state.schemaCompareResult.differences.findIndex(
                            (d) =>
                                d.sourceValue === difference.sourceValue &&
                                d.targetValue === difference.targetValue &&
                                d.updateAction === difference.updateAction &&
                                d.name === difference.name,
                        );

                        if (index !== -1) {
                            state.schemaCompareResult.differences[index].included =
                                payload.includeRequest;
                        }
                    });
                }

                this.updateState(state);
            } else {
                if (result.blockingDependencies) {
                    const diffEntry = payload.diffEntry;
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
            state.isIncludeExcludeAllOperationInProgress = true;
            this.updateState(state);

            const result = await includeExcludeAllNodes(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
            );

            this.state.isIncludeExcludeAllOperationInProgress = false;

            if (result.success) {
                state.schemaCompareResult.differences = result.allIncludedOrExcludedDifferences;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("openScmp", async (state) => {
            const selectedFilePath = await showOpenDialogForScmp();

            if (!selectedFilePath) {
                return state;
            }

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

            const result = await openScmp(selectedFilePath, this.schemaCompareService);

            if (!result || !result.success) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.openScmpErrorMessage(result.errorMessage),
                );
                return state;
            }

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
            const saveFilePath = await showSaveDialogForScmp();

            if (!saveFilePath) {
                return state;
            }

            const sourceExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalSourceExcludes,
            );
            const targetExcludes: mssql.SchemaCompareObjectId[] = this.convertExcludesToObjectIds(
                state.originalTargetExcludes,
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
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.saveScmpErrorMessage(result.errorMessage),
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
            const endActivity = startActivity(
                TelemetryViews.SchemaCompare,
                TelemetryActions.Cancel,
                this.operationId,
                {
                    startTime: Date.now().toString(),
                },
            );

            const result = await cancel(this.operationId, this.schemaCompareService);

            if (!result || !result.success) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    locConstants.SchemaCompare.cancelErrorMessage(result.errorMessage),
                );

                return state;
            }

            endActivity.end(ActivityStatus.Succeeded);

            state.isComparisonInProgress = false;
            state.cancelResultStatus = result;
            this.updateState(state);

            return state;
        });
    }

    private formatEntryName(nameParts: string[]): string {
        if (isNullOrUndefined(nameParts) || nameParts.length === 0) {
            return "";
        }
        return nameParts.join(".");
    }

    private mapExtractTargetEnum(folderStructure: string): mssql.ExtractTarget {
        switch (folderStructure) {
            case "File":
                return mssql.ExtractTarget.file;
            case "Flat":
                return mssql.ExtractTarget.flat;
            case "Object Type":
                return mssql.ExtractTarget.objectType;
            case "Schema":
                return mssql.ExtractTarget.schema;
            case "Schema/Object Type":
            default:
                return mssql.ExtractTarget.schemaObjectType;
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

        if (payload.sourceEndpointInfo.endpointType === mssql.SchemaCompareEndpointType.Project) {
            payload.sourceEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.sourceEndpointInfo.projectFilePath,
            );
        }
        if (payload.targetEndpointInfo.endpointType === mssql.SchemaCompareEndpointType.Project) {
            payload.targetEndpointInfo.targetScripts = await this.getProjectScriptFiles(
                payload.targetEndpointInfo.projectFilePath,
            );
        }

        const result = await compare(
            this.operationId,
            TaskExecutionMode.execute,
            payload,
            this.schemaCompareService,
        );

        state.isComparisonInProgress = false;

        if (!result || !result.success) {
            endActivity.endFailed(undefined, false, undefined, undefined, {
                errorMessage: result.errorMessage,
                operationId: this.operationId,
            });

            vscode.window.showErrorMessage(
                locConstants.SchemaCompare.compareErrorMessage(result.errorMessage),
            );

            return state;
        }

        endActivity.end(ActivityStatus.Succeeded);

        const finalDifferences = this.getAllObjectTypeDifferences(result);
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
        if (endpoint && endpoint.endpointType === mssql.SchemaCompareEndpointType.Database) {
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
                    endpointType: mssql.SchemaCompareEndpointType.Database,
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
                    extractTarget: mssql.ExtractTarget.schemaObjectType,
                };
            } else {
                endpointInfo = {
                    endpointType: mssql.SchemaCompareEndpointType.Database,
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
                    extractTarget: mssql.ExtractTarget.schemaObjectType,
                };
            }
        } else if (endpoint.endpointType === mssql.SchemaCompareEndpointType.Project) {
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
                    endpoint.endpointType === mssql.SchemaCompareEndpointType.Database
                        ? mssql.SchemaCompareEndpointType.Database
                        : mssql.SchemaCompareEndpointType.Dacpac,
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
        // let data = [];
        let finalDifferences: DiffEntry[] = [];
        let differences = result.differences;
        if (differences) {
            differences.forEach((difference) => {
                if (difference.differenceType === mssql.SchemaDifferenceType.Object) {
                    if (
                        (difference.sourceValue !== null && difference.sourceValue.length > 0) ||
                        (difference.targetValue !== null && difference.targetValue.length > 0)
                    ) {
                        // lewissanchez todo: need to check if difference is excluded before adding to final differences list
                        finalDifferences.push(difference);
                    }
                }
            });
        }

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
