/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import { randomUUID } from "crypto";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import * as designer from "../sharedInterfaces/tableDesigner";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { getDesignerView } from "./tableDesignerTabDefinition";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
import { sendActionEvent } from "../telemetry/telemetry";
import {
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { copied, scriptCopiedToClipboard } from "../constants/locConstants";
import { UserSurvey } from "../nps/userSurvey";

export class TableDesignerWebviewController extends ReactWebviewPanelController<
    designer.TableDesignerWebviewState,
    designer.TableDesignerReducers
> {
    private _isEdit: boolean = false;
    private _correlationId: string = randomUUID();

    constructor(
        context: vscode.ExtensionContext,
        private _tableDesignerService: designer.ITableDesignerService,
        private _connectionManager: ConnectionManager,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _targetNode?: TreeNodeInfo,
    ) {
        super(
            context,
            "tableDesigner",
            {
                apiState: {
                    editState: designer.LoadState.NotStarted,
                    generateScriptState: designer.LoadState.NotStarted,
                    previewState: designer.LoadState.NotStarted,
                    publishState: designer.LoadState.NotStarted,
                    initializeState: designer.LoadState.Loading,
                },
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
                showRestorePromptAfterClose: true,
            },
        );
        void this.initialize();
    }

    private async initialize() {
        const intializeStartTime = Date.now();
        if (!this._targetNode) {
            await vscode.window.showErrorMessage(
                "Unable to find object explorer node",
            );
            return;
        }

        this._isEdit =
            this._targetNode.nodeType === "Table" ||
            this._targetNode.nodeType === "View"
                ? true
                : false;

        const targetDatabase = this.getDatabaseNameForNode(this._targetNode);
        // get database name from connection string
        const databaseName = targetDatabase ? targetDatabase : "master";

        const connectionInfo = this._targetNode.connectionInfo;
        connectionInfo.database = databaseName;

        const connectionDetails =
            await this._connectionManager.createConnectionDetails(
                connectionInfo,
            );
        const connectionString =
            await this._connectionManager.getConnectionString(
                connectionDetails,
                true,
                true,
            );

        if (!connectionString || connectionString === "") {
            await vscode.window.showErrorMessage(
                "Unable to find connection string for the connection",
            );
            return;
        }

        try {
            let tableInfo: designer.TableInfo;
            if (this._isEdit) {
                tableInfo = {
                    id: randomUUID(),
                    isNewTable: false,
                    title: this._targetNode.label as string,
                    tooltip: `${connectionInfo.server} - ${databaseName} - ${this._targetNode.label}`,
                    server: connectionInfo.server,
                    database: databaseName,
                    connectionString: connectionString,
                    schema: this._targetNode.metadata.schema,
                    name: this._targetNode.metadata.name,
                };
            } else {
                tableInfo = {
                    id: randomUUID(),
                    isNewTable: true,
                    title: "New Table",
                    tooltip: `${connectionInfo.server} - ${databaseName} - New Table`,
                    server: connectionInfo.server,
                    database: databaseName,
                    connectionString: connectionString,
                };
            }
            this.panel.title = tableInfo.title;
            const intializeData =
                await this._tableDesignerService.initializeTableDesigner(
                    tableInfo,
                );
            const intializeEndTime = Date.now();
            sendActionEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Initialize,
                {
                    correlationId: this._correlationId,
                    isEdit: this._isEdit.toString(),
                },
                {
                    durationMs: intializeEndTime - intializeStartTime,
                },
            );
            intializeData.tableInfo.database = databaseName ?? "master";
            this.state = {
                tableInfo: tableInfo,
                view: getDesignerView(intializeData.view),
                model: intializeData.viewModel,
                issues: intializeData.issues,
                isValid: true,
                tabStates: {
                    mainPaneTab: designer.DesignerMainPaneTabs.Columns,
                    resultPaneTab: designer.DesignerResultPaneTabs.Script,
                },
                apiState: {
                    ...this.state.apiState,
                    initializeState: designer.LoadState.Loaded,
                },
            };
        } catch (e) {
            this.state.apiState.initializeState = designer.LoadState.Error;
            this.state = this.state;
        }

        this.registerRpcHandlers();
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
        this._tableDesignerService.disposeTableDesigner(this.state.tableInfo);
        super.dispose();
        sendActionEvent(TelemetryViews.TableDesigner, TelemetryActions.Close, {
            correlationId: this._correlationId,
        });
    }

    private registerRpcHandlers() {
        this.registerReducer("processTableEdit", async (state, payload) => {
            const editResponse =
                await this._tableDesignerService.processTableEdit(
                    payload.table,
                    payload.tableChangeInfo,
                );
            sendActionEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Edit,
                {
                    type: payload.tableChangeInfo.type.toString(),
                    source: payload.tableChangeInfo.source,
                    correlationId: this._correlationId,
                },
            );
            if (editResponse.issues?.length === 0) {
                state.tabStates.resultPaneTab =
                    designer.DesignerResultPaneTabs.Script;
            } else {
                state.tabStates.resultPaneTab =
                    designer.DesignerResultPaneTabs.Issues;
            }

            const afterEditState = {
                ...state,
                view: editResponse.view
                    ? getDesignerView(editResponse.view)
                    : state.view,
                model: editResponse.viewModel,
                issues: editResponse.issues,
                isValid: editResponse.isValid,
                apiState: {
                    ...state.apiState,
                    editState: designer.LoadState.Loaded,
                },
            };
            return afterEditState;
        });

        this.registerReducer("publishChanges", async (state, payload) => {
            this.state = {
                ...this.state,
                apiState: {
                    ...this.state.apiState,
                    publishState: designer.LoadState.Loading,
                },
            };
            try {
                const publishResponse =
                    await this._tableDesignerService.publishChanges(
                        payload.table,
                    );

                sendActionEvent(
                    TelemetryViews.TableDesigner,
                    TelemetryActions.Publish,
                    {
                        correlationId: this._correlationId,
                    },
                );
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
                };
                this.panel.title = state.tableInfo.title;
                this.showRestorePromptAfterClose = false;
                await UserSurvey.getInstance().promptUserForNPSFeedback();
            } catch (e) {
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        publishState: designer.LoadState.Error,
                    },
                    publishingError: e.toString(),
                };
                sendActionEvent(
                    TelemetryViews.TableDesigner,
                    TelemetryActions.Publish,
                    {
                        correlationId: this._correlationId,
                        error: "true",
                    },
                );
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
            const script = await this._tableDesignerService.generateScript(
                payload.table,
            );
            sendActionEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.GenerateScript,
                {
                    correlationId: this._correlationId,
                },
            );
            state = {
                ...state,
                apiState: {
                    ...state.apiState,
                    generateScriptState: designer.LoadState.Loaded,
                },
            };
            await this._untitledSqlDocumentService.newQuery(script);
            await UserSurvey.getInstance().promptUserForNPSFeedback();
            return state;
        });

        this.registerReducer(
            "generatePreviewReport",
            async (state, payload) => {
                this.state = {
                    ...this.state,
                    apiState: {
                        ...this.state.apiState,
                        previewState: designer.LoadState.Loading,
                        publishState: designer.LoadState.NotStarted,
                    },
                    publishingError: undefined,
                };
                const previewReport =
                    await this._tableDesignerService.generatePreviewReport(
                        payload.table,
                    );
                sendActionEvent(
                    TelemetryViews.TableDesigner,
                    TelemetryActions.GenerateScript,
                    {
                        correlationId: this._correlationId,
                    },
                );
                state = {
                    ...state,
                    apiState: {
                        ...state.apiState,
                        previewState: designer.LoadState.Loaded,
                        publishState: designer.LoadState.NotStarted,
                    },
                    generatePreviewReportResult: previewReport,
                };
                return state;
            },
        );

        this.registerReducer("initializeTableDesigner", async (state) => {
            await this.initialize();
            return state;
        });

        this.registerReducer("scriptAsCreate", async (state) => {
            await this._untitledSqlDocumentService.newQuery(
                (state.model["script"] as designer.InputBoxProperties).value ??
                    "",
            );
            return state;
        });

        this.registerReducer("copyScriptAsCreateToClipboard", async (state) => {
            await vscode.env.clipboard.writeText(
                (state.model["script"] as designer.InputBoxProperties).value ??
                    "",
            );
            await vscode.window.showInformationMessage(scriptCopiedToClipboard);
            return state;
        });

        this.registerReducer("setTab", async (state, payload) => {
            state.tabStates.mainPaneTab = payload.tabId;
            return state;
        });

        this.registerReducer(
            "setPropertiesComponents",
            async (state, payload) => {
                state.propertiesPaneData = payload.components;
                return state;
            },
        );

        this.registerReducer("setResultTab", async (state, payload) => {
            state.tabStates.resultPaneTab = payload.tabId;
            return state;
        });

        this.registerReducer("closeDesigner", async (state) => {
            sendActionEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.Close,
                {
                    correlationId: this._correlationId,
                },
            );
            this.panel.dispose();
            return state;
        });

        this.registerReducer("continueEditing", async (state) => {
            this.state.apiState.publishState = designer.LoadState.NotStarted;
            this.showRestorePromptAfterClose = true;
            sendActionEvent(
                TelemetryViews.TableDesigner,
                TelemetryActions.ContinueEditing,
                {
                    correlationId: this._correlationId,
                },
            );
            return state;
        });
        this.registerReducer("copyPublishErrorToClipboard", async (state) => {
            await vscode.env.clipboard.writeText(state.publishingError ?? "");
            void vscode.window.showInformationMessage(copied);
            return state;
        });
    }
}
