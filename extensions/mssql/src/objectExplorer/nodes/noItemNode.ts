/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocalizedConstants from "../../constants/locConstants";
import { TreeNodeInfo } from "./treeNodeInfo";
import { ObjectExplorerUtils } from "../objectExplorerUtils";

export class NoItemsNode extends vscode.TreeItem {
  constructor(private _parentNode: TreeNodeInfo) {
    super(
      LocalizedConstants.ObjectExplorer.NoItems,
      vscode.TreeItemCollapsibleState.None,
    );
    this.iconPath = {
      light: ObjectExplorerUtils.iconPath("NoItems_light"),
      dark: ObjectExplorerUtils.iconPath("NoItems_dark"),
    };
  }

  public get parentNode(): TreeNodeInfo {
    return this._parentNode;
  }
}
