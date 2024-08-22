/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as vscodeMssql from 'vscode-mssql';
import * as vscode from 'vscode';
import { WebviewRoute } from "../sharedInterfaces/webviewRoutes";

export class ObjectExplorerFilterReactWebviewController extends ReactWebViewPanelController<ObjectExplorerFilterState, ObjectExplorerReducers> {
	private _onSubmit: vscode.EventEmitter<vscodeMssql.NodeFilter[]> = new vscode.EventEmitter<vscodeMssql.NodeFilter[]>();
	public readonly onSubmit: vscode.Event<vscodeMssql.NodeFilter[]> = this._onSubmit.event;

	constructor(
		context: vscode.ExtensionContext
	) {
		super(
			context,
			'Object Explorer Filter',
			WebviewRoute.objectExplorerFilter,
			{
				filterProperties: [],
				existingFilters: []
			},
			vscode.ViewColumn.Beside,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter_inverse.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter.svg')
			}
		);

		this.registerReducer('submit', (state, payload) => {
			this._onSubmit.fire(payload.filters);
			this.dispose();
			return state;
		});
	}

	public loadData(data: ObjectExplorerFilterState): void {
		this.state = data;
	}


}

export class ObjectExplorerFilter {
	private static _filterWebviewController: ObjectExplorerFilterReactWebviewController;

	public static async getFilters(context: vscode.ExtensionContext, filterProperties: vscodeMssql.NodeFilterProperty[], existingFilters?: vscodeMssql.NodeFilter[]): Promise<vscodeMssql.NodeFilter[]> {
		return await new Promise((resolve, reject) => {
			if (!this._filterWebviewController || this._filterWebviewController.isDisposed) {
				this._filterWebviewController = new ObjectExplorerFilterReactWebviewController(
					context
				);
			}
			this._filterWebviewController.loadData({
				filterProperties: filterProperties,
				existingFilters: existingFilters
			});
			this._filterWebviewController.revealToForeground();
			this._filterWebviewController.onSubmit((e) => {
				resolve(e);
			});
			this._filterWebviewController.onDisposed(() => {
				//resolve(existingFilters ?? []);
				resolve([{
					name: 'Name',
					value: 'aasim',
					operator: 8
				}]);
			});
		});
	}
}




export interface ObjectExplorerFilterState {
	filterProperties: vscodeMssql.NodeFilterProperty[];
	existingFilters: vscodeMssql.NodeFilter[];
}

export interface ObjectExplorerReducers {
	submit: {
		filters: vscodeMssql.NodeFilter[];
	}
}