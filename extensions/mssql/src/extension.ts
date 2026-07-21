/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
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
import { registerSqlToolsMcpServer } from "./sqlToolsMcp/registerSqlToolsMcpServer";
import { Perf } from "./perf/perfTelemetry";
import { registerPerfApi } from "./perf/perfApi";
import { DiagnosticsManager } from "./diagnostics/diagnosticsManager";
import { registerDebugConsole } from "./controllers/debugConsoleWebviewController";
import { startStsDiagListener } from "./diagnostics/stsDiagListener";
import { perfSlowdown } from "./perf/perfSlowdown";

/** exported for testing purposes only */
export let controller: MainController = undefined;
export let uriOwnershipCoordinator: UriOwnershipCoordinator = undefined;

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
    try {
        return await activateInternal(context);
    } catch (error) {
        // Activation begin/end markers must stay balanced even when activation
        // fails, so the harness/self-test sees a clear failure instead of
        // waiting for an end marker that never comes.
        Perf.setActivationState("failed");
        Perf.marker("mssql.activate.end", "end", {
            failed: true,
            error: true,
            reason:
                error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
        });
        Perf.flush();
        throw error;
    }
}

async function activateInternal(context: vscode.ExtensionContext): Promise<IExtension> {
    // Session Diag lifecycle FIRST: when mssql.sessionDiag.enabled is on, the
    // store sink must exist before the first activation marker fires so
    // startup/activation data is captured, not dropped. The manager has no
    // controller dependency; the Debug Console command registers with it.
    let diagnosticsManager: DiagnosticsManager | undefined;
    if (vscode.workspace.getConfiguration().get<boolean>("mssql.debugConsole.enabled", true)) {
        diagnosticsManager = new DiagnosticsManager(context);
        context.subscriptions.push(diagnosticsManager);
        registerDebugConsole(context, diagnosticsManager);
    }

    Perf.setActivationState("activating");
    Perf.marker("mssql.activate.begin", "begin");
    await perfSlowdown(750);

    // Create coordinator early so uriOwnershipApi is available for export
    uriOwnershipCoordinator = createUriOwnershipCoordinator(context);

    controller = new MainController(context);
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

    // Start the STS diagnostics listener BEFORE the service spawns so the
    // child inherits STS_DIAG_URL/STS_DIAG_TOKEN (Debug Console live spans
    // for dispatcher/SqlCommand/SMO). Near-zero cost when the console is
    // closed: the service batches cheaply and the listener discards.
    if (vscode.workspace.getConfiguration().get<boolean>("mssql.debugConsole.enabled", true)) {
        await startStsDiagListener();
    }

    await controller.activate();

    initializeUriOwnershipCoordinator(uriOwnershipCoordinator, controller.connectionManager);
    registerSqlToolsMcpServer(context, controller.connectionManager, SqlToolsServerClient.instance);

    const participant = vscode.chat.createChatParticipant(
        "mssql.agent",
        createSqlAgentRequestHandler(controller.copilotService, context, controller),
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
        ) => provideFollowups(result, context, token, controller),
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

    registerPerfApi(context, { getController: () => controller });

    // (Session Diag + Debug Console are initialized at the very top of
    // activation so startup/activation events are captured, not dropped.)

    Perf.setActivationState("activated");
    Perf.marker("mssql.activate.end", "end");
    Perf.flush();

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
        sendRequest: async <P, R, E>(requestType: RequestType<P, R, E>, params?: P) => {
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
