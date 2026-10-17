/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Completion enablement controls for the Debug Console. Changes preserve the
 * activation snapshot: enabling a previously inactive provider requires reload.
 * Schema sharing remains an independent, explicit choice.
 */

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { isCompletionsDebugHostConfigured } from "../diagnostics/completionsDebugConsoleHost";
import { isInlineCompletionFeatureEnabled } from "./inlineCompletionFeatureGate";
import { mergeCopilotEnableMap, resolveCopilotEnableTarget } from "./copilotEnableSettingsGuard";

export interface CompletionsEnablementStatus {
    experimentalEnabled: boolean;
    useSchemaContext: boolean;
    /** The runtime gate the provider and debug viewer check. */
    featureEnabled: boolean;
    /** github.copilot.enable maps sql -> false (no double ghost text). */
    copilotSqlDisabled: boolean;
    schemaContextProfile: string;
    modelFamily: string;
    modelVendors: string[];
    includeSqlDiagnostics: boolean;
    traceCaptureEnabled: boolean;
}

export function getCompletionsEnablementStatus(): CompletionsEnablementStatus {
    const config = vscode.workspace.getConfiguration();
    const copilotEnable = vscode.workspace
        .getConfiguration("github.copilot")
        .get<Record<string, boolean>>("enable");
    return {
        experimentalEnabled: config.get<boolean>(Constants.configEnableExperimentalFeatures, false),
        useSchemaContext: config.get<boolean>(
            Constants.configCopilotInlineCompletionsUseSchemaContext,
            false,
        ),
        featureEnabled: isInlineCompletionFeatureEnabled() && isCompletionsDebugHostConfigured(),
        copilotSqlDisabled: copilotEnable?.["sql"] === false,
        schemaContextProfile: config.get<string>(
            "mssql.copilot.inlineCompletions.profile",
            "balanced",
        ),
        modelFamily: config.get<string>("mssql.copilot.inlineCompletions.modelFamily", ""),
        modelVendors: config.get<string[]>("mssql.copilot.inlineCompletions.modelVendors", []),
        includeSqlDiagnostics: config.get<boolean>(
            Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics,
            true,
        ),
        traceCaptureEnabled: config.get<boolean>(
            "mssql.copilot.inlineCompletions.trace.captureEnabled",
            false,
        ),
    };
}

/** Enable the feature gate globally and quiet GitHub Copilot for SQL. */
export async function enableAiCompletions(): Promise<CompletionsEnablementStatus> {
    const config = vscode.workspace.getConfiguration();
    await config.update(
        Constants.configEnableExperimentalFeatures,
        true,
        vscode.ConfigurationTarget.Global,
    );
    await config.update(
        Constants.configCopilotInlineCompletionsEnabled,
        true,
        vscode.ConfigurationTarget.Global,
    );

    // Same merge + target selection as the interactive guard, applied as an
    // explicit gesture (the page button) rather than a prompt.
    const copilotConfig = vscode.workspace.getConfiguration("github.copilot");
    const inspected = copilotConfig.inspect<Record<string, boolean>>("enable");
    const current =
        inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
    if (current?.["sql"] !== false) {
        const { target } = resolveCopilotEnableTarget(inspected);
        await copilotConfig.update("enable", mergeCopilotEnableMap(current), target);
    }
    return getCompletionsEnablementStatus();
}

/** Turn the feature gate off (leaves the experimental flag and Copilot map). */
export async function disableAiCompletions(): Promise<CompletionsEnablementStatus> {
    await vscode.workspace
        .getConfiguration()
        .update(
            Constants.configCopilotInlineCompletionsEnabled,
            false,
            vscode.ConfigurationTarget.Global,
        );
    return getCompletionsEnablementStatus();
}
