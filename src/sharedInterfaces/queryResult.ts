/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface QueryResultReducers {
}

export interface QueryResultProvider {
}

export enum QueryResultPaneTabs {
	Results = 'results',
	Messages = 'messages'
}

export interface QueryResultTabStates {
	resultPaneTab: QueryResultPaneTabs;
}

export interface QueryResultWebViewState {
	value?: number;
	messages: QueryResultMessage[];
	tabStates?: QueryResultTabStates;
}

export interface QueryResultMessage {
	message: string;
	timestamp: string;
}
