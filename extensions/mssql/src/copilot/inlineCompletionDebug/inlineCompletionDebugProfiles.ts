/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InlineCompletionCategory,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugProfileOption,
    InlineCompletionDebugSchemaContextOverrides,
} from "../../sharedInterfaces/inlineCompletionDebug";

export interface InlineCompletionModelPreference {
    providerVendors: readonly string[];
    familyPatterns: readonly RegExp[];
}

export interface InlineCompletionDebugProfileDefinition extends InlineCompletionDebugProfileOption {
    modelPreference: InlineCompletionModelPreference;
    continuationModelPreference?: InlineCompletionModelPreference;
    forceIntentMode: boolean | null;
    enabledCategories: readonly InlineCompletionCategory[];
    useSchemaContext: boolean | null;
    schemaContext: InlineCompletionDebugSchemaContextOverrides | null;
    debounceMs: number;
    maxTokens: number | null;
}

export const inlineCompletionDebugCustomProfileId = "custom";
export const inlineCompletionConfiguredDefaultProfileId: InlineCompletionDebugProfileId =
    "balanced";

export const defaultInlineCompletionModelVendors = [
    "copilot",
    "anthropic-api",
    "openai-api",
    "xai-api",
] as const;

// Copilot preferences reviewed against GitHub's supported-model catalog on 2026-10-16.
// https://docs.github.com/en/copilot/reference/ai-models/supported-models
// These rank models returned by vscode.lm; they never manufacture availability.
// Match both dotted IDs and normalized display names (for example GPT-6.1 Sol).
export const defaultInlineCompletionModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelVendors,
    familyPatterns: [
        /^gpt-6[.-]1-sol(?:$|-)/i,
        /^gpt-6-sol(?:$|-)/i,
        /^claude-sonnet-5[.-]5(?:$|-)/i,
        /^claude-sonnet-5(?:$|-)/i,
        /^claude-opus-5[.-]5(?:$|-)/i,
        /^claude-opus-5(?:$|-)/i,
        /^gpt-6-astra(?:$|-)/i,
        /^gemini-4-argon(?:$|-)/i,
        /^grok-4[.-]7(?:$|-)/i,
        /^kimi-k3(?:$|-)/i,
        // Account-specific and newly released models remain usable through live discovery.
        /.*/i,
    ],
};

const intentModelPreference = defaultInlineCompletionModelPreference;

const continuationModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelVendors,
    familyPatterns: [
        /^gpt-6-luna(?:$|-)/i,
        /^claude-haiku-5[.-]5(?:$|-)/i,
        /^gemini-3[.-]8-flash(?:$|-)/i,
        /^gemini-3[.-]7-flash(?:$|-)/i,
        /^mai-code-1[.-]1-flash(?:$|-)/i,
        /.*/i,
    ],
};

export const inlineCompletionDebugPresetProfiles: readonly InlineCompletionDebugProfileDefinition[] =
    [
        {
            id: "focused",
            label: "Focused",
            description: "Intent-only completions with the lowest automatic request volume.",
            modelPreference: intentModelPreference,
            forceIntentMode: null,
            enabledCategories: ["intent"],
            useSchemaContext: true,
            schemaContext: { budgetProfile: "balanced" },
            debounceMs: 1000,
            maxTokens: null,
        },
        {
            id: "balanced",
            label: "Balanced",
            description: "Intent and continuation completions with a moderate automatic debounce.",
            modelPreference: intentModelPreference,
            continuationModelPreference,
            forceIntentMode: null,
            enabledCategories: ["continuation", "intent"],
            useSchemaContext: true,
            schemaContext: { budgetProfile: "balanced" },
            debounceMs: 500,
            maxTokens: null,
        },
        {
            id: "broad",
            label: "Broad",
            description: "Intent and continuation completions with the quickest debounce.",
            modelPreference: intentModelPreference,
            continuationModelPreference,
            forceIntentMode: null,
            enabledCategories: ["continuation", "intent"],
            useSchemaContext: true,
            schemaContext: { budgetProfile: "generous" },
            debounceMs: 350,
            maxTokens: null,
        },
    ];

export const inlineCompletionDebugProfileOptions: readonly InlineCompletionDebugProfileOption[] = [
    ...inlineCompletionDebugPresetProfiles.map(({ id, label, description }) => ({
        id,
        label,
        description,
    })),
    {
        id: inlineCompletionDebugCustomProfileId,
        label: "Custom",
        description: "Session-only settings from the current debug controls.",
    },
];

export function getInlineCompletionDebugPresetProfile(
    profileId: InlineCompletionDebugProfileId | null | undefined,
): InlineCompletionDebugProfileDefinition | undefined {
    if (!profileId || profileId === inlineCompletionDebugCustomProfileId) {
        return undefined;
    }

    return inlineCompletionDebugPresetProfiles.find((profile) => profile.id === profileId);
}

export function getInlineCompletionModelPreferenceForCategory(
    profile: InlineCompletionDebugProfileDefinition | undefined,
    category: InlineCompletionCategory,
): InlineCompletionModelPreference | undefined {
    if (!profile) {
        return undefined;
    }

    if (category === "continuation") {
        return profile.continuationModelPreference ?? profile.modelPreference;
    }

    return profile.modelPreference;
}

export function getInlineCompletionProfileSchemaContextOverrides(
    profile: InlineCompletionDebugProfileDefinition | undefined,
    overrides: InlineCompletionDebugSchemaContextOverrides | null | undefined,
): InlineCompletionDebugSchemaContextOverrides | undefined {
    const profileSchemaContext = profile?.schemaContext ?? undefined;
    const overrideSchemaContext = overrides ?? undefined;
    if (!profileSchemaContext && !overrideSchemaContext) {
        return undefined;
    }

    return {
        ...(profileSchemaContext ?? {}),
        ...(overrideSchemaContext ?? {}),
        budgetOverrides: {
            ...(profileSchemaContext?.budgetOverrides ?? {}),
            ...(overrideSchemaContext?.budgetOverrides ?? {}),
        },
    };
}

export function getInlineCompletionPresetProfileId(
    value: unknown,
): InlineCompletionDebugProfileId | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    return getInlineCompletionDebugPresetProfile(value as InlineCompletionDebugProfileId)?.id;
}

export function isInlineCompletionDebugProfileId(
    value: unknown,
): value is InlineCompletionDebugProfileId {
    return (
        typeof value === "string" &&
        inlineCompletionDebugProfileOptions.some((profile) => profile.id === value)
    );
}

export function createInlineCompletionDebugPresetOverrides(
    profileId: InlineCompletionDebugProfileId,
): Partial<InlineCompletionDebugOverrides> {
    if (profileId === inlineCompletionDebugCustomProfileId) {
        return {
            profileId,
        };
    }

    return {
        profileId,
        modelSelector: null,
        continuationModelSelector: null,
        forceIntentMode: null,
        useSchemaContext: null,
        includeSqlDiagnostics: null,
        enabledCategories: null,
        debounceMs: null,
        maxTokens: null,
        schemaContext: null,
        customSystemPrompt: null,
    };
}

export const INLINE_COMPLETION_PROFILE_DEFINITIONS_VERSION = 2;
