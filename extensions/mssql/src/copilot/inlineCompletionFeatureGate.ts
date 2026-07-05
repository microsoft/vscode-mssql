/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { previewService } from "../previews/previewService";

export function isInlineCompletionFeatureEnabled(): boolean {
    return (
        previewService.experimentalFeaturesEnabled &&
        (vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ??
            false)
    );
}
