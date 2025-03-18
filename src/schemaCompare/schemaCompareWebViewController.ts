/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../sharedInterfaces/schemaCompare";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
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
    showOpenDialog,
    getSchemaCompareEndpointTypeString,
    sqlDatabaseProjectsPublishChanges,
    getStartingPathForOpenDialog,
    showSaveDialog,
} from "./schemaCompareUtils";
import { locConstants as loc } from "../reactviews/common/locConstants";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { TaskExecutionMode, DiffEntry } from "vscode-mssql";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import {
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { deepClone } from "../models/utils";

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
        /*
        const keys = Object.keys(activeConnections);

        connectionMgr
            .listDatabases(keys[0])
            .then(async (databases) => {
                console.log(databases);
            })
            .catch((err) => {
                console.log(err);
            });
            */

        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        //
        // const connectionDetails = connectionMgr.createConnectionDetails(
        //     activeConnections[0].credentials,
        // );

        // connectionMgr
        //     .getConnectionString(connectionDetails, true, true)
        //     .then(async (connectionString) => {
        // if (!connectionString || connectionString === "") {
        //     vscode.window.showErrorMessage(
        //         "Unabled to find connection string for the connection",
        //     );
        // } else {
        //     try {
        //         const databases = await connectionMgr.listDatabases(
        //             activeConnections[0],
        //         );

        //         console.log(databases);
        //     } catch (error) {
        //         console.error("Error listing databases:", error);
        //     }
        // });

        // const connections = connectionMgr.connectionStore.loadAllConnections(
        //     /* get recent connections: */ true,
        // );

        // const PROFILE = 0;
        // const savedConnections = connections.filter(
        //     (c) => Number(c.quickPickItemType) === PROFILE,
        // );

        // const NEW_CONNECTION = 2;
        // const newConnections = connections.filter(
        //     (c) => Number(c.quickPickItemType) === NEW_CONNECTION,
        // );

        // const allConnections = [...newConnections, ...savedConnections];
        // const serverNames = allConnections.map((c) => c.connectionCreds.server);

        // const connectionInfo = allConnections[0].connectionCreds;
        // connectionMgr.connectionStore
        //     .lookupPassword(connectionInfo, false)
        //     .then(async (password) => {
        //         connectionInfo.password = password;

        //         const connectionDetails =
        //             connectionMgr.createConnectionDetails(connectionInfo);

        //         const connectionString =
        //             await connectionMgr.getConnectionString(
        //                 connectionDetails,
        //                 true,
        //                 true,
        //             );

        //         if (!connectionString || connectionString === "") {
        //             vscode.window.showErrorMessage(
        //                 "Unabled to find connection string for the connection",
        //             );
        //         } else {
        //             const databases =
        //                 await connectionMgr.listDatabases(connectionString);

        //             console.log(databases);
        //         }
        //     });

        // const uniqueConnectionLabels = Array.from(new Set(connectionLabels));

        super(
            context,
            vscodeWrapper,
            "schemaCompare",
            "schemaCompare",
            {
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

        this.connectionMgr.onActiveConnectionsChanged(() => {
            const activeServers = this.getActiveServersList();
            this.state.activeServers = activeServers;

            this.updateState();
        });
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

        let connectionProfile: IConnectionProfile | undefined = sourceContext
            ? (sourceContext.connectionInfo as IConnectionProfile)
            : undefined;

        if (connectionProfile) {
            source = await this.getEndpointInfoFromConnectionProfile(
                connectionProfile,
                sourceContext,
            );
        } else if (
            sourceContext &&
            (sourceContext as string) &&
            (sourceContext as string).endsWith(".dacpac")
        ) {
            source = this.getEndpointInfoFromDacpac(sourceContext as string);
        } else if (sourceContext) {
            source = await this.getEndpointInfoFromProject(
                sourceContext as string,
            );
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
        this.updateState();
    }

    private async getEndpointInfoFromConnectionProfile(
        connectionProfile: IConnectionProfile,
        sourceContext: any,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        let ownerUri =
            await this.connectionMgr.getUriForConnection(connectionProfile);
        let user = connectionProfile.user;
        if (!user) {
            user = loc.schemaCompare.defaultUserName;
        }

        const source = {
            endpointType: mssql.SchemaCompareEndpointType.Database,
            serverDisplayName: `${connectionProfile.server} (${user})`,
            serverName: connectionProfile.server,
            databaseName: ObjectExplorerUtils.getDatabaseName(sourceContext),
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

        return source;
    }

    private getEndpointInfoFromDacpac(
        sourceDacpac: string,
    ): mssql.SchemaCompareEndpointInfo {
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
            dataSchemaProvider:
                await this.getDatabaseSchemaProvider(projectFilePath),
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            packageFilePath: "",
            connectionDetails: undefined,
        };

        return source;
    }

    private async getProjectScriptFiles(
        projectFilePath: string,
    ): Promise<string[]> {
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

    private async getDatabaseSchemaProvider(
        projectFilePath: string,
    ): Promise<string> {
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
        this.registerReducer("listActiveServers", (state) => {
            const activeServers = this.getActiveServersList();

            state.activeServers = activeServers;
            this.updateState(state);

            return state;
        });

        this.registerReducer(
            "listDatabasesForActiveServer",
            async (state, payload) => {
                let databases: string[] = [];
                try {
                    databases = await this.connectionMgr.listDatabases(
                        payload.connectionUri,
                    );
                } catch (error) {
                    console.error("Error listing databases:", error);
                }

                state.databases = databases;
                this.updateState(state);

                return state;
            },
        );

        this.registerReducer("openAddNewConnectionDialog", (state) => {
            vscode.commands.executeCommand("mssql.addObjectExplorerPreview");

            return state;
        });

        this.registerReducer("selectFile", async (state, payload) => {
            let payloadFilePath = "";
            if (payload.endpoint) {
                payloadFilePath =
                    payload.endpoint.packageFilePath ||
                    payload.endpoint.projectFilePath;
            }

            const filters = {
                Files: [payload.fileType],
            };

            const filePath = await this.showOpenDialog(
                payloadFilePath,
                filters,
            );

            if (filePath) {
                const updatedEndpointInfo =
                    payload.fileType === "dacpac"
                        ? this.getEndpointInfoFromDacpac(filePath)
                        : await this.getEndpointInfoFromProject(filePath);

                state.auxiliaryEndpointInfo = updatedEndpointInfo;

                // if (payload.fileType === "dacpac") {
                //     if (payload.endpointType === "source") {
                //         state.sourceEndpointInfo = updatedEndpointInfo;
                //     } else {
                //         state.targetEndpointInfo = updatedEndpointInfo;
                //     }
                // }
                // else
                if (payload.fileType === "sqlproj") {
                    if (payload.endpointType === "source") {
                        // state.sourceEndpointInfo = updatedEndpointInfo;
                        // state.sourceEndpointInfo.dataSchemaProvider = "160";
                        /*
                        state.auxiliaryEndpointInfo.targetScripts = [
                            "c:\\DatabaseProjects\\SimpleProj\\Address.sql",
                        ];
                        */
                    } else {
                        // state.targetEndpointInfo = updatedEndpointInfo;
                        // state.targetEndpointInfo.dataSchemaProvider = "160";
                        /*
                        state.auxiliaryEndpointInfo.targetScripts = [
                            "c:\\DatabaseProjects\\SimpleProj2\\Address.sql",
                            "c:\\DatabaseProjects\\SimpleProj2\\Person.sql",
                        ];
                        */
                        state.auxiliaryEndpointInfo.extractTarget = 5;
                    }
                }

                this.updateState(state);
            }

            return state;
        });

        this.registerReducer(
            "confirmSelectedSchema",
            async (state, payload) => {
                if (payload.endpointType === "source") {
                    state.sourceEndpointInfo = state.auxiliaryEndpointInfo;
                } else {
                    if (
                        state.auxiliaryEndpointInfo.endpointType ===
                        mssql.SchemaCompareEndpointType.Project
                    ) {
                        state.auxiliaryEndpointInfo.extractTarget =
                            this.mapExtractTargetEnum(payload.folderStructure);
                    }
                    state.targetEndpointInfo = state.auxiliaryEndpointInfo;
                }
                state.auxiliaryEndpointInfo = undefined;

                this.updateState(state);

                return state;
            },
        );

        this.registerReducer("confirmSelectedDatabase", (state, payload) => {
            const connection =
                this.connectionMgr.activeConnections[
                    payload.serverConnectionUri
                ];

            const connectionProfile =
                connection.credentials as IConnectionProfile;

            let user = connectionProfile.user;
            if (!user) {
                user = loc.schemaCompare.defaultUserName;
            }

            const endpointInfo = {
                endpointType: mssql.SchemaCompareEndpointType.Database,
                serverDisplayName: `${connectionProfile.server} (${user})`,
                serverName: connectionProfile.server,
                databaseName: payload.databaseName,
                ownerUri: payload.serverConnectionUri,
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

            if (payload.endpointType === "source") {
                state.sourceEndpointInfo = endpointInfo;
            } else {
                state.targetEndpointInfo = endpointInfo;
            }

            this.updateState(state);

            return state;
        });

        this.registerReducer("setIntermediarySchemaOptions", async (state) => {
            state.intermediaryOptionsResult = deepClone(
                state.defaultDeploymentOptionsResult,
            );

            this.updateState(state);

            return state;
        });

        this.registerReducer(
            "intermediaryIncludeObjectTypesOptionsChanged",
            (state, payload) => {
                const deploymentOptions =
                    state.intermediaryOptionsResult.defaultDeploymentOptions;
                const excludeObjectTypeOptions =
                    deploymentOptions.excludeObjectTypes.value;

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
            },
        );

        this.registerReducer("confirmSchemaOptions", async (state, payload) => {
            state.defaultDeploymentOptionsResult.defaultDeploymentOptions =
                deepClone(
                    state.intermediaryOptionsResult.defaultDeploymentOptions,
                );
            state.intermediaryOptionsResult = undefined;

            this.updateState(state);

            const yesItem: vscode.MessageItem = {
                title: loc.schemaCompare.yes,
            };

            const noItem: vscode.MessageItem = {
                title: loc.schemaCompare.no,
                isCloseAffordance: true,
            };

            sendActionEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.OptionsChanged,
            );

            if (payload.optionsChanged) {
                vscode.window
                    .showInformationMessage(
                        loc.schemaCompare.optionsChangedMessage,
                        { modal: true },
                        yesItem,
                        noItem,
                    )
                    .then(async (result) => {
                        if (result.title === loc.schemaCompare.yes) {
                            const payload = {
                                sourceEndpointInfo: state.sourceEndpointInfo,
                                targetEndpointInfo: state.targetEndpointInfo,
                                deploymentOptions:
                                    state.defaultDeploymentOptionsResult
                                        .defaultDeploymentOptions,
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

        this.registerReducer(
            "intermediaryGeneralOptionsChanged",
            (state, payload) => {
                const generalOptionsDictionary =
                    state.intermediaryOptionsResult.defaultDeploymentOptions
                        .booleanOptionsDictionary;
                generalOptionsDictionary[payload.key].value =
                    !generalOptionsDictionary[payload.key].value;

                this.updateState(state);
                return state;
            },
        );

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
                    loc.schemaCompare.generateScriptErrorMessage(
                        result.errorMessage,
                    ),
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
            const yes = loc.schemaCompare.yes;
            const result = await vscode.window.showWarningMessage(
                loc.schemaCompare.areYouSureYouWantToUpdateTheTarget,
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
                    publishResult = await this.publishChangesToProject(state);
                    break;

                case mssql.SchemaCompareEndpointType.Dacpac: // Dacpac is an invalid publish target
                default:
                    throw new Error(
                        `Unsupported SchemaCompareEndpointType: ${getSchemaCompareEndpointTypeString(state.targetEndpointInfo.endpointType)}`,
                    );
            }

            if (
                !publishResult ||
                !publishResult.success ||
                publishResult.errorMessage
            ) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: publishResult.errorMessage,
                    operationId: this.operationId,
                    targetType: getSchemaCompareEndpointTypeString(
                        state.targetEndpointInfo.endpointType,
                    ),
                });

                vscode.window.showErrorMessage(
                    loc.schemaCompare.schemaCompareApplyFailed(
                        publishResult.errorMessage,
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

        this.registerReducer(
            "publishDatabaseChanges",
            async (state, payload) => {
                const result = await publishDatabaseChanges(
                    this.operationId,
                    TaskExecutionMode.execute,
                    payload,
                    this.schemaCompareService,
                );

                state.publishDatabaseChangesResultStatus = result;
                return state;
            },
        );

        this.registerReducer(
            "publishProjectChanges",
            async (state, payload) => {
                const result = await publishProjectChanges(
                    this.operationId,
                    payload,
                    this.schemaCompareService,
                );

                state.schemaComparePublishProjectResult = result;
                return state;
            },
        );

        this.registerReducer("resetOptions", async (state) => {
            const result = await getDefaultOptions(this.schemaCompareService);

            // May not always want to reset options back to default until OK is clicked.
            // state.defaultDeploymentOptionsResult = result;
            state.intermediaryOptionsResult = deepClone(result);
            this.updateState(state);

            sendActionEvent(
                TelemetryViews.SchemaCompare,
                TelemetryActions.ResetOptions,
            );

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
                        const index =
                            state.schemaCompareResult.differences.findIndex(
                                (d) =>
                                    d.sourceValue === difference.sourceValue &&
                                    d.targetValue === difference.targetValue &&
                                    d.updateAction ===
                                        difference.updateAction &&
                                    d.name === difference.name,
                            );

                        if (index !== -1) {
                            state.schemaCompareResult.differences[
                                index
                            ].included = payload.includeRequest;
                        }
                    });
                }

                this.updateState(state);
            }

            return state;
        });

        this.registerReducer("openScmp", async (state) => {
            const startingFilePath = await getStartingPathForOpenDialog();

            const fileDialogFilters = {
                "scmp Files": ["scmp"],
            };

            const selectedFilePath = await this.showOpenDialog(
                startingFilePath,
                fileDialogFilters,
            );

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

            const result = await openScmp(
                selectedFilePath,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    loc.schemaCompare.openScmpErrorMessage(result.errorMessage),
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
            state.scmpSourceExcludes = result.excludedSourceElements;
            state.scmpTargetExcludes = result.excludedTargetElements;
            state.sourceTargetSwitched =
                result.originalTargetName !==
                state.targetEndpointInfo.databaseName;

            endActivity.end(ActivityStatus.Succeeded, {
                operationId: this.operationId,
                elapsedTime: (Date.now() - startTime).toString(),
            });

            state.schemaCompareOpenScmpResult = result;
            this.updateState(state);

            return state;
        });

        this.registerReducer("saveScmp", async (state) => {
            const saveFilePath = await this.showSaveDialog();

            if (!saveFilePath) {
                return state;
            }

            const sourceExcludes: mssql.SchemaCompareObjectId[] =
                this.convertExcludesToObjectIds(state.originalSourceExcludes);
            const targetExcludes: mssql.SchemaCompareObjectId[] =
                this.convertExcludesToObjectIds(state.originalTargetExcludes);

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
                    loc.schemaCompare.saveScmpErrorMessage(result.errorMessage),
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

            const result = await cancel(
                this.operationId,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                endActivity.endFailed(undefined, false, undefined, undefined, {
                    errorMessage: result.errorMessage,
                    operationId: this.operationId,
                });

                vscode.window.showErrorMessage(
                    loc.schemaCompare.cancelErrorMessage(result.errorMessage),
                );
            }

            endActivity.end(ActivityStatus.Succeeded);

            state.cancelResultStatus = result;
            return state;
        });
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

    private getActiveServersList(): { [connectionUri: string]: string } {
        const activeServers: { [connectionUri: string]: string } = {};
        let seenServerNames = new Set<string>();

        const activeConnections = this.connectionMgr.activeConnections;
        Object.keys(activeConnections).forEach((connectionUri) => {
            let serverName =
                activeConnections[connectionUri].credentials.server;

            if (!seenServerNames.has(serverName)) {
                activeServers[connectionUri] = serverName;
                seenServerNames.add(serverName);
            }
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
        const endActivity = startActivity(
            TelemetryViews.SchemaCompare,
            TelemetryActions.Compare,
            this.operationId,
            {
                startTime: Date.now().toString(),
            },
        );

        const result = await compare(
            this.operationId,
            TaskExecutionMode.execute,
            payload,
            this.schemaCompareService,
        );

        if (!result || !result.success) {
            endActivity.endFailed(undefined, false, undefined, undefined, {
                errorMessage: result.errorMessage,
                operationId: this.operationId,
            });

            vscode.window.showErrorMessage(
                loc.schemaCompare.compareErrorMessage(result.errorMessage),
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

    private async showOpenDialog(
        filePath: string,
        filters: { [name: string]: string[] },
    ): Promise<string | undefined> {
        const startingFilePath = await getStartingPathForOpenDialog(filePath);

        const selectedFilePath = await showOpenDialog(
            startingFilePath,
            filters,
        );

        return selectedFilePath;
    }

    private async showSaveDialog(): Promise<string | undefined> {
        const startingFilePath = await getStartingPathForOpenDialog();

        const selectedFilePath = await showSaveDialog(startingFilePath);

        return selectedFilePath;
    }

    private async constructEndpointInfo(
        endpoint: mssql.SchemaCompareEndpointInfo,
        caller: string,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        let ownerUri;
        let endpointInfo;
        if (
            endpoint &&
            endpoint.endpointType === mssql.SchemaCompareEndpointType.Database
        ) {
            // ownerUri = await this.verifyConnectionAndGetOwnerUri(
            //     endpoint,
            //     caller,
            // );
        }

        if (ownerUri) {
            endpointInfo = endpoint;
            endpointInfo.ownerUri = ownerUri;
        } else if (
            endpoint.endpointType === mssql.SchemaCompareEndpointType.Project
        ) {
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
                    endpoint.endpointType ===
                    mssql.SchemaCompareEndpointType.Database
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

    private getAllObjectTypeDifferences(
        result: mssql.SchemaCompareResult,
    ): DiffEntry[] {
        // let data = [];
        let finalDifferences: DiffEntry[] = [];
        let differences = result.differences;
        if (differences) {
            differences.forEach((difference) => {
                if (
                    difference.differenceType ===
                    mssql.SchemaDifferenceType.Object
                ) {
                    if (
                        (difference.sourceValue !== null &&
                            difference.sourceValue.length > 0) ||
                        (difference.targetValue !== null &&
                            difference.targetValue.length > 0)
                    ) {
                        finalDifferences.push(difference); // Add only non-null changes to ensure index does not mismatch between dictionay and UI - #6234
                        // let include: boolean = true;
                        // data.push([
                        //     difference.name,
                        //     this.createName(difference.sourceValue),
                        //     include,
                        //     updateAction,
                        //     this.createName(difference.targetValue),
                        // ]);
                    }
                }
            });
        }

        return finalDifferences;

        // result.differences = finalDifferences;
        // return data;
    }

    private async publishChangesToProject(
        state: SchemaCompareWebViewState,
    ): Promise<mssql.ResultStatus> {
        const result: mssql.ResultStatus = await vscode.commands.executeCommand(
            sqlDatabaseProjectsPublishChanges,
            this.operationId,
            state.targetEndpointInfo.projectFilePath,
            state.targetEndpointInfo.extractTarget,
        );

        if (!result.success) {
            vscode.window.showErrorMessage(
                loc.schemaCompare.thereWasAnErrorUpdatingTheProject,
            );
        }

        return result;
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
                nameParts: value.sourceValue
                    ? value.sourceValue
                    : value.targetValue,
                sqlObjectType: `Microsoft.Data.Tools.Schema.Sql.SchemaModel.${value.name}`,
            });
        });

        return result;
    }

    // private async verifyConnectionAndGetOwnerUri(
    //     endpoint: mssql.SchemaCompareEndpointInfo,
    //     caller: string,
    // ): Promise<string | undefined> {
    //     let ownerUri = undefined;

    //     if (
    //         endpoint.endpointType ===
    //             mssql.SchemaCompareEndpointType.Database &&
    //         endpoint.connectionDetails
    //     ) {
    //         let connectionProfile = this.connectionInfoToConnectionProfile(
    //             endpoint.connectionDetails,
    //         );
    //         let connection = await azdata.connection.connect(
    //             connectionProfile,
    //             false,
    //             false,
    //         );

    //         if (connection) {
    //             ownerUri = await azdata.connection.getUriForConnection(
    //                 connection.connectionId,
    //             );

    //             if (!ownerUri) {
    //                 let connectionList =
    //                     await azdata.connection.getConnections(true);

    //                 let userConnection;
    //                 userConnection = connectionList.find(
    //                     (connection) =>
    //                         endpoint.connectionDetails["authenticationType"] ===
    //                             azdata.connection.AuthenticationType.SqlLogin &&
    //                         endpoint.connectionDetails["serverName"] ===
    //                             connection.options.server &&
    //                         endpoint.connectionDetails["userName"] ===
    //                             connection.options.user &&
    //                         (endpoint.connectionDetails[
    //                             "databaseName"
    //                         ].toLowerCase() ===
    //                             connection.options.database.toLowerCase() ||
    //                             connection.options.database.toLowerCase() ===
    //                                 "master"),
    //                 );

    //                 if (userConnection === undefined) {
    //                     const getConnectionString =
    //                         loc.getConnectionString(caller);
    //                     // need only yes button - since the modal dialog has a default cancel
    //                     let result = await vscode.window.showWarningMessage(
    //                         getConnectionString,
    //                         { modal: true },
    //                         loc.YesButtonText,
    //                     );
    //                     if (result === loc.YesButtonText) {
    //                         userConnection =
    //                             await azdata.connection.openConnectionDialog(
    //                                 undefined,
    //                                 connectionProfile,
    //                             );
    //                     }
    //                 }

    //                 if (userConnection !== undefined) {
    //                     ownerUri = await azdata.connection.getUriForConnection(
    //                         userConnection.connectionId,
    //                     );
    //                 }
    //             }
    //             if (!ownerUri && connection.errorMessage) {
    //                 vscode.window.showErrorMessage(connection.errorMessage);
    //             }
    //         }
    //     }
    //     return ownerUri;
    // }

    // private connectionInfoToConnectionProfile(details: mssql.IConnectionInfo): IConnectionProfile {
    //     return {
    //         serverName: details['serverName'],
    //         databaseName: details['databaseName'],
    //         authenticationType: details['authenticationType'],
    //         providerName: 'MSSQL',
    //         connectionName: '',
    //         userName: details['userName'],
    //         password: details['password'],
    //         savePassword: false,
    //         groupFullName: undefined,
    //         saveProfile: true,
    //         id: undefined,
    //         groupId: undefined,
    //         options: details['options']
    //     };
    // }

    // private shouldDiffBeIncluded(diff: mssql.DiffEntry): boolean {
    //     let key =
    //         diff.sourceValue && diff.sourceValue.length > 0
    //             ? this.createName(diff.sourceValue)
    //             : this.createName(diff.targetValue);
    //     if (key) {
    //         if (
    //             this.sourceTargetSwitched === true &&
    //             (this.originalTargetExcludes.has(key) ||
    //                 this.hasExcludeEntry(this.scmpTargetExcludes, key))
    //         ) {
    //             this.originalTargetExcludes.set(key, diff);
    //             return false;
    //         }
    //         if (
    //             this.sourceTargetSwitched === false &&
    //             (this.originalSourceExcludes.has(key) ||
    //                 this.hasExcludeEntry(this.scmpSourceExcludes, key))
    //         ) {
    //             this.originalSourceExcludes.set(key, diff);
    //             return false;
    //         }
    //         return true;
    //     }
    //     return true;
    // }

    // private createName(nameParts: string[]): string {
    //     if (!nameParts || nameParts.length === 0) {
    //         return "";
    //     }
    //     return nameParts.join(".");
    // }

    // private hasExcludeEntry(
    //     collection: mssql.SchemaCompareObjectId[],
    //     entryName: string,
    // ): boolean {
    //     let found = false;
    //     if (collection) {
    //         const index = collection.findIndex(
    //             (e) => this.createName(e.nameParts) === entryName,
    //         );
    //         found = index !== -1;
    //     }
    //     return found;
    // }
}
