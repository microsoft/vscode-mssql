/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { logger2 } from "../../../models/logger2";

export interface ProviderModelEntry {
    id: string;
    displayName: string;
    family: string;
    version?: string;
    maxInputTokens: number;
    maxOutputTokens: number;
}

export interface ProviderModelCatalog {
    builtIn: ProviderModelEntry[];
    additionalModelsSetting: string;
}

export interface LanguageModelChatInformation {
    id: string;
    name: string;
    family: string;
    version: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    capabilities: {
        toolCalling: boolean;
        imageInput: boolean;
    };
}

const logger = logger2.withPrefix("LanguageModelCatalog");

export function getProviderModelCatalog(catalog: ProviderModelCatalog): ProviderModelEntry[] {
    return [...catalog.builtIn, ...getConfiguredAdditionalModels(catalog.additionalModelsSetting)];
}

export function getConfiguredAdditionalModels(setting: string): ProviderModelEntry[] {
    const configured = vscode.workspace.getConfiguration().get<unknown>(setting, []);
    return normalizeConfiguredAdditionalModels(configured, setting);
}

export function normalizeConfiguredAdditionalModels(
    configured: unknown,
    setting: string,
): ProviderModelEntry[] {
    if (!Array.isArray(configured)) {
        logger.warn(`Ignoring ${setting}; expected an array.`);
        return [];
    }

    const valid: ProviderModelEntry[] = [];
    for (const [index, value] of configured.entries()) {
        const entry = normalizeModelEntry(value);
        if (!entry) {
            logger.warn(`Ignoring invalid ${setting}[${index}] model definition.`);
            continue;
        }
        valid.push(entry);
    }
    return valid;
}

export function toLanguageModelChatInformation(
    _vendor: string,
    entry: ProviderModelEntry,
): LanguageModelChatInformation {
    // Vendor-uniqueness is provided by VS Code's LanguageModelChat.vendor field;
    // prefixing the id again would only produce ugly composite ids like
    // `anthropic-api/anthropic-api/claude-sonnet-4-6` once a downstream consumer
    // composes its own `vendor/id` selector.
    return {
        id: entry.id,
        name: entry.displayName,
        family: entry.family,
        version: entry.version ?? entry.id,
        maxInputTokens: entry.maxInputTokens,
        maxOutputTokens: entry.maxOutputTokens,
        capabilities: {
            toolCalling: false,
            imageInput: false,
        },
    };
}

function normalizeModelEntry(value: unknown): ProviderModelEntry | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }

    const source = value as Record<string, unknown>;
    const id = asNonEmptyString(source.id);
    const displayName = asNonEmptyString(source.displayName);
    const family = asNonEmptyString(source.family);
    if (!id || !displayName || !family) {
        return undefined;
    }

    return {
        id,
        displayName,
        family,
        version: asNonEmptyString(source.version),
        maxInputTokens: asPositiveInteger(source.maxInputTokens) ?? 200000,
        maxOutputTokens: asPositiveInteger(source.maxOutputTokens) ?? 8192,
    };
}

function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
