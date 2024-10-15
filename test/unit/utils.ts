/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../../src/constants/constants";
import * as vscode from "vscode";

export async function activateExtension() {
    const extension = vscode.extensions.getExtension(constants.extensionId);
    await extension.activate();
}
