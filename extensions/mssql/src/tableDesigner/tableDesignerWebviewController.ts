/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import { randomUUID } from "crypto";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import * as designer from "../sharedInterfaces/tableDesigner";
import SqlDocumentService, { ConnectionStrategy } from "../controllers/sqlDocumentService";
import { getDesignerView } from "./tableDesignerTabDefinition";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { IConnectionProfile } from "../models/interfaces";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { LoadingLogEntry } from "../sharedInterfaces/webview";
import * as LocConstants from "../constants/locConstants";
import { UserSurvey } from "../nps/userSurvey";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { getErrorMessage } from "../utils/utils";
import VscodeWrapper from "../controllers/vscodeWrapper";
import logger2 from "../models/logger2";

const TABLE_DESIGNER_VIEW_ID = "tableDesigner";
const logger = logger2.withPrefix("TableDesignerWebviewController");

export class TableDesignerWebviewController extends WebviewPanelController<
    designer.TableDesignerWebviewState,
    designer.TableDesignerReducers
> {
    private _isEdit: boolean = false;
    private _correlationId: string = randomUUID();
    private _sessionId: string = randomUUID();
    private _progressListener:
        | ((progress: designer.TableDesignerProgressNotificationParams) => void)
        | undefined;
    private _messageListener:
        | ((message: designer.TableDesignerMessageNotificationParams) => void)
        | undefined;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private _tableDesignerService: designer.ITableDesignerService,
        private _connectionManager: ConnectionManager,
        private _sqlDocumentService: SqlDocumentService,
        private _targetNode?: TreeNodeInfo,
        private _objectExplorerProvider?: ObjectExplorerProvider,
        private _objectExplorerTree?: vscode.TreeView<TreeNodeInfo>,
    ) {
        super(
            context,
            vscodeWrapper,
            TABLE_DESIGNER_VIEW_ID,
            TABLE_DESIGNER_VIEW_ID,
            {
                apiState: {
                    editState: designer.LoadState.NotStarted,
                    generateScriptState: designer.LoadState.NotStarted,
                    previewState: designer.LoadState.NotStarted,
                    publishState: designer.LoadState.NotStarted,
                    initializeState: designer.LoadState.Loading,
                },
                loadingMessages: [],
                hasUnpublishedChanges: false,
            },
            {
                title: "Table Designer",
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableDesignerEditor_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableDesignerEditor_light.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );
        this.registerRpcHandlers();
        this.setupTableDesignerProgressListeners();
        void this.initializeAfterWebviewReady();
    }

    private async initializeAfterWebviewReady() {
        try {
            await this.whenWebviewReady();
        } catch {
            // If the ready signal times out, still attempt initialization.
        }

        if (this.state.apiState?.initializeState === designer.LoadState.Loading) {
            await this.initialize();
        }
    }

    private async initialize() {
        if (!this._targetNode) {
            const errorMessage = "Unable to find object explorer node";
            sendErrorEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Initialize,
                new Error(errorMessage),
                true, //includeErrorMessage
                undefined, // errorCode
                "unableToFindObjectExplorerNode",
            );
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Error,
                },
                initializationError: errorMessage,
                loadingMessages: this.appendLoadingMessage(errorMessage, true),
            };
            return;
        }

        this._isEdit =
            this._targetNode.nodeType === "Table" || this._targetNode.nodeType === "View"
                ? true
                : false;

        this.showRestorePromptAfterClose = !this._isEdit; // Show restore prompt only for new table creation.

        const targetDatabase = this.getDatabaseNameForNode(this._targetNode);
        // get database name from connection string
        const databaseName = targetDatabase ? targetDatabase : "master";
        // clone connection info and set database name

        this.state = {
            ...this.state,
            apiState: {
                ...this.state.apiState,
                initializeState: designer.LoadState.Loading,
            },
        };

        let connectionInfo = this._targetNode.connectionProfile;

        try {
            connectionInfo = (await this._connectionManager.prepareConnectionInfo(
                connectionInfo,
            )) as IConnectionProfile;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(getErrorMessage(e));
            sendErrorEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Initialize,
                error,
                true, //includeErrorMessage
                undefined, // errorCode
                "prepareConnectionInfoFailed",
            );
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Error,
                },
                initializationError: getErrorMessage(e),
                loadingMessages: this.appendLoadingMessage(getErrorMessage(e), true),
            };
            return;
        }

        this._targetNode.updateConnectionProfile(connectionInfo);
        connectionInfo.database = databaseName;

        let connectionString: string | undefined;
        try {
            const connectionDetails =
                await this._connectionManager.createConnectionDetails(connectionInfo);
            connectionString = await this._connectionManager.getConnectionString(
                connectionDetails,
                true,
                true,
            );

            if (!connectionString || connectionString === "") {
                const errorMessage = "Unable to find connection string for the connection";
                sendErrorEvent(
                    TelemetryViews.TableDesigner,
                    TelemetryActions.Initialize,
                    new Error(errorMessage),
                    true, //includeErrorMessage
                    undefined, // errorCode
                    "unableToFindConnectionString",
                );

                this.state = {
                    ...this.state,
                    apiState: {
                        ...this.state.apiState,
                        initializeState: designer.LoadState.Error,
                    },
                    initializationError: errorMessage,
                    loadingMessages: this.appendLoadingMessage(errorMessage, true),
                };

                return;
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(getErrorMessage(e));
            sendErrorEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Initialize,
                error,
                false, //includeErrorMessage
                undefined, // errorCode
                "unableToFindConnectionString",
            );
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Error,
                },
                initializationError: getErrorMessage(e),
                loadingMessages: this.appendLoadingMessage(getErrorMessage(e), true),
            };
            return;
        }

        const endActivity = startActivity(
            TelemetryViews.TableDesigner,
            TelemetryActions.Initialize,
            this._correlationId,
            {
                correlationId: this._correlationId,
                isEdit: this._isEdit.toString(),
            },
        );
        const accessToken = connectionInfo.azureAccountToken
            ? connectionInfo.azureAccountToken
            : undefined;
        try {
            let tableInfo: designer.TableInfo;
            if (this._isEdit) {
                tableInfo = {
                    id: this._sessionId,
                    isNewTable: false,
                    title: this._targetNode.label as string,
                    tooltip: `${connectionInfo.server} - ${databaseName} - ${this._targetNode.label}`,
                    server: connectionInfo.server,
                    database: databaseName,
                    connectionString: connectionString,
                    accessToken: accessToken,
                    schema: this._targetNode.metadata.schema,
                    name: this._targetNode.metadata.name,
                };
            } else {
                tableInfo = {
                    id: this._sessionId,
                    isNewTable: true,
                    title: "New Table",
                    tooltip: `${connectionInfo.server} - ${databaseName} - New Table`,
                    server: connectionInfo.server,
                    database: databaseName,
                    accessToken: accessToken,
                    connectionString: connectionString,
                };
            }
            this.panel.title = tableInfo.title;
            const initializeResult = await this._tableDesignerService.initializeTableDesigner({
                sessionId: this._sessionId,
                tableInfo,
            });
            endActivity.end(ActivityStatus.Succeeded);
            initializeResult.tableInfo.database = databaseName ?? "master";
            this.state = {
                tableInfo: initializeResult.tableInfo,
                view: getDesignerView(initializeResult.view),
                model: initializeResult.viewModel,
                issues: initializeResult.issues,
                isValid: true,
                hasUnpublishedChanges: false,
                tabStates: {
                    mainPaneTab: designer.DesignerMainPaneTabs.Columns,
                    resultPaneTab: designer.DesignerResultPaneTabs.Script,
                },
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Loaded,
                },
                initializationError: undefined,
                loadingMessages: this.appendLoadingMessage("Table designer loaded"),
            };
        } catch (e) {
            endActivity.endFailed(e, false);
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Error,
                },
                initializationError: getErrorMessage(e),
                loadingMessages: this.appendLoadingMessage(getErrorMessage(e), true),
            };
        }
    }

    private getDatabaseNameForNode(node: TreeNodeInfo): string {
        if (node.metadata?.metadataTypeName === "Database") {
            return node.metadata.name;
        } else {
            if (node.parentNode) {
                return this.getDatabaseNameForNode(node.parentNode);
            }
        }
        return "";
    }

    public override dispose() {
        if (this._progressListener) {
            this._tableDesignerService.removeProgressListener(this._progressListener);
            this._progressListener = undefined;
        }
        if (this._messageListener) {
            this._tableDesignerService.removeMessageListener(this._messageListener);
            this._messageListener = undefined;
        }
        this._tableDesignerService.disposeTableDesigner(this.state.tableInfo);
        super.dispose();
        sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.Close, {
            correlationId: this._correlationId,
        });
    }

    private registerRpcHandlers() {
        this.registerReducer("processTableEdit", async (state, payload) => {
            try {
                const editResponse = await this._tableDesignerService.processTableEdit(
                    payload.table,
                    payload.tableChangeInfo,
                );
                sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.Edit, {
                    type: payload.tableChangeInfo.type.toString(),
                    source: payload.tableChangeInfo.source,
                    correlationId: this._correlationId,
                });
                if (editResponse.issues?.length === 0) {
                    state.tabStates.resultPaneTab = designer.DesignerResultPaneTabs.Script;
                } else {
                    state.tabStates.resultPaneTab = designer.DesignerResultPaneTabs.Issues;
                }

                this.showRestorePromptAfterClose = true;

                const afterEditState = {
                    ...state,
                    view: editResponse.view ? getDesignerView(editResponse.view) : state.view,
                    model: editResponse.viewModel,
                    issues: editResponse.issues,
                    isValid: editResponse.isValid,
                    apiState: {
                        ...state.apiState,
                        editState: designer.LoadState.Loaded,
                        previewState: designer.LoadState.NotStarted,
                        publishState: designer.LoadState.NotStarted,
                    },
                    hasUnpublishedChanges: true,
                };

                return afterEditState;
            } catch (e) {
                const error = e instanceof Error ? e : new Error(getErrorMessage(e));

                sendErrorEvent(
                    TelemetryViews.TableDesigner,
                    TelemetryActions.Edit,
                    error,
                    false, //includeErrorMessage
                );
                vscode.window.showErrorMessage(getErrorMessage(e));
                return state;
            }
        });

        this.registerReducer("publishChanges", async (state, payload) => {
            const publishProgressMessages: LoadingLogEntry[] = [];
            const endActivity = startActivity(
                TelemetryViews.TableDesigner,
                TelemetryActions.Publish,
                this._correlationId,
                {
                    correlationId: this._correlationId,
                },
            );
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    publishState: designer.LoadState.Loading,
                },
                publishProgressMessages,
            };
            state = {
                ...state,
                apiState: {
                    ...state.apiState,
                    publishState: designer.LoadState.Loading,
                },
                publishProgressMessages,
            };
            try {
                const publishResponse = await this._tableDesignerService.publishChanges(
                    payload.table,
                );
                endActivity.end(ActivityStatus.Succeeded);
                state = {
                    ...state,
                    tableInfo: publishResponse.newTableInfo,
                    view: getDesignerView(publishResponse.view),
                    model: publishResponse.viewModel,
                    apiState: {
                        ...state.apiState,
                        publishState: designer.LoadState.Loaded,
                        previewState: designer.LoadState.NotStarted,
                    },
                    hasUnpublishedChanges: false,
                };
                this._sessionId = publishResponse.newTableInfo.id;
                this.panel.title = state.tableInfo.title;
                this.showRestorePromptAfterClose = false;
                UserSurvey.getInstance().promptUserForNPSFeedback(TABLE_DESIGNER_VIEW_ID);
            } catch (e) {
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        publishState: designer.LoadState.Error,
                    },
                    publishingError: e.toString(),
                    publishProgressMessages: this.appendProgressMessage(
                        state.publishProgressMessages,
                        getErrorMessage(e),
                        true,
                    ),
                };
                endActivity.endFailed(e, false);
            }

            let targetNode = this._targetNode;
            // In case of table edit, we need to refresh the tables folder to get the new updated table
            if (this._targetNode.context.subType !== "Tables") {
                targetNode = this._targetNode.parentNode; // Setting the target node to the parent node to refresh the tables folder
            }
            if (targetNode) {
                await this._objectExplorerTree.reveal(targetNode, {
                    expand: true,
                    select: true,
                });
                await this._objectExplorerProvider.refreshNode(targetNode);
            }
            return state;
        });

        this.registerReducer("generateScript", async (state, payload) => {
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    generateScriptState: designer.LoadState.Loading,
                },
            };
            try {
                const script = await this._tableDesignerService.generateScript(payload.table);
                sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.GenerateScript, {
                    correlationId: this._correlationId,
                });
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        generateScriptState: designer.LoadState.Loaded,
                    },
                };
                await this._sqlDocumentService.newQuery({
                    content: script,
                    connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                    connectionInfo: payload.table.connectionInfo,
                });
                UserSurvey.getInstance().promptUserForNPSFeedback(TABLE_DESIGNER_VIEW_ID);
            } catch (e) {
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        generateScriptState: designer.LoadState.Error,
                    },
                };
                vscode.window.showErrorMessage(getErrorMessage(e));
            }
            return state;
        });

        this.registerReducer("generatePreviewReport", async (state, payload) => {
            const reportProgressMessages: LoadingLogEntry[] = [];
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    previewState: designer.LoadState.Loading,
                    publishState: designer.LoadState.NotStarted,
                    generateScriptState: designer.LoadState.NotStarted,
                },
                publishingError: undefined,
                reportProgressMessages,
            };
            state = {
                ...state,
                apiState: {
                    ...state.apiState,
                    previewState: designer.LoadState.Loading,
                    publishState: designer.LoadState.NotStarted,
                    generateScriptState: designer.LoadState.NotStarted,
                },
                publishingError: undefined,
                reportProgressMessages,
            };
            try {
                const previewReport = await this._tableDesignerService.generatePreviewReport(
                    payload.table,
                );
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        previewState: previewReport.schemaValidationError
                            ? designer.LoadState.Error
                            : designer.LoadState.Loaded,
                        publishState: designer.LoadState.NotStarted,
                        generateScriptState: designer.LoadState.NotStarted,
                    },
                    generatePreviewReportResult: previewReport,
                    reportProgressMessages: previewReport.schemaValidationError
                        ? this.appendProgressMessage(
                              state.reportProgressMessages,
                              previewReport.schemaValidationError,
                              true,
                          )
                        : state.reportProgressMessages,
                };
            } catch (e) {
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        previewState: designer.LoadState.Error,
                        publishState: designer.LoadState.NotStarted,
                        generateScriptState: designer.LoadState.NotStarted,
                    },
                    generatePreviewReportResult: {
                        schemaValidationError: getErrorMessage(e),
                        report: "",
                        mimeType: "",
                    },
                    reportProgressMessages: this.appendProgressMessage(
                        state.reportProgressMessages,
                        getErrorMessage(e),
                        true,
                    ),
                };
            }
            sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.GenerateScript, {
                correlationId: this._correlationId,
            });

            return state;
        });

        this.onNotification(designer.InitializeTableDesignerNotification.type, async () => {
            await this.initialize();
        });

        this.onNotification(designer.ScriptAsCreateNotification.type, async (params) => {
            await this._sqlDocumentService.newQuery({
                content: params.script,
                connectionStrategy: ConnectionStrategy.DoNotConnect,
            });
        });

        this.onNotification(
            designer.CopyScriptAsCreateToClipboardNotification.type,
            async (params) => {
                await vscode.env.clipboard.writeText(params.script);
                await vscode.window.showInformationMessage(LocConstants.scriptCopiedToClipboard);
            },
        );

        this.registerReducer("setTab", async (state, payload) => {
            state.tabStates.mainPaneTab = payload.tabId;
            return state;
        });

        this.registerReducer("setPropertiesComponents", async (state, payload) => {
            state.propertiesPaneData = payload.components;
            return state;
        });

        this.registerReducer("setResultTab", async (state, payload) => {
            state.tabStates.resultPaneTab = payload.tabId;
            return state;
        });

        this.onNotification(designer.CloseDesignerNotification.type, async () => {
            sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.Close, {
                correlationId: this._correlationId,
            });
            this.panel.dispose();
        });

        this.registerReducer("continueEditing", async (state) => {
            this.state.apiState.publishState = designer.LoadState.NotStarted;
            sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.ContinueEditing, {
                correlationId: this._correlationId,
            });
            return state;
        });

        this.onNotification(
            designer.CopyPublishErrorToClipboardNotification.type,
            async (params) => {
                await vscode.env.clipboard.writeText(params.error);
                void vscode.window.showInformationMessage(LocConstants.copied);
            },
        );
    }

    private setupTableDesignerProgressListeners() {
        this._progressListener = (progress) => {
            if (progress.sessionId !== this._sessionId) {
                return;
            }

            logger.info("Progress", progress);
            this.appendOperationProgress(progress.operation, progress.message, progress.status);

            try {
                void this.sendNotification(
                    designer.TableDesignerProgressNotification.type,
                    progress,
                );
            } catch {
                // Ignore notifications racing with webview disposal.
            }
        };

        this._messageListener = (message) => {
            if (message.sessionId !== this._sessionId) {
                return;
            }

            logger.info("Message", message);
            this.appendOperationProgress(message.operation, message.message, message.messageType);

            try {
                void this.sendNotification(designer.TableDesignerMessageNotification.type, message);
            } catch {
                // Ignore notifications racing with webview disposal.
            }
        };

        this._tableDesignerService.onProgress(this._progressListener);
        this._tableDesignerService.onMessage(this._messageListener);
    }

    private appendLoadingMessage(message: string, isError = false): LoadingLogEntry[] {
        return this.appendProgressMessage(this.state.loadingMessages, message, isError);
    }

    private appendProgressMessage(
        messages: LoadingLogEntry[] | undefined,
        message: string,
        isError = false,
    ): LoadingLogEntry[] {
        const nextMessage: LoadingLogEntry = {
            message,
            kind: isError ? "error" : "progress",
        };
        const currentMessages = messages ?? [];
        const previousMessage = currentMessages[currentMessages.length - 1];
        if (
            previousMessage?.message === nextMessage.message &&
            previousMessage?.kind === nextMessage.kind
        ) {
            return currentMessages;
        }

        return [...currentMessages, nextMessage];
    }

    private appendOperationProgress(
        operation: string,
        message: string,
        statusOrMessageType: string,
    ) {
        const normalizedOperation = operation.toLowerCase();
        const isError = this.isErrorStatus(statusOrMessageType);
        if (normalizedOperation.includes("report") || normalizedOperation.includes("preview")) {
            this.state = {
                ...this.state,
                reportProgressMessages: this.appendProgressMessage(
                    this.state.reportProgressMessages,
                    message,
                    isError,
                ),
            };
            return;
        }

        if (normalizedOperation.includes("publish")) {
            this.state = {
                ...this.state,
                publishProgressMessages: this.appendProgressMessage(
                    this.state.publishProgressMessages,
                    message,
                    isError,
                ),
            };
            return;
        }

        this.state = {
            ...this.state,
            loadingMessages: this.appendLoadingMessage(message, isError),
        };
    }

    private isErrorStatus(statusOrMessageType: string): boolean {
        const normalized = statusOrMessageType.toLowerCase();
        return normalized === "error" || normalized === "failed";
    }
}
