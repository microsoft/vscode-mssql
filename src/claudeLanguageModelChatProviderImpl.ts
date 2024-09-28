import * as vscode from 'vscode';
import Anthropic from "@anthropic-ai/sdk";
import { Message, MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';

export class ClaudeLanguageModelChatProviderImpl implements vscode.LanguageModelChatProvider {
    private readonly _emitter = new vscode.EventEmitter<{ readonly extensionId: string; readonly participant?: string; readonly tokenCount?: number }>();
    public onDidReceiveLanguageModelResponse2: vscode.Event<{ readonly extensionId: string; readonly participant?: string; readonly tokenCount?: number }> = this._emitter.event;

    constructor() {
        this.onDidReceiveLanguageModelResponse2(e => {
            console.log('onDidReceiveLanguageModelResponse2', e);
        });
    }

    public provideLanguageModelResponse(
        originalMessages: vscode.LanguageModelChatMessage[],
        options: { [name: string]: any },
        extensionId: string,
        progress: vscode.Progress<vscode.ChatResponseFragment>,
        token: vscode.CancellationToken): Thenable<any> {
        return Promise.resolve(undefined);
    }

    private static toClaudeTools(tools: vscode.LanguageModelChatTool[]): Tool[] {
        return tools.map(tool => (
        <Tool>{
            name: tool.name,
            description: tool.description,
            input_schema: tool.parametersSchema
        }));
    }

    private async callClaudeApi(messages: MessageParam[], options: any): Promise<Message> {
        let systemMessage = '';
        let activeAssistantMessage: MessageParam | undefined = undefined;
        let requestMessages = [];
        for (let message of messages) {
            if (message.role === 'assistant') {
                if (message.content[0] !== undefined && requestMessages.length === 0) {
                    //let content: any = message.content[0];
                    if (message.content !== undefined) {
                        systemMessage += message.content + '\n';
                    }
                } else {
                    if (activeAssistantMessage === undefined) {
                        activeAssistantMessage = message;
                    } else {
                        if (message.content !== undefined && activeAssistantMessage.content !== undefined) {
                            activeAssistantMessage.content += '\n' + message.content;
                        }
                    }
                }
            } else {
                if (activeAssistantMessage !== undefined) {
                    requestMessages.push(activeAssistantMessage);
                    activeAssistantMessage = undefined;
                }
                requestMessages.push(message);
            }
        }

        const anthropic = new Anthropic();
        anthropic.apiKey = '...';
        const msg = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 1000,
            temperature: 0,
            system: systemMessage,
            messages: requestMessages,
            tools: ClaudeLanguageModelChatProviderImpl.toClaudeTools(options.tools)
        });
        return msg;
    }

    public async provideLanguageModelResponse2(
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        extensionId: string,
        progress: vscode.Progress<vscode.ChatResponseFragment2>,
        token: vscode.CancellationToken
    ): Promise<any> {
        const claudeMessages: MessageParam[] = messages.map(message => ({
            role: message.role === 1 ? 'user' : 'assistant',
            content: message.content
        }));

        try {
            let message = await this.callClaudeApi(claudeMessages, options);

            let toolCallContent = undefined;
            for (let content of message.content) {
                if (content.type === 'tool_use') {
                    toolCallContent = content;
                    break;
                }
            }

            if (toolCallContent !== undefined) {
                progress.report({ index: 0, part: new vscode.LanguageModelChatResponseToolCallPart(
                    toolCallContent.name,
                    toolCallContent.id,
                    JSON.stringify(toolCallContent.input)) });
            } else {
                let outputString = '';
                for (let content of message.content) {
                    if (content.type === 'text') {
                        outputString += content.text;
                    }
                }

                if (outputString.length > 0) {
                    progress.report({ index: 0, part: new vscode.LanguageModelChatResponseTextPart(outputString) });
                    this._emitter.fire({ extensionId: extensionId, participant: 'claude', tokenCount: this.estimateTokenCount(outputString) });
                }
            }

        } catch (error) {
            console.error('Error calling Claude API:', error);
            throw error;
        }
    }

    public provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Thenable<number> {
        const content = typeof text === 'string' ? text : text.content;
        return Promise.resolve(this.estimateTokenCount(content));
    }

    private estimateTokenCount(text: string): number {
        // This is a very rough estimate. You might want to use a more accurate tokenizer.
        return Math.ceil(text.split(/\s+/).length * 1.3);
    }
}


export class ClaudeChatResponseProviderMetadataImpl implements vscode.ChatResponseProviderMetadata {
    readonly vendor: string = 'local-ollama"';

    /**
     * Human-readable name of the language model.
     */
    readonly name: string = "claude";

    /**
     * Opaque family-name of the language model.
     */
    readonly family: string = 'mssql-claude';

    /**
     * Opaque version string of the model. This is defined by the extension contributing the language model
     * and subject to change while the identifier is stable.
     */
    readonly version: string = '3.5 Sonnet'; // Update this based on the specific Claude model you're using

    // These values are placeholders. Replace with actual values from Claude's documentation.
    readonly maxInputTokens: number = 200000; // Claude 3 Sonnet's context window size
    readonly maxOutputTokens: number = 4096; // A common max output size, but check Claude's documentation

    /**
     * When present, this gates the use of `requestLanguageModelAccess` behind an authorization flow where
     * the user must approve of another extension accessing the models contributed by this extension.
     * Additionally, the extension can provide a label that will be shown in the UI.
     */
    auth?: true | { label: string } = { label: "Authorize Claude API Access" };

    readonly isDefault?: boolean = false; // Set to true if you want Claude to be the default
    readonly isUserSelectable?: boolean = true;
}
