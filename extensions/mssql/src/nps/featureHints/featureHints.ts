/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FeatureHintScreenshotId, FeatureHintSuggestion } from "../../sharedInterfaces/userSurvey";

/** Launches the feature: either a VS Code command or an external link. */
export type FeatureHintTryNow =
    | { kind: "command"; command: string; args?: unknown[]; label?: string }
    | { kind: "url"; url: string; label?: string };

/** Matched locally against the feedback text. Free, synchronous, runs on Submit. */
export interface KeywordFeatureHintMatch {
    mode: "keyword";
    /**
     * Strings match case-insensitively as whole words or phrases ("F5" does not match "F50");
     * any whitespace in a phrase matches any run of whitespace. Use a RegExp for anything else.
     */
    keywords: readonly (string | RegExp)[];
}

/** Matched by a small Copilot model on Submit, only when the user is signed in to Copilot. */
export interface CopilotFeatureHintMatch {
    mode: "copilot";
    /**
     * English guidance for the model describing what the feature does and how users who are
     * missing it tend to phrase their feedback. Never shown to users.
     */
    promptHint: string;
}

interface FeatureHintCommon {
    /** Stable identifier, reported in telemetry. */
    id: string;
    /** Localized display name, from locConstants.FeatureHints. */
    featureName: string;
    /** Localized one-sentence description, from locConstants.FeatureHints. */
    description: string;
    match: KeywordFeatureHintMatch | CopilotFeatureHintMatch;
    /** Optional screenshot; see FeatureHintScreenshotId. */
    screenshot?: FeatureHintScreenshotId;
    /** Return true to skip the hint for users who already use the feature. */
    isAlreadyInUse?: () => boolean;
}

/** A configured hint. At least one of `docsUrl` and `tryNow` is required. */
export type FeatureHintDefinition = FeatureHintCommon &
    (
        | { docsUrl: string; tryNow?: FeatureHintTryNow }
        | { docsUrl?: string; tryNow: FeatureHintTryNow }
    );

/** Returns a problem for each invalid definition; an empty result means the config is valid. */
export function validateFeatureHintDefinitions(
    definitions: readonly FeatureHintDefinition[],
): string[] {
    const problems: string[] = [];
    const seenIds = new Set<string>();

    for (const definition of definitions) {
        const id = definition.id?.trim();
        if (!id) {
            problems.push("A feature hint is missing an id.");
            continue;
        }
        if (seenIds.has(id)) {
            problems.push(`Feature hint '${id}' is defined more than once.`);
        }
        seenIds.add(id);

        if (!definition.featureName?.trim() || !definition.description?.trim()) {
            problems.push(`Feature hint '${id}' needs a featureName and a description.`);
        }
        if (!definition.docsUrl && !definition.tryNow) {
            problems.push(`Feature hint '${id}' needs a docsUrl, a tryNow action, or both.`);
        }
        if (definition.docsUrl && !isHttpsUrl(definition.docsUrl)) {
            problems.push(`Feature hint '${id}' has a docsUrl that is not an https URL.`);
        }
        if (definition.tryNow?.kind === "url" && !isHttpsUrl(definition.tryNow.url)) {
            problems.push(`Feature hint '${id}' has a tryNow url that is not an https URL.`);
        }
        if (definition.tryNow?.kind === "command" && !definition.tryNow.command?.trim()) {
            problems.push(`Feature hint '${id}' has a tryNow command with no command id.`);
        }

        const match = definition.match;
        if (match?.mode === "keyword") {
            if (!match.keywords?.length || match.keywords.some(isEmptyKeyword)) {
                problems.push(`Feature hint '${id}' needs only non-empty keywords.`);
            }
        } else if (match?.mode === "copilot") {
            if (!match.promptHint?.trim()) {
                problems.push(`Feature hint '${id}' needs a promptHint for Copilot matching.`);
            }
        } else {
            problems.push(`Feature hint '${id}' needs a match mode of 'keyword' or 'copilot'.`);
        }
    }

    return problems;
}

/** Hints of the given mode for features the user does not already use, in config order. */
export function getCandidateHints(
    definitions: readonly FeatureHintDefinition[],
    mode: "keyword" | "copilot",
): FeatureHintDefinition[] {
    return definitions.filter(
        (definition) => definition.match.mode === mode && !isAlreadyInUse(definition),
    );
}

export function findKeywordMatches(
    feedback: string,
    definitions: readonly FeatureHintDefinition[],
): FeatureHintDefinition[] {
    return getCandidateHints(definitions, "keyword").filter((definition) =>
        (definition.match as KeywordFeatureHintMatch).keywords.some((keyword) =>
            toKeywordRegExp(keyword).test(feedback),
        ),
    );
}

export function toKeywordRegExp(keyword: string | RegExp): RegExp {
    if (keyword instanceof RegExp) {
        // A global or sticky RegExp would carry lastIndex between tests.
        return new RegExp(keyword.source, keyword.flags.replace(/[gy]/g, ""));
    }
    const phrase = keyword
        .trim()
        .split(/\s+/)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_])`, "iu");
}

export function toFeatureHintSuggestion(definition: FeatureHintDefinition): FeatureHintSuggestion {
    return {
        id: definition.id,
        featureName: definition.featureName,
        description: definition.description,
        hasDocs: !!definition.docsUrl,
        canTryNow: !!definition.tryNow,
        tryNowLabel: definition.tryNow?.label,
        screenshot: definition.screenshot,
    };
}

function isAlreadyInUse(definition: FeatureHintDefinition): boolean {
    try {
        return definition.isAlreadyInUse?.() ?? false;
    } catch {
        return false;
    }
}

function isEmptyKeyword(keyword: string | RegExp): boolean {
    return typeof keyword === "string" ? keyword.trim() === "" : keyword.source === "(?:)";
}

function isHttpsUrl(value: string): boolean {
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}
