/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Anchor-tracking script composer shared by the emitters (design 05 §13.1
 * anchors). Text is accumulated append-only while line/character positions
 * are tracked, so anchors land on exact offsets of the FINAL text. Header
 * comments (fidelity notes) are prepended at the end via anchor remapping.
 * Pure: no vscode, no node builtins (lint-enforced).
 */

import { ScriptAnchor, ScriptSymbolRef, ScriptTextSpan } from "./api";

export class ScriptWriter {
    private parts: string[] = [];
    private offset = 0;
    private line = 0;
    private character = 0;
    private readonly recorded: ScriptAnchor[] = [];

    get length(): number {
        return this.offset;
    }

    append(text: string): this {
        this.parts.push(text);
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10 /* \n */) {
                this.line++;
                this.character = 0;
            } else if (text.charCodeAt(i) !== 13 /* \r counts with its \n */) {
                this.character++;
            }
        }
        this.offset += text.length;
        return this;
    }

    /** Append `text` and record an anchor spanning exactly that text. */
    anchored(symbol: ScriptSymbolRef, text: string): this {
        const span: ScriptTextSpan = { start: this.offset, end: this.offset + text.length };
        this.recorded.push({ symbol, span, line: this.line, character: this.character });
        return this.append(text);
    }

    get text(): string {
        return this.parts.join("");
    }

    get anchors(): readonly ScriptAnchor[] {
        return this.recorded;
    }
}

/**
 * Prepend a header (comment lines) to an emitted body, shifting the body's
 * anchors. The header MUST end with a newline so characters are unaffected.
 */
export function withHeader(
    header: string,
    body: { text: string; anchors: readonly ScriptAnchor[] },
): { text: string; anchors: readonly ScriptAnchor[] } {
    if (header.length === 0) {
        return body;
    }
    let headerLines = 0;
    for (let i = 0; i < header.length; i++) {
        if (header.charCodeAt(i) === 10) {
            headerLines++;
        }
    }
    return {
        text: header + body.text,
        anchors: body.anchors.map((anchor) => ({
            symbol: anchor.symbol,
            span: {
                start: anchor.span.start + header.length,
                end: anchor.span.end + header.length,
            },
            line: anchor.line + headerLines,
            character: anchor.character,
        })),
    };
}

/** Render fidelity notes as `-- note` header lines (empty when none). */
export function fidelityHeader(notes: readonly string[]): string {
    if (notes.length === 0) {
        return "";
    }
    return notes.map((note) => `-- ${sanitizeCommentText(note)}`).join("\r\n") + "\r\n";
}

/** Single-line comment safety: fold line breaks, close comment openers. */
export function sanitizeCommentText(value: string): string {
    return value
        .replace(/\r\n|\r|\n/g, " ")
        .replace(/\*\//g, "* /")
        .trim();
}
