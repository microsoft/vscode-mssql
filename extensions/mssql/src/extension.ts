/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    IInstantiationService,
    InstantiationServiceBuilder,
    ServiceDescriptor,
} from "extension-toolkit/base";
import {
    ExtensionContextService,
    IExtensionContextService,
    initializeExtensionToolkit,
    initializeTelemetryReporter,
    sendActionEvent,
    telemetryReporter,
} from "extension-toolkit/vscode";
import MainController from "./controllers/mainController";
import { IExtension } from "vscode-mssql";
import SqlToolsServerClient from "./languageservice/serviceclient";
import { createMssqlInternalApi } from "./controllers/internalApiFactory";
import { registerDataWorkspace } from "./dataWorkspace/dataWorkspaceRegistration";
import { IExtension as IDataWorkspaceExtension } from "dataworkspace";
import {
    createSqlAgentRequestHandler,
    ISqlChatResult,
    provideFollowups,
} from "./copilot/chatAgentRequestHandler";
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
import { CredentialStore, ICredentialStore } from "./credentialstore/credentialstore";
import { ConnectionConfig, IConnectionConfig } from "./connectionconfig/connectionconfig";
import { IConnectionStore, ConnectionStore } from "./models/connectionStore";
import { IAccountStore, AccountStore } from "./azure/accountStore";

/** The mssql extension API, including the Projects workspace API used by project extensions. */
export type MssqlExtensionApi = IExtension & { dataWorkspace: IDataWorkspaceExtension };

/** exported for testing purposes only */
export let controller: MainController = undefined;
export let uriOwnershipCoordinator: UriOwnershipCoordinator = undefined;

let activation: MssqlActivation | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<MssqlExtensionApi> {
    initializeExtensionToolkit();

    const builder = new InstantiationServiceBuilder();

    builder.define(IExtensionContextService, new ExtensionContextService(context));
    builder.define(ICredentialStore, new ServiceDescriptor(CredentialStore));
    builder.define(IConnectionConfig, new ServiceDescriptor(ConnectionConfig));
    builder.define(IConnectionStore, new ServiceDescriptor(ConnectionStore));
    builder.define(IAccountStore, new ServiceDescriptor(AccountStore));

    const instantiationService = builder.seal();
    context.subscriptions.push(instantiationService);

    activation = instantiationService.createInstance(MssqlActivation);
    return activation.activate();
}

// this method is called when your extension is deactivated
export async function deactivate(): Promise<void> {
    await activation?.deactivate();
}

/**
 * Exposed for testing purposes
 */
export async function getController(): Promise<MainController> {
    if (!controller) {
        const savedController: MainController = await vscode.commands.executeCommand(
            "mssql.getControllerForTests",
        );
        return savedController;
    }
    return controller;
}

class MssqlActivation {
    constructor(
        @IExtensionContextService private readonly _contextService: IExtensionContextService,
        @IInstantiationService private readonly _instantiationService: IInstantiationService,
    ) {}

    async activate(): Promise<MssqlExtensionApi> {
        const context = this._contextService.context;
        initializeTelemetryReporter(context.extension.packageJSON.aiKey);

        // Create coordinator early so uriOwnershipApi is available for export
        uriOwnershipCoordinator = createUriOwnershipCoordinator(context);

        controller = this._instantiationService.createInstance(MainController, context);
        context.subscriptions.push(controller);
        context.subscriptions.push(telemetryReporter);

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
        registerSqlToolsMcpServer(
            context,
            controller.connectionManager,
            SqlToolsServerClient.instance,
        );

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
                    kind:
                        feedback.kind === ChatResultFeedbackKind.Helpful ? "Helpful" : "Unhelpful",
                    correlationId: (feedback.result as ISqlChatResult).metadata.correlationId,
                });
            },
        );

        context.subscriptions.push(controller, participant, receiveFeedbackDisposable);

        await ChangelogWebviewController.showChangelogOnExtensionUpdate(context);

        // TODO(api-retirement): Remove this public API after dependent extensions have migrated.
        const api: MssqlExtensionApi = {
            ...createMssqlInternalApi(controller, uriOwnershipCoordinator),
            dataWorkspace: registerDataWorkspace(context),
        };
        return api;
    }

    async deactivate(): Promise<void> {
        if (controller) {
            await controller.deactivate();
            controller.dispose();
        }
    }
}
