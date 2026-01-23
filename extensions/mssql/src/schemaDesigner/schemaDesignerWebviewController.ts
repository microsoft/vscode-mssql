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
    configSchemaDesignerEnableExpandCollapseButtons,
    schemaDesignerEngineInMemory,
} from "../constants/constants";
import { IConnectionInfo } from "vscode-mssql";
import { ConnectionStrategy } from "../controllers/sqlDocumentService";
import { UserSurvey } from "../nps/userSurvey";
import { randomUUID } from "crypto";
import { IConnectionProfile } from "../models/interfaces";

type SchemaDesignerEngine = typeof schemaDesignerEngineInMemory | "dacfx";

function isExpandCollapseButtonsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration()
        .get<boolean>(configSchemaDesignerEnableExpandCollapseButtons) as boolean;
}

const SCHEMA_DESIGNER_VIEW_ID = "schemaDesigner";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private _sessionId: string = "";
    private _connectionProfile?: IConnectionProfile;
    private _key: string = "";
    public schemaDesignerDetails: SchemaDesigner.CreateSessionResponse | undefined = undefined;
    private _engineMode: SchemaDesignerEngine;
    private _activeOwnerUri: string | undefined;

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
        engineMode: SchemaDesignerEngine = "dacfx",
        connectionProfile?: IConnectionProfile,
) {
        super(
            context,
            vscodeWrapper,
            SCHEMA_DESIGNER_VIEW_ID,
            SCHEMA_DESIGNER_VIEW_ID,
            {
                enableExpandCollapseButtons: isExpandCollapseButtonsEnabled(),
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
        this._engineMode = engineMode;
        this._connectionProfile = connectionProfile ?? treeNode?.connectionProfile;

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
                const ownerUri = this.isInMemoryEngine() ? await this.ensureOwnerUri() : undefined;
                const cachedItem = this.schemaDesignerCache.get(this._key);
                if (!cachedItem || this.isInMemoryEngine()) {
                    sessionResponse = await this.schemaDesignerService.createSession({
                        connectionString: this.connectionString,
                        accessToken: this.accessToken,
                        databaseName: this.databaseName,
                        ownerUri,
                        connectionProfile: this.isInMemoryEngine()
                            ? this._connectionProfile
                            : undefined,
                    });
                    if (cachedItem?.schemaDesignerDetails?.schema) {
                        sessionResponse.schema = cachedItem.schemaDesignerDetails.schema;
                    }
                    this.schemaDesignerCache.set(this._key, {
                        schemaDesignerDetails: sessionResponse,
                        isDirty: cachedItem?.isDirty ?? false,
                    });
                } else {
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
                    updatedSchema: this.isInMemoryEngine() ? payload.schema : undefined,
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
        if (this._activeOwnerUri) {
            void this.mainController.connectionManager.disconnect(this._activeOwnerUri);
            this._activeOwnerUri = undefined;
        }
        super.dispose();
    }

    private isInMemoryEngine(): boolean {
        return this._engineMode === schemaDesignerEngineInMemory;
    }

    private async ensureOwnerUri(): Promise<string> {
        if (
            this.connectionUri &&
            this.mainController.connectionManager.isConnected(this.connectionUri)
        ) {
            this._activeOwnerUri = this.connectionUri;
            return this.connectionUri;
        }


        if (this.connectionUri) {
            const connectionInfo =
                this.mainController.connectionManager.getConnectionInfo(this.connectionUri);
            if (connectionInfo?.credentials) {
                const newOwnerUri = `${
                    connectionInfo.credentials.server ?? "schemaDesigner"
                }-${this.databaseName}-schemaDesigner-${randomUUID()}`;
                const connected = await this.mainController.connectionManager.connect(
                    newOwnerUri,
                    connectionInfo.credentials,
                    {
                        connectionSource: "schemaDesigner",
                    },
                );
                if (connected) {
                    this._activeOwnerUri = newOwnerUri;
                    this._connectionProfile = connectionInfo.credentials as IConnectionProfile;
                    return newOwnerUri;
                }
            }
        }

        if (this._activeOwnerUri) {
            return this._activeOwnerUri;
        }

        const connectionInfo = this.treeNode?.connectionProfile ?? this._connectionProfile;
        if (!connectionInfo) {
            throw new Error("Unable to determine connection for Schema Designer");
        }

        let ownerUri = this.mainController.connectionManager.getUriForConnection(connectionInfo);
        if (!ownerUri) {
            ownerUri = `${connectionInfo.server}-${this.databaseName}-schemaDesigner-${randomUUID()}`;
        }

        const connected = await this.mainController.connectionManager.connect(ownerUri, connectionInfo, {
            connectionSource: "schemaDesigner",
        });
        if (!connected) {
            throw new Error("Failed to establish connection for Schema Designer");
        }

        this._connectionProfile = connectionInfo;
        this._activeOwnerUri = ownerUri;
        return ownerUri;
    }
}
