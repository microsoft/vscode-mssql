/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../../constants/constants";
import {
    getConfiguredAdditionalModels,
    ProviderModelEntry,
} from "../languageModels/shared/providerModelCatalog";
import { SdkProviderKind } from "./apiKeyResolution";

export type SdkModelCatalogEntry = ProviderModelEntry;

export const defaultAnthropicSdkModels: SdkModelCatalogEntry[] = [
    {
        id: "claude-opus-4-7",
        displayName: "Claude Opus 4.7",
        family: "claude-opus",
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
    },
    {
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        family: "claude-opus",
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
    },
    {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        family: "claude-sonnet",
        maxInputTokens: 1000000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5",
        family: "claude-sonnet",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
    {
        id: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        family: "claude-haiku",
        maxInputTokens: 200000,
        maxOutputTokens: 64000,
    },
];

export const defaultOpenAiSdkModels: SdkModelCatalogEntry[] = [
    {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        family: "gpt-5.5",
        maxInputTokens: 1050000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        family: "gpt-5.4",
        maxInputTokens: 1050000,
        maxOutputTokens: 128000,
    },
    {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        family: "gpt-5.4-mini",
        maxInputTokens: 400000,
        maxOutputTokens: 128000,
    },
];

export const defaultXAiSdkModels: SdkModelCatalogEntry[] = [
    {
        id: "grok-4-1-fast-non-reasoning",
        displayName: "Grok 4.1 Fast Non-Reasoning",
        family: "grok-4.1-fast",
        maxInputTokens: 2000000,
        maxOutputTokens: 30000,
    },
    {
        id: "grok-4.20",
        displayName: "Grok 4.20",
        family: "grok-4.20",
        maxInputTokens: 2000000,
        maxOutputTokens: 65536,
    },
    {
        id: "grok-4.20-reasoning",
        displayName: "Grok 4.20 Reasoning",
        family: "grok-4.20",
        maxInputTokens: 2000000,
        maxOutputTokens: 65536,
    },
];

export function getSdkModelCatalog(kind: SdkProviderKind): SdkModelCatalogEntry[] {
    const defaults = getDefaultSdkModels(kind);
    return [...defaults, ...getConfiguredAdditionalModels(getAdditionalModelsSetting(kind))];
}

function getAdditionalModelsSetting(kind: SdkProviderKind): string {
    switch (kind) {
        case "anthropic":
            return Constants.configCopilotSdkProvidersAnthropicAdditionalModels;
        case "openai":
            return Constants.configCopilotSdkProvidersOpenAiAdditionalModels;
        case "xai":
            return Constants.configCopilotSdkProvidersXAiAdditionalModels;
    }
}

function getDefaultSdkModels(kind: SdkProviderKind): SdkModelCatalogEntry[] {
    switch (kind) {
        case "anthropic":
            return defaultAnthropicSdkModels;
        case "openai":
            return defaultOpenAiSdkModels;
        case "xai":
            return defaultXAiSdkModels;
    }
}
