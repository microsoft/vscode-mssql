/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

// GetNextMessage request/response
export enum MessageType {
    Fragment = 0,
    Complete = 1,
    RequestLLM = 2,
    RequestDirectLLM = 3,
}

export enum MessageRole {
    System = 0,
    User = 1,
    Assistant = 2,
    Tool = 3,
    Function = 4,
}

export class LanguageModelChatTool {
    public functionName: string;
    public functionDescription: string;
    public functionParameters: string;
}

export class LanguageModelRequestMessage {
    public text: string;
    public role: MessageRole;
}

export class GetNextMessageParams {
    public conversationUri: string;
    public userText: string;
    public tool: LanguageModelChatTool;
    public toolParameters: string;
}

export class GetNextMessageResponse {
    public conversationUri: string;
    public messageType: MessageType;
    public responseText: string;
    public tools: LanguageModelChatTool[];
    public requestMessages: LanguageModelRequestMessage[];
}

export class GetNextMessageRequest {
    public static readonly type = new RequestType<
        GetNextMessageParams,
        GetNextMessageResponse,
        void,
        void
    >("copilot/getnextmessage");
}

// StartConversation request/response
export class StartConversationParams {
    public conversationUri: string;
    public connectionUri: string;
    public userText: string;
}

export class StartConversationResponse {
    public success: boolean;
}

export class StartConversationRequest {
    public static readonly type = new RequestType<
        StartConversationParams,
        StartConversationResponse,
        void,
        void
    >("copilot/startconversation");
}
