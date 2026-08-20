/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    escapeIdentifierContent,
    identifierQualifiersBefore,
    incompleteDelimitedIdentifierAt,
    isIdentifierContinuationCharacter,
    unescapeIdentifierContent,
} from "../semantics/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import { quoteIdentifierIfNeeded } from "./identifierFormatting.js";

export interface PrefixContext {
    readonly qualifiers: readonly string[];
    readonly prefix: string;
    readonly range: { readonly start: number; readonly end: number };
    readonly contextStart: number;
    readonly delimiter?: {
        readonly kind: "bracket" | "doubleQuote";
        readonly closed: boolean;
    };
}

export function completionPrefix(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
): PrefixContext {
    const text = snapshot.text.text;
    const delimited = delimitedIdentifierAt(snapshot, offset);
    let partStart: number;
    let prefix: string;
    let range: { start: number; end: number };
    let delimiter: PrefixContext["delimiter"];

    if (delimited) {
        partStart = delimited.start;
        const contentStart = delimited.start + 1;
        const contentEnd = delimited.closed ? delimited.end - 1 : delimited.end;
        const rawPrefix = text.slice(contentStart, offset);
        prefix =
            delimited.kind === "bracket"
                ? unescapeIdentifierContent(rawPrefix, "bracket")
                : unescapeIdentifierContent(rawPrefix, "doubleQuote");
        range = { start: contentStart, end: contentEnd };
        delimiter = { kind: delimited.kind, closed: delimited.closed };
    } else {
        partStart = offset;
        while (partStart > 0 && isIdentifierContinuationCharacter(text[partStart - 1]!)) {
            partStart--;
        }
        let partEnd = offset;
        while (partEnd < text.length && isIdentifierContinuationCharacter(text[partEnd]!)) {
            partEnd++;
        }
        prefix = text.slice(partStart, offset);
        range = { start: partStart, end: partEnd };
    }

    return {
        qualifiers: identifierQualifiersBefore(text, partStart),
        prefix,
        range,
        contextStart: partStart,
        ...(delimiter ? { delimiter } : {}),
    };
}

function delimitedIdentifierAt(
    snapshot: DocumentAnalysisSnapshot,
    offset: number,
):
    | {
          readonly kind: "bracket" | "doubleQuote";
          readonly start: number;
          readonly end: number;
          readonly closed: boolean;
      }
    | undefined {
    const candidates = [offset, offset - 1, offset + 1]
        .filter((position) => position >= 0 && position <= snapshot.text.text.length)
        .map((position) => snapshot.syntax.nodeAt(position));
    for (const node of candidates) {
        const kind =
            node.kind === "BracketedIdentifier"
                ? "bracket"
                : node.kind === "DoubleQuotedIdentifier"
                  ? "doubleQuote"
                  : undefined;
        if (!kind || offset < node.start + 1 || offset > node.end - 1) continue;
        return { kind, start: node.start, end: node.end, closed: true };
    }

    const current = snapshot.syntax.nodeAt(offset);
    if (current.kind === "StringLiteral") return undefined;
    const incomplete = incompleteDelimitedIdentifierAt(snapshot.text.text, offset);
    return incomplete
        ? {
              kind: incomplete.kind,
              start: incomplete.start,
              end: incomplete.end,
              closed: false,
          }
        : undefined;
}

export function completionIdentifierInsertion(
    prefix: PrefixContext,
    value: string,
    quoteIfNeeded = true,
): string {
    if (prefix.delimiter?.kind === "bracket") {
        return `${escapeIdentifierContent(value, "bracket")}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        return `${escapeIdentifierContent(value, "doubleQuote")}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return quoteIfNeeded ? quoteIdentifierIfNeeded(value) : value;
}

export function completionMultipartInsertion(
    prefix: PrefixContext,
    parts: readonly string[],
): string {
    if (prefix.delimiter?.kind === "bracket") {
        const content = parts.map((part) => escapeIdentifierContent(part, "bracket")).join("].[");
        return `${content}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        const content = parts
            .map((part) => escapeIdentifierContent(part, "doubleQuote"))
            .join('"."');
        return `${content}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return parts.map(quoteIdentifierIfNeeded).join(".");
}
