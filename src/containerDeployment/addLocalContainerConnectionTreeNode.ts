/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

export class AddLocalContainerConnectionTreeNode extends vscode.TreeItem {
    constructor() {
        super(
            LocalizedConstants.ContainerDeployment.msgAddLocalContainerConnection,
            vscode.TreeItemCollapsibleState.None,
        );
        this.command = {
            title: LocalizedConstants.ContainerDeployment.msgAddLocalContainerConnection,
            command: Constants.cmdDeployLocalDockerContainer,
        };
        this.iconPath = {
            light: vscode.Uri.file(path.join(ObjectExplorerUtils.rootPath, "add_light.svg")),
            dark: vscode.Uri.file(path.join(ObjectExplorerUtils.rootPath, "add_dark.svg")),
        };
    }
}
