/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    GetNextMessageRequest,
    GetNextMessageResponse,
    GetNextMessageParams,
    StartConversationRequest,
    StartConversationResponse,
    StartConversationParams,
    LanguageModelChatTool,
} from "../models/contracts/copilot"; // SQL Copilot

export class CopilotService {
    constructor(private sqlToolsClient: SqlToolsServiceClient) {}
    async startConversation(
        conversationUri: string,
        connectionUri: string,
        userText: string,
    ): Promise<boolean> {
        try {
            let params: StartConversationParams = {
                conversationUri: conversationUri,
                connectionUri: connectionUri,
                userText: userText,
            };
            let response: StartConversationResponse = await this.sqlToolsClient.sendRequest(
                StartConversationRequest.type,
                params,
            );
            return response.success;
        } catch (e) {
            this.sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async getNextMessage(
        conversationUri: string,
        replyText: string,
        tool?: LanguageModelChatTool,
        toolParameters?: string,
    ): Promise<GetNextMessageResponse> {
        try {
            let params: GetNextMessageParams = {
                conversationUri: conversationUri,
                userText: replyText,
                tool: tool,
                toolParameters: toolParameters,
            };
            let response: GetNextMessageResponse = await this.sqlToolsClient.sendRequest(
                GetNextMessageRequest.type,
                params,
            );
            return response;
        } catch (e) {
            this.sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
