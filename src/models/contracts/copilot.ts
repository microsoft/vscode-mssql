/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from 'vscode-languageclient';

// GetNextMessage request/response
export enum MessageType {
	Fragment = 0,
	Complete = 1,
	RequestLLM = 2
}

export class GetNextMessageParams {
	public conversationUri: string;
	public userText: string;
}

export class GetNextMessageResponse {
	public messageType: MessageType;
	public responseText: string;
}

export class GetNextMessageRequest {
	public static readonly type = new RequestType<GetNextMessageParams, GetNextMessageResponse, void, void>('copilot/getnextmessage');
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
	public static readonly type = new RequestType<StartConversationParams, StartConversationResponse, void, void>('copilot/startconversation');
}
