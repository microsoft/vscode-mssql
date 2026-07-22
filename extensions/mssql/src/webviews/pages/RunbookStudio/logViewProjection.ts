/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure projection for the bounded Runbook Studio log viewport. Structured
 * payloads are formatted only when their complete syntax validates; malformed
 * or ordinary text is preserved exactly. React remains responsible for
 * escaping the projected text.
 */

export type LogContentLanguage = "xml" | "json" | "text";

export interface ProjectedLogContent {
    text: string;
    language: LogContentLanguage;
    lineCount: number;
}

export function projectLogContent(raw: string): ProjectedLogContent {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            const text = JSON.stringify(JSON.parse(trimmed), undefined, 2);
            return { text, language: "json", lineCount: countLines(text) };
        } catch {
            // Preserve malformed JSON as ordinary text.
        }
    }

    if (trimmed.startsWith("<")) {
        const text = formatXml(trimmed);
        if (text !== undefined) {
            return { text, language: "xml", lineCount: countLines(text) };
        }
    }

    return { text: raw, language: "text", lineCount: countLines(raw) };
}

function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split(/\r?\n/).length;
}

/** Tokenize and indent XML while respecting quoted `>` characters, comments,
 * CDATA, processing instructions, and DOCTYPE internal subsets. */
function formatXml(xml: string): string | undefined {
    const tokens = tokenizeXml(xml);
    if (!tokens) {
        return undefined;
    }
    const lines: string[] = [];
    const stack: string[] = [];
    let rootSeen = false;

    for (const token of tokens) {
        if (!token.startsWith("<")) {
            const text = token.trim();
            if (!text) {
                continue;
            }
            if (stack.length === 0) {
                return undefined;
            }
            appendIndented(lines, text, stack.length);
            continue;
        }

        const normalized = token.trim();
        if (
            normalized.startsWith("<?") ||
            normalized.startsWith("<!--") ||
            normalized.startsWith("<![CDATA[") ||
            /^<!DOCTYPE\b/i.test(normalized)
        ) {
            appendIndented(lines, normalized, stack.length);
            continue;
        }

        if (normalized.startsWith("</")) {
            const name = tagName(normalized);
            if (!name || stack[stack.length - 1] !== name) {
                return undefined;
            }
            stack.pop();
            appendIndented(lines, normalized, stack.length);
            continue;
        }

        const name = tagName(normalized);
        if (!name || normalized.startsWith("<!")) {
            return undefined;
        }
        if (stack.length === 0) {
            if (rootSeen) {
                return undefined;
            }
            rootSeen = true;
        }
        appendIndented(lines, normalized, stack.length);
        if (!/\/\s*>$/.test(normalized)) {
            stack.push(name);
        }
    }

    return rootSeen && stack.length === 0 ? lines.join("\n") : undefined;
}

function appendIndented(lines: string[], value: string, depth: number): void {
    for (const line of value.split(/\r?\n/)) {
        lines.push("  ".repeat(depth) + line.trim());
    }
}

function tagName(tag: string): string | undefined {
    return /^<\/?\s*([^\s/>]+)/.exec(tag)?.[1];
}

function tokenizeXml(xml: string): string[] | undefined {
    const tokens: string[] = [];
    let position = 0;
    while (position < xml.length) {
        if (xml[position] !== "<") {
            const nextTag = xml.indexOf("<", position);
            const end = nextTag < 0 ? xml.length : nextTag;
            tokens.push(xml.slice(position, end));
            position = end;
            continue;
        }

        const specialEnd = specialTokenEnd(xml, position);
        if (specialEnd !== undefined) {
            if (specialEnd < 0) {
                return undefined;
            }
            tokens.push(xml.slice(position, specialEnd));
            position = specialEnd;
            continue;
        }

        let quote: '"' | "'" | undefined;
        let subsetDepth = 0;
        let end = -1;
        for (let index = position + 1; index < xml.length; index++) {
            const character = xml[index];
            if (quote) {
                if (character === quote) {
                    quote = undefined;
                }
                continue;
            }
            if (character === '"' || character === "'") {
                quote = character;
            } else if (character === "[") {
                subsetDepth++;
            } else if (character === "]" && subsetDepth > 0) {
                subsetDepth--;
            } else if (character === ">" && subsetDepth === 0) {
                end = index + 1;
                break;
            }
        }
        if (end < 0) {
            return undefined;
        }
        tokens.push(xml.slice(position, end));
        position = end;
    }
    return tokens;
}

function specialTokenEnd(xml: string, position: number): number | undefined {
    for (const [prefix, suffix] of [
        ["<!--", "-->"],
        ["<![CDATA[", "]]>"],
        ["<?", "?>"],
    ] as const) {
        if (!xml.startsWith(prefix, position)) {
            continue;
        }
        const end = xml.indexOf(suffix, position + prefix.length);
        return end < 0 ? -1 : end + suffix.length;
    }
    return undefined;
}
