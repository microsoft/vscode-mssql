/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ObjectExplorerFilteringWebViewState {
	databasesFolderPath: string;
	filters: Array<Filter>;
}

export interface Filter {
	filterName: string;
	operator: string;
	value: string;
	filterDescription: string;
}

export interface ObjectExplorerProvider {

}
