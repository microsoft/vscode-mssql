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
import { inlineCompletionDebugPresetProfiles } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";

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
    test("uses provider order as the tie-breaker for matching model families", () => {
        const models = [
            fakeModel({
                vendor: "anthropic-api",
                id: "claude-sonnet-4-6",
                family: "claude-sonnet",
                version: "claude-sonnet-4-6",
            }),
            fakeModel({
                vendor: "copilot",
                id: "claude-sonnet-4-5",
                family: "claude-sonnet",
                version: "claude-sonnet-4-5",
            }),
        ];

        const matched = selectPreferredModel(models);
        expect(matched?.vendor).to.equal("copilot");
        expect(matched?.id).to.equal("claude-sonnet-4-5");
    });

    test("chooses the best available version inside a preferred provider", () => {
        const models = [
            fakeModel({
                vendor: "copilot",
                id: "claude-sonnet-4-5",
                family: "claude-sonnet",
                version: "claude-sonnet-4-5",
            }),
            fakeModel({
                vendor: "copilot",
                id: "claude-sonnet-4-6",
                family: "claude-sonnet",
                version: "claude-sonnet-4-6",
            }),
        ];

        const matched = selectPreferredModel(models);
        expect(matched?.id).to.equal("claude-sonnet-4-6");
    });

    test("focused profile prefers lower-token model families before middle models", () => {
        const focused = inlineCompletionDebugPresetProfiles.find(
            (profile) => profile.id === "focused",
        );
        const models = [
            fakeModel({
                vendor: "copilot",
                id: "claude-sonnet-4-6",
                family: "claude-sonnet",
            }),
            fakeModel({
                vendor: "anthropic-api",
                id: "claude-haiku-4-5",
                family: "claude-haiku",
            }),
        ];

        const matched = selectPreferredModel(models, focused?.modelPreference);
        expect(matched?.family).to.equal("claude-haiku");
    });
});
