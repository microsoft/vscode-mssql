/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import {
    formatModelDisplayName,
    formatModelSelector,
    formatProviderLabel,
    parseModelSelector,
} from "../../src/copilot/languageModels/shared/modelDisplay";
import { matchLanguageModelChatToSelector } from "../../src/copilot/languageModelSelection";
import { selectPreferredModel } from "../../src/copilot/sqlInlineCompletionProvider";
import {
    inlineCompletionDebugPresetProfiles,
    getInlineCompletionModelPreferenceForCategory,
} from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";

function fakeModel(
    overrides: Partial<vscode.LanguageModelChat> & { vendor: string; id: string },
): vscode.LanguageModelChat {
    return {
        name: overrides.id,
        family: overrides.id,
        version: "1",
        ...overrides,
    } as vscode.LanguageModelChat;
}

suite("Inline completion model display helpers", () => {
    test("formatProviderLabel maps known vendors and falls through unknown vendors", () => {
        expect(formatProviderLabel("copilot")).to.equal("Copilot");
        expect(formatProviderLabel("anthropic-api")).to.equal("Anthropic API");
        expect(formatProviderLabel("openai-api")).to.equal("OpenAI API");
        expect(formatProviderLabel("xai-api")).to.equal("xAI API");
        expect(formatProviderLabel("future-vendor")).to.equal("future-vendor");
    });

    test("formatModelSelector + parseModelSelector round-trip", () => {
        const selector = formatModelSelector({ vendor: "anthropic-api", id: "claude-opus-4-7" });
        expect(selector).to.equal("anthropic-api/claude-opus-4-7");

        const parsed = parseModelSelector(selector);
        expect(parsed).to.deep.equal({ vendor: "anthropic-api", id: "claude-opus-4-7" });
    });

    test("parseModelSelector rejects malformed input", () => {
        expect(parseModelSelector("")).to.equal(undefined);
        expect(parseModelSelector("no-slash")).to.equal(undefined);
        expect(parseModelSelector("/missing-vendor")).to.equal(undefined);
        expect(parseModelSelector("missing-id/")).to.equal(undefined);
    });

    test("parseModelSelector preserves slashes inside the model id", () => {
        // Some catalogs ship ids that contain `/`; only the first slash is the separator.
        const parsed = parseModelSelector("openai-api/o3/preview");
        expect(parsed).to.deep.equal({ vendor: "openai-api", id: "o3/preview" });
    });

    test("formatModelDisplayName puts the provider label in front of the model name", () => {
        const label = formatModelDisplayName({
            vendor: "anthropic-api",
            id: "claude-opus-4-7",
            name: "Claude Opus 4.7",
        });
        expect(label).to.equal("Anthropic API — Claude Opus 4.7");
    });
});

suite("matchLanguageModelChatToSelector", () => {
    const models = [
        fakeModel({ vendor: "anthropic-api", id: "claude-opus-4-7", family: "claude-opus" }),
        fakeModel({ vendor: "anthropic-api", id: "claude-opus-4-6", family: "claude-opus" }),
        fakeModel({ vendor: "copilot", id: "claude-sonnet-4-5", family: "claude-sonnet-4-5" }),
    ];

    test("matches by exact vendor/id selector when both vendors share a family", () => {
        const matched = matchLanguageModelChatToSelector(models, "anthropic-api/claude-opus-4-6");
        expect(matched?.id).to.equal("claude-opus-4-6");
    });

    test("falls back to family lookup for legacy values", () => {
        const matched = matchLanguageModelChatToSelector(models, "claude-sonnet-4-5");
        expect(matched?.vendor).to.equal("copilot");
    });

    test("returns undefined for unknown selector and family", () => {
        expect(matchLanguageModelChatToSelector(models, "unknown/model")).to.equal(undefined);
        expect(matchLanguageModelChatToSelector(models, "")).to.equal(undefined);
    });
});

suite("selectPreferredModel", () => {
    const available = (...ids: string[]) => ids.map((id) => fakeModel({ vendor: "copilot", id }));

    for (const profile of inlineCompletionDebugPresetProfiles) {
        test(
            profile.id + " prefers Sol for intent over previous defaults and other current models",
            () => {
                const models = available(
                    "claude-sonnet-4-6",
                    "gpt-5.5",
                    "gpt-6-astra",
                    "claude-sonnet-5.5",
                    "gpt-6-sol",
                    "gpt-6.1-sol",
                );
                expect(
                    selectPreferredModel(
                        models,
                        getInlineCompletionModelPreferenceForCategory(profile, "intent"),
                    )?.id,
                ).to.equal("gpt-6.1-sol");
            },
        );
        if (profile.enabledCategories.includes("continuation")) {
            test(profile.id + " prefers Luna for continuation independently of intent", () => {
                const models = available(
                    "claude-haiku-4-5",
                    "gpt-5.4-mini",
                    "gpt-6.1-sol",
                    "claude-haiku-5.5",
                    "gpt-6-luna",
                );
                expect(
                    selectPreferredModel(
                        models,
                        getInlineCompletionModelPreferenceForCategory(profile, "continuation"),
                    )?.id,
                ).to.equal("gpt-6-luna");
            });
        }
    }

    test("matches normalized display names when a provider uses opaque IDs", () => {
        const models = [
            fakeModel({ vendor: "copilot", id: "opaque-id", family: "gpt", name: "GPT-6.1 Sol" }),
            ...available("gpt-6-sol"),
        ];
        expect(selectPreferredModel(models)?.id).to.equal("opaque-id");
    });

    test("prefers Copilot when the same preferred model is exposed by another provider", () => {
        const models = [
            fakeModel({ vendor: "openai-api", id: "gpt-6.1-sol" }),
            ...available("gpt-6.1-sol"),
        ];
        expect(selectPreferredModel(models)?.vendor).to.equal("copilot");
    });

    test("uses available current alternatives when Sol and Luna are unavailable", () => {
        const balanced = inlineCompletionDebugPresetProfiles.find(
            (profile) => profile.id === "balanced",
        )!;
        const models = available("gpt-5.5", "claude-haiku-5.5", "claude-sonnet-5.5");
        expect(selectPreferredModel(models, balanced.modelPreference)?.id).to.equal(
            "claude-sonnet-5.5",
        );
        expect(selectPreferredModel(models, balanced.continuationModelPreference)?.id).to.equal(
            "claude-haiku-5.5",
        );
    });

    test("accepts newly discovered models and never invents unavailable ones", () => {
        expect(selectPreferredModel(available("future-model"))?.id).to.equal("future-model");
        expect(selectPreferredModel([])).to.equal(undefined);
    });

    test("explicit vendor/model selectors can select either role's preferred model", () => {
        const models = available("gpt-6.1-sol", "gpt-6-luna");
        expect(matchLanguageModelChatToSelector(models, "copilot/gpt-6.1-sol")?.id).to.equal(
            "gpt-6.1-sol",
        );
        expect(matchLanguageModelChatToSelector(models, "copilot/gpt-6-luna")?.id).to.equal(
            "gpt-6-luna",
        );
    });
});
