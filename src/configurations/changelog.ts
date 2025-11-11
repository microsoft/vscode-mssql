/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import * as vscode from "vscode";
import * as constants from "../constants/constants";

export const changelogConfig: ChangelogWebviewState = {
    changes: [],
    resources: [],
    walkthroughs: [],
    version: vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown",
};
