/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotService } from '../services/copilotService';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { LanguageModelChatTool, MessageRole, MessageType } from '../models/contracts/copilot';

interface ISqlChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	};
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4o' };

let nextConversationUriId = 1;

export const createSqlAgentRequestHandler = (
	copilotService: CopilotService,
	vscodeWrapper: VscodeWrapper,
	context: vscode.ExtensionContext): vscode.ChatRequestHandler => {

	const handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		_context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<ISqlChatResult> => {
		const prompt = request.prompt.trim();
		const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

		try {
			if (!model) {
				stream.markdown('No model found.');
				return { metadata: { command: '' } };
			}

			stream.progress(`Using ${model.name} (${context.languageModelAccessInformation.canSendRequest(model)})...`);

			let conversationUri = `conversationUri${nextConversationUriId++}`;
			let connectionUri = vscodeWrapper.activeTextEditorUri;
			if (!connectionUri) {
				stream.markdown('Please open a SQL file before asking for help.');
				return { metadata: { command: '' } };
			}

			const success = await copilotService.startConversation(conversationUri, connectionUri, prompt);
			console.log(success ? "Success" : "Failure");

			let sqlTool: LanguageModelChatTool;
			let sqlToolParameters: string;
			let replyText = '';
			let continuePollingMessages = true;
			let printTextout = false;
			let functionCalledPreviously = true;
			while (continuePollingMessages) {
				const result = await copilotService.getNextMessage(conversationUri, replyText, sqlTool, sqlToolParameters);
				replyText = '';
				sqlTool = undefined;
				sqlToolParameters = undefined;

				continuePollingMessages = result.messageType !== MessageType.Complete;
				if (result.messageType === MessageType.Complete || result.messageType === MessageType.Fragment) {
					replyText = '';
				} else if (result.messageType === MessageType.RequestLLM) {
					const requestTools = result.tools.map((tool): vscode.LanguageModelChatTool => {
						return {
							name: tool.functionName,
							description: tool.functionDescription,
							inputSchema: JSON.parse(tool.functionParameters)
						};
					});

					const options: vscode.LanguageModelChatRequestOptions = {
						justification: 'SQL Server Copilot requested this information.',
						tools: requestTools
					};
					const messages = [];

					for (const message of result.requestMessages) {
						if (message.role == MessageRole.System) {
							messages.push(vscode.LanguageModelChatMessage.Assistant(message.text));
						} else {
							messages.push(vscode.LanguageModelChatMessage.User(message.text));
						}
					}

					replyText = '';
					const chatResponse = await model.sendRequest(messages, options, token);
					let partIdx = 0;
					for await (const part of chatResponse.stream) {
						if (part instanceof vscode.LanguageModelTextPart) {
							if (partIdx === 0 && !functionCalledPreviously) {
								break;
							}

							functionCalledPreviously = false;
							replyText += part.value;
							printTextout = true;
						} else if (part instanceof vscode.LanguageModelToolCallPart) {
							functionCalledPreviously = true;
							const tool = result.tools.find(tool => tool.functionName === part.name);
							if (!tool) {
								stream.markdown(`Tool lookup for: ${part.name} - ${JSON.stringify(part.input)}.  Invoking external tool.`);
								continue;
							}

							sqlTool = tool;
							try {
								sqlToolParameters = JSON.stringify(part.input);
							} catch (err) {
								throw new Error(`Got invalid tool use parameters: "${JSON.stringify(part.input)}". (${(err as Error).message})`);
							}

							stream.progress(`Calling tool: ${tool.functionName} with ${JSON.stringify(part.input)}`);
						}
						++partIdx;
					}
				}

				if (printTextout) {
					stream.markdown(replyText);
					printTextout = false;
				}
			}

		} catch (err) {
			handleError(err, stream);
		}

		return { metadata: { command: '' } };
	};

	return handler;
};

/* HELPER FUNCTIONS */

function handleError(err: any, stream: vscode.ChatResponseStream): void {
	// making the chat request might fail because
	// - model does not exist
	// - user consent not given
	// - quote limits exceeded
	if (err instanceof vscode.LanguageModelError) {
		console.log(err.message, err.code);
		if (err.message.includes('off_topic')) {
			stream.markdown(vscode.l10n.t("I'm sorry, I can only explain computer science concepts."));
		}
	} else {
		// re-throw other errors so they show up in the UI
		throw err;
	}
}
