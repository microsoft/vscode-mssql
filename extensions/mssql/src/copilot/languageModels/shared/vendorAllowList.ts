/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../../../constants/constants";

export const defaultInlineCompletionModelVendors = [
    "copilot",
    "anthropic-api",
    "openai-api",
    "xai-api",
];

export function getConfiguredInlineCompletionModelVendors(): string[] {
    const configured = vscode.workspace
        .getConfiguration()
        .get<unknown>(
            Constants.configCopilotInlineCompletionsModelVendors,
            defaultInlineCompletionModelVendors,
        );
    if (!Array.isArray(configured)) {
        return defaultInlineCompletionModelVendors;
    }

    const vendors = configured
        .filter((value): value is string => typeof value === "string" && !!value.trim())
        .map((value) => value.trim());
    return vendors.length ? Array.from(new Set(vendors)) : defaultInlineCompletionModelVendors;
}
