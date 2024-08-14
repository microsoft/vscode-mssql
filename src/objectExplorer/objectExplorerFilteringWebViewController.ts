/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import ConnectionManager from "../controllers/connectionManager";
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as filtering from './objectExplorerFilteringInterfaces';
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';

export class ObjectExplorerFilteringWebViewController extends ReactWebViewPanelController<filtering.ObjectExplorerFilteringWebViewState> {

	constructor(context: vscode.ExtensionContext,
		private _objectExplorerService: filtering.ObjectExplorerProvider,
		private _connectionManager: ConnectionManager,
		private _untitledSqlDocumentService: UntitledSqlDocumentService,
		targetNode?: TreeNodeInfo
	) {
		let databasesFolderPath = targetNode.nodePath;

		const initialData: filtering.ObjectExplorerFilteringWebViewState = {
			databasesFolderPath: databasesFolderPath,
			filterableProperties: targetNode.filterableProperties,
		};

		super(
			context,
			'Object Explorer Filtering',
			'objectExplorerFiltering.js',
			'objectExplorerFiltering.css',
			initialData,
			vscode.ViewColumn.Active,
			{
				dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter_inverse.svg'),
				light: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter.svg')
			}
		);
	}
}
