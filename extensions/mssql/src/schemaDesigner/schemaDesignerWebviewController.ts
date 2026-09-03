/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import * as LocConstants from "../constants/locConstants";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import MainController from "../controllers/mainController";
import { homedir } from "os";
import { getErrorMessage, getUniqueFilePath, uuid } from "../utils/utils";
import { sendActionEvent, startActivity } from "extension-toolkit/vscode";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { configSchemaDesignerEnableExpandCollapseButtons } from "../constants/constants";
import type { IConnectionInfo, IServerInfo } from "vscode-mssql";
import { DatabaseEngineEdition } from "../databaseProjects/common/enums";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { ConnectionStrategy } from "../controllers/sqlDocumentService";
import { UserSurvey } from "../nps/userSurvey";
import { DabMetadataService, type IDabMetadataService } from "../dab/dabMetadataService";
import { DabConfigStore, type DabStoreKey } from "../dab/dabConfigStore";
import { generateDabDeploymentName } from "../dab/dabContainer";
import { DabService } from "../services/dabService";
import { Dab } from "../sharedInterfaces/dab";
import { CopilotChat } from "../sharedInterfaces/copilotChat";
import { addMcpServerToWorkspace } from "../copilot/copilotUtils";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    getSchemaDesignerDefinitionOutput,
    SchemaDesignerDefinitionOutput,
} from "../sharedInterfaces/schemaDesignerDefinitionOutput";
function isExpandCollapseButtonsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration()
        .get<boolean>(configSchemaDesignerEnableExpandCollapseButtons) as boolean;
}

function isCopilotChatInstalled(): boolean {
    return !!vscode.extensions.getExtension("github.copilot-chat");
}

const SCHEMA_DESIGNER_VIEW_ID = "schemaDesigner";
const DAB_CONFIG_FILE_EXTENSION = "json";
/** Idle period before an edited DAB config is written to global storage. */
const DAB_CONFIG_SAVE_DEBOUNCE_MS = 500;
const DEFINITION_FILE_EXTENSION_BY_KIND: Record<SchemaDesigner.DefinitionKind, string> = {
    [SchemaDesigner.DefinitionKind.Sql]: "sql",
    [SchemaDesigner.DefinitionKind.Prisma]: "prisma",
    [SchemaDesigner.DefinitionKind.Sequelize]: "ts",
    [SchemaDesigner.DefinitionKind.TypeOrm]: "ts",
    [SchemaDesigner.DefinitionKind.Drizzle]: "ts",
    [SchemaDesigner.DefinitionKind.SqlAlchemy]: "py",
    [SchemaDesigner.DefinitionKind.EfCore]: "cs",
};

function sanitizeFileNamePart(value: string): string {
    const sanitized = value
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return sanitized || "database";
}

function getDateFileNamePart(date = new Date()): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}${month}${day}`;
}

function getCopilotChatDiscoveryDismissedState(
    context: vscode.ExtensionContext,
): CopilotChat.DiscoveryDismissedState {
    return {
        schemaDesigner: context.globalState.get(
            CopilotChat.getDiscoveryDismissedStateKey("schemaDesigner"),
            false,
        ),
        dab: context.globalState.get(CopilotChat.getDiscoveryDismissedStateKey("dab"), false),
    };
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(getErrorMessage(error));
}

export class SchemaDesignerWebviewController extends WebviewPanelController<
    SchemaDesigner.SchemaDesignerWebviewState,
    SchemaDesigner.SchemaDesignerReducers
> {
    private _sessionId: string = "";
    private _key: string = "";
    private _serverName: string | undefined;
    private _sqlServerContainerName: string | undefined;
    private _dabService: DabService;
    private _dabConfigStore: DabConfigStore | undefined;
    private _pendingDabConfigSave: Dab.DabConfig | undefined;
    /** Process id of a CLI engine launched but not yet recorded. */
    private _pendingDabCliProcessId: number | undefined;
    private _dabConfigSaveTimer: NodeJS.Timeout | undefined;
    private _dabMetadataService: IDabMetadataService | undefined;
    private _progressListener:
        | ((progress: SchemaDesigner.SchemaDesignerProgressNotificationParams) => void)
        | undefined;
    private _messageListener:
        | ((message: SchemaDesigner.SchemaDesignerMessageNotificationParams) => void)
        | undefined;
    private _initializeSchemaDesignerPromise:
        | Promise<SchemaDesigner.CreateSessionResponse>
        | undefined;
    public schemaDesignerDetails: SchemaDesigner.CreateSessionResponse | undefined = undefined;
    public baselineSchema: SchemaDesigner.Schema | undefined = undefined;

    constructor(
        context: vscode.ExtensionContext,
        private mainController: MainController,
        private schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        private connectionString: string,
        private accessToken: string | undefined,
        private databaseName: string,
        private schemaDesignerCache: Map<string, SchemaDesigner.SchemaDesignerCacheItem>,
        private treeNode?: TreeNodeInfo,
        private connectionUri?: string,
        isReadOnly: boolean = false,
        cacheKey?: string,
        dabMetadataService?: IDabMetadataService,
    ) {
        super(
            context,
            SCHEMA_DESIGNER_VIEW_ID,
            SCHEMA_DESIGNER_VIEW_ID,
            {
                enableExpandCollapseButtons: isExpandCollapseButtonsEnabled(),
                isCopilotChatInstalled: isCopilotChatInstalled(),
                copilotChatDiscoveryDismissed: getCopilotChatDiscoveryDismissedState(context),
                activeView: SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner,
                isReadOnly,
            },
            {
                title: isReadOnly
                    ? `${LocConstants.SchemaDesigner.ReadOnlyPanelTitle} - ${databaseName}`
                    : `${LocConstants.SchemaDesigner.PanelTitle} - ${databaseName}`,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "applicationQuickStart_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "applicationQuickStart_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this._key = cacheKey ?? `${this.connectionString}-${this.databaseName}`;
        this._dabMetadataService = dabMetadataService;
        this._serverName = this.resolveServerName();
        this._sqlServerContainerName = this.resolveSqlServerContainerName();
        this._dabConfigStore = context.globalStorageUri
            ? new DabConfigStore(context.globalStorageUri.fsPath)
            : undefined;
        this._dabService = new DabService(
            context.globalStorageUri
                ? { storagePath: context.globalStorageUri.fsPath, logger: this.logger }
                : undefined,
        );

        this.updateState({
            ...this.state,
            isDabDeploymentSupported: this.resolveIsDabDeploymentSupported(),
        });

        this.setupRequestHandlers();
        this.setupReducers();
        this.setupSchemaDesignerProgressListeners();
        this.setupConfigurationListener();
    }

    /**
     * Sets the initial filter tables for the Schema Designer.
     * When set, the FilterTablesButton will apply this filter after initialization.
     * @param tables Array of fully qualified table names (e.g., ["dbo.Students"])
     */
    public setInitialFilterTables(tables: string[]): void {
        this.updateState({
            ...this.state,
            initialFilterTables: tables,
        });
    }

    private setupRequestHandlers() {
        this.onRequest(CopilotChat.OpenFromUiRequest.type, async (payload) => {
            await vscode.commands.executeCommand(CopilotChat.openFromUiCommand, payload);
        });

        this.onRequest(SchemaDesigner.InitializeSchemaDesignerRequest.type, async () => {
            if (!this._initializeSchemaDesignerPromise) {
                this._initializeSchemaDesignerPromise = this.initializeSchemaDesignerSession();
            }

            try {
                return await this._initializeSchemaDesignerPromise;
            } finally {
                this._initializeSchemaDesignerPromise = undefined;
            }
        });

        this.onRequest(SchemaDesigner.GetDefinitionRequest.type, async (payload) => {
            const definitionActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GetDefinition,
                {
                    additionalProps: {
                        tableCount: payload.updatedSchema.tables.length.toString(),
                    },
                },
            );
            const script = await this.schemaDesignerService.getDefinition({
                updatedSchema: payload.updatedSchema,
                sessionId: this._sessionId,
            });
            definitionActivity.end(ActivityStatus.Succeeded, {
                additionalMeasurements: {
                    tableCount: payload.updatedSchema.tables.length,
                },
            });
            this.updateCacheItem(payload.updatedSchema);
            return script;
        });

        this.onRequest(SchemaDesigner.GetReportWebviewRequest.type, async (payload) => {
            const reportActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GetReport,
                {
                    additionalProps: {
                        tableCount: payload.updatedSchema.tables.length.toString(),
                    },
                },
            );
            try {
                const report = await this.schemaDesignerService.getReport({
                    updatedSchema: payload.updatedSchema,
                    sessionId: this._sessionId,
                });
                this.updateCacheItem(payload.updatedSchema);
                const result = {
                    report,
                };

                reportActivity.end(ActivityStatus.Succeeded, {
                    additionalProps: {
                        hasSchemaChanged: result.report?.hasSchemaChanged?.toString(),
                        possibleDataLoss: result.report?.dacReport?.possibleDataLoss?.toString(),
                        requireTableRecreation:
                            result.report.dacReport?.requireTableRecreation?.toString(),
                        hasWarnings: result.report?.dacReport?.hasWarnings?.toString(),
                    },
                    additionalMeasurements: {
                        tableCount: payload.updatedSchema?.tables?.length,
                    },
                });

                return result;
            } catch (error) {
                reportActivity.endFailed(toError(error), false);
                return {
                    error: getErrorMessage(error),
                };
            }
        });

        this.onRequest(SchemaDesigner.PublishSessionRequest.type, async (payload) => {
            const publishActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.PublishSession,
            );
            try {
                await this.schemaDesignerService.publishSession({
                    sessionId: this._sessionId,
                });
                publishActivity.end(ActivityStatus.Succeeded, {
                    additionalMeasurements: {
                        tableCount: payload.schema?.tables?.length,
                    },
                });
                if (this.schemaDesignerDetails) {
                    this.schemaDesignerDetails.schema = payload.schema;
                }
                this.updateCacheItem(undefined, false);

                // After publishing, reset baseline to current (published) schema so change count clears.
                const publishedSchema = this.schemaDesignerDetails?.schema;
                if (publishedSchema) {
                    this.baselineSchema = publishedSchema;
                    const cacheItem = this.schemaDesignerCache.get(this._key);
                    if (cacheItem) {
                        cacheItem.baselineSchema = publishedSchema;
                        this.schemaDesignerCache.set(this._key, cacheItem);
                    }
                }

                void UserSurvey.getInstance().promptUserForNPSFeedback(SCHEMA_DESIGNER_VIEW_ID);
                return {
                    success: true,
                    error: undefined,
                    updatedSchema: this.schemaDesignerDetails?.schema ?? payload.schema,
                };
            } catch (error) {
                publishActivity.endFailed(toError(error), false);
                return {
                    success: false,
                    error: getErrorMessage(error),
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
                additionalProps: {
                    format: payload?.format,
                },
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
            try {
                const definition = await this.createDefinitionOutput(params);
                await vscode.env.clipboard.writeText(definition.text);
                await vscode.window.showInformationMessage(LocConstants.copied);
            } catch (error) {
                await vscode.window.showErrorMessage(
                    LocConstants.failedToCopyTextToClipboard(getErrorMessage(error)),
                );
            }
        });

        this.onNotification(SchemaDesigner.OpenInEditorNotification.type, async (params) => {
            try {
                const definition = await this.createDefinitionOutput(params);

                if (definition.language === "sql") {
                    await this.mainController.sqlDocumentService.newQuery({
                        content: definition.text,
                        connectionStrategy: ConnectionStrategy.DoNotConnect,
                    });
                    return;
                }

                const document = await vscode.workspace.openTextDocument({
                    content: definition.text,
                    language: definition.language,
                });
                await vscode.window.showTextDocument(document, { preview: false });
            } catch (error) {
                await vscode.window.showErrorMessage(
                    LocConstants.failedToOpenTextInEditor(getErrorMessage(error)),
                );
            }
        });

        this.onNotification(
            SchemaDesigner.AddDefinitionToWorkspaceNotification.type,
            async (params) => {
                try {
                    const definition = await this.createDefinitionOutput(params);
                    await this.addTextToWorkspace(
                        definition.text,
                        DEFINITION_FILE_EXTENSION_BY_KIND[params.definitionKind],
                    );
                } catch (error) {
                    await vscode.window.showErrorMessage(
                        LocConstants.failedToAddTextToWorkspace(getErrorMessage(error)),
                    );
                }
            },
        );

        this.onNotification(SchemaDesigner.OpenInEditorWithConnectionNotification.type, () => {
            const generateScriptActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.GenerateScript,
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
                        generateScriptActivity.end(ActivityStatus.Succeeded, {
                            additionalMeasurements: result?.script
                                ? { scriptLength: result?.script?.length }
                                : { scriptLength: 0 },
                        });
                        let connectionCredentials: IConnectionInfo | undefined;
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
                        generateScriptActivity.endFailed(toError(error), false);
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

        this.onNotification(SchemaDesigner.SchemaDesignerDirtyStateNotification.type, (payload) => {
            this.updateCacheItem(undefined, payload.hasChanges);
        });

        this.onNotification(SchemaDesigner.UpdateFilterTablesNotification.type, (payload) => {
            this.updateState({
                ...this.state,
                currentFilteredTables: payload.currentFilteredTables,
            });
        });

        this.onRequest(SchemaDesigner.GetBaselineSchemaRequest.type, async () => {
            const cacheItem = this.schemaDesignerCache.get(this._key);
            // Prefer cached baseline so it survives controller recreation (webview restore)
            if (cacheItem?.baselineSchema) {
                this.baselineSchema = cacheItem.baselineSchema;
                return cacheItem.baselineSchema;
            }

            // Fallback (should be rare): use controller field or current schema
            return (
                this.baselineSchema ??
                this.schemaDesignerDetails?.schema ?? {
                    tables: [],
                }
            );
        });

        // DAB request handlers
        this.onRequest(Dab.GetDatabaseObjectsRequest.type, async () => {
            return {
                sourceObjects: await this.getDabDatabaseObjects(),
            };
        });

        this.onRequest(Dab.GenerateConfigRequest.type, async (payload) => {
            return this._dabService.generateConfig(payload.config, {
                connectionString: this.connectionString,
                sqlServerContainerName: this._sqlServerContainerName,
            });
        });

        this.onRequest(Dab.GetCachedConfigRequest.type, async () => {
            // The in-memory cache holds the config for designers opened in this
            // session; the store carries it across sessions.
            const cachedConfig = this.schemaDesignerCache.get(this._key)?.dabConfig;
            return {
                config: cachedConfig ?? (await this.loadDabConfigFromStore()),
            };
        });

        this.onNotification(Dab.CacheConfigNotification.type, async (payload) => {
            this.updateCacheItem(undefined, undefined, payload.config);
            this.scheduleDabConfigSave(payload.config);
        });

        this.onNotification(Dab.ResetConfigNotification.type, async () => {
            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.ResetDabConfig);
            await this.deleteStoredDabConfig();
        });

        this.onNotification(Dab.OpenConfigInEditorNotification.type, async (payload) => {
            const doc = await vscode.workspace.openTextDocument({
                content: payload.configContent,
                language: "json",
            });

            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.ExportDabConfig, {
                additionalProps: {
                    language: "json",
                },
            });

            await vscode.window.showTextDocument(doc);
        });

        this.onNotification(Dab.AddConfigToWorkspaceNotification.type, async (payload) => {
            try {
                await this.addTextToWorkspace(payload.configContent, DAB_CONFIG_FILE_EXTENSION);

                sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.ExportDabConfig, {
                    additionalProps: {
                        language: "json",
                        target: "workspace",
                    },
                });
            } catch (error) {
                await vscode.window.showErrorMessage(
                    LocConstants.failedToAddTextToWorkspace(getErrorMessage(error)),
                );
            }
        });

        this.onNotification(Dab.OpenLogsInNewTabNotification.type, async (payload) => {
            const doc = await vscode.workspace.openTextDocument({
                content: payload.logsContent,
                language: "log",
            });

            await vscode.window.showTextDocument(doc, { preview: false });
        });

        this.onNotification(Dab.OpenUrlNotification.type, async (payload) => {
            const uri = vscode.Uri.parse(payload.url, true);
            if (uri.scheme !== "http" && uri.scheme !== "https") {
                return;
            }

            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.OpenDabApiUrl, {
                additionalProps: {
                    apiType: payload.apiType ?? "",
                },
            });

            try {
                await vscode.commands.executeCommand("simpleBrowser.show", uri.toString());
            } catch {
                void vscode.window.showErrorMessage(LocConstants.SchemaDesigner.failedToOpenUrl);
            }
        });

        this.onNotification(Dab.CopyTextNotification.type, async (payload) => {
            await vscode.env.clipboard.writeText(payload.text);
            let message = "";
            switch (payload.copyTextType) {
                case Dab.CopyTextType.Url:
                    message = LocConstants.SchemaDesigner.urlCopiedToClipboard;
                    break;
                case Dab.CopyTextType.Logs:
                    message = LocConstants.SchemaDesigner.logsCopiedToClipboard;
                    break;
                case Dab.CopyTextType.Config:
                    message = LocConstants.SchemaDesigner.configCopiedToClipboard;
                    break;
            }

            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.CopyDabText, {
                additionalProps: {
                    copyTextType: payload.copyTextType,
                },
            });

            await vscode.window.showInformationMessage(message);
        });

        // DAB deployment request handlers
        this.onRequest(Dab.RunDeploymentStepRequest.type, async (payload) => {
            const deploymentStepActivity = startActivity(
                TelemetryViews.SchemaDesigner,
                TelemetryActions.RunDabDeploymentStep,
                {
                    additionalProps: {
                        step: payload.step.toString(),
                    },
                },
            );
            if (!this.resolveIsDabDeploymentSupported()) {
                const message = LocConstants.SchemaDesigner.dabDeploymentNotSupported;
                void vscode.window.showErrorMessage(message);
                deploymentStepActivity.endFailed(undefined, false, undefined, undefined, {
                    hasContainerLogs: "false",
                });
                return {
                    success: false,
                    error: message,
                };
            }
            const target = payload.target ?? Dab.DabDeploymentTarget.Docker;
            try {
                const connectionInfo = this.connectionString
                    ? {
                          connectionString: this.connectionString,
                          sqlServerContainerName: this._sqlServerContainerName,
                      }
                    : undefined;

                const result =
                    target === Dab.DabDeploymentTarget.DabCli
                        ? await this._dabService.runCliDeploymentStep(
                              payload.step,
                              payload.params,
                              payload.config,
                              connectionInfo,
                              payload.params
                                  ? this.getDabCliConfigPath(payload.params.containerName)
                                  : undefined,
                          )
                        : await this._dabService.runDeploymentStep(
                              payload.step,
                              payload.params,
                              payload.config,
                              connectionInfo,
                          );

                if (result.success) {
                    // Remember the engine's process id so it can be stopped later;
                    // it is launched a step before the deployment is tracked.
                    if (
                        target === Dab.DabDeploymentTarget.DabCli &&
                        payload.step === Dab.DabDeploymentStepOrder.startCliEngine
                    ) {
                        this._pendingDabCliProcessId = (result as { processId?: number }).processId;
                    }

                    // The deployment is only worth tracking once it answers.
                    if (Dab.isFinalDabDeploymentStep(target, payload.step) && payload.params) {
                        await this.trackDabDeployment(
                            target,
                            payload.params,
                            payload.config,
                            payload.deploymentId,
                        );
                    }
                    deploymentStepActivity.end(ActivityStatus.Succeeded);
                } else {
                    deploymentStepActivity.endFailed(undefined, false, undefined, undefined, {
                        hasContainerLogs: (!!result.containerLogs).toString(),
                    });
                }
                return result;
            } catch (error) {
                deploymentStepActivity.endFailed(undefined, false, undefined, undefined, {
                    hasContainerLogs: "false",
                });
                throw error;
            }
        });

        this.onRequest(Dab.ValidateDeploymentParamsRequest.type, async (payload) => {
            // An empty name means the form is asking for a default; generate one
            // from the database so both targets read as DAB_<database>_<n>.
            const containerName = payload.containerName || (await this.generateDabDeploymentName());
            return this._dabService.validateDeploymentParams(containerName, payload.port);
        });

        this.onRequest(Dab.StopDeploymentRequest.type, async (payload) => {
            return this._dabService.stopDeployment(payload.containerName);
        });

        // DAB deployment tracking request handlers
        this.onRequest(Dab.GetDeploymentsRequest.type, async (payload) => {
            return this.getDabDeploymentList(payload.config);
        });

        this.onRequest(Dab.DeleteDeploymentRequest.type, async (payload) => {
            return this.withTrackedDabDeployment(
                payload.deploymentId,
                async (store, key, record) => {
                    const result = await this.tearDownDabDeployment(store, key, record);
                    if (!result.success) {
                        return { success: false, error: result.error };
                    }

                    await store.removeDeployment(key, record.id);
                    sendActionEvent(
                        TelemetryViews.SchemaDesigner,
                        TelemetryActions.DeleteDabDeployment,
                    );
                    return { success: true };
                },
            );
        });

        this.onRequest(Dab.StartDeploymentContainerRequest.type, async (payload) => {
            return this.withTrackedDabDeployment(payload.deploymentId, async (store, key, record) =>
                this.startTrackedDabDeployment(store, key, record),
            );
        });

        this.onRequest(Dab.StopDeploymentContainerRequest.type, async (payload) => {
            return this.withTrackedDabDeployment(
                payload.deploymentId,
                async (_store, _key, record) =>
                    record.target === Dab.DabDeploymentTarget.DabCli
                        ? this._dabService.stopCliDeployment(record)
                        : this._dabService.stopContainer(record.name),
            );
        });

        this.onRequest(Dab.PrepareRedeploymentRequest.type, async (payload) => {
            return this.withTrackedDabDeployment(payload.deploymentId, async (store, key, record) =>
                this.prepareDabRedeployment(store, key, record),
            );
        });

        this.onRequest(Dab.AddMcpServerRequest.type, async (payload) => {
            sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.AddDabMcpServer);

            return addMcpServerToWorkspace(payload.serverName, payload.serverUrl);
        });
    }

    private async getDabDatabaseObjects(): Promise<Dab.DabSourceObject[]> {
        if (!this.connectionUri) {
            return [];
        }

        const dabMetadataService = this.dabMetadataService;
        const queryOptions = this.getDabMetadataQueryOptions();
        const [views, storedProcedures] = await Promise.all([
            dabMetadataService.listDabViews(this.connectionUri, this.databaseName, queryOptions),
            dabMetadataService.listDabStoredProcedures(
                this.connectionUri,
                this.databaseName,
                queryOptions,
            ),
        ]);
        const [viewColumnsByView, parametersByProcedure] = await Promise.all([
            this.getDabViewColumnsByView(
                dabMetadataService,
                this.connectionUri,
                views,
                queryOptions,
            ),
            this.getDabStoredProcedureParametersByProcedure(
                dabMetadataService,
                this.connectionUri,
                storedProcedures,
                queryOptions,
            ),
        ]);

        const viewObjects = views.map((view) => {
            const columns = viewColumnsByView.get(view.id) ?? [];
            return {
                id: view.id,
                sourceType: Dab.EntitySourceType.View,
                schemaName: view.schema,
                sourceName: view.name,
                columns: columns.map((column) => ({
                    id: column.id,
                    name: column.name,
                    dataType: column.dataType,
                    isPrimaryKey: column.isPrimaryKey,
                    isSupported: Dab.isDataTypeSupportedForDab(column.dataType),
                    isExposed: true,
                })),
                fields: columns.map((column) => ({
                    name: column.name,
                    ...(column.isPrimaryKey ? { isPrimaryKey: true } : {}),
                })),
            };
        });

        const storedProcedureObjects = storedProcedures.map((procedure) => {
            const parameters = parametersByProcedure.get(procedure.id) ?? [];
            return {
                id: procedure.id,
                sourceType: Dab.EntitySourceType.StoredProcedure,
                schemaName: procedure.schema,
                sourceName: procedure.name,
                columns: [],
                parameters: parameters.map((parameter) => ({
                    name: parameter.name.replace(/^@/, ""),
                    dataType: parameter.dataType,
                    isRequired: true,
                })),
            };
        });

        return [...viewObjects, ...storedProcedureObjects];
    }

    private get dabMetadataService(): IDabMetadataService {
        this._dabMetadataService ??= new DabMetadataService(SqlToolsServiceClient.instance);
        return this._dabMetadataService;
    }

    private async getDabViewColumnsByView(
        dabMetadataService: IDabMetadataService,
        ownerUri: string,
        views: Dab.DabDatabaseObjectMetadata[],
        queryOptions: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabViewColumnMetadata[]>> {
        if (views.length === 0) {
            return new Map();
        }

        try {
            return await dabMetadataService.getDabViewColumnsByView(
                ownerUri,
                this.databaseName,
                queryOptions,
            );
        } catch (error) {
            this.logger.warn(
                `Failed to load DAB view columns in bulk. Falling back to per-view metadata. ${getErrorMessage(error)}`,
            );
        }

        return new Map(
            await Promise.all(
                views.map(async (view) => {
                    try {
                        return [
                            view.id,
                            await dabMetadataService.getDabViewColumns(
                                ownerUri,
                                view.schema,
                                view.name,
                                this.databaseName,
                                queryOptions,
                            ),
                        ] as const;
                    } catch (error) {
                        this.logger.warn(
                            `Failed to load DAB view columns for ${view.schema}.${view.name}. ${getErrorMessage(error)}`,
                        );
                        return [view.id, [] as Dab.DabViewColumnMetadata[]] as const;
                    }
                }),
            ),
        );
    }

    private async getDabStoredProcedureParametersByProcedure(
        dabMetadataService: IDabMetadataService,
        ownerUri: string,
        storedProcedures: Dab.DabDatabaseObjectMetadata[],
        queryOptions: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabStoredProcedureParameterMetadata[]>> {
        if (storedProcedures.length === 0) {
            return new Map();
        }

        try {
            return await dabMetadataService.getDabStoredProcedureParametersByProcedure(
                ownerUri,
                this.databaseName,
                queryOptions,
            );
        } catch (error) {
            this.logger.warn(
                `Failed to load DAB stored procedure parameters in bulk. Falling back to per-procedure metadata. ${getErrorMessage(error)}`,
            );
        }

        return new Map(
            await Promise.all(
                storedProcedures.map(async (procedure) => {
                    try {
                        return [
                            procedure.id,
                            await dabMetadataService.getDabStoredProcedureParameters(
                                ownerUri,
                                procedure.schema,
                                procedure.name,
                                this.databaseName,
                                queryOptions,
                            ),
                        ] as const;
                    } catch (error) {
                        this.logger.warn(
                            `Failed to load DAB stored procedure parameters for ${procedure.schema}.${procedure.name}. ${getErrorMessage(error)}`,
                        );
                        return [
                            procedure.id,
                            [] as Dab.DabStoredProcedureParameterMetadata[],
                        ] as const;
                    }
                }),
            ),
        );
    }

    private getDabMetadataQueryOptions(): Dab.DabMetadataQueryOptions {
        return {
            useNoLock: this.supportsNoLockTableHints(),
        };
    }

    private supportsNoLockTableHints(): boolean {
        const engineEditionId = this.resolveServerInfo()?.engineEditionId;
        if (engineEditionId === undefined || engineEditionId === DatabaseEngineEdition.Unknown) {
            return false;
        }

        return (
            engineEditionId !== DatabaseEngineEdition.SqlDataWarehouse &&
            engineEditionId !== DatabaseEngineEdition.SqlOnDemand
        );
    }

    private async initializeSchemaDesignerSession(): Promise<SchemaDesigner.CreateSessionResponse> {
        const schemaDesignerInitActivity = startActivity(
            TelemetryViews.SchemaDesigner,
            TelemetryActions.Initialize,
            { includeCallStack: true },
        );
        try {
            let sessionResponse: SchemaDesigner.CreateSessionResponse;
            const cacheItem = this.schemaDesignerCache.get(this._key);
            const hasCachedSession = !!cacheItem?.schemaDesignerDetails?.sessionId;

            if (!hasCachedSession) {
                this._sessionId = uuid();
                sessionResponse = await this.schemaDesignerService.createSession({
                    sessionId: this._sessionId,
                    connectionString: this.connectionString,
                    accessToken: this.accessToken,
                    databaseName: this.databaseName,
                });
                this.baselineSchema = sessionResponse.schema;
                this.schemaDesignerCache.set(this._key, {
                    schemaDesignerDetails: sessionResponse,
                    baselineSchema: sessionResponse.schema,
                    dabConfig: cacheItem?.dabConfig,
                    isDirty: cacheItem?.isDirty ?? false,
                });
            } else {
                sessionResponse = cacheItem.schemaDesignerDetails;
                this.baselineSchema = cacheItem.baselineSchema;
                this._sessionId = sessionResponse.sessionId;
            }

            this.schemaDesignerDetails = sessionResponse;
            this._sessionId = sessionResponse.sessionId;
            schemaDesignerInitActivity.end(ActivityStatus.Succeeded, {
                additionalMeasurements: {
                    tableCount: sessionResponse?.schema?.tables?.length,
                },
            });
            return sessionResponse;
        } catch (error) {
            schemaDesignerInitActivity.endFailed(toError(error), false);
            throw error;
        }
    }

    private setupReducers() {
        this.registerReducer("dismissCopilotChatDiscovery", async (state, payload) => {
            if (!payload?.scenario) {
                return state;
            }

            await this._context.globalState.update(
                CopilotChat.getDiscoveryDismissedStateKey(payload.scenario),
                true,
            );

            return {
                ...state,
                copilotChatDiscoveryDismissed: {
                    ...state.copilotChatDiscoveryDismissed,
                    [payload.scenario]: true,
                },
            };
        });
    }

    private setupSchemaDesignerProgressListeners() {
        this._progressListener = (progress) => {
            if (progress.sessionId !== this._sessionId) {
                return;
            }

            this.logger.debug("Progress", progress);

            try {
                void this.sendNotification(
                    SchemaDesigner.SchemaDesignerProgressNotification.type,
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

            this.logger.info("Message", message);

            try {
                void this.sendNotification(
                    SchemaDesigner.SchemaDesignerMessageNotification.type,
                    message,
                );
            } catch {
                // Ignore notifications racing with webview disposal.
            }
        };

        this.schemaDesignerService.onProgress(this._progressListener);
        this.schemaDesignerService.onMessage(this._messageListener);
    }

    private async createDefinitionOutput(
        params?: SchemaDesigner.OpenInEditorOptions | SchemaDesigner.CopyToClipboardOptions,
    ): Promise<SchemaDesignerDefinitionOutput> {
        if (params?.text !== undefined) {
            return {
                text: params.text,
                language: "language" in params ? (params.language ?? "sql") : "sql",
            };
        }

        const updatedSchema = params?.updatedSchema ?? this.schemaDesignerDetails?.schema;
        if (!updatedSchema) {
            throw new Error(LocConstants.schemaDesignerDetailsUnavailable);
        }

        this.updateCacheItem(updatedSchema);

        const definitionKind = params?.definitionKind ?? SchemaDesigner.DefinitionKind.Sql;
        if (definitionKind === SchemaDesigner.DefinitionKind.Sql) {
            const definition = await this.schemaDesignerService.getDefinition({
                updatedSchema,
                sessionId: this._sessionId || this.schemaDesignerDetails?.sessionId || "",
            });
            return {
                text: definition.script,
                language: "sql",
            };
        }

        return getSchemaDesignerDefinitionOutput(updatedSchema, definitionKind);
    }

    private async addTextToWorkspace(text: string, fileExtension: string): Promise<vscode.Uri> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            throw new Error(LocConstants.SchemaDesigner.noWorkspaceOpenForGeneratedFile);
        }

        const baseName = `${sanitizeFileNamePart(this.databaseName)}_${getDateFileNamePart()}`;
        const outputUri = await getUniqueFilePath(workspaceFolder, baseName, fileExtension);
        await vscode.workspace.fs.writeFile(outputUri, Buffer.from(text, "utf8"));

        const document = await vscode.workspace.openTextDocument(outputUri);
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.window.showInformationMessage(
            LocConstants.SchemaDesigner.generatedFileAddedToWorkspace(outputUri.fsPath),
        );
        return outputUri;
    }

    private setupConfigurationListener() {
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(configSchemaDesignerEnableExpandCollapseButtons)) {
                const newValue = isExpandCollapseButtonsEnabled();

                this.updateState({
                    ...this.state,
                    enableExpandCollapseButtons: newValue,
                });
            }
        });
        this.registerDisposable(configChangeDisposable);
    }

    private updateCacheItem(
        updatedSchema?: SchemaDesigner.Schema,
        isDirty?: boolean,
        dabConfig?: Dab.DabConfig,
    ): SchemaDesigner.SchemaDesignerCacheItem {
        let schemaDesignerCacheItem = this.schemaDesignerCache.get(this._key);
        if (!schemaDesignerCacheItem) {
            if (this.schemaDesignerDetails) {
                schemaDesignerCacheItem = {
                    schemaDesignerDetails: this.schemaDesignerDetails,
                    baselineSchema: this.baselineSchema ?? this.schemaDesignerDetails.schema,
                    isDirty: false,
                };
            } else {
                schemaDesignerCacheItem = {
                    schemaDesignerDetails: {
                        schema: { tables: [] },
                        dataTypes: [],
                        schemaNames: [],
                        sessionId: "",
                    },
                    baselineSchema: this.baselineSchema ?? { tables: [] },
                    isDirty: false,
                };
            }
        }
        if (
            !this.schemaDesignerDetails &&
            schemaDesignerCacheItem.schemaDesignerDetails.sessionId
        ) {
            this.schemaDesignerDetails = schemaDesignerCacheItem.schemaDesignerDetails;
        }
        if (updatedSchema) {
            if (!this.schemaDesignerDetails) {
                throw new Error(LocConstants.schemaDesignerDetailsUnavailable);
            }
            this.schemaDesignerDetails!.schema = updatedSchema;
            schemaDesignerCacheItem.schemaDesignerDetails.schema = updatedSchema;
        }
        if (dabConfig) {
            schemaDesignerCacheItem.dabConfig = dabConfig;
        }
        // if isDirty is not provided, set it to schemaDesignerCacheItem.isDirty
        // else, set it to the provided value
        schemaDesignerCacheItem.isDirty = isDirty ?? schemaDesignerCacheItem.isDirty;
        this.schemaDesignerCache.set(this._key, schemaDesignerCacheItem);
        return schemaDesignerCacheItem;
    }

    // #region DAB persistence

    /**
     * Identifies the stored DAB configuration for this designer. Undefined when
     * the server could not be resolved, in which case nothing is persisted and
     * the designer falls back to the in-memory cache for this session.
     */
    private get dabStoreKey(): DabStoreKey | undefined {
        return this._serverName
            ? { server: this._serverName, database: this.databaseName }
            : undefined;
    }

    private async loadDabConfigFromStore(): Promise<Dab.DabConfig | undefined> {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key) {
            return undefined;
        }

        try {
            return await store.getConfig(key);
        } catch (error) {
            this.logger.warn(`Failed to read stored DAB config: ${getErrorMessage(error)}`);
            return undefined;
        }
    }

    /**
     * Drops the stored configuration so a reset cannot leave stale settings
     * behind if the designer closes before the defaults are saved.
     */
    private async deleteStoredDabConfig(): Promise<void> {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key) {
            return;
        }

        // A save queued from before the reset would write the old config back.
        this._pendingDabConfigSave = undefined;
        if (this._dabConfigSaveTimer) {
            clearTimeout(this._dabConfigSaveTimer);
            this._dabConfigSaveTimer = undefined;
        }

        try {
            await store.deleteConfig(key);
        } catch (error) {
            this.logger.warn(`Failed to discard stored DAB config: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Persists the configuration after a short idle period. The designer emits
     * a config on every edit, so writing on each one would mean a file write
     * per checkbox click.
     */
    private scheduleDabConfigSave(config: Dab.DabConfig): void {
        if (!this._dabConfigStore || !this.dabStoreKey) {
            return;
        }

        this._pendingDabConfigSave = config;
        if (this._dabConfigSaveTimer) {
            return;
        }

        this._dabConfigSaveTimer = setTimeout(() => {
            this._dabConfigSaveTimer = undefined;
            void this.flushDabConfigSave();
        }, DAB_CONFIG_SAVE_DEBOUNCE_MS);
    }

    /** Writes any pending configuration immediately. */
    private async flushDabConfigSave(): Promise<void> {
        if (this._dabConfigSaveTimer) {
            clearTimeout(this._dabConfigSaveTimer);
            this._dabConfigSaveTimer = undefined;
        }

        const config = this._pendingDabConfigSave;
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        this._pendingDabConfigSave = undefined;
        if (!config || !store || !key) {
            return;
        }

        try {
            await store.saveConfig(key, config);
        } catch (error) {
            this.logger.error(`Failed to save DAB config: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Records a container that finished deploying, or refreshes the record of
     * one that was redeployed.
     */
    private async trackDabDeployment(
        target: Dab.DabDeploymentTarget,
        params: Dab.DabDeploymentParams,
        config: Dab.DabConfig | undefined,
        deploymentId: string | undefined,
    ): Promise<void> {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key || !config) {
            return;
        }

        const isCli = target === Dab.DabDeploymentTarget.DabCli;
        const cliFields = isCli
            ? {
                  processId: this._pendingDabCliProcessId,
                  configPath: this.getDabCliConfigPath(params.containerName),
              }
            : {};

        try {
            const configHash = this._dabService.computeConfigHash(config);
            if (deploymentId) {
                const updated = await store.updateDeployment(key, deploymentId, {
                    target,
                    name: params.containerName,
                    port: params.port,
                    apiTypes: config.apiTypes,
                    configHash,
                    deployedUtc: new Date().toISOString(),
                    ...cliFields,
                });

                // The record can be gone if it was deleted mid-redeploy; fall
                // through and track the deployment that is now actually running.
                if (updated) {
                    return;
                }
            }

            await store.addDeployment(key, {
                target,
                name: params.containerName,
                port: params.port,
                apiTypes: config.apiTypes,
                configHash,
                ...cliFields,
            });
        } catch (error) {
            this.logger.error(`Failed to record DAB deployment: ${getErrorMessage(error)}`);
        } finally {
            this._pendingDabCliProcessId = undefined;
        }
    }

    /**
     * Generates a deployment name that collides with neither an existing Docker
     * container nor a deployment already tracked for this database.
     */
    private async generateDabDeploymentName(): Promise<string> {
        let trackedNames: string[] = [];
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (store && key) {
            try {
                trackedNames = (await store.getDeployments(key)).map(
                    (deployment) => deployment.name,
                );
            } catch (error) {
                this.logger.warn(
                    `Could not read tracked deployments while naming: ${getErrorMessage(error)}`,
                );
            }
        }

        return generateDabDeploymentName(this.databaseName, trackedNames);
    }

    /** Config file path for a CLI deployment of this name. */
    private getDabCliConfigPath(name: string): string | undefined {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key) {
            return undefined;
        }

        return this._dabService.getCliConfigPath(store.getCliDeploymentDirectory(key, name));
    }

    /** Resolves the live state of a tracked deployment, whichever target it uses. */
    private async getDabDeploymentStatus(
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.DabDeploymentContainerStatus> {
        return record.target === Dab.DabDeploymentTarget.DabCli
            ? this._dabService.getCliDeploymentStatus(record)
            : this._dabService.getContainerStatus(record.name);
    }

    /**
     * Starts a tracked deployment again without redeploying it.
     *
     * A CLI engine is a process rather than a container, so restarting it means
     * relaunching it from its saved config; the new process id is recorded so
     * the deployment can be stopped again later.
     */
    private async startTrackedDabDeployment(
        store: DabConfigStore,
        key: DabStoreKey,
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.DeploymentActionResponse> {
        if (record.target !== Dab.DabDeploymentTarget.DabCli) {
            return this._dabService.startContainer(record.name);
        }

        if (!this.connectionString) {
            return { success: false, error: LocConstants.SchemaDesigner.dabDeploymentNotSupported };
        }

        const result = await this._dabService.startCliDeployment(record, {
            connectionString: this.connectionString,
            sqlServerContainerName: this._sqlServerContainerName,
        });

        if (result.success) {
            await store.updateDeployment(key, record.id, { processId: result.processId });
        }

        return { success: result.success, error: result.error };
    }

    /**
     * Stops a deployment and removes whatever it left behind: the container for
     * Docker, or the engine process and its generated config for the CLI.
     */
    private async tearDownDabDeployment(
        store: DabConfigStore,
        key: DabStoreKey,
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.DeploymentActionResponse> {
        if (record.target === Dab.DabDeploymentTarget.DabCli) {
            const stopResult = await this._dabService.stopCliDeployment(record);
            if (!stopResult.success) {
                return stopResult;
            }

            await store.deleteCliDeployment(key, record.name);
            return { success: true };
        }

        const result = await this._dabService.stopDeployment(record.name);
        return { success: result.success, error: result.error };
    }

    /**
     * Builds the deployments list, pairing each tracked deployment with its
     * live container state and whether it is running an outdated config.
     */
    private async getDabDeploymentList(
        config: Dab.DabConfig | undefined,
    ): Promise<Dab.GetDeploymentsResponse> {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key) {
            return {
                deployments: [],
                error: LocConstants.LocalContainers.dabDeploymentStoreUnavailable,
            };
        }

        try {
            const records = await store.getDeployments(key);
            const currentConfigHash = config
                ? this._dabService.computeConfigHash(config)
                : undefined;

            const deployments = await Promise.all(
                records.map(async (record) => ({
                    ...record,
                    status: await this.getDabDeploymentStatus(record),
                    isConfigOutdated: currentConfigHash
                        ? currentConfigHash !== record.configHash
                        : false,
                    apiUrl: `http://localhost:${record.port}`,
                })),
            );

            // Newest first: the deployment a user just made is the one they act on.
            deployments.sort((left, right) => right.deployedUtc.localeCompare(left.deployedUtc));
            return { deployments };
        } catch (error) {
            this.logger.error(`Failed to list DAB deployments: ${getErrorMessage(error)}`);
            return { deployments: [], error: getErrorMessage(error) };
        }
    }

    /**
     * Resolves a tracked deployment and runs an action against it, reporting a
     * clear failure when the store is unavailable or the record has gone.
     */
    private async withTrackedDabDeployment<T extends Dab.DeploymentActionResponse>(
        deploymentId: string,
        action: (
            store: DabConfigStore,
            key: DabStoreKey,
            record: Dab.DabDeploymentRecord,
        ) => Promise<T>,
    ): Promise<T | Dab.DeploymentActionResponse> {
        const store = this._dabConfigStore;
        const key = this.dabStoreKey;
        if (!store || !key) {
            return {
                success: false,
                error: LocConstants.LocalContainers.dabDeploymentStoreUnavailable,
            };
        }

        try {
            const record = (await store.getDeployments(key)).find(
                (deployment) => deployment.id === deploymentId,
            );
            if (!record) {
                return {
                    success: false,
                    error: LocConstants.LocalContainers.dabDeploymentNotFound,
                };
            }

            return await action(store, key, record);
        } catch (error) {
            this.logger.error(`DAB deployment action failed: ${getErrorMessage(error)}`);
            return { success: false, error: getErrorMessage(error) };
        }
    }

    /**
     * Clears the way for a redeployment: the port is checked first so a
     * container is never removed for a deployment that cannot succeed, then the
     * existing container is removed so it can be recreated under the same name.
     */
    private async prepareDabRedeployment(
        store: DabConfigStore,
        key: DabStoreKey,
        record: Dab.DabDeploymentRecord,
    ): Promise<Dab.PrepareRedeploymentResponse> {
        const status = await this.getDabDeploymentStatus(record);
        const portUnavailableError = {
            success: false,
            error: LocConstants.LocalContainers.dabRedeployPortUnavailable(
                record.port,
                record.name,
            ),
        };

        // Only a running deployment is holding its own port. In every other
        // state the port can be checked first, so nothing is torn down for a
        // redeployment that was going to fail anyway.
        const isRunning = status === Dab.DabDeploymentContainerStatus.Running;
        if (!isRunning && !(await this._dabService.isPortAvailable(record.port))) {
            return portUnavailableError;
        }

        const tearDownResult = await this.tearDownDabDeployment(store, key, record);
        if (!tearDownResult.success) {
            return { success: false, error: tearDownResult.error };
        }

        // Whatever was holding the port is gone now, so anything still bound to
        // it belongs to something else.
        if (isRunning && !(await this._dabService.isPortAvailable(record.port))) {
            return portUnavailableError;
        }

        sendActionEvent(TelemetryViews.SchemaDesigner, TelemetryActions.RedeployDabDeployment, {
            additionalProps: { target: record.target },
        });
        return {
            success: true,
            params: { containerName: record.name, port: record.port },
            target: record.target,
        };
    }

    // #endregion

    override async dispose(): Promise<void> {
        if (this._progressListener) {
            this.schemaDesignerService.removeProgressListener(this._progressListener);
            this._progressListener = undefined;
        }
        if (this._messageListener) {
            this.schemaDesignerService.removeMessageListener(this._messageListener);
            this._messageListener = undefined;
        }
        if (this.schemaDesignerDetails) {
            this.updateCacheItem(this.schemaDesignerDetails!.schema);
        }
        await this.flushDabConfigSave();
        super.dispose();
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
     * Applies a batch of semantic schema edits in the webview (used by the schema designer LM tool).
     * This method must never be treated as a transcript schema source; it is only used to compute receipts.
     */
    public async applyEdits(
        params: SchemaDesigner.ApplyEditsWebviewParams,
    ): Promise<SchemaDesigner.ApplyEditsWebviewResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(SchemaDesigner.ApplyEditsWebviewRequest.type, params);
    }

    public async getDabToolState(): Promise<Dab.GetDabToolStateResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(Dab.GetDabToolStateRequest.type, undefined);
    }

    public async applyDabToolChanges(
        params: Dab.ApplyDabToolChangesParams,
    ): Promise<Dab.ApplyDabToolChangesResponse> {
        await this.whenWebviewReady();
        return this.sendRequest(Dab.ApplyDabToolChangesRequest.type, params);
    }

    public showView(view: SchemaDesigner.SchemaDesignerActiveView): void {
        this.updateState({
            ...this.state,
            activeView: view,
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
        return this.resolveConnectionInfo()?.server;
    }

    /**
     * Determines whether the DAB (Data API builder) feature is supported for this connection.
     * Currently only SQL Login connections are supported because DAB runs in a local
     * Docker container that cannot perform interactive Azure AD authentication.
     */
    private resolveIsDabDeploymentSupported(): boolean {
        const authType = this.resolveAuthenticationType();
        return authType === AuthenticationType.SqlLogin;
    }

    private resolveAuthenticationType(): string | undefined {
        return this.resolveConnectionInfo()?.authenticationType;
    }

    /**
     * Resolves the SQL Server container name from the connection profile.
     * Returns undefined if the SQL Server is not running in a Docker container.
     */
    private resolveSqlServerContainerName(): string | undefined {
        return this.resolveConnectionInfo()?.containerName;
    }

    private resolveServerInfo(): IServerInfo | undefined {
        const connectionInfo = this.resolveConnectionInfo();
        if (!connectionInfo) {
            return undefined;
        }
        return this.mainController.connectionManager.getServerInfo(connectionInfo);
    }

    private resolveConnectionInfo(): IConnectionInfo | undefined {
        if (this.treeNode) {
            return this.treeNode.connectionProfile;
        }

        if (this.connectionUri) {
            return this.mainController.connectionManager.getConnectionInfo(this.connectionUri)
                ?.credentials;
        }

        return undefined;
    }
}
