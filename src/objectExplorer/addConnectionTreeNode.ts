/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import * as vscode from 'vscode';
import * as Constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import { ObjectExplorerUtils } from './objectExplorerUtils';

export class AddConnectionTreeNode extends vscode.TreeItem {

	constructor() {
		super(LocalizedConstants.msgAddConnection, vscode.TreeItemCollapsibleState.None);
		this.command = {
			title: LocalizedConstants.msgAddConnection,
			command: Constants.cmdAddObjectExplorer
		};
		this.iconPath = {
			light: path.join(ObjectExplorerUtils.rootPath, 'add.svg'),
			dark: path.join(ObjectExplorerUtils.rootPath, 'add_inverse.svg')
		};
	}
}
