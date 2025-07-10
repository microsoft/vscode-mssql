/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as events from "events";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import { AzureResourceController } from "../azure/azureResourceController";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import SqlToolsServerClient from "../languageservice/serviceclient";
import * as ConnInfo from "../models/connectionInfo";
import {
    CompletionExtensionParams,
    CompletionExtLoadRequest,
    RebuildIntelliSenseNotification,
} from "../models/contracts/languageService";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import * as Utils from "../models/utils";
import { AccountSignInTreeNode } from "../objectExplorer/nodes/accountSignInTreeNode";
import { ConnectTreeNode } from "../objectExplorer/nodes/connectTreeNode";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import CodeAdapter from "../prompts/adapter";
import { IPrompter } from "../prompts/question";
import { Deferred } from "../protocol";
import { QueryHistoryNode } from "../queryHistory/queryHistoryNode";
import { QueryHistoryProvider } from "../queryHistory/queryHistoryProvider";
import { ScriptingService } from "../scripting/scriptingService";
import { AzureAccountService } from "../services/azureAccountService";
import { AzureResourceService } from "../services/azureResourceService";
import { DacFxService } from "../services/dacFxService";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { SchemaCompareService } from "../services/schemaCompareService";
import { SqlTasksService } from "../services/sqlTasksService";
import StatusView from "../views/statusView";
import { IConnectionGroup, IConnectionProfile, ISelectionData } from "./../models/interfaces";
import ConnectionManager from "./connectionManager";
import UntitledSqlDocumentService from "./untitledSqlDocumentService";
import VscodeWrapper from "./vscodeWrapper";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { TableDesignerService } from "../services/tableDesignerService";
import { TableDesignerWebviewController } from "../tableDesigner/tableDesignerWebviewController";
import { ConnectionDialogWebviewController } from "../connectionconfig/connectionDialogWebviewController";
import { ObjectExplorerFilter } from "../objectExplorer/objectExplorerFilter";
import { ExecutionPlanService } from "../services/executionPlanService";
import { ExecutionPlanWebviewController } from "./executionPlanWebviewController";
import { QueryResultWebviewController } from "../queryResult/queryResultWebViewController";
import { MssqlProtocolHandler } from "../mssqlProtocolHandler";
import { getErrorMessage, isIConnectionInfo } from "../utils/utils";
import { getStandardNPSQuestions, UserSurvey } from "../nps/userSurvey";
import { ExecutionPlanOptions } from "../models/contracts/queryExecute";
import { ObjectExplorerDragAndDropController } from "../objectExplorer/objectExplorerDragAndDropController";
import { SchemaDesignerService } from "../services/schemaDesignerService";
import store from "../queryResult/singletonStore";
import { SchemaCompareWebViewController } from "../schemaCompare/schemaCompareWebViewController";
import { SchemaCompare } from "../constants/locConstants";
import { SchemaDesignerWebviewManager } from "../schemaDesigner/schemaDesignerWebviewManager";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { CopilotService } from "../services/copilotService";
import * as Prompts from "../copilot/prompts";
import { CreateSessionResult } from "../objectExplorer/objectExplorerService";
import { SqlCodeLensProvider } from "../queryResult/sqlCodeLensProvider";
import { ConnectionSharingService } from "../connectionSharing/connectionSharingService";
import { ShowSchemaTool } from "../copilot/tools/showSchemaTool";
import { ConnectTool } from "../copilot/tools/connectTool";
import { ListServersTool } from "../copilot/tools/listServersTool";
import { DisconnectTool } from "../copilot/tools/disconnectTool";
import { GetConnectionDetailsTool } from "../copilot/tools/getConnectionDetailsTool";
import { ChangeDatabaseTool } from "../copilot/tools/changeDatabaseTool";
import { ListDatabasesTool } from "../copilot/tools/listDatabasesTool";
import { ListTablesTool } from "../copilot/tools/listTablesTool";
import { ListSchemasTool } from "../copilot/tools/listSchemasTool";
import { ListViewsTool } from "../copilot/tools/listViewsTool";
import { ListFunctionsTool } from "../copilot/tools/listFunctionsTool";
import { ConnectionGroupNode } from "../objectExplorer/nodes/connectionGroupNode";
import { ConnectionGroupWebviewController } from "./connectionGroupWebviewController";
import { ContainerDeploymentWebviewController } from "../containerDeployment/containerDeploymentWebviewController";
import {
    deleteContainer,
    prepareForDockerContainerCommand,
    stopContainer,
} from "../containerDeployment/dockerUtils";
import { StateChangeNotification } from "../sharedInterfaces/webview";
import { QueryResultWebviewState } from "../sharedInterfaces/queryResult";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";

/**
 * The main controller class that initializes the extension
 */
export default class MainController implements vscode.Disposable {
    private _context: vscode.ExtensionContext;
    private _event: events.EventEmitter = new events.EventEmitter();
    private _outputContentProvider: SqlOutputContentProvider;
    private _queryResultWebviewController: QueryResultWebviewController;
    private _statusview: StatusView;
    private _connectionMgr: ConnectionManager;
    private _prompter: IPrompter;
    private _vscodeWrapper: VscodeWrapper;
    private _initialized: boolean = false;
    private _lastSavedUri: string | undefined;
    private _lastSavedTimer: Utils.Timer | undefined;
    private _lastOpenedUri: string | undefined;
    private _lastOpenedTimer: Utils.Timer | undefined;
    private _untitledSqlDocumentService: UntitledSqlDocumentService;
    private _objectExplorerProvider: ObjectExplorerProvider;
    private _queryHistoryProvider: QueryHistoryProvider;
    private _scriptingService: ScriptingService;
    private _queryHistoryRegistered: boolean = false;
    private _executionPlanOptions: ExecutionPlanOptions = {
        includeEstimatedExecutionPlanXml: false,
        includeActualExecutionPlanXml: false,
    };
    public sqlTasksService: SqlTasksService;
    public dacFxService: DacFxService;
    public schemaCompareService: SchemaCompareService;
    public sqlProjectsService: SqlProjectsService;
    public azureAccountService: AzureAccountService;
    public azureResourceService: AzureResourceService;
    public tableDesignerService: TableDesignerService;
    public copilotService: CopilotService;
    public configuration: vscode.WorkspaceConfiguration;
    public objectExplorerTree: vscode.TreeView<TreeNodeInfo>;
    public executionPlanService: ExecutionPlanService;
    public schemaDesignerService: SchemaDesignerService;
    public connectionSharingService: ConnectionSharingService;

    /**
     * The main controller constructor
     * @constructor
     */
    constructor(
        context: vscode.ExtensionContext,
        connectionManager?: ConnectionManager,
        vscodeWrapper?: VscodeWrapper,
    ) {
        this._context = context;
        if (connectionManager) {
            this._connectionMgr = connectionManager;
        }
        this._vscodeWrapper = vscodeWrapper ?? new VscodeWrapper();
        this._untitledSqlDocumentService = new UntitledSqlDocumentService(this._vscodeWrapper);
        this.configuration = vscode.workspace.getConfiguration();
        UserSurvey.createInstance(this._context, this._vscodeWrapper);
    }

    /**
     * Helper method to setup command registrations
     */
    public registerCommand(command: string): void {
        const self = this;
        this._context.subscriptions.push(
            vscode.commands.registerCommand(command, () => self._event.emit(command)),
        );
    }

    /**
     * Helper method to setup command registrations with arguments
     */
    private registerCommandWithArgs(command: string): void {
        const self = this;
        this._context.subscriptions.push(
            vscode.commands.registerCommand(command, (args: any) => {
                self._event.emit(command, args);
            }),
        );
    }

    /**
     * Disposes the controller
     */
    dispose(): void {
        void this.deactivate();
    }

    /**
     * Deactivates the extension
     */
    public async deactivate(): Promise<void> {
        Utils.logDebug("de-activated.");
        await this.onDisconnect();
        this._statusview.dispose();
    }

    public get isExperimentalEnabled(): boolean {
        return this.configuration.get(Constants.configEnableExperimentalFeatures);
    }

    public get isRichExperiencesEnabled(): boolean {
        return this.configuration.get(Constants.configEnableRichExperiences);
    }

    public get useLegacyConnectionExperience(): boolean {
        return this.configuration.get(Constants.configUseLegacyConnectionExperience);
    }

    public get useLegacyQueryResultExperience(): boolean {
        return this.configuration.get(Constants.configUseLegacyQueryResultExperience);
    }

    /**
     * Initializes the extension
     */
    public async activate(): Promise<boolean> {
        // initialize the language client then register the commands
        const didInitialize = await this.initialize();
        if (didInitialize) {
            // register VS Code commands
            this.registerCommand(Constants.cmdConnect);
            this._event.on(Constants.cmdConnect, () => {
                void this.runAndLogErrors(this.onNewConnection());
            });
            this.registerCommand(Constants.cmdDisconnect);
            this._event.on(Constants.cmdDisconnect, () => {
                void this.runAndLogErrors(this.onDisconnect());
            });
            this.registerCommand(Constants.cmdRunQuery);
            this._event.on(Constants.cmdRunQuery, () => {
                void UserSurvey.getInstance().promptUserForNPSFeedback();
                this._executionPlanOptions.includeEstimatedExecutionPlanXml = false;
                void this.onRunQuery();
            });
            this.registerCommand(Constants.cmdManageConnectionProfiles);
            this._event.on(Constants.cmdManageConnectionProfiles, async () => {
                await this.onManageProfiles();
            });
            this.registerCommand(Constants.cmdClearPooledConnections);
            this._event.on(Constants.cmdClearPooledConnections, async () => {
                await this.onClearPooledConnections();
            });
            this.registerCommand(Constants.cmdDeployLocalDockerContainer);
            this._event.on(Constants.cmdDeployLocalDockerContainer, () => {
                this.onDeployContainer();
            });
            this.registerCommand(Constants.cmdRunCurrentStatement);
            this._event.on(Constants.cmdRunCurrentStatement, () => {
                void this.onRunCurrentStatement();
            });
            this.registerCommand(Constants.cmdChangeDatabase);
            this._event.on(Constants.cmdChangeDatabase, () => {
                void this.runAndLogErrors(this.onChooseDatabase());
            });
            this.registerCommand(Constants.cmdChooseDatabase);
            this._event.on(Constants.cmdChooseDatabase, () => {
                void this.runAndLogErrors(this.onChooseDatabase());
            });
            this.registerCommand(Constants.cmdChooseLanguageFlavor);
            this._event.on(Constants.cmdChooseLanguageFlavor, () => {
                void this.runAndLogErrors(this.onChooseLanguageFlavor());
            });
            this.registerCommand(Constants.cmdLaunchUserFeedback);
            this._event.on(Constants.cmdLaunchUserFeedback, async () => {
                await UserSurvey.getInstance().launchSurvey("nps", getStandardNPSQuestions());
            });
            this.registerCommand(Constants.cmdCancelQuery);
            this._event.on(Constants.cmdCancelQuery, () => {
                this.onCancelQuery();
            });
            this.registerCommand(Constants.cmdShowGettingStarted);
            this._event.on(Constants.cmdShowGettingStarted, async () => {
                await this.launchGettingStartedPage();
            });
            this.registerCommand(Constants.cmdNewQuery);
            this._event.on(Constants.cmdNewQuery, () => this.runAndLogErrors(this.onNewQuery()));
            this.registerCommand(Constants.cmdRebuildIntelliSenseCache);
            this._event.on(Constants.cmdRebuildIntelliSenseCache, () => {
                this.onRebuildIntelliSense();
            });
            this.registerCommandWithArgs(Constants.cmdLoadCompletionExtension);
            this._event.on(
                Constants.cmdLoadCompletionExtension,
                (params: CompletionExtensionParams) => {
                    this.onLoadCompletionExtension(params);
                },
            );
            this.registerCommand(Constants.cmdToggleSqlCmd);
            this._event.on(Constants.cmdToggleSqlCmd, async () => {
                await this.onToggleSqlCmd();
            });
            this.registerCommand(Constants.cmdAadRemoveAccount);
            this._event.on(Constants.cmdAadRemoveAccount, () =>
                this.removeAadAccount(this._prompter),
            );
            this.registerCommand(Constants.cmdAadAddAccount);
            this._event.on(Constants.cmdAadAddAccount, () => this.addAadAccount());
            this.registerCommandWithArgs(Constants.cmdClearAzureTokenCache);
            this._event.on(Constants.cmdClearAzureTokenCache, () => this.onClearAzureTokenCache());
            this.registerCommand(Constants.cmdShowExecutionPlanInResults);
            this._event.on(Constants.cmdShowExecutionPlanInResults, () => {
                this._executionPlanOptions.includeEstimatedExecutionPlanXml = true;
                void this.onRunQuery();
            });
            this.registerCommand(Constants.cmdEnableActualPlan);
            this._event.on(Constants.cmdEnableActualPlan, () => {
                this.onToggleActualPlan(true);
            });
            this.registerCommand(Constants.cmdDisableActualPlan);
            this._event.on(Constants.cmdDisableActualPlan, () => {
                this.onToggleActualPlan(false);
            });

            this._context.subscriptions.push(
                vscode.languages.registerCodeLensProvider(
                    { language: "sql" },
                    new SqlCodeLensProvider(this._connectionMgr),
                ),
            );

            this.initializeObjectExplorer();

            this.registerCommandWithArgs(Constants.cmdConnectObjectExplorerProfile);
            this._event.on(
                Constants.cmdConnectObjectExplorerProfile,
                (profile: IConnectionProfile) => {
                    this._connectionMgr.connectionUI
                        .saveProfile(profile)
                        .then(async () => {
                            await this.createObjectExplorerSession(profile);
                        })
                        .catch((err) => {
                            this._vscodeWrapper.showErrorMessage(err);
                        });
                },
            );

            this.registerCommand(Constants.cmdObjectExplorerEnableGroupBySchemaCommand);
            this._event.on(Constants.cmdObjectExplorerEnableGroupBySchemaCommand, () => {
                vscode.workspace
                    .getConfiguration()
                    .update(Constants.cmdObjectExplorerGroupBySchemaFlagName, true, true);
            });
            this.registerCommand(Constants.cmdObjectExplorerDisableGroupBySchemaCommand);
            this._event.on(Constants.cmdObjectExplorerDisableGroupBySchemaCommand, () => {
                vscode.workspace
                    .getConfiguration()
                    .update(Constants.cmdObjectExplorerGroupBySchemaFlagName, false, true);
            });

            this.registerCommand(Constants.cmdEnableRichExperiencesCommand);
            this._event.on(Constants.cmdEnableRichExperiencesCommand, async () => {
                await this._vscodeWrapper
                    .getConfiguration()
                    .update(
                        Constants.configEnableRichExperiences,
                        true,
                        vscode.ConfigurationTarget.Global,
                    );

                // reload immediately so that the changes take effect
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            });

            const launchEditorChatWithPrompt = async (
                prompt: string,
                selectionPrompt: string | undefined = undefined,
            ) => {
                const activeEditor = vscode.window.activeTextEditor;
                const uri = activeEditor?.document.uri.toString();
                const promptToUse =
                    activeEditor?.selection.isEmpty || !selectionPrompt ? prompt : selectionPrompt;
                if (!uri) {
                    // No active editor, so don't open chat
                    // TODO: Show a message to the user
                    return;
                }
                // create new connection
                if (!this.connectionManager.isConnected(uri)) {
                    await this.onNewConnection();
                    sendActionEvent(TelemetryViews.QueryEditor, TelemetryActions.CreateConnection);
                }

                // Open chat window
                vscode.commands.executeCommand("workbench.action.chat.open", promptToUse);
            };

            this.registerCommandWithArgs(Constants.cmdChatWithDatabase);
            this._event.on(Constants.cmdChatWithDatabase, async (treeNodeInfo: TreeNodeInfo) => {
                sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ChatWithDatabase);

                const connectionCredentials = Object.assign({}, treeNodeInfo.connectionProfile);
                const databaseName = ObjectExplorerUtils.getDatabaseName(treeNodeInfo);
                if (
                    databaseName !== connectionCredentials.database &&
                    databaseName !== LocalizedConstants.defaultDatabaseLabel
                ) {
                    connectionCredentials.database = databaseName;
                } else if (databaseName === LocalizedConstants.defaultDatabaseLabel) {
                    connectionCredentials.database = "";
                }

                // Check if the active document already has this database as a connection.
                var alreadyActive = false;
                let activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const uri = activeEditor.document.uri.toString();
                    const connection = this._connectionMgr.getConnectionInfo(uri);
                    if (connection) {
                        if (
                            connection.credentials.user === connectionCredentials.user &&
                            connection.credentials.database === connectionCredentials.database
                        ) {
                            alreadyActive = true;
                        }
                    }
                }

                if (!alreadyActive) {
                    treeNodeInfo.updateConnectionProfile(connectionCredentials);
                    await this.onNewQuery(treeNodeInfo);

                    // Check if the new editor was created
                    activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const documentText = activeEditor.document.getText();
                        if (documentText.length === 0) {
                            // The editor is empty; safe to insert text
                            const server = connectionCredentials.server;
                            await activeEditor.edit((editBuilder) => {
                                editBuilder.insert(
                                    new vscode.Position(0, 0),
                                    `-- @${Constants.mssqlChatParticipantName} Chat Query Editor (${server}:${connectionCredentials.database}:${connectionCredentials.user})\n`,
                                );
                            });
                        } else {
                            // The editor already contains text
                            console.warn("Chat with database: unable to open editor");
                        }
                    } else {
                        // The editor was somehow not created
                        this._vscodeWrapper.showErrorMessage(
                            "Chat with database: unable to open editor",
                        );
                    }
                }

                if (activeEditor) {
                    // Open chat window
                    vscode.commands.executeCommand(
                        "workbench.action.chat.open",
                        `@${Constants.mssqlChatParticipantName} Hello!`,
                    );
                }
            });

            this.registerCommandWithArgs(Constants.cmdChatWithDatabaseInAgentMode);
            this._event.on(
                Constants.cmdChatWithDatabaseInAgentMode,
                async (treeNodeInfo: TreeNodeInfo) => {
                    sendActionEvent(
                        TelemetryViews.MssqlCopilot,
                        TelemetryActions.ChatWithDatabaseInAgentMode,
                    );

                    const connectionCredentials = Object.assign({}, treeNodeInfo.connectionProfile);
                    const databaseName = ObjectExplorerUtils.getDatabaseName(treeNodeInfo);
                    if (
                        databaseName !== connectionCredentials.database &&
                        databaseName !== LocalizedConstants.defaultDatabaseLabel
                    ) {
                        connectionCredentials.database = databaseName;
                    } else if (databaseName === LocalizedConstants.defaultDatabaseLabel) {
                        connectionCredentials.database = "";
                    }
                    vscode.commands.executeCommand(
                        "workbench.action.chat.openAgent",
                        `Connect to ${connectionCredentials.server},${connectionCredentials.database}${connectionCredentials.profileName ? ` using profile ${connectionCredentials.profileName}` : ""}.`,
                    );
                },
            );

            // -- EXPLAIN QUERY --
            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdExplainQuery, async () => {
                    sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.ExplainQuery);

                    await launchEditorChatWithPrompt(
                        Prompts.explainQueryPrompt,
                        Prompts.explainQuerySelectionPrompt,
                    );
                }),
            );

            // -- REWRITE QUERY --
            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdRewriteQuery, async () => {
                    sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.RewriteQuery);

                    await launchEditorChatWithPrompt(
                        Prompts.rewriteQueryPrompt,
                        Prompts.rewriteQuerySelectionPrompt,
                    );
                }),
            );

            // -- ANALYZE QUERY PERFORMANCE --
            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdAnalyzeQueryPerformance, async () => {
                    sendActionEvent(
                        TelemetryViews.MssqlCopilot,
                        TelemetryActions.AnalyzeQueryPerformance,
                    );

                    await launchEditorChatWithPrompt(Prompts.analyzeQueryPerformancePrompt);
                }),
            );

            this.initializeQueryHistory();

            this.sqlTasksService = new SqlTasksService(
                SqlToolsServerClient.instance,
                this._untitledSqlDocumentService,
            );
            this.dacFxService = new DacFxService(SqlToolsServerClient.instance);
            this.sqlProjectsService = new SqlProjectsService(SqlToolsServerClient.instance);
            this.schemaCompareService = new SchemaCompareService(SqlToolsServerClient.instance);
            const azureResourceController = new AzureResourceController();
            this.azureAccountService = new AzureAccountService(
                this._connectionMgr.azureController,
                this._connectionMgr.accountStore,
            );
            this.azureResourceService = new AzureResourceService(
                this._connectionMgr.azureController,
                azureResourceController,
                this._connectionMgr.accountStore,
            );
            this.tableDesignerService = new TableDesignerService(SqlToolsServerClient.instance);
            this.executionPlanService = new ExecutionPlanService(SqlToolsServerClient.instance);
            this.copilotService = new CopilotService(SqlToolsServerClient.instance);

            this._queryResultWebviewController.setExecutionPlanService(this.executionPlanService);
            this._queryResultWebviewController.setUntitledDocumentService(
                this._untitledSqlDocumentService,
            );

            this.schemaDesignerService = new SchemaDesignerService(SqlToolsServerClient.instance);

            this.connectionSharingService = new ConnectionSharingService(
                this._context,
                this._connectionMgr.client,
                this._connectionMgr,
                this._vscodeWrapper,
                this._scriptingService,
            );

            const providerInstance = new this.ExecutionPlanCustomEditorProvider(
                this._context,
                this._vscodeWrapper,
                this.executionPlanService,
                this._untitledSqlDocumentService,
            );
            vscode.window.registerCustomEditorProvider("mssql.executionPlanView", providerInstance);

            const self = this;
            const uriHandler: vscode.UriHandler = {
                async handleUri(uri: vscode.Uri): Promise<void> {
                    const mssqlProtocolHandler = new MssqlProtocolHandler(
                        self._connectionMgr.client,
                    );

                    const connectionInfo = await mssqlProtocolHandler.handleUri(uri);

                    vscode.commands.executeCommand(Constants.cmdAddObjectExplorer, connectionInfo);
                },
            };
            vscode.window.registerUriHandler(uriHandler);

            // Add handlers for VS Code generated commands
            this._vscodeWrapper.onDidCloseTextDocument(
                async (params) => await this.onDidCloseTextDocument(params),
            );

            this._vscodeWrapper.onDidOpenTextDocument((params) =>
                this.onDidOpenTextDocument(params),
            );

            this._vscodeWrapper.onDidChangeActiveTextEditor((params) =>
                this.onDidChangeActiveTextEditor(params),
            );

            this._vscodeWrapper.onDidSaveTextDocument((params) =>
                this.onDidSaveTextDocument(params),
            );
            this._vscodeWrapper.onDidChangeConfiguration((params) =>
                this.onDidChangeConfiguration(params),
            );

            this.registerLanguageModelTools();

            return true;
        }
    }

    /**
     * Helper method to register all language model tools
     */
    private registerLanguageModelTools(): void {
        // Register mssql_connect tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotConnectToolName,
                new ConnectTool(this.connectionManager),
            ),
        );

        // Register mssql_disconnect tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotDisconnectToolName,
                new DisconnectTool(this.connectionManager),
            ),
        );

        // Register mssql_list_servers tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListServersToolName,
                new ListServersTool(this.connectionManager),
            ),
        );

        // Register mssql_list_databases tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListDatabasesToolName,
                new ListDatabasesTool(this.connectionManager),
            ),
        );

        // Register mssql_get_connection_details tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotGetConnectionDetailsToolName,
                new GetConnectionDetailsTool(this.connectionManager),
            ),
        );

        // Register mssql_change_database tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotChangeDatabaseToolName,
                new ChangeDatabaseTool(this.connectionManager),
            ),
        );
        // Register mssql_show_schema tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotShowSchemaToolName,
                new ShowSchemaTool(
                    this.connectionManager,
                    async (connectionUri: string, database: string) => {
                        const designer =
                            await SchemaDesignerWebviewManager.getInstance().getSchemaDesigner(
                                this._context,
                                this._vscodeWrapper,
                                this,
                                this.schemaDesignerService,
                                database,
                                undefined,
                                connectionUri,
                            );
                        designer.revealToForeground();
                    },
                ),
            ),
        );

        // Register mssql_list_tables tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListTablesToolName,
                new ListTablesTool(this.connectionManager, SqlToolsServerClient.instance),
            ),
        );

        // Register mssql_list_schemas tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListSchemasToolName,
                new ListSchemasTool(this.connectionManager, SqlToolsServerClient.instance),
            ),
        );

        // Register mssql_list_views tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListViewsToolName,
                new ListViewsTool(this.connectionManager, SqlToolsServerClient.instance),
            ),
        );

        // Register mssql_list_functions tool
        this._context.subscriptions.push(
            vscode.lm.registerTool(
                Constants.copilotListFunctionsToolName,
                new ListFunctionsTool(this.connectionManager, SqlToolsServerClient.instance),
            ),
        );
    }

    /**
     * Helper to script a node based on the script operation
     */
    public async scriptNode(
        node: TreeNodeInfo,
        operation: ScriptOperation,
        executeScript: boolean = false,
    ): Promise<void> {
        const scriptNodeOperation = async () => {
            const nodeUri = ObjectExplorerUtils.getNodeUri(node);
            let connectionCreds = node.connectionProfile;
            const databaseName = ObjectExplorerUtils.getDatabaseName(node);
            // if not connected or different database
            if (
                !this.connectionManager.isConnected(nodeUri) ||
                connectionCreds.database !== databaseName
            ) {
                // make a new connection
                connectionCreds.database = databaseName;
                if (!this.connectionManager.isConnecting(nodeUri)) {
                    const promise = new Deferred<boolean>();
                    await this.connectionManager.connect(nodeUri, connectionCreds, promise);
                    await promise;
                }
            }

            const selectStatement = await this._scriptingService.scriptTreeNode(
                node,
                nodeUri,
                operation,
            );
            const editor = await this._untitledSqlDocumentService.newQuery(selectStatement);
            let uri = editor.document.uri.toString(true);
            let scriptingObject = this._scriptingService.getObjectFromNode(node);
            let title = `${scriptingObject.schema}.${scriptingObject.name}`;
            const queryUriPromise = new Deferred<boolean>();
            await this.connectionManager.connect(uri, connectionCreds, queryUriPromise);
            await queryUriPromise;
            this._statusview.languageFlavorChanged(uri, Constants.mssqlProviderName);
            this._statusview.sqlCmdModeChanged(uri, false);
            if (executeScript) {
                const queryPromise = new Deferred<boolean>();
                await this._outputContentProvider.runQuery(
                    this._statusview,
                    uri,
                    undefined,
                    title,
                    {},
                    queryPromise,
                );
                await queryPromise;
                await this.connectionManager.connectionStore.removeRecentlyUsed(
                    <IConnectionProfile>connectionCreds,
                );
            }

            let scriptType;
            switch (operation) {
                case ScriptOperation.Select:
                    scriptType = "Select";
                    break;
                case ScriptOperation.Create:
                    scriptType = "Create";
                    break;
                case ScriptOperation.Insert:
                    scriptType = "Insert";
                    break;
                case ScriptOperation.Update:
                    scriptType = "Update";
                    break;
                case ScriptOperation.Delete:
                    scriptType = "Delete";
                    break;
                case ScriptOperation.Execute:
                    scriptType = "Execute";
                    break;
                case ScriptOperation.Alter:
                    scriptType = "Alter";
                    break;
                default:
                    scriptType = "Unknown";
                    break;
            }
            sendActionEvent(
                TelemetryViews.QueryEditor,
                TelemetryActions.RunQuery,
                {
                    isScriptExecuted: executeScript.toString(),
                    objectType: node.nodeType,
                    operation: scriptType,
                },
                undefined,
                connectionCreds as IConnectionProfile,
                this.connectionManager.getServerInfo(connectionCreds),
            );
        };

        let operationType = "";
        switch (operation) {
            case ScriptOperation.Select:
                operationType = LocalizedConstants.ObjectExplorer.ScriptSelectLabel;
                break;
            case ScriptOperation.Create:
                operationType = LocalizedConstants.ObjectExplorer.ScriptCreateLabel;
                break;
            case ScriptOperation.Insert:
                operationType = LocalizedConstants.ObjectExplorer.ScriptInsertLabel;
                break;
            case ScriptOperation.Update:
                operationType = LocalizedConstants.ObjectExplorer.ScriptUpdateLabel;
                break;
            case ScriptOperation.Delete:
                operationType = LocalizedConstants.ObjectExplorer.ScriptDeleteLabel;
                break;
            case ScriptOperation.Execute:
                operationType = LocalizedConstants.ObjectExplorer.ScriptExecuteLabel;
                break;
            case ScriptOperation.Alter:
                operationType = LocalizedConstants.ObjectExplorer.ScriptAlterLabel;
                break;
            default:
                operationType = LocalizedConstants.ObjectExplorer.ScriptSelectLabel;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocalizedConstants.ObjectExplorer.FetchingScriptLabel(operationType),
            },
            async () => {
                const scriptTelemetryActivity = startActivity(
                    TelemetryViews.ObjectExplorer,
                    TelemetryActions.ScriptNode,
                    undefined,
                    {
                        operation: operationType,
                        nodeType: node.nodeType,
                        subType: node.nodeSubType,
                    },
                );
                try {
                    await scriptNodeOperation();
                    scriptTelemetryActivity.end(ActivityStatus.Succeeded);
                } catch (error) {
                    scriptTelemetryActivity.endFailed(error, false);
                }
            },
        );
    }

    /**
     * Returns a flag indicating if the extension is initialized
     */
    public isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Initializes the extension
     */
    public async initialize(): Promise<boolean> {
        // initialize language service client
        await SqlToolsServerClient.instance.initialize(this._context);
        // Init status bar
        this._statusview = new StatusView(this._vscodeWrapper);

        // Init CodeAdapter for use when user response to questions is needed
        this._prompter = new CodeAdapter(this._vscodeWrapper);

        // Init Query Results Webview Controller
        this._queryResultWebviewController = new QueryResultWebviewController(
            this._context,
            this._vscodeWrapper,
            this.executionPlanService,
            this.untitledSqlDocumentService,
        );

        // Init content provider for results pane
        this._outputContentProvider = new SqlOutputContentProvider(
            this._context,
            this._statusview,
            this._vscodeWrapper,
        );
        this._outputContentProvider.setQueryResultWebviewController(
            this._queryResultWebviewController,
        );
        this._queryResultWebviewController.setSqlOutputContentProvider(this._outputContentProvider);

        // Init connection manager and connection MRU
        this._connectionMgr = new ConnectionManager(
            this._context,
            this._statusview,
            this._prompter,
            this.useLegacyConnectionExperience,
        );

        void this.showOnLaunchPrompts();

        // Handle case where SQL file is the 1st opened document
        const activeTextEditor = this._vscodeWrapper.activeTextEditor;
        if (activeTextEditor && this._vscodeWrapper.isEditingSqlFile) {
            this.onDidOpenTextDocument(activeTextEditor.document);
        }
        await this.sanitizeConnectionProfiles();
        await this.loadTokenCache();
        Utils.logDebug("activated.");

        // capture basic metadata
        sendActionEvent(TelemetryViews.General, TelemetryActions.Activated, {
            experimentalFeaturesEnabled: this.isExperimentalEnabled.toString(),
            modernFeaturesEnabled: this.isRichExperiencesEnabled.toString(),
            useLegacyConnections: this.useLegacyConnectionExperience.toString(),
            useLegacyQueryResults: this.useLegacyQueryResultExperience.toString(),
        });

        await this._connectionMgr.initialized;

        this._statusview.setConnectionStore(this._connectionMgr.connectionStore);

        this._initialized = true;
        return true;
    }

    private async loadTokenCache(): Promise<void> {
        await this._connectionMgr.azureController.loadTokenCache();
    }

    /**
     * Sanitize the connection profiles in the settings.
     */
    public async sanitizeConnectionProfiles(): Promise<void> {
        const sanitize = async (
            connectionProfiles: IConnectionProfile[],
            target: vscode.ConfigurationTarget,
        ) => {
            let profileChanged = false;
            for (const conn of connectionProfiles) {
                // remove azure account token
                if (
                    conn &&
                    conn.authenticationType !== "AzureMFA" &&
                    conn.azureAccountToken !== undefined
                ) {
                    conn.azureAccountToken = undefined;
                    profileChanged = true;
                }
                // remove password
                if (!Utils.isEmpty(conn.password)) {
                    // save the password in the credential store if save password is true
                    await this.connectionManager.connectionStore.saveProfilePasswordIfNeeded(conn);
                    conn.password = "";
                    profileChanged = true;
                }
                // Fixup 'Encrypt' property if needed
                let result = ConnInfo.updateEncrypt(conn);
                if (result.updateStatus) {
                    await this.connectionManager.connectionStore.saveProfile(
                        result.connection as IConnectionProfile,
                    );
                }
            }
            if (profileChanged) {
                await this._vscodeWrapper.setConfiguration(
                    Constants.extensionName,
                    Constants.connectionsArrayName,
                    connectionProfiles,
                    target,
                );
            }
        };
        const profileMapping = new Map<vscode.ConfigurationTarget, IConnectionProfile[]>();
        const configuration = this._vscodeWrapper.getConfiguration(
            Constants.extensionName,
            this._vscodeWrapper.activeTextEditorUri,
        );
        const configValue = configuration.inspect<IConnectionProfile[]>(
            Constants.connectionsArrayName,
        );
        profileMapping.set(vscode.ConfigurationTarget.Global, configValue.globalValue || []);
        profileMapping.set(vscode.ConfigurationTarget.Workspace, configValue.workspaceValue || []);
        profileMapping.set(
            vscode.ConfigurationTarget.WorkspaceFolder,
            configValue.workspaceFolderValue || [],
        );
        for (const target of profileMapping.keys()) {
            // sanitize the connections and save them back to their original target.
            await sanitize(profileMapping.get(target), target);
        }
    }

    /**
     * Creates a new Object Explorer session
     * @param connectionCredentials Connection credentials to use for the session
     * @returns OE node if the session was created successfully, undefined otherwise
     */
    public async createObjectExplorerSession(
        connectionCredentials?: IConnectionInfo,
    ): Promise<TreeNodeInfo> {
        let retry = true;
        // There can be many reasons for the session creation to fail, so we will retry until we get a successful result or the user cancels the operation.
        let sessionCreationResult: CreateSessionResult = undefined;
        while (retry) {
            retry = false;
            sessionCreationResult =
                await this._objectExplorerProvider.createSession(connectionCredentials);
            if (sessionCreationResult?.shouldRetryOnFailure) {
                retry = true;
            }
        }
        if (sessionCreationResult) {
            const newNode = await sessionCreationResult.connectionNode;
            if (newNode) {
                this._objectExplorerProvider.refresh(undefined);
                return newNode;
            }
        }
        return undefined;
    }

    /**
     * Initializes the Object Explorer commands
     * @param objectExplorerProvider provider settable for testing purposes
     */
    private initializeObjectExplorer(objectExplorerProvider?: ObjectExplorerProvider): void {
        const self = this;
        // Register the object explorer tree provider
        this._objectExplorerProvider =
            objectExplorerProvider ??
            new ObjectExplorerProvider(
                this._vscodeWrapper,
                this._connectionMgr,
                this.isRichExperiencesEnabled,
            );

        this.objectExplorerTree = vscode.window.createTreeView("objectExplorer", {
            treeDataProvider: this._objectExplorerProvider,
            canSelectMany: false,
            showCollapseAll: true,
            dragAndDropController: new ObjectExplorerDragAndDropController(
                this._vscodeWrapper,
                this._connectionMgr.connectionStore,
            ),
        });
        this._context.subscriptions.push(this.objectExplorerTree);

        // Old style Add connection when experimental features are not enabled

        // Add Object Explorer Node
        this.registerCommandWithArgs(Constants.cmdAddObjectExplorer);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._event.on(Constants.cmdAddObjectExplorer, async (args: any) => {
            if (this.useLegacyConnectionExperience) {
                await self.createObjectExplorerSession();
            } else {
                let connectionInfo: IConnectionInfo | undefined = undefined;
                let connectionGroup: IConnectionGroup | undefined = undefined;
                if (args) {
                    // validate that `args` is an IConnectionInfo before assigning
                    if (isIConnectionInfo(args)) {
                        connectionInfo = args;
                    } else {
                        if (args instanceof ConnectionGroupNode) {
                            connectionGroup = args.connectionGroup;
                        }
                    }
                }

                const connDialog = new ConnectionDialogWebviewController(
                    this._context,
                    this._vscodeWrapper,
                    this,
                    this._objectExplorerProvider,
                    connectionInfo,
                    connectionGroup,
                );
                connDialog.revealToForeground();
            }
        });

        // redirect the "Legacy" command to the core command; that handler will differentiate
        this.registerCommandWithArgs(Constants.cmdAddObjectExplorerLegacy);
        this._event.on(Constants.cmdAddObjectExplorerLegacy, (args) => {
            vscode.commands.executeCommand(Constants.cmdAddObjectExplorer, args);
        });

        // Object Explorer New Query
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdObjectExplorerNewQuery,
                async (treeNodeInfo: TreeNodeInfo) => {
                    const connectionCredentials = treeNodeInfo.connectionProfile;
                    const databaseName = ObjectExplorerUtils.getDatabaseName(treeNodeInfo);

                    if (
                        databaseName !== connectionCredentials.database &&
                        databaseName !== LocalizedConstants.defaultDatabaseLabel
                    ) {
                        connectionCredentials.database = databaseName;
                    } else if (databaseName === LocalizedConstants.defaultDatabaseLabel) {
                        connectionCredentials.database = "";
                    }
                    treeNodeInfo.updateConnectionProfile(connectionCredentials);
                    await self.onNewQuery(treeNodeInfo);
                },
            ),
        );

        // Remove Object Explorer Node
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdRemoveObjectExplorerNode,
                async (treeNodeInfo: ConnectionNode) => {
                    await this._objectExplorerProvider.removeNode(treeNodeInfo);
                },
            ),
        );

        // Refresh Object Explorer Node
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdRefreshObjectExplorerNode,
                async (treeNodeInfo: TreeNodeInfo) => {
                    await this._objectExplorerProvider.refreshNode(treeNodeInfo);
                },
            ),
        );

        const connectParentNode = async (node: AccountSignInTreeNode | ConnectTreeNode) => {
            this._objectExplorerProvider.deleteChildrenCache(node.parentNode);
            void this._objectExplorerProvider.refresh(node.parentNode);
        };

        // Sign In into Object Explorer Node
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdObjectExplorerNodeSignIn,
                async (node: AccountSignInTreeNode) => {
                    let choice = await this._vscodeWrapper.showErrorMessage(
                        LocalizedConstants.ObjectExplorer.FailedOEConnectionError,
                        LocalizedConstants.ObjectExplorer.FailedOEConnectionErrorRetry,
                        LocalizedConstants.ObjectExplorer.FailedOEConnectionErrorUpdate,
                    );
                    switch (choice) {
                        case LocalizedConstants.ObjectExplorer.FailedOEConnectionErrorUpdate:
                            const connDialog = new ConnectionDialogWebviewController(
                                this._context,
                                this._vscodeWrapper,
                                this,
                                this._objectExplorerProvider,
                                node.parentNode.connectionProfile,
                            );
                            connDialog.revealToForeground();
                            break;
                        case LocalizedConstants.ObjectExplorer.FailedOEConnectionErrorRetry:
                            await connectParentNode(node);
                            break;
                        default:
                            break;
                    }
                },
            ),
        );

        // Connect to Object Explorer Node
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdConnectObjectExplorerNode,
                async (node: ConnectTreeNode) => {
                    await connectParentNode(node);
                },
            ),
        );

        // Disconnect Object Explorer Node
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdDisconnectObjectExplorerNode,
                async (node: ConnectionNode) => {
                    await this._objectExplorerProvider.disconnectNode(node);
                },
            ),
        );

        this.registerCommand(Constants.cmdConnectionGroupCreate);
        this._event.on(Constants.cmdConnectionGroupCreate, () => {
            const connGroupDialog = new ConnectionGroupWebviewController(
                this._context,
                this._vscodeWrapper,
                this.connectionManager.connectionStore.connectionConfig,
            );
            connGroupDialog.revealToForeground();
        });

        this.registerCommandWithArgs(Constants.cmdConnectionGroupEdit);
        this._event.on(Constants.cmdConnectionGroupEdit, (node: ConnectionGroupNode) => {
            const connGroupDialog = new ConnectionGroupWebviewController(
                this._context,
                this._vscodeWrapper,
                this.connectionManager.connectionStore.connectionConfig,
                node.connectionGroup,
            );
            connGroupDialog.revealToForeground();
        });

        this.registerCommandWithArgs(Constants.cmdConnectionGroupDelete);
        this._event.on(Constants.cmdConnectionGroupDelete, async (node: ConnectionGroupNode) => {
            if (!(node instanceof ConnectionGroupNode)) {
                return;
            }

            let result = undefined;

            if (node.children.length > 0) {
                result = await vscode.window.showInformationMessage(
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeletionConfirmationWithContents(
                        typeof node.label === "string" ? node.label : node.label.label,
                    ),
                    { modal: true },
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeleteContents,
                    LocalizedConstants.ObjectExplorer.ConnectionGroupMoveContents,
                );
            } else {
                result = await vscode.window.showInformationMessage(
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeletionConfirmationWithoutContents(
                        typeof node.label === "string" ? node.label : node.label.label,
                    ),
                    { modal: true },
                    LocalizedConstants.Common.delete,
                );
            }
            if (
                result === LocalizedConstants.ObjectExplorer.ConnectionGroupDeleteContents ||
                result === LocalizedConstants.Common.delete
            ) {
                void this.connectionManager.connectionStore.connectionConfig.removeGroup(
                    node.connectionGroup.id,
                    "delete",
                );
            } else if (result === LocalizedConstants.ObjectExplorer.ConnectionGroupMoveContents) {
                void this.connectionManager.connectionStore.connectionConfig.removeGroup(
                    node.connectionGroup.id,
                    "move",
                );
            }
        });

        if (this.isRichExperiencesEnabled) {
            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdSchemaCompare, async (node: any) =>
                    this.onSchemaCompare(node),
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdSchemaCompareOpenFromCommandPalette,
                    async () => {
                        await this.onSchemaCompare();
                    },
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdEditConnection,
                    async (node: TreeNodeInfo) => {
                        const connDialog = new ConnectionDialogWebviewController(
                            this._context,
                            this._vscodeWrapper,
                            this,
                            this._objectExplorerProvider,
                            node.connectionProfile,
                        );
                        connDialog.revealToForeground();
                    },
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdDesignSchema,
                    async (node: TreeNodeInfo) => {
                        const schemaDesigner =
                            await SchemaDesignerWebviewManager.getInstance().getSchemaDesigner(
                                this._context,
                                this._vscodeWrapper,
                                this,
                                this.schemaDesignerService,
                                node.metadata.name,
                                node,
                            );

                        schemaDesigner.revealToForeground();
                    },
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdNewTable,
                    async (node: TreeNodeInfo) => {
                        const reactPanel = new TableDesignerWebviewController(
                            this._context,
                            this._vscodeWrapper,
                            this.tableDesignerService,
                            this._connectionMgr,
                            this._untitledSqlDocumentService,
                            node,
                            this._objectExplorerProvider,
                            this.objectExplorerTree,
                        );
                        reactPanel.revealToForeground();
                    },
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdEditTable,
                    async (node: TreeNodeInfo) => {
                        const reactPanel = new TableDesignerWebviewController(
                            this._context,
                            this._vscodeWrapper,
                            this.tableDesignerService,
                            this._connectionMgr,
                            this._untitledSqlDocumentService,
                            node,
                            this._objectExplorerProvider,
                            this.objectExplorerTree,
                        );
                        reactPanel.revealToForeground();
                    },
                ),
            );

            const filterNode = async (node: TreeNodeInfo) => {
                const filters = await ObjectExplorerFilter.getFilters(
                    this._context,
                    this._vscodeWrapper,
                    node,
                );
                if (filters) {
                    node.filters = filters;
                    if (node.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                        await this._objectExplorerProvider.refreshNode(node);
                    } else if (node.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                        await this._objectExplorerProvider.expandNode(
                            node,
                            node.sessionId,
                            undefined,
                        );
                    }
                    await this.objectExplorerTree.reveal(node, {
                        select: true,
                        focus: true,
                        expand: true,
                    });
                } else {
                    // User cancelled the operation. Do nothing and focus on the node
                    await this.objectExplorerTree.reveal(node, {
                        select: true,
                        focus: true,
                    });
                    return;
                }
            };

            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdFilterNode, filterNode),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdFilterNodeWithExistingFilters,
                    filterNode,
                ),
            );

            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdClearFilters,
                    async (node: TreeNodeInfo) => {
                        node.filters = [];
                        await this._objectExplorerProvider.refreshNode(node);
                        await this.objectExplorerTree.reveal(node, {
                            select: true,
                            focus: true,
                            expand: true,
                        });
                    },
                ),
            );

            this._context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    "queryResult",
                    this._queryResultWebviewController,
                ),
            );
        }

        // Initiate the scripting service
        this._scriptingService = new ScriptingService(this._connectionMgr);

        // Script as Select
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdScriptSelect,
                async (node: TreeNodeInfo) => {
                    await this.scriptNode(node, ScriptOperation.Select, true);
                    UserSurvey.getInstance().promptUserForNPSFeedback();
                },
            ),
        );

        // Script as Create
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdScriptCreate,
                async (node: TreeNodeInfo) => await this.scriptNode(node, ScriptOperation.Create),
            ),
        );

        // Script as Drop
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdScriptDelete,
                async (node: TreeNodeInfo) => await this.scriptNode(node, ScriptOperation.Delete),
            ),
        );

        // Script as Execute
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdScriptExecute,
                async (node: TreeNodeInfo) => await this.scriptNode(node, ScriptOperation.Execute),
            ),
        );

        // Script as Alter
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdScriptAlter,
                async (node: TreeNodeInfo) => await this.scriptNode(node, ScriptOperation.Alter),
            ),
        );

        // Copy object name command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdCopyObjectName,
                async (node: TreeNodeInfo) => {
                    const name = ObjectExplorerUtils.getQualifiedName(node);
                    if (name) {
                        await this._vscodeWrapper.clipboardWriteText(name);
                    }
                },
            ),
        );

        // Start container command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdStartContainer,
                async (node: TreeNodeInfo) => {
                    if (
                        !node ||
                        !node.connectionProfile ||
                        !(await this.isContainerReadyForCommands(node))
                    ) {
                        return;
                    }
                    try {
                        // doing it this way instead of directly calling startContainer
                        // allows for the object explorer item loading UI to show
                        this._objectExplorerProvider.deleteChildrenCache(node);
                        await this._objectExplorerProvider.setNodeLoading(node);
                        this._objectExplorerProvider.refresh(node);
                        await this.objectExplorerTree.reveal(node, {
                            select: true,
                            focus: true,
                            expand: true,
                        });

                        await this.connectionManager.connectionUI
                            .saveProfile(node.connectionProfile as IConnectionProfile)
                            .then(async () => {
                                await this.createObjectExplorerSession(
                                    node.connectionProfile as IConnectionProfile,
                                );
                            });
                    } catch {
                        vscode.window.showErrorMessage(
                            LocalizedConstants.ContainerDeployment.failStartContainer(
                                node.connectionProfile.containerName,
                            ),
                        );
                    }
                },
            ),
        );

        // Stop container command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdStopContainer,
                async (node: TreeNodeInfo) => {
                    if (
                        !node ||
                        !node.connectionProfile ||
                        !(await this.isContainerReadyForCommands(node))
                    ) {
                        return;
                    }

                    const containerName = node.connectionProfile.containerName;
                    node.loadingLabel =
                        LocalizedConstants.ContainerDeployment.stoppingContainerLoadingLabel;
                    await this._objectExplorerProvider.setNodeLoading(node);
                    this._objectExplorerProvider.refresh(node);

                    await stopContainer(containerName).then(async (stoppedSuccessfully) => {
                        if (stoppedSuccessfully) {
                            node.loadingLabel =
                                LocalizedConstants.ContainerDeployment.startingContainerLoadingLabel;

                            await this._objectExplorerProvider
                                .disconnectNode(node as ConnectionNode)
                                .then(() => this._objectExplorerProvider.refresh(undefined));
                        }

                        vscode.window.showInformationMessage(
                            stoppedSuccessfully
                                ? LocalizedConstants.ContainerDeployment.stoppedContainerSucessfully(
                                      containerName,
                                  )
                                : LocalizedConstants.ContainerDeployment.failStopContainer(
                                      containerName,
                                  ),
                        );
                    });
                },
            ),
        );
        // Delete container command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(
                Constants.cmdDeleteContainer,
                async (node: TreeNodeInfo) => {
                    if (
                        !node ||
                        !node.connectionProfile ||
                        !(await this.isContainerReadyForCommands(node))
                    ) {
                        return;
                    }

                    const confirmation = await vscode.window.showInformationMessage(
                        LocalizedConstants.ContainerDeployment.deleteContainerConfirmation(
                            node.connectionProfile.containerName,
                        ),
                        { modal: true },
                        LocalizedConstants.Common.delete,
                    );

                    if (confirmation === LocalizedConstants.Common.delete) {
                        node.loadingLabel =
                            LocalizedConstants.ContainerDeployment.deletingContainerLoadingLabel;
                        await this._objectExplorerProvider.setNodeLoading(node);
                        this._objectExplorerProvider.refresh(node);

                        const containerName = node.connectionProfile.containerName;
                        const deletedSuccessfully = await deleteContainer(containerName);
                        vscode.window.showInformationMessage(
                            deletedSuccessfully
                                ? LocalizedConstants.ContainerDeployment.deletedContainerSucessfully(
                                      containerName,
                                  )
                                : LocalizedConstants.ContainerDeployment.failDeleteContainer(
                                      containerName,
                                  ),
                        );
                        node.loadingLabel =
                            LocalizedConstants.ContainerDeployment.startingContainerLoadingLabel;
                        if (deletedSuccessfully) {
                            // Delete node from tree
                            await this._objectExplorerProvider.removeNode(
                                node as ConnectionNode,
                                false,
                            );
                            return this._objectExplorerProvider.refresh(undefined);
                        }
                    }
                },
            ),
        );

        // Reveal Query Results command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdrevealQueryResultPanel, () => {
                vscode.commands.executeCommand("queryResult.focus", {
                    preserveFocus: true,
                });
            }),
        );

        // Query Results copy messages command
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdCopyAll, async (context) => {
                const uri = context.uri;
                await this._queryResultWebviewController.copyAllMessagesToClipboard(uri);
            }),
        );
    }

    /**
     * Initializes the Query History commands
     */
    private initializeQueryHistory(): void {
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        let queryHistoryFeature = config.get(Constants.configEnableQueryHistoryFeature);
        // If the query history feature is enabled
        if (queryHistoryFeature && !this._queryHistoryRegistered) {
            // Register the query history tree provider
            this._queryHistoryProvider = new QueryHistoryProvider(
                this._connectionMgr,
                this._outputContentProvider,
                this._vscodeWrapper,
                this._untitledSqlDocumentService,
                this._statusview,
                this._prompter,
            );

            this._context.subscriptions.push(
                vscode.window.registerTreeDataProvider("queryHistory", this._queryHistoryProvider),
            );

            // Command to refresh Query History
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdRefreshQueryHistory,
                    (ownerUri: string, hasError: boolean) => {
                        config = this._vscodeWrapper.getConfiguration(
                            Constants.extensionConfigSectionName,
                        );
                        let queryHistoryFeatureEnabled = config.get(
                            Constants.configEnableQueryHistoryFeature,
                        );
                        let queryHistoryCaptureEnabled = config.get(
                            Constants.configEnableQueryHistoryCapture,
                        );
                        if (queryHistoryFeatureEnabled && queryHistoryCaptureEnabled) {
                            const timeStamp = new Date();
                            this._queryHistoryProvider.refresh(ownerUri, timeStamp, hasError);
                        }
                    },
                ),
            );

            // Command to enable clear all entries in Query History
            this._context.subscriptions.push(
                vscode.commands.registerCommand(Constants.cmdClearAllQueryHistory, () => {
                    this._queryHistoryProvider.clearAll();
                }),
            );

            // Command to enable delete an entry in Query History
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdDeleteQueryHistory,
                    (node: QueryHistoryNode) => {
                        this._queryHistoryProvider.deleteQueryHistoryEntry(node);
                    },
                ),
            );

            // Command to enable open a query in Query History
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdOpenQueryHistory,
                    async (node: QueryHistoryNode) => {
                        await this._queryHistoryProvider.openQueryHistoryEntry(node);
                    },
                ),
            );

            // Command to enable run a query in Query History
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdRunQueryHistory,
                    async (node: QueryHistoryNode) => {
                        await this._queryHistoryProvider.openQueryHistoryEntry(node, true);
                    },
                ),
            );

            // Command to start the query history capture
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdStartQueryHistory,
                    async (node: QueryHistoryNode) => {
                        await this._queryHistoryProvider.startQueryHistoryCapture();
                    },
                ),
            );

            // Command to pause the query history capture
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdPauseQueryHistory,
                    async (node: QueryHistoryNode) => {
                        await this._queryHistoryProvider.pauseQueryHistoryCapture();
                    },
                ),
            );

            // Command to open the query history experience in the command palette
            this._context.subscriptions.push(
                vscode.commands.registerCommand(
                    Constants.cmdCommandPaletteQueryHistory,
                    async () => {
                        await this._queryHistoryProvider.showQueryHistoryCommandPalette();
                    },
                ),
            );
            this._queryHistoryRegistered = true;
        }
    }

    /**
     * Handles the command to toggle SQLCMD mode
     */
    private async onToggleSqlCmd(): Promise<void> {
        let isSqlCmd: boolean;
        const uri = this._vscodeWrapper.activeTextEditorUri;
        const queryRunner = this._outputContentProvider.getQueryRunner(uri);
        // if a query runner exists, use it
        if (queryRunner) {
            isSqlCmd = queryRunner.isSqlCmd;
        } else {
            // otherwise create a new query runner
            isSqlCmd = false;
            const editor = this._vscodeWrapper.activeTextEditor;
            const title = path.basename(editor.document.fileName);
            this._outputContentProvider.createQueryRunner(this._statusview, uri, title);
        }
        await this._outputContentProvider.toggleSqlCmd(this._vscodeWrapper.activeTextEditorUri);
        await this._connectionMgr.onChooseLanguageFlavor(true, !isSqlCmd);
        this._statusview.sqlCmdModeChanged(this._vscodeWrapper.activeTextEditorUri, !isSqlCmd);
    }

    /**
     * Handles the command to cancel queries
     */
    private onCancelQuery(): void {
        if (!this.canRunCommand() || !this.validateTextDocumentHasFocus()) {
            return;
        }
        try {
            let uri = this._vscodeWrapper.activeTextEditorUri;
            this._outputContentProvider.cancelQuery(uri);
        } catch (err) {
            console.warn(`Unexpected error cancelling query : ${getErrorMessage(err)}`);
        }
    }

    /**
     * Choose a new database from the current server
     */
    private async onChooseDatabase(): Promise<boolean> {
        if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
            const success = await this._connectionMgr.onChooseDatabase();
            return success;
        }
        return false;
    }

    /**
     * Choose a language flavor for the SQL document. Should be either "MSSQL" or "Other"
     * to indicate that intellisense and other services should not be provided
     */
    private async onChooseLanguageFlavor(): Promise<boolean> {
        if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
            const fileUri = this._vscodeWrapper.activeTextEditorUri;
            if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
                void this._connectionMgr.onChooseLanguageFlavor();
            } else {
                this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            }
        }
        return false;
    }

    /**
     * Close active connection, if any
     */
    private async onDisconnect(): Promise<boolean> {
        if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
            let fileUri = this._vscodeWrapper.activeTextEditorUri;
            let queryRunner = this._outputContentProvider.getQueryRunner(fileUri);
            if (queryRunner && queryRunner.isExecutingQuery) {
                this._outputContentProvider.cancelQuery(fileUri);
            }
            const success = await this._connectionMgr.onDisconnect();
            if (success) {
                vscode.commands.executeCommand("setContext", "mssql.editorConnected", false);
            }
            return success;
        }
        return false;
    }

    /**
     * Manage connection profiles (create, edit, remove).
     * Public for testing purposes
     */
    public async onManageProfiles(): Promise<void> {
        if (this.canRunCommand()) {
            await this._connectionMgr.onManageProfiles();
            return;
        }
    }

    /**
     * Clears all pooled connections not in active use.
     */
    public async onClearPooledConnections(): Promise<void> {
        if (this.canRunCommand()) {
            await this._connectionMgr.onClearPooledConnections();
            return;
        }
    }

    /**
     * Let users pick from a list of connections
     */
    public async onNewConnection(): Promise<boolean> {
        if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
            let credentials = await this._connectionMgr.onNewConnection();
            if (credentials) {
                await this.createObjectExplorerSession(credentials);
                return true;
            }
        }
        return false;
    }

    public onDeployContainer(): void {
        sendActionEvent(
            TelemetryViews.ContainerDeployment,
            TelemetryActions.OpenContainerDeployment,
        );

        const reactPanel = new ContainerDeploymentWebviewController(
            this._context,
            this._vscodeWrapper,
            this,
        );
        reactPanel.revealToForeground();
    }

    /**
     * Makes a connection and save if saveConnection is set to true
     * @param uri The URI of the connection to list the databases for.
     * @param connectionInfo The connection info
     * @param connectionPromise connection promise object
     * @param saveConnection saves the connection profile if sets to true
     * @returns if saveConnection is set to true, returns true for successful connection and saving the profile
     * otherwise returns true for successful connection
     *
     */
    public async connect(
        uri: string,
        connectionInfo: IConnectionInfo,
        connectionPromise: Deferred<boolean>,
        saveConnection?: boolean,
    ): Promise<boolean> {
        if (this.canRunCommand() && uri && connectionInfo) {
            const connectedSuccessfully = await this._connectionMgr.connect(
                uri,
                connectionInfo,
                connectionPromise,
            );
            if (connectedSuccessfully) {
                if (saveConnection) {
                    await this.createObjectExplorerSession(connectionInfo);
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Clear and rebuild the IntelliSense cache
     */
    public onRebuildIntelliSense(): void {
        if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
            const fileUri = this._vscodeWrapper.activeTextEditorUri;
            if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
                this._statusview.languageServiceStatusChanged(
                    fileUri,
                    LocalizedConstants.updatingIntelliSenseStatus,
                );
                SqlToolsServerClient.instance.sendNotification(
                    RebuildIntelliSenseNotification.type,
                    {
                        ownerUri: fileUri,
                    },
                );
            } else {
                this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
            }
        }
    }

    /**
     * Send completion extension load request to language service
     */
    public onLoadCompletionExtension(params: CompletionExtensionParams): void {
        SqlToolsServerClient.instance.sendRequest(CompletionExtLoadRequest.type, params);
    }

    /**
     * execute the SQL statement for the current cursor position
     */
    public async onRunCurrentStatement(callbackThis?: MainController): Promise<void> {
        // the 'this' context is lost in retry callback, so capture it here
        let self: MainController = callbackThis ? callbackThis : this;
        try {
            if (!self.canRunCommand()) {
                return;
            }
            if (!self.canRunV2Command()) {
                // Notify the user that this is not supported on this version
                await this._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.macSierraRequiredErrorMessage,
                );
                return;
            }
            if (!self.validateTextDocumentHasFocus()) {
                return;
            }

            // check if we're connected and editing a SQL file
            if (!(await this.checkIsReadyToExecuteQuery())) {
                return;
            }

            let editor = self._vscodeWrapper.activeTextEditor;
            let uri = self._vscodeWrapper.activeTextEditorUri;
            let title = path.basename(editor.document.fileName);

            // return early if the document does contain any text
            if (editor.document.getText(undefined).trim().length === 0) {
                return;
            }

            // only the start line and column are used to determine the current statement
            let querySelection: ISelectionData = {
                startLine: editor.selection.start.line,
                startColumn: editor.selection.start.character,
                endLine: 0,
                endColumn: 0,
            };

            await self._outputContentProvider.runCurrentStatement(
                self._statusview,
                uri,
                querySelection,
                title,
            );
        } catch (err) {
            console.warn(`Unexpected error running current statement : ${err}`);
        }
    }

    /**
     * get the T-SQL query from the editor, run it and show output
     */
    public async onRunQuery(callbackThis?: MainController): Promise<void> {
        // the 'this' context is lost in retry callback, so capture it here
        let self: MainController = callbackThis ? callbackThis : this;
        try {
            if (!self.canRunCommand() || !self.validateTextDocumentHasFocus()) {
                return;
            }

            // check if we're connected and editing a SQL file
            if (!(await self.checkIsReadyToExecuteQuery())) {
                return;
            }

            let editor = self._vscodeWrapper.activeTextEditor;
            let uri = self._vscodeWrapper.activeTextEditorUri;

            if (self._queryResultWebviewController) {
                self._executionPlanOptions.includeActualExecutionPlanXml =
                    self._queryResultWebviewController.actualPlanStatuses.includes(uri);
            } else {
                self._executionPlanOptions.includeActualExecutionPlanXml = false;
            }

            // Do not execute when there are multiple selections in the editor until it can be properly handled.
            // Otherwise only the first selection will be executed and cause unexpected issues.
            if (editor.selections?.length > 1) {
                self._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgMultipleSelectionModeNotSupported,
                );
                return;
            }

            // create new connection
            if (!self.connectionManager.isConnected(uri)) {
                await self.onNewConnection();
                sendActionEvent(TelemetryViews.QueryEditor, TelemetryActions.CreateConnection);
            }
            // check if current connection is still valid / active - if not, refresh azure account token
            await self._connectionMgr.refreshAzureAccountToken(uri);

            let title = path.basename(editor.document.fileName);
            let querySelection: ISelectionData;
            // Calculate the selection if we have a selection, otherwise we'll treat null as
            // the entire document's selection
            if (!editor.selection.isEmpty) {
                let selection = editor.selection;
                querySelection = {
                    startLine: selection.start.line,
                    startColumn: selection.start.character,
                    endLine: selection.end.line,
                    endColumn: selection.end.character,
                };
            }

            // Trim down the selection. If it is empty after selecting, then we don't execute
            let selectionToTrim = editor.selection.isEmpty ? undefined : editor.selection;
            if (editor.document.getText(selectionToTrim).trim().length === 0) {
                return;
            }
            // Delete stored filters and dimension states for result grid when a new query is executed
            store.deleteMainKey(uri);

            await self._outputContentProvider.runQuery(
                self._statusview,
                uri,
                querySelection,
                title,
                self._executionPlanOptions,
            );
        } catch (err) {
            console.warn(`Unexpected error running query : ${err}`);
        }
    }

    /**
     * Checks if there's an active SQL file that has a connection associated with it.
     * @returns true if the file is a SQL file and has a connection, false otherwise
     */
    public async checkIsReadyToExecuteQuery(): Promise<boolean> {
        if (!(await this.checkForActiveSqlFile())) {
            return false;
        }

        if (this._connectionMgr.isConnected(this._vscodeWrapper.activeTextEditorUri)) {
            return true;
        }

        const result = await this.onNewConnection();

        return result;
    }

    /**
     * Executes a callback and logs any errors raised
     */
    private runAndLogErrors<T>(promise: Promise<T>): Promise<T> {
        let self = this;
        return promise.catch((err) => {
            self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
            return undefined;
        });
    }

    public onToggleActualPlan(isEnable: boolean): void {
        const uri = this._vscodeWrapper.activeTextEditorUri;
        let actualPlanStatuses = this._queryResultWebviewController.actualPlanStatuses;

        // adds the current uri to the list of uris with actual plan enabled
        // or removes the uri if the user is disabling it
        if (isEnable && !actualPlanStatuses.includes(uri)) {
            actualPlanStatuses.push(uri);
        } else {
            this._queryResultWebviewController.actualPlanStatuses = actualPlanStatuses.filter(
                (statusUri) => statusUri != uri,
            );
        }

        // sets the vscode context variable associated with the
        // actual plan statuses; this is used in the package.json to
        // know when to change the enabling/disabling icon
        void vscode.commands.executeCommand(
            "setContext",
            "mssql.executionPlan.urisWithActualPlanEnabled",
            this._queryResultWebviewController.actualPlanStatuses,
        );
    }

    /**
     * Access the connection manager for testing
     */
    public get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }

    public set connectionManager(connectionManager: ConnectionManager) {
        this._connectionMgr = connectionManager;
    }

    public get untitledSqlDocumentService(): UntitledSqlDocumentService {
        return this._untitledSqlDocumentService;
    }

    public set untitledSqlDocumentService(untitledSqlDocumentService: UntitledSqlDocumentService) {
        this._untitledSqlDocumentService = untitledSqlDocumentService;
    }

    /**
     * Verifies the extension is initilized and if not shows an error message
     */
    private canRunCommand(): boolean {
        if (this._connectionMgr === undefined) {
            Utils.showErrorMsg(LocalizedConstants.extensionNotInitializedError);
            return false;
        }
        return true;
    }

    /**
     * Return whether or not some text document currently has focus, and display an error message if not
     */
    private validateTextDocumentHasFocus(): boolean {
        if (this._vscodeWrapper.activeTextEditorUri === undefined) {
            Utils.showErrorMsg(LocalizedConstants.noActiveEditorMsg);
            return false;
        }
        return true;
    }

    /**
     * Checks if the current document is a SQL file
     * @returns true if the current document is a SQL file, false if not or if there's no active document
     */
    private async checkForActiveSqlFile(): Promise<boolean> {
        if (!this.validateTextDocumentHasFocus()) {
            return false;
        }

        if (this._vscodeWrapper.isEditingSqlFile) {
            return true;
        }

        return await this._connectionMgr.connectionUI.promptToChangeLanguageMode();
    }

    /**
     * Verifies the tools service version is high enough to support certain commands
     */
    private canRunV2Command(): boolean {
        let version: number = SqlToolsServerClient.instance.getServiceVersion();
        return version > 1;
    }

    private async showOnLaunchPrompts(): Promise<void> {
        // All prompts should be async and _not_ awaited so that we don't block the rest of the extension

        if (this.shouldShowEnableRichExperiencesPrompt()) {
            void this.showEnableRichExperiencesPrompt();
        } else {
            void this.showFirstLaunchPrompts();
        }
    }

    private shouldShowEnableRichExperiencesPrompt(): boolean {
        return !(
            this._vscodeWrapper
                .getConfiguration()
                .get<boolean>(Constants.configEnableRichExperiencesDoNotShowPrompt) ||
            this._vscodeWrapper
                .getConfiguration()
                .get<boolean>(Constants.configEnableRichExperiences)
        );
    }

    /**
     * Prompts the user to enable rich experiences
     */
    private async showEnableRichExperiencesPrompt(): Promise<void> {
        if (!this.shouldShowEnableRichExperiencesPrompt()) {
            return;
        }

        const response = await this._vscodeWrapper.showInformationMessage(
            LocalizedConstants.enableRichExperiencesPrompt(Constants.richFeaturesLearnMoreLink),
            LocalizedConstants.enableRichExperiences,
            LocalizedConstants.Common.dontShowAgain,
        );

        let telemResponse: string;

        switch (response) {
            case LocalizedConstants.enableRichExperiences:
                telemResponse = "enableRichExperiences";
                break;
            case LocalizedConstants.Common.dontShowAgain:
                telemResponse = "dontShowAgain";
                break;
            default:
                telemResponse = "dismissed";
        }

        sendActionEvent(TelemetryViews.General, TelemetryActions.EnableRichExperiencesPrompt, {
            response: telemResponse,
        });

        this.doesExtensionLaunchedFileExist(); // create the "extensionLaunched" file since this takes the place of the release notes prompt

        if (response === LocalizedConstants.enableRichExperiences) {
            await vscode.commands.executeCommand(Constants.cmdEnableRichExperiencesCommand);
        } else if (response === LocalizedConstants.Common.dontShowAgain) {
            await this._vscodeWrapper
                .getConfiguration()
                .update(
                    Constants.configEnableRichExperiencesDoNotShowPrompt,
                    true,
                    vscode.ConfigurationTarget.Global,
                );
        }
    }

    /**
     * Prompts the user to view release notes, if this is a new extension install
     */
    private async showFirstLaunchPrompts(): Promise<void> {
        let self = this;
        if (!this.doesExtensionLaunchedFileExist()) {
            // ask the user to view release notes document
            let confirmText = LocalizedConstants.viewMore;
            let promiseReleaseNotes = this._vscodeWrapper
                .showInformationMessage(
                    LocalizedConstants.releaseNotesPromptDescription,
                    confirmText,
                )
                .then(async (result) => {
                    if (result === confirmText) {
                        await self.launchReleaseNotesPage();
                    }
                });

            await Promise.all([promiseReleaseNotes]);
        }
    }

    /**
     * Shows the release notes page in the preview browser
     */
    private async launchReleaseNotesPage(): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse(Constants.changelogLink));
    }

    /**
     * Shows the Getting Started page in the preview browser
     */
    private async launchGettingStartedPage(): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse(Constants.gettingStartedGuideLink));
    }

    private async newQueryFromProfile(
        newDocUri: string,
        connectionProfile: IConnectionInfo,
        sessionId: string,
        source: string,
        createObjectExplorerSession: boolean,
    ) {
        // connect to the node if the command came from the context
        const connectionCreds = connectionProfile;
        // if the node isn't connected
        if (createObjectExplorerSession && !sessionId) {
            // connect it first
            await this.createObjectExplorerSession(connectionProfile);
        }
        this._statusview.languageFlavorChanged(newDocUri, Constants.mssqlProviderName);
        // connection string based credential
        if (connectionCreds.connectionString) {
            if ((connectionCreds as IConnectionProfile).savePassword) {
                // look up connection string
                let connectionString = await this._connectionMgr.connectionStore.lookupPassword(
                    connectionCreds,
                    true,
                );
                connectionCreds.connectionString = connectionString;
            }
        }
        await this.connectionManager.connect(newDocUri, connectionCreds);
        this._statusview.sqlCmdModeChanged(newDocUri, false);
        await this.connectionManager.connectionStore.removeRecentlyUsed(
            <IConnectionProfile>connectionCreds,
        );
        sendActionEvent(
            TelemetryViews.ObjectExplorer,
            TelemetryActions.NewQuery,
            {
                nodeType: source,
            },
            undefined, // additionalMeasurements
            connectionProfile as IConnectionProfile,
            this._connectionMgr.getServerInfo(connectionProfile),
        );
        return true;
    }

    private async newQueryFromPrompt(newDocUri: string) {
        // new query command
        const credentials = await this._connectionMgr.onNewConnection();

        // initiate a new OE with same connection
        if (credentials) {
            await this.createObjectExplorerSession(credentials);
        }
        this._statusview.sqlCmdModeChanged(newDocUri, false);
        sendActionEvent(
            TelemetryViews.CommandPalette,
            TelemetryActions.NewQuery,
            undefined,
            undefined,
            credentials as IConnectionProfile,
            this._connectionMgr.getServerInfo(credentials),
        );
        return true;
    }

    /**
     * Opens a new query and creates new connection. Connection precedence is:
     * 1. User right-clicked on an OE node and selected "New Query": use that node's connection profile
     * 2. User triggered "New Query" from command palette and the active document has a connection: copy that to the new document
     * 3. User triggered "New Query" from command palette while they have a connected OE node selected: use that node's connection profile
     * 4. User triggered "New Query" from command palette and there's no reasonable context: prompt for connection to use
     */
    public async onNewQuery(node?: TreeNodeInfo, content?: string): Promise<boolean> {
        if (!this.canRunCommand()) {
            return;
        }

        const currentDocUri = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.document.uri.toString(true)
            : undefined;
        const newEditor = await this._untitledSqlDocumentService.newQuery(content);
        const newDocUri = newEditor.document.uri.toString(true);

        // Case 1: User right-clicked on an OE node and selected "New Query"
        if (node) {
            return await this.newQueryFromProfile(
                newDocUri,
                node.connectionProfile,
                node.sessionId,
                node.nodeType,
                true, // createObjectExplorerSession
            );
        }

        // Case 2: User triggered "New Query" from command palette and the active document has a connection
        if (currentDocUri) {
            const connectionInfo = this._connectionMgr.getConnectionInfo(currentDocUri);

            if (connectionInfo) {
                return await this.newQueryFromProfile(
                    newDocUri,
                    connectionInfo.credentials,
                    undefined, // sessionId
                    "previousEditor",
                    false, //createObjectExplorerSession
                );
            }
        }

        // Case 3: User triggered "New Query" from command palette while they have a connected OE node selected
        const selectedNode = this.objectExplorerTree.selection?.[0];
        if (selectedNode && selectedNode.sessionId) {
            return await this.newQueryFromProfile(
                newDocUri,
                selectedNode.connectionProfile,
                selectedNode.sessionId,
                selectedNode.nodeType,
                true, // createObjectExplorerSession
            );
        }

        // Case 4: User triggered "New Query" from command palette and there's nowhere to get connection context from
        return await this.newQueryFromPrompt(newDocUri);
    }

    public async onSchemaCompare(node?: any): Promise<void> {
        const result = await this.schemaCompareService.schemaCompareGetDefaultOptions();
        const schemaCompareWebView = new SchemaCompareWebViewController(
            this._context,
            this._vscodeWrapper,
            node,
            this.schemaCompareService,
            this._connectionMgr,
            result,
            SchemaCompare.Title,
        );

        schemaCompareWebView.revealToForeground();
    }

    /**
     * Check if the extension launched file exists.
     * This is to detect when we are running in a clean install scenario.
     */
    private doesExtensionLaunchedFileExist(): boolean {
        // check if file already exists on disk
        let filePath = this._context.asAbsolutePath("extensionlaunched.dat");
        try {
            // this will throw if the file does not exist
            fs.statSync(filePath);
            return true;
        } catch (err) {
            try {
                // write out the "first launch" file if it doesn't exist
                fs.writeFile(filePath, "launched", (err) => {
                    return;
                });
            } catch (err) {
                // ignore errors writing first launch file since there isn't really
                // anything we can do to recover in this situation.
            }
            return false;
        }
    }

    /**
     * Called by VS Code when a text document closes. This will dispatch calls to other
     * controllers as needed. Determines if this was a normal closed file, a untitled closed file,
     * or a renamed file
     * @param doc The document that was closed
     */
    public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
        if (this._connectionMgr === undefined || doc === undefined || doc.uri === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        let closedDocumentUri: string = doc.uri.toString(true);
        let closedDocumentUriScheme: string = doc.uri.scheme;

        // Stop timers if they have been started
        if (this._lastSavedTimer) {
            this._lastSavedTimer.end();
        }

        if (this._lastOpenedTimer) {
            this._lastOpenedTimer.end();
        }

        // Determine which event caused this close event

        // If there was a saveTextDoc event just before this closeTextDoc event and it
        // was untitled then we know it was an untitled save
        if (
            this._lastSavedUri &&
            closedDocumentUriScheme === LocalizedConstants.untitledScheme &&
            this._lastSavedTimer?.getDuration() < Constants.untitledSaveTimeThreshold
        ) {
            // Untitled file was saved and connection will be transfered
            await this.updateUri(closedDocumentUri, this._lastSavedUri);

            // If there was an openTextDoc event just before this closeTextDoc event then we know it was a rename
        } else if (
            this._lastOpenedUri &&
            this._lastSavedTimer?.getDuration() < Constants.untitledSaveTimeThreshold
        ) {
            await this.updateUri(closedDocumentUri, this._lastOpenedUri);
        } else {
            // Pass along the close event to the other handlers for a normal closed file
            await this._connectionMgr.onDidCloseTextDocument(doc);
            this._outputContentProvider.onDidCloseTextDocument(doc);
        }

        // clean up: if a document is closed with actual plan enabled, remove it
        // from our status list
        if (this._queryResultWebviewController.actualPlanStatuses.includes(closedDocumentUri)) {
            this._queryResultWebviewController.actualPlanStatuses.filter(
                (uri) => uri != closedDocumentUri,
            );
            vscode.commands.executeCommand(
                "setContext",
                "mssql.executionPlan.urisWithActualPlanEnabled",
                this._queryResultWebviewController.actualPlanStatuses,
            );
        }

        // Reset special case timers and events
        this._lastSavedUri = undefined;
        this._lastSavedTimer = undefined;
        this._lastOpenedTimer = undefined;
        this._lastOpenedUri = undefined;

        // Remove diagnostics for the related file
        let diagnostics = SqlToolsServerClient.instance.diagnosticCollection;
        if (diagnostics.has(doc.uri)) {
            diagnostics.delete(doc.uri);
        }

        // Delete filters and dimension states for the closed document
        store.deleteMainKey(closedDocumentUri);
    }

    private async updateUri(oldUri: string, newUri: string) {
        // Transfer the connection to the new URI
        await this._connectionMgr.copyConnectionToFile(oldUri, newUri);

        // Call STS  & Query Runner to update URI
        this._outputContentProvider.updateQueryRunnerUri(oldUri, newUri);

        // Update the URI in the output content provider query result map
        this._outputContentProvider.onUntitledFileSaved(oldUri, newUri);

        let state = this._queryResultWebviewController.getQueryResultState(oldUri);
        if (state) {
            state.uri = newUri;

            await this._queryResultWebviewController.sendNotification(
                StateChangeNotification.type<QueryResultWebviewState>(),
                state,
            );

            //Update the URI in the query result webview state
            this._queryResultWebviewController.setQueryResultState(newUri, state);
            this._queryResultWebviewController.deleteQueryResultState(oldUri);
        }
    }

    /**
     * Called by VS Code when a text document is opened. Checks if a SQL file was opened
     * to enable features of our extension for the document.
     */
    public onDidOpenTextDocument(doc: vscode.TextDocument): void {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }
        this._connectionMgr.onDidOpenTextDocument(doc);

        if (this._previousActiveDocument && doc.languageId === Constants.languageId) {
            void this._connectionMgr.copyConnectionToFile(
                this._previousActiveDocument.uri.toString(true),
                doc.uri.toString(true),
                true /* keepOldConnected */,
            );
        }

        if (doc && doc.languageId === Constants.languageId) {
            // set encoding to false
            this._statusview.languageFlavorChanged(
                doc.uri.toString(true),
                Constants.mssqlProviderName,
            );
        }

        // Setup properties incase of rename
        this._lastOpenedTimer = new Utils.Timer();
        this._lastOpenedTimer.start();

        if (doc && doc.uri) {
            this._lastOpenedUri = doc.uri.toString(true);

            // pre-opened tabs won't trigger onDidChangeActiveTextEditor, so set _previousActiveEditor here
            this._previousActiveDocument =
                doc.languageId === Constants.languageId ? doc : undefined;
        }
    }

    /**
     * Tracks the previous editor for the purposes of transferring connections to a newly-opened file.
     * Set to undefined if the previous editor is not a SQL file (languageId === mssql).
     */
    private _previousActiveDocument: vscode.TextDocument | undefined;

    public onDidChangeActiveTextEditor(editor: vscode.TextEditor): void {
        if (editor?.document) {
            this._previousActiveDocument =
                editor.document.languageId === Constants.languageId ? editor.document : undefined;
        }
    }

    /**
     * Called by VS Code when a text document is saved. Will trigger a timer to
     * help determine if the file was a file saved from an untitled file.
     * @param doc The document that was saved
     */
    public onDidSaveTextDocument(doc: vscode.TextDocument): void {
        if (this._connectionMgr === undefined) {
            // Avoid processing events before initialization is complete
            return;
        }

        // Set encoding to false by giving true as argument
        let savedDocumentUri: string = doc.uri.toString(true);

        // Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
        this._lastSavedTimer = new Utils.Timer();
        this._lastSavedTimer.start();
        this._lastSavedUri = savedDocumentUri;
    }

    private onChangeQueryHistoryConfig(): void {
        let queryHistoryFeatureEnabled = this._vscodeWrapper
            .getConfiguration(Constants.extensionConfigSectionName)
            .get(Constants.configEnableQueryHistoryFeature);
        if (queryHistoryFeatureEnabled) {
            this.initializeQueryHistory();
        }
    }

    /**
     * Called by VS Code when user settings are changed
     * @param ConfigurationChangeEvent event that is fired when config is changed
     */
    public async onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (!e.affectsConfiguration(Constants.extensionName)) {
            return;
        }

        this.onChangeQueryHistoryConfig();
        const needsRefresh = await this.onChangeConnectionConfig(e);
        await this.onChangeGroupBySchemaConfig(e);

        if (needsRefresh) {
            this._objectExplorerProvider.refresh(undefined);
        }
        if (e.affectsConfiguration(Constants.mssqlPiiLogging)) {
            this.updatePiiLoggingLevel();
        }

        // Prompt to reload VS Code when any of these settings are updated.
        const configSettingsRequiringReload = [
            Constants.enableSqlAuthenticationProvider,
            Constants.enableConnectionPooling,
            Constants.configEnableExperimentalFeatures,
            Constants.configEnableRichExperiences,
            Constants.configUseLegacyConnectionExperience,
            Constants.configUseLegacyQueryResultExperience,
        ];

        if (configSettingsRequiringReload.some((setting) => e.affectsConfiguration(setting))) {
            await this.displayReloadMessage(LocalizedConstants.reloadPromptGeneric);
        }
    }

    private async onChangeGroupBySchemaConfig(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (!e.affectsConfiguration(Constants.cmdObjectExplorerGroupBySchemaFlagName)) {
            return;
        }

        let errorFoundWhileRefreshing = false;
        (await this._objectExplorerProvider.getChildren()).forEach((n: TreeNodeInfo) => {
            try {
                void this._objectExplorerProvider.refreshNode(n);
            } catch (e) {
                errorFoundWhileRefreshing = true;
                this._connectionMgr.client.logger.error(e);
            }
        });
        if (errorFoundWhileRefreshing) {
            Utils.showErrorMsg(LocalizedConstants.objectExplorerNodeRefreshError);
        }
    }

    /**
     * Updates the Object Explorer connections based on the user settings, removing stale connections and adding new ones.
     * @returns true if the Object Explorer should be refreshed, false otherwise.
     */
    private async onChangeConnectionConfig(e: vscode.ConfigurationChangeEvent): Promise<boolean> {
        if (
            !e.affectsConfiguration(`mssql.${Constants.connectionsArrayName}`) &&
            !e.affectsConfiguration(`mssql.${Constants.connectionGroupsArrayName}`)
        ) {
            return false;
        }

        let needsRefresh = false;

        // 1. If the connectionsGroup setting has changed, Object Explorer always needs to be refreshed
        if (e.affectsConfiguration(`mssql.${Constants.connectionGroupsArrayName}`)) {
            needsRefresh = true;
        }

        // 2. Handle connections that have been added, removed, or reparented in OE
        let configConnections =
            await this.connectionManager.connectionStore.connectionConfig.getConnections(
                true /* alsoGetFromWorkspace */,
            );
        let objectExplorerConnections = this._objectExplorerProvider.connections;

        let result = await this.handleRemovedConns(objectExplorerConnections, configConnections);
        needsRefresh ||= result;

        result = await this.handleAddedConns(objectExplorerConnections, configConnections);
        needsRefresh ||= result;

        // no side-effects, so can be skipped if OE refresh is already needed
        needsRefresh ||= await this.checkForMovedConns(configConnections);

        // 3. Ensure passwords have been saved to the credential store instead of to config JSON
        await this.sanitizeConnectionProfiles();

        if (
            needsRefresh &&
            this._vscodeWrapper
                .getConfiguration()
                .get<boolean>(Constants.configStatusBarEnableConnectionColor)
        ) {
            // update status bar connection colors
            void this._statusview.updateConnectionColors();
        }

        return needsRefresh;
    }

    /** Determine if any connections have had their groupId changed.
     * This function has no side-effects, so it can be skipped if an OE refresh is already needed.
     */
    private async checkForMovedConns(configConnections: IConnectionProfile[]): Promise<boolean> {
        for (const connProfile of configConnections) {
            if (
                connProfile.groupId !==
                this._objectExplorerProvider.objectExplorerService.getConnectionNodeById(
                    connProfile.id,
                )?.connectionProfile.groupId
            ) {
                return true;
            }
        }

        return false;
    }

    private async handleAddedConns(
        oeConnections: IConnectionProfile[],
        configConnections: IConnectionProfile[],
    ): Promise<boolean> {
        let needsRefresh = false;

        // if a connection was manually added
        let newConnections = configConnections.filter((userConn) => {
            return !oeConnections.some((oeConn) => Utils.isSameConnectionInfo(userConn, oeConn));
        });
        for (let conn of newConnections) {
            // if a connection is not connected, that means it was added manually
            const newConnectionProfile = <IConnectionProfile>conn;
            const uri = ObjectExplorerUtils.getNodeUriFromProfile(newConnectionProfile);
            if (
                !this.connectionManager.isActiveConnection(conn) &&
                !this.connectionManager.isConnecting(uri)
            ) {
                // add a disconnected node for the connection
                this._objectExplorerProvider.addDisconnectedNode(conn);
                needsRefresh = true;
            }
        }

        return needsRefresh;
    }

    private async handleRemovedConns(
        oeConnections: IConnectionProfile[],
        configConnections: IConnectionProfile[],
    ): Promise<boolean> {
        let needsRefresh = false;

        // if a connection was manually removed...
        let staleConnections = oeConnections.filter((oeConn) => {
            return !configConnections.some((configConn) =>
                Utils.isSameConnectionInfo(oeConn, configConn),
            );
        });
        // ...disconnect that connection and remove its creds from the credential store and MRU
        for (let conn of staleConnections) {
            let profile = <IConnectionProfile>conn;
            if (this.connectionManager.isActiveConnection(conn)) {
                const uri = this.connectionManager.getUriForConnection(conn);
                await this.connectionManager.disconnect(uri);
            }
            await this.connectionManager.connectionStore.removeRecentlyUsed(profile);
            if (
                profile.authenticationType === Constants.sqlAuthentication &&
                profile.savePassword
            ) {
                await this.connectionManager.deleteCredential(profile);
            }
        }
        // remove them from object explorer
        await this._objectExplorerProvider.removeConnectionNodes(staleConnections);
        needsRefresh ||= staleConnections.length > 0;

        return needsRefresh;
    }

    /**
     * Updates Pii Logging configuration for Logger.
     */
    private updatePiiLoggingLevel(): void {
        const piiLogging: boolean = vscode.workspace
            .getConfiguration(Constants.extensionName)
            .get(Constants.piiLogging, false);
        SqlToolsServerClient.instance.logger.piiLogging = piiLogging;
    }

    /**
     * Display notification with button to reload
     * return true if button clicked
     * return false if button not clicked
     */
    private async displayReloadMessage(reloadPrompt: string): Promise<boolean> {
        const result = await vscode.window.showInformationMessage(
            reloadPrompt,
            LocalizedConstants.reloadChoice,
        );
        if (result === LocalizedConstants.reloadChoice) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
            return true;
        } else {
            return false;
        }
    }

    private async isContainerReadyForCommands(node: TreeNodeInfo): Promise<boolean> {
        const containerName = node.connectionProfile?.containerName;
        const prepResult = await prepareForDockerContainerCommand(containerName);
        if (!prepResult.success) {
            if (
                prepResult.error ===
                LocalizedConstants.ContainerDeployment.containerDoesNotExistError
            ) {
                node.loadingLabel = LocalizedConstants.Common.error;
                const confirmation = await vscode.window.showInformationMessage(
                    prepResult.error,
                    { modal: true },
                    LocalizedConstants.RemoveProfileLabel,
                );
                if (confirmation === LocalizedConstants.RemoveProfileLabel) {
                    await this._objectExplorerProvider.removeNode(node as ConnectionNode, false);
                }
            } else {
                vscode.window.showErrorMessage(prepResult.error);
            }
        }
        return prepResult.success;
    }

    public removeAadAccount(prompter: IPrompter): void {
        void this.connectionManager.removeAccount(prompter);
    }

    public addAadAccount(): void {
        void this.connectionManager.addAccount();
    }

    public onClearAzureTokenCache(): void {
        this.connectionManager.onClearTokenCache();
    }

    private ExecutionPlanCustomEditorProvider = class implements vscode.CustomTextEditorProvider {
        constructor(
            public context: vscode.ExtensionContext,
            public vscodeWrapper: VscodeWrapper,
            public executionPlanService: ExecutionPlanService,
            public untitledSqlService: UntitledSqlDocumentService,
        ) {
            this.context = context;
            this.executionPlanService = executionPlanService;
            this.untitledSqlService = untitledSqlService;
        }

        public async resolveCustomTextEditor(document: vscode.TextDocument): Promise<void> {
            await this.onOpenExecutionPlanFile(document);
        }

        public async onOpenExecutionPlanFile(document: vscode.TextDocument) {
            const planContents = document.getText();
            let docName = document.fileName;
            docName = docName.substring(docName.lastIndexOf(path.sep) + 1);

            vscode.commands.executeCommand("workbench.action.closeActiveEditor");

            const executionPlanController = new ExecutionPlanWebviewController(
                this.context,
                this.vscodeWrapper,
                this.executionPlanService,
                this.untitledSqlService,
                planContents,
                docName,
            );

            executionPlanController.revealToForeground();

            sendActionEvent(TelemetryViews.ExecutionPlan, TelemetryActions.Open);
        }
    };
}
