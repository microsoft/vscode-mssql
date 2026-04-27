/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InlineCompletionCategory,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugProfileOption,
} from "../../sharedInterfaces/inlineCompletionDebug";

export interface InlineCompletionModelPreference {
    providerVendors: readonly string[];
    familyPatterns: readonly RegExp[];
}

export interface InlineCompletionDebugProfileDefinition extends InlineCompletionDebugProfileOption {
    modelPreference: InlineCompletionModelPreference;
    forceIntentMode: boolean | null;
    enabledCategories: readonly InlineCompletionCategory[];
    debounceMs: number;
    maxTokens: number | null;
}

export const inlineCompletionDebugCustomProfileId = "custom";
export const inlineCompletionConfiguredDefaultProfileId = "default";

export const defaultInlineCompletionModelPreference: InlineCompletionModelPreference = {
    providerVendors: ["copilot", "anthropic-api", "openai-api", "xai-api"],
    familyPatterns: [
        /^claude-sonnet/i,
        /^claude-opus/i,
        /^gpt-5.*codex/i,
        /^gpt-5(?!.*(mini|codex))/i,
        /^gpt-5.*mini/i,
        /^grok-4\.1.*fast/i,
        /^grok-4\.20/i,
        /^grok-4/i,
        /^grok.*mini/i,
        /^gpt-4o(?!-mini)/i,
        /^gpt-4o-mini/i,
        /^claude.*haiku/i,
        /.*/i,
    ],
};

const lowTokenModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelPreference.providerVendors,
    familyPatterns: [
        /^claude.*haiku/i,
        /^gpt-5.*mini/i,
        /^grok-4\.1.*fast/i,
        /^grok.*mini/i,
        /^gpt-4o-mini/i,
        /^claude-sonnet/i,
        /^gpt-5(?!.*(mini|codex))/i,
        /.*/i,
    ],
};

const middleModelPreference: InlineCompletionModelPreference = {
    providerVendors: defaultInlineCompletionModelPreference.providerVendors,
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
            modelPreference: lowTokenModelPreference,
            forceIntentMode: null,
            enabledCategories: ["intent"],
            debounceMs: 1000,
            maxTokens: null,
        },
        {
            id: "balanced",
            label: "Balanced",
            description: "Intent-only completions with a moderate automatic debounce.",
            modelPreference: middleModelPreference,
            forceIntentMode: null,
            enabledCategories: ["intent"],
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
        enabledCategories: null,
        debounceMs: null,
        maxTokens: null,
        customSystemPrompt: null,
    };
}
