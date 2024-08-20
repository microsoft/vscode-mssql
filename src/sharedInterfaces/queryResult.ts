/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum QueryResultLoadState {
	Loading = 'Loading',
	Loaded = 'Loaded',
	Error = 'Error'
}

export interface QueryResultReducers {
}

export interface QueryResultReactProvider {
	setResultTab: (tabId: QueryResultPaneTabs) => void;
}

export enum QueryResultPaneTabs {
	Results = 'results',
	Messages = 'messages'
}

export interface QueryResultTabStates {
	resultPaneTab: QueryResultPaneTabs;
}

export interface QueryResultWebViewState {
	value?: string;
	messages: QueryResultMessage[];
	tabStates?: QueryResultTabStates;
}

export interface QueryResultMessage {
	message: string;
	timestamp: string;
}

export interface QueryResultReducers {
	setResultTab: {
		tabId: QueryResultPaneTabs
	}
}
