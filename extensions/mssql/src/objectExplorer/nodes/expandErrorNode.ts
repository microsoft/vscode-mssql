/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocalizedConstants from "../../constants/locConstants";
import { TreeNodeInfo } from "./treeNodeInfo";
import { IconUtils } from "../../utils/iconUtils";

export class ExpandErrorNode extends vscode.TreeItem {
    constructor(
        private _parentNode: TreeNodeInfo,
        errorMessage: string,
    ) {
        super(
            LocalizedConstants.ObjectExplorer.ErrorLoadingRefreshToTryAgain,
            vscode.TreeItemCollapsibleState.None,
        );
        this.tooltip = errorMessage;
        this.iconPath = {
            light: IconUtils.getIcon("objectTypes", "Error_light.svg"),
            dark: IconUtils.getIcon("objectTypes", "Error_dark.svg"),
        };
    }

    public get parentNode(): TreeNodeInfo {
        return this._parentNode;
    }
}
