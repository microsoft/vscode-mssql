/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
export {
    defaultInlineCompletionModelVendors,
    getConfiguredInlineCompletionModelVendors,
} from "./languageModels/shared/vendorAllowList";
import { getConfiguredInlineCompletionModelVendors } from "./languageModels/shared/vendorAllowList";
import { formatModelSelector, parseModelSelector } from "./languageModels/shared/modelDisplay";

export async function selectConfiguredLanguageModels(
    family?: string,
): Promise<vscode.LanguageModelChat[]> {
    const all: vscode.LanguageModelChat[] = [];

    for (const vendor of getConfiguredInlineCompletionModelVendors()) {
        const models = await vscode.lm.selectChatModels({
            vendor,
            ...(family ? { family } : {}),
        });
        all.push(...models);
    }

    return dedupeLanguageModels(all);
}

// Resolves a configured selector — `<vendor>/<id>` or a bare family — against
// the set of currently available models. Selector form is preferred so the
// user's choice survives across providers that share family names; the family
// form is kept as a fallback for the legacy `modelFamily` setting value.
export function matchLanguageModelChatToSelector(
    models: vscode.LanguageModelChat[],
    selectorOrFamily: string,
): vscode.LanguageModelChat | undefined {
    const trimmed = selectorOrFamily.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = parseModelSelector(trimmed);
    if (parsed) {
        const exact = models.find(
            (model) => model.vendor === parsed.vendor && model.id === parsed.id,
        );
        if (exact) {
            return exact;
        }
    }

    return (
        models.find((model) => formatModelSelector(model) === trimmed) ??
        models.find((model) => model.family === trimmed)
    );
}

function dedupeLanguageModels(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat[] {
    const seen = new Set<string>();
    const deduped: vscode.LanguageModelChat[] = [];

    for (const model of models) {
        const key = formatModelSelector(model);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(model);
    }

    return deduped;
}
