/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import ConnectionManager from "../controllers/connectionManager";
import { randomUUID } from "crypto";
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as filtering from './objectExplorerFilteringInterfaces';
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';

export class ObjectExplorerFilteringWebViewController extends ReactWebViewPanelController<filtering.ObjectExplorerFilteringWebViewState> {

	constructor(context: vscode.ExtensionContext,
		private _objectExplorerService: filtering.ObjectExplorerProvider,
		private _connectionManager: ConnectionManager,
		private _untitledSqlDocumentService: UntitledSqlDocumentService,
		private _targetNode?: TreeNodeInfo
	) {
		let databasesFolderPath = _targetNode.nodePath;

		const initialData: filtering.ObjectExplorerFilteringWebViewState = {
			databasesFolderPath: databasesFolderPath,
			filters: [
				{
					filterName: 'Name',
					operator: 'Contains',
					value: '',
					filterDescription: 'Include or exclude object based on the name or part of a name.',
				},
				{
					filterName: 'Owner',
					operator: 'Contains',
					value: '',
					filterDescription: 'Include or exclude objects based on the owner or part of an owner name.',
				},
				{
					filterName: 'Create Date',
					operator: 'Equals',
					value: '',
					filterDescription: 'Include or exclude objects based on their creation date.',
				},
			]
		}
		super(context, 'Object Explorer Filtering', 'objectExplorerFiltering.js', 'objectExplorerFiltering.css', initialData, vscode.ViewColumn.Active, {
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter_inverse.svg'),
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'filter.svg')
		});
		this.initialize();
	}

	private async initialize() {

	}
}