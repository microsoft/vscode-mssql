/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
import VscodeWrapper from "./controllers/vscodeWrapper";
import { ConnectionDetails, IConnectionInfo, IExtension } from "vscode-mssql";
import { Deferred } from "./protocol";
import * as utils from "./models/utils";
import { ObjectExplorerUtils } from "./objectExplorer/objectExplorerUtils";
import SqlToolsServerClient from "./languageservice/serviceclient";
import { ConnectionProfile } from "./models/connectionProfile";
import { FirewallRuleError } from "./languageservice/interfaces";
import { RequestType } from "vscode-languageclient";
import { createSqlAgentRequestHandler } from './chat/sqlAgentRequestHandler';
// import { Message, Ollama, Tool, ToolCall } from 'ollama';
import { ClaudeLanguageModelChatProviderImpl } from "./claudeLanguageModelChatProviderImpl";

let controller: MainController = undefined;

export class LanguageModelTextPart implements vscode.LanguageModelChatResponseTextPart {
	value: string;

	constructor(value: string) {
		this.value = value;

	}
}

class LanguageModelChatProviderImpl implements vscode.LanguageModelChatProvider {
    LanguageModelChatProviderImpl() {
        this.onDidReceiveLanguageModelResponse2(e => {
			console.log('onDidReceiveLanguageModelResponse2', e);
		});
    }

    private delegate: ClaudeLanguageModelChatProviderImpl = new ClaudeLanguageModelChatProviderImpl();

    private readonly _emitter = new vscode.EventEmitter<{ readonly extensionId: string; readonly participant?: string; readonly tokenCount?: number }>();
    public onDidReceiveLanguageModelResponse2: vscode.Event<{ readonly extensionId: string; readonly participant?: string; readonly tokenCount?: number }> = this._emitter.event

    public provideLanguageModelResponse(
        originalMessages: vscode.LanguageModelChatMessage[],
        options: { [name: string]: any },
        extensionId: string,
        progress: vscode.Progress<vscode.ChatResponseFragment>,
        token: vscode.CancellationToken): Thenable<any> {

        return this.delegate.provideLanguageModelResponse(originalMessages, options, extensionId, progress, token);
        //return undefined;
    }

    // private static toTools(tools: vscode.LanguageModelChatTool[]): Tool[] {
    //     let newTools: Tool[] = [];
    //     let tool = tools[0];
    //     newTools.push({ type: 'function', function: { name: tool.name, description: tool.description, parameters: <any>tool.parametersSchema } });
    //     return newTools;
    // }

    // private static toLanguageModelChatMessageToolResultPart(toolCall: ToolCall): vscode.LanguageModelChatResponseToolCallPart {
    //     return new vscode.LanguageModelChatResponseToolCallPart(
    //         toolCall.function.name,
    //         toolCall.function.name,
    //         toolCall.function.arguments);
    // }

    public async provideLanguageModelResponse2(
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        extensionId: string,
        progress: vscode.Progress<vscode.ChatResponseFragment2>,
        token: vscode.CancellationToken): Promise<any> {

        return this.delegate.provideLanguageModelResponse2(messages, options, extensionId, progress, token);

        // let newMessages: Message[] = [];
        // for (const message of messages) {
        //     newMessages.push({ role: message.role == 1 ? 'user' : 'assistant', content: message.content });
        // }
        // const ollama = new Ollama({ host: 'http://localhost:11434' })
        // let response = await ollama.chat(
        // { model: 'llama3.2',
        //     messages: newMessages,
        //     stream: false,
        //     tools: LanguageModelChatProviderImpl.toTools(options.tools)
        // });

        //  // Process function calls made by the model
        // if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        //     let toolCall = LanguageModelChatProviderImpl.toLanguageModelChatMessageToolResultPart(response.message.tool_calls[0]);
        //     progress.report({ index: 0, part: toolCall });

        // } else {
        //     let outputString = response.message.content;
        //     progress.report({ index: 0, part: new vscode.LanguageModelChatResponseTextPart(outputString) });
        //     this._emitter.fire({ extensionId: extensionId, participant: 'local-ollama', tokenCount: 10 });
        // }
    }

    public provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Thenable<number> {
        return this.delegate.provideTokenCount(text, token);
        //return Promise.resolve(10); // just use a fixed number for now
    }
}

class ChatResponseProviderMetadataImpl implements vscode.ChatResponseProviderMetadata {

    readonly vendor: string = 'local-ollama';

    /**
     * Human-readable name of the language model.
     */
    readonly name: string = "Local Ollama";
    /**
     * Opaque family-name of the language model. Values might be `gpt-3.5-turbo`, `gpt4`, `phi2`, or `llama`
     * but they are defined by extensions contributing languages and subject to change.
     */
    readonly family: string = 'local-ollama';

    /**
     * Opaque version string of the model. This is defined by the extension contributing the language model
     * and subject to change while the identifier is stable.
     */
    readonly version: string = '3.2'

    readonly maxInputTokens: number = 30000;

    readonly maxOutputTokens: number= 30000;

    /**
     * When present, this gates the use of `requestLanguageModelAccess` behind an authorization flow where
     * the user must approve of another extension accessing the models contributed by this extension.
     * Additionally, the extension can provide a label that will be shown in the UI.
     */
    auth?: true | { label: string };

    // TODO@API maybe an enum, LanguageModelChatProviderPickerAvailability?
    readonly isDefault?: boolean = true;
    readonly isUserSelectable?: boolean = true;
}

export async function activate(
    context: vscode.ExtensionContext,
): Promise<IExtension> {
    let vscodeWrapper = new VscodeWrapper();
    controller = new MainController(context, undefined, vscodeWrapper);

    // Checking if localization should be applied
    //let config = vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
    //let applyLocalization = config[Constants.configApplyLocalization];
    // if (applyLocalization) {
    // 	LocalizedConstants.loadLocalizedConstants(vscode.env.language);
    // }

    // Exposed for testing purposes
    vscode.commands.registerCommand(
        "mssql.getControllerForTests",
        () => controller,
    );
    await controller.activate();

	const participant = vscode.chat.createChatParticipant('mssql.agent',
		createSqlAgentRequestHandler(controller.copilotService, vscodeWrapper, context));

    // Register the chat model provider
    vscode.lm.registerChatModelProvider(
        "local-ollama",
        new LanguageModelChatProviderImpl(),
        new ChatResponseProviderMetadataImpl(),
    );

	context.subscriptions.push(controller, participant);

    return {
        sqlToolsServicePath: SqlToolsServerClient.instance.sqlToolsServicePath,
        promptForConnection: (ignoreFocusOut?: boolean) => {
            return controller.connectionManager.connectionUI.promptForConnection(
                ignoreFocusOut,
            );
        },
        connect: async (
            connectionInfo: IConnectionInfo,
            saveConnection?: boolean,
        ) => {
            const uri = utils.generateQueryUri().toString();
            const connectionPromise = new Deferred<boolean>();
            // First wait for initial connection request to succeed
            const requestSucceeded = await controller.connect(
                uri,
                connectionInfo,
                connectionPromise,
                saveConnection,
            );
            if (!requestSucceeded) {
                if (
                    controller.connectionManager.failedUriToFirewallIpMap.has(
                        uri,
                    )
                ) {
                    throw new FirewallRuleError(
                        uri,
                        `Connection request for ${JSON.stringify(connectionInfo)} failed because of invalid firewall rule settings`,
                    );
                } else {
                    throw new Error(
                        `Connection request for ${JSON.stringify(connectionInfo)} failed`,
                    );
                }
            }
            // Next wait for the actual connection to be made
            const connectionSucceeded = await connectionPromise;
            if (!connectionSucceeded) {
                throw new Error(
                    `Connection for ${JSON.stringify(connectionInfo)} failed`,
                );
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
        promptForFirewallRule: (
            connectionUri: string,
            connectionInfo: IConnectionInfo,
        ) => {
            const connectionProfile = new ConnectionProfile(connectionInfo);
            return controller.connectionManager.connectionUI.addFirewallRule(
                connectionUri,
                connectionProfile,
            );
        },
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        createConnectionDetails: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.createConnectionDetails(
                connectionInfo,
            );
        },
        sendRequest: async <P, R, E, R0>(
            requestType: RequestType<P, R, E, R0>,
            params?: P,
        ) => {
            return await controller.connectionManager.sendRequest(
                requestType,
                params,
            );
        },
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
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
        let savedController: MainController =
            await vscode.commands.executeCommand("mssql.getControllerForTests");
        return savedController;
    }
    return controller;
}
