/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared constants for the Inline Completion Debug domain services (final
 * plan WI-1.1). These live outside the standalone-panel controller so the
 * services, the standalone panel adapter, and the Debug Console adapter can
 * all import them without pulling webview-controller code (and without
 * circular imports).
 */

import * as Constants from "../../../constants/constants";
import { FeatureSettingsSpec } from "../../../diagnostics/featureCapture/settingsSnapshot";
import { buildCompletionRules } from "../../sqlInlineCompletionProvider";

export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPrompt";
export const INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";

/** Default system prompt shown when no custom prompt has been saved. */
export const DEFAULT_CUSTOM_PROMPT = buildCompletionRules(false, false);

/**
 * Completions settings surface captured as classified settings.snapshot /
 * settings.changed state events. Closed-enum settings are explicitly marked
 * diagnostic.metadata; the schema-context JSON stays user.text (it can name
 * schemas); the trace folder is a path.
 */
export const COMPLETIONS_SETTINGS_SPEC: FeatureSettingsSpec = {
    feature: "completions",
    keys: [
        Constants.configCopilotInlineCompletionsUseSchemaContext,
        Constants.configCopilotInlineCompletionsIncludeSqlDiagnostics,
        Constants.configCopilotInlineCompletionsSchemaContext,
        { key: Constants.configCopilotInlineCompletionsProfile, cls: "diagnostic.metadata" },
        { key: Constants.configCopilotInlineCompletionsModelFamily, cls: "diagnostic.metadata" },
        {
            key: Constants.configCopilotInlineCompletionsContinuationModelFamily,
            cls: "diagnostic.metadata",
        },
        { key: Constants.configCopilotInlineCompletionsModelVendors, cls: "diagnostic.metadata" },
        {
            key: Constants.configCopilotInlineCompletionsEnabledCategories,
            cls: "diagnostic.metadata",
        },
        Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
        Constants.configCopilotInlineCompletionsTraceCaptureEnabled,
        { key: Constants.configCopilotInlineCompletionsTraceFolder, cls: "source.path" },
        Constants.configCopilotInlineCompletionsTraceRedactPrompts,
        Constants.configCopilotInlineCompletionsTraceMaxFileSizeMB,
    ],
};

/** Loose object guard shared by the config/override normalizers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
