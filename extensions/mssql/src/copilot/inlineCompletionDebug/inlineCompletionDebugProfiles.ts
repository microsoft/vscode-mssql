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

export const defaultInlineCompletionModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelVendors,
    familyPatterns: [
        /^claude-sonnet-4-(6|5)/i,
        /^gpt-5\.5(?!.*mini)/i,
        /^gpt-5\.[0-9]+(?!.*mini)/i,
        /^gpt-5(?!.*(mini|codex))/i,
        /^grok-4\.20/i,
        /^grok-4/i,
        /^claude-sonnet/i,
        /^claude-opus/i,
        /^gpt-5.*codex/i,
        /^gpt-5.*mini/i,
        /^grok-4\.1.*fast/i,
        /^grok.*mini/i,
        /^gpt-4o(?!-mini)/i,
        /^gpt-4o-mini/i,
        /^claude.*haiku/i,
        /.*/i,
    ],
};

const intentModelPreference: InlineCompletionModelPreference = {
    providerVendors: ["copilot", "anthropic-api", "openai-api", "xai-api"],
    familyPatterns: [
        /^claude-sonnet-4-(6|5)/i,
        /^gpt-5\.5(?!.*mini)/i,
        /^gpt-5\.[0-9]+(?!.*mini)/i,
        /^gpt-5(?!.*(mini|codex))/i,
        /^grok-4\.20/i,
        /^grok-4/i,
        /^claude-sonnet/i,
        /^claude-opus/i,
        /^gpt-4o(?!-mini)/i,
        /.*/i,
    ],
};

const continuationModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelVendors,
    familyPatterns: [
        /^claude-haiku-4-5/i,
        /^gpt-5\.5.*mini/i,
        /^gpt-5.*mini/i,
        /^gpt-4o-mini/i,
        /^grok-4\.1.*fast/i,
        /^grok.*mini/i,
        /^claude.*haiku/i,
        /.*/i,
    ],
};

const middleModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelVendors,
    familyPatterns: [
        /^claude-sonnet/i,
        /^gpt-5(?!.*(mini|codex))/i,
        /^grok-4\.1.*fast/i,
        /^grok-4\.20/i,
        /^grok-4/i,
        /^gpt-5.*mini/i,
        /^grok.*mini/i,
        /^claude.*haiku/i,
        /^gpt-4o(?!-mini)/i,
        /^gpt-4o-mini/i,
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
            modelPreference: middleModelPreference,
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
