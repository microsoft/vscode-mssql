/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import MainController from "../controllers/mainController";
import { homedir } from "os";
import { getErrorMessage, getUniqueFilePath } from "../utils/utils";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    configEnableDab,
    configSchemaDesignerEnableExpandCollapseButtons,
} from "../constants/constants";
import { IConnectionInfo } from "vscode-mssql";
import { ConnectionStrategy } from "../controllers/sqlDocumentService";
import { UserSurvey } from "../nps/userSurvey";

function isExpandCollapseButtonsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration()
        .get<boolean>(configSchemaDesignerEnableExpandCollapseButtons) as boolean;
}

function isDABEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(configEnableDab) as boolean;
}

const SCHEMA_DESIGNER_VIEW_ID = "schemaDesigner";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private _sessionId: string = "";
    private _key: string = "";
    private _serverName: string | undefined;
    public schemaDesignerDetails: SchemaDesigner.CreateSessionResponse | undefined = undefined;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private mainController: MainController,
        private schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        private connectionString: string,
        private accessToken: string | undefined,
        private databaseName: string,
        private schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem>,
        private treeNode?: TreeNodeInfo,
        private connectionUri?: string,
    ) {
        super(
            context,
            vscodeWrapper,
            SCHEMA_DESIGNER_VIEW_ID,
            SCHEMA_DESIGNER_VIEW_ID,
            {
                enableExpandCollapseButtons: isExpandCollapseButtonsEnabled(),
                enableDAB: isDABEnabled(),
                activeView: SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner,
            },
            {
                title: databaseName,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this._key = `${this.connectionString}-${this.databaseName}`;
        this._serverName = this.resolveServerName();

        this.setupRequestHandlers();
        this.setupConfigurationListener();
    }

    private setupRequestHandlers() {
        this.onRequest(SchemaDesigner.InitializeSchemaDesignerRequest.type, async () => {
            const schemaDesignerInitActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.Initialize,
                undefined,
                undefined,
                undefined,
                true, // include callstack in telemetry
            );
            try {
                let sessionResponse: SchemaDesigner.CreateSessionResponse;
                if (!this.schemaDesignerCache.has(this._key)) {
                    sessionResponse = await this.schemaDesignerService.createSession({
                        connectionString: this.connectionString,
                        accessToken: this.accessToken,
                        databaseName: this.databaseName,
                    });
                    this.schemaDesignerCache.set(this._key, {
                        schemaDesignerDetails: sessionResponse,
                        isDirty: false,
                    });
                } else {
                    // if the cache has the session, the changes have not been saved, and the
                    // session is dirty
                    sessionResponse = this.updateCacheItem(undefined, true).schemaDesignerDetails;
                }
                this.schemaDesignerDetails = sessionResponse;
                this._sessionId = sessionResponse.sessionId;
                schemaDesignerInitActivity.end(ActivityStatus.Succeeded, undefined, {
                    tableCount: sessionResponse?.schema?.tables?.length,
                });
                return sessionResponse;
            } catch (error) {
                schemaDesignerInitActivity.endFailed(error, false);
                throw error;
            }
        });

        this.onRequest(SchemaDesigner.GetDefinitionRequest.type, async (payload) => {
            const definitionActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GetDefinition,
                undefined,
                {
                    tableCount: payload.updatedSchema.tables.length.toString(),
                },
            );
            const script = await this.schemaDesignerService.getDefinition({
                updatedSchema: payload.updatedSchema,
                sessionId: this._sessionId,
            });
            definitionActivity.end(ActivityStatus.Succeeded, undefined, {
                tableCount: payload.updatedSchema.tables.length,
            });
            this.updateCacheItem(payload.updatedSchema, true);
            return script;
        });

        this.onRequest(SchemaDesigner.GetReportWebviewRequest.type, async (payload) => {
            const reportActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GetReport,
                undefined,
                {
                    tableCount: payload.updatedSchema.tables.length.toString(),
                },
            );
            try {
                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: LocConstants.SchemaDesigner.GeneratingReport,
                        cancellable: false,
                    },
                    async () => {
                        // Wait for the report to be generated
                        const report = await this.schemaDesignerService.getReport({
                            updatedSchema: payload.updatedSchema,
                            sessionId: this._sessionId,
                        });
                        this.updateCacheItem(payload.updatedSchema, true);
                        return {
                            report,
                        };
                    },
                );

                reportActivity.end(
                    ActivityStatus.Succeeded,
                    {
                        hasSchemaChanged: result.report?.hasSchemaChanged?.toString(),
                        possibleDataLoss: result.report?.dacReport?.possibleDataLoss?.toString(),
                        requireTableRecreation:
                            result.report.dacReport?.requireTableRecreation?.toString(),
                        hasWarnings: result.report?.dacReport?.hasWarnings?.toString(),
                    },
                    {
                        tableCount: payload.updatedSchema?.tables?.length,
                    },
                );

                return result;
            } catch (error) {
                reportActivity.endFailed(error, false);
                return {
                    error: error.toString(),
                };
            }
        });

        this.onRequest(SchemaDesigner.PublishSessionRequest.type, async (payload) => {
            const publishActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.PublishSession,
                undefined,
            );
            try {
                await this.schemaDesignerService.publishSession({
                    sessionId: this._sessionId,
                });
                publishActivity.end(ActivityStatus.Succeeded, undefined, {
                    tableCount: payload.schema?.tables?.length,
                });
                this.updateCacheItem(undefined, false);

                void UserSurvey.getInstance().promptUserForNPSFeedback(SCHEMA_DESIGNER_VIEW_ID);
                return {
                    success: true,
                };
            } catch (error) {
                publishActivity.endFailed(error, false);
                return {
                    success: false,
                    error: error.toString(),
                };
            }
        });

        this.onNotification(SchemaDesigner.ExportToFileNotification.type, async (payload) => {
            // Determine the base folder for saving the file
            const baseFolder =
                vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir());

            // Prompt the user with a Save dialog
            const outputPath = await vscode.window.showSaveDialog({
                filters: { [payload.format]: [payload.format] },
                defaultUri: await getUniqueFilePath(
                    baseFolder,
                    `schema-${this.databaseName}`,
                    payload.format,
                ),
                saveLabel: LocConstants.SchemaDesigner.Save,
                title: LocConstants.SchemaDesigner.SaveAs,
            });

            if (!outputPath) {
                // User cancelled the save dialog
                return;
            }

            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.ExportToImage, {
                format: payload?.format,
            });

            void UserSurvey.getInstance().promptUserForNPSFeedback(SCHEMA_DESIGNER_VIEW_ID);

            if (payload.format === "svg") {
                let fileContents = new Uint8Array(
                    Buffer.from(decodeURIComponent(payload.fileContents.split(",")[1]), "utf8"),
                );
                await vscode.workspace.fs.writeFile(outputPath, fileContents);
            } else {
                let fileContents = new Uint8Array(
                    Buffer.from(payload.fileContents.split(",")[1], "base64"),
                );
                vscode.workspace.fs.writeFile(outputPath, fileContents);
            }
        });

        this.onNotification(SchemaDesigner.CopyToClipboardNotification.type, async (params) => {
            await vscode.env.clipboard.writeText(params.text);
            await vscode.window.showInformationMessage(LocConstants.scriptCopiedToClipboard);
        });

        this.onNotification(SchemaDesigner.OpenInEditorNotification.type, async () => {
            const definition = await this.schemaDesignerService.getDefinition({
                updatedSchema: this.schemaDesignerDetails!.schema,
                sessionId: this._sessionId,
            });
            await this.mainController.sqlDocumentService.newQuery({
                content: definition.script,
                connectionStrategy: ConnectionStrategy.DoNotConnect,
            });
        });

        this.onNotification(SchemaDesigner.OpenInEditorWithConnectionNotification.type, () => {
            const generateScriptActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GenerateScript,
                undefined,
            );
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: LocConstants.SchemaDesigner.OpeningPublishScript,
                    cancellable: false,
                },
                async () => {
                    try {
                        const result = await this.schemaDesignerService.generateScript({
                            sessionId: this._sessionId,
                        });
                        generateScriptActivity.end(
                            ActivityStatus.Succeeded,
                            undefined,
                            result?.script
                                ? { scriptLength: result?.script?.length }
                                : { scriptLength: 0 },
                        );
                        let connectionCredentials: IConnectionInfo;
                        // Open the document in the editor with the connection
                        if (this.treeNode) {
                            connectionCredentials = this.treeNode.connectionProfile;
                        } else if (this.connectionUri) {
                            connectionCredentials =
                                this.mainController.connectionManager.getConnectionInfo(
                                    this.connectionUri,
                                ).credentials;
                        }
                        await this.mainController.sqlDocumentService.newQuery({
                            content: result?.script,
                            connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                            connectionInfo: connectionCredentials,
                        });
                    } catch (error) {
                        generateScriptActivity.endFailed(error, false);
                        vscode.window.showErrorMessage(
                            LocConstants.SchemaDesigner.PublishScriptFailed(getErrorMessage(error)),
                        );
                    }
                },
            );
        });

        this.onNotification(SchemaDesigner.CloseSchemaDesignerNotification.type, () => {
            // Close the schema designer panel
            this.panel.dispose();
        });
    }

    private setupConfigurationListener() {
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(configSchemaDesignerEnableExpandCollapseButtons)) {
                const newValue = isExpandCollapseButtonsEnabled();

                this.updateState({
                    enableExpandCollapseButtons: newValue,
                });
            }
            if (e.affectsConfiguration(configEnableDab)) {
                const newValue = isDABEnabled();
                this.updateState({
                    enableDAB: newValue,
                });
            }
        });
        this.registerDisposable(configChangeDisposable);
    }

    private updateCacheItem(
        updatedSchema?: SchemaDesigner.Schema,
        isDirty?: boolean,
    ): SchemaDesigner.SchemaDesignerCacheItem {
        let schemaDesignerCacheItem = this.schemaDesignerCache.get(this._key)!;
        if (updatedSchema) {
            this.schemaDesignerDetails!.schema = updatedSchema;
            schemaDesignerCacheItem.schemaDesignerDetails.schema = updatedSchema;
        }
        // if isDirty is not provided, set it to schemaDesignerCacheItem.isDirty
        // else, set it to the provided value
        schemaDesignerCacheItem.isDirty = isDirty ?? schemaDesignerCacheItem.isDirty;
        this.schemaDesignerCache.set(this._key, schemaDesignerCacheItem);
        return schemaDesignerCacheItem;
    }

    override async dispose(): Promise<void> {
        if (this.schemaDesignerDetails) {
            this.updateCacheItem(this.schemaDesignerDetails!.schema);
        }
        super.dispose();
    }

    /**
     * Adds a new table to the schema designer.
     * @param tableName Optional name for the new table
     * @param schemaName Optional schema name
     */
    public async addTable(
        tableName?: string,
        schemaName?: string,
        table?: SchemaDesigner.Table,
    ): Promise<SchemaDesigner.SchemaDesignerOperationResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(SchemaDesigner.AddTableRequest.type, {
            tableName,
            schemaName,
            table,
        });
    }

    /**
     * Updates an existing table in the schema designer.
     */
    public async updateTable(
        table: SchemaDesigner.Table,
    ): Promise<SchemaDesigner.SchemaDesignerOperationResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(SchemaDesigner.UpdateTableRequest.type, {
            table,
        });
    }

    /**
     * Deletes a table from the schema designer.
     */
    public async deleteTable(params: {
        tableId?: string;
        tableName?: string;
        schemaName?: string;
    }): Promise<SchemaDesigner.SchemaDesignerOperationResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(SchemaDesigner.DeleteTableRequest.type, params);
    }

    /**
     * Gets the current schema state from the webview.
     */
    public async getSchemaState(): Promise<SchemaDesigner.Schema> {
        await this.whenWebviewReady();
        const result = await this.sendRequest(SchemaDesigner.GetSchemaStateRequest.type, undefined);
        return result.schema;
    }

    /**
     * Replaces the schema model in the webview with a new schema.
     */
    public async replaceSchemaState(
        schema: SchemaDesigner.Schema,
        keepPositions: boolean = true,
        focusTableId?: string,
    ): Promise<SchemaDesigner.SchemaDesignerOperationResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(SchemaDesigner.ReplaceSchemaRequest.type, {
            schema,
            keepPositions,
            focusTableId,
        });
    }

    public get designerKey(): string {
        return this._key;
    }

    public get database(): string {
        return this.databaseName;
    }

    public get server(): string | undefined {
        return this._serverName;
    }

    private resolveServerName(): string | undefined {
        if (this.treeNode) {
            return this.treeNode.connectionProfile?.server;
        }

        if (this.connectionUri) {
            return this.mainController.connectionManager.getConnectionInfo(this.connectionUri)
                ?.credentials?.server;
        }

        return undefined;
    }
}
