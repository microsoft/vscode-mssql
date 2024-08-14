/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ObjectExplorerFilteringWebViewState {
	databasesFolderPath: string;
	filterableProperties: NodeFilterProperty[];
}

export interface NodeFilterProperty {
	displayName: string;
	type: NodeFilterPropertyDataType;
	description: string;
}

export enum NodeFilterPropertyDataType {
	String = 0,
	Number = 1,
	Boolean = 2,
	Date = 3,
	Choice = 4
}

export interface ObjectExplorerProvider {

}
