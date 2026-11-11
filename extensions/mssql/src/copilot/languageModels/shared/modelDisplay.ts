/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ModelDisplayInput {
    id: string;
    name: string;
    vendor: string;
}

// A "model selector" is a stable, unique token that identifies one specific
// language model across all configured providers: `<vendor>/<id>`. Several
// providers ship overlapping model names or families (e.g. Copilot and the
// Anthropic API both expose Claude Sonnet 4.5, multiple Anthropic models share
// the `claude-sonnet` family), so family alone cannot distinguish them.
export function formatModelSelector(input: Pick<ModelDisplayInput, "id" | "vendor">): string {
    return `${input.vendor}/${input.id}`;
}

export interface ParsedModelSelector {
    vendor: string;
    id: string;
}

export function parseModelSelector(selector: string): ParsedModelSelector | undefined {
    const trimmed = selector.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0 || slash === trimmed.length - 1) {
        return undefined;
    }

    return {
        vendor: trimmed.slice(0, slash),
        id: trimmed.slice(slash + 1),
    };
}

export function formatProviderLabel(vendor: string): string {
    switch (vendor) {
        case "copilot":
            return "Copilot";
        case "anthropic-api":
            return "Anthropic API";
        case "openai-api":
            return "OpenAI API";
        case "xai-api":
            return "xAI API";
        default:
            return vendor;
    }
}

// Renders the dropdown label as `Provider — Name`. The provider prefix is the
// disambiguator that lets `Claude Sonnet 4.5` from Copilot live next to the
// same model from the Anthropic API. The unambiguous `vendor/id` selector is
// available in the event details pane when a precise lookup is needed.
export function formatModelDisplayName(model: ModelDisplayInput): string {
    return `${formatProviderLabel(model.vendor)} — ${model.name}`;
}
