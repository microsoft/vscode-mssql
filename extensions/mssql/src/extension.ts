/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
import VscodeWrapper from "./controllers/vscodeWrapper";
import { ConnectionDetails, IConnectionInfo, IExtension } from "vscode-mssql";
import * as utils from "./models/utils";
import { ObjectExplorerUtils } from "./objectExplorer/objectExplorerUtils";
import SqlToolsServerClient from "./languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import {
    createSqlAgentRequestHandler,
    ISqlChatResult,
    provideFollowups,
} from "./copilot/chatAgentRequestHandler";
import { sendActionEvent } from "./telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "./sharedInterfaces/telemetry";
import { ChatResultFeedbackKind } from "vscode";
import { IconUtils } from "./utils/iconUtils";
import { ChangelogWebviewController } from "./controllers/changelogWebviewController";
import { initializeWebviewLocalizationCache } from "./controllers/localizationCache";
import { UriOwnershipCoordinator } from "./uriOwnership/uriOwnershipCore";
import {
    createUriOwnershipCoordinator,
    initializeUriOwnershipCoordinator,
} from "./uriOwnership/uriOwnershipInitialization";
import {
    SqlServerBranchDataProvider,
    isSqlServerRootModel,
} from "./azure/sqlServerBranchDataProvider";
import {
    AzExtResourceType,
    AzureResourcesExtensionApi,
    apiUtils,
} from "@microsoft/vscode-azureresources-api";

/** exported for testing purposes only */
export let controller: MainController = undefined;
export let uriOwnershipCoordinator: UriOwnershipCoordinator = undefined;

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
    // Create coordinator early so uriOwnershipApi is available for export
    uriOwnershipCoordinator = createUriOwnershipCoordinator(context);

    let vscodeWrapper = new VscodeWrapper();
    controller = new MainController(context, undefined, vscodeWrapper);
    context.subscriptions.push(controller);
    // Initialize loc cache for webviews early so that it's ready by the time any webview requests it.
    initializeWebviewLocalizationCache();

    IconUtils.initialize(context.extensionUri);

    // Check if GitHub Copilot is installed
    const copilotExtension = vscode.extensions.getExtension("github.copilot-chat");
    vscode.commands.executeCommand(
        "setContext",
        "mssql.copilot.isGHCInstalled",
        !!copilotExtension,
    );

    // Exposed for testing purposes
    vscode.commands.registerCommand("mssql.getControllerForTests", () => controller);
    await controller.activate();

    initializeUriOwnershipCoordinator(uriOwnershipCoordinator, controller.connectionManager);

    // Soft-register with the Azure Resources extension if it is installed.
    // If it is not installed, mssql continues to work normally with no degradation.
    void registerAzureResourcesBranchDataProvider(context, controller);

    const participant = vscode.chat.createChatParticipant(
        "mssql.agent",
        createSqlAgentRequestHandler(controller.copilotService, vscodeWrapper, context, controller),
    );
    participant.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "images",
        "mssql-chat-avatar.jpg",
    );
    participant.followupProvider = {
        provideFollowups: (
            result: vscode.ChatResult,
            context: vscode.ChatContext,
            token: vscode.CancellationToken,
        ) => provideFollowups(result, context, token, controller, vscodeWrapper),
    };

    const receiveFeedbackDisposable = participant.onDidReceiveFeedback(
        (feedback: vscode.ChatResultFeedback) => {
            sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.Feedback, {
                kind: feedback.kind === ChatResultFeedbackKind.Helpful ? "Helpful" : "Unhelpful",
                correlationId: (feedback.result as ISqlChatResult).metadata.correlationId,
            });
        },
    );

    context.subscriptions.push(controller, participant, receiveFeedbackDisposable);

    await ChangelogWebviewController.showChangelogOnExtensionUpdate(context);

    return {
        sqlToolsServicePath: SqlToolsServerClient.instance.sqlToolsServicePath,
        promptForConnection: async (ignoreFocusOut?: boolean) => {
            const connectionProfileList =
                await controller.connectionManager.connectionStore.getPickListItems();
            return controller.connectionManager.connectionUI.promptForConnection(
                connectionProfileList,
                ignoreFocusOut,
            );
        },
        connect: async (connectionInfo: IConnectionInfo, saveConnection?: boolean) => {
            const uri = utils.generateQueryUri().toString();
            // First wait for initial connection request to succeed
            const requestSucceeded = await controller.connect(
                uri,
                connectionInfo,
                saveConnection,
                "extensionApi",
            );
            if (!requestSucceeded) {
                throw new Error(`Connection request for ${JSON.stringify(connectionInfo)} failed`);
            }
            return uri;
        },
        listDatabases: (connectionUri: string) => {
            return controller.connectionManager.listDatabases(connectionUri);
        },
        getDatabaseNameFromTreeNode: (node: vscodeMssql.ITreeNodeInfo) => {
            return ObjectExplorerUtils.getDatabaseName(node);
        },
        dacFx: controller.dacFxService,
        schemaCompare: controller.schemaCompareService,
        sqlProjects: controller.sqlProjectsService,
        getConnectionString: (
            connectionUriOrDetails: string | ConnectionDetails,
            includePassword?: boolean,
            includeApplicationName?: boolean,
        ) => {
            return controller.connectionManager.getConnectionString(
                connectionUriOrDetails,
                includePassword,
                includeApplicationName,
            );
        },
        promptForFirewallRule: async (connectionUri: string, credentials: IConnectionInfo) => {
            const connectionInfo = controller.connectionManager.getConnectionInfo(connectionUri);
            if (!connectionInfo) {
                throw new Error(
                    `Could not find connection info for connection URI: ${connectionUri}`,
                );
            }
            return controller.connectionManager.handleFirewallError(
                credentials,
                connectionInfo.errorMessage,
            );
        },
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        createConnectionDetails: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.createConnectionDetails(connectionInfo);
        },
        sendRequest: async <P, R, E, R0>(requestType: RequestType<P, R, E, R0>, params?: P) => {
            return await controller.connectionManager.sendRequest(requestType, params);
        },
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
        connectionSharing: {
            getActiveEditorConnectionId: (extensionId: string) => {
                return controller.connectionSharingService.getActiveEditorConnectionId(extensionId);
            },
            getActiveDatabase: (extensionId: string) => {
                return controller.connectionSharingService.getActiveDatabase(extensionId);
            },
            getDatabaseForConnectionId: (extensionId: string, connectionId: string) => {
                return controller.connectionSharingService.getDatabaseForConnectionId(
                    extensionId,
                    connectionId,
                );
            },
            connect: async (extensionId: string, connectionId: string): Promise<string> => {
                return controller.connectionSharingService.connect(extensionId, connectionId);
            },
            disconnect: (connectionUri: string): void => {
                return controller.connectionSharingService.disconnect(connectionUri);
            },
            isConnected: (connectionUri: string): boolean => {
                return controller.connectionSharingService.isConnected(connectionUri);
            },
            executeSimpleQuery: (
                connectionUri: string,
                queryString: string,
            ): Promise<vscodeMssql.SimpleExecuteResult> => {
                return controller.connectionSharingService.executeSimpleQuery(
                    connectionUri,
                    queryString,
                );
            },
            getServerInfo: (connectionUri: string): vscodeMssql.IServerInfo => {
                return controller.connectionSharingService.getServerInfo(connectionUri);
            },
            listDatabases: (connectionUri: string): Promise<string[]> => {
                return controller.connectionSharingService.listDatabases(connectionUri);
            },
            scriptObject: (connectionUri, operation, scriptingObject) => {
                return controller.connectionSharingService.scriptObject(
                    connectionUri,
                    operation,
                    scriptingObject,
                );
            },
            getConnectionString: (extensionId: string, connectionId: string): Promise<string> => {
                return controller.connectionSharingService.getConnectionString(
                    extensionId,
                    connectionId,
                );
            },
        } as vscodeMssql.IConnectionSharingService,
        uriOwnershipApi: uriOwnershipCoordinator.uriOwnershipApi,
    };
}

// this method is called when your extension is deactivated
export async function deactivate(): Promise<void> {
    if (controller) {
        await controller.deactivate();
        controller.dispose();
    }
}

/**
 * Registers the SQL Server branch data provider with the Azure Resources extension, if installed.
 * This is a no-op if the Azure Resources extension is not installed.
 */
async function registerAzureResourcesBranchDataProvider(
    context: vscode.ExtensionContext,
    mainController: MainController,
): Promise<void> {
    const outputChannel = mainController.vscodeWrapper.outputChannel;

    try {
        outputChannel.appendLine("[Azure Resources] Looking for the Azure Resources extension...");

        const apiProvider = await apiUtils.getExtensionExports<apiUtils.AzureExtensionApiProvider>(
            "ms-azuretools.vscode-azureresourcegroups",
        );

        if (!apiProvider) {
            // Azure Resources extension is not installed; skip registration silently.
            outputChannel.appendLine(
                "[Azure Resources] Azure Resources extension not found; skipping branch data provider registration.",
            );
            return;
        }

        outputChannel.appendLine(
            "[Azure Resources] Registering SQL Server branch data provider...",
        );

        const api = apiProvider.getApi<AzureResourcesExtensionApi>("2", {
            extensionId: context.extension.id,
        });

        const provider = new SqlServerBranchDataProvider(
            mainController.objectExplorerProvider.objectExplorerService,
            outputChannel,
        );

        const openInObjectExplorerCommand = vscode.commands.registerCommand(
            "mssql.openInObjectExplorer",
            async (node: unknown) => {
                if (!isSqlServerRootModel(node)) {
                    return;
                }
                if (node.connectionNode) {
                    mainController.objectExplorerProvider.objectExplorerService.revealInObjectExplorer(
                        node.connectionNode,
                    );
                    await vscode.commands.executeCommand("objectExplorer.focus");
                } else {
                    await vscode.window.showWarningMessage(
                        `Connect to "${node.resource.name}" first by expanding it in the Azure Resources view.`,
                    );
                }
            },
        );

        context.subscriptions.push(
            provider,
            openInObjectExplorerCommand,
            api.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.SqlServers,
                provider,
            ),
        );

        outputChannel.appendLine(
            "[Azure Resources] SQL Server branch data provider registered successfully.",
        );
    } catch (err) {
        outputChannel.appendLine(
            `[Azure Resources] Failed to register branch data provider: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Do not rethrow — failure here must not break regular mssql functionality.
    }
}

/**
 * Exposed for testing purposes
 */
export async function getController(): Promise<MainController> {
    if (!controller) {
        let savedController: MainController = await vscode.commands.executeCommand(
            "mssql.getControllerForTests",
        );
        return savedController;
    }
    return controller;
}
