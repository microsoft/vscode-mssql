/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeIdentifier } from "../semantics/index.js";
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
                ? rawPrefix.replaceAll("]]", "]")
                : rawPrefix.replaceAll('""', '"');
        range = { start: contentStart, end: contentEnd };
        delimiter = { kind: delimited.kind, closed: delimited.closed };
    } else {
        partStart = offset;
        while (partStart > 0 && isIdentifierCompletionCharacter(text[partStart - 1]!)) partStart--;
        let partEnd = offset;
        while (partEnd < text.length && isIdentifierCompletionCharacter(text[partEnd]!)) partEnd++;
        prefix = text.slice(partStart, offset);
        range = { start: partStart, end: partEnd };
    }

    const qualifier = multipartQualifierBefore(text, partStart);
    return {
        qualifiers:
            qualifier.length === 0
                ? []
                : splitMultipartPrefix(qualifier).map((part) => normalizeIdentifier(part.trim())),
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
    const lineStart =
        Math.max(
            snapshot.text.text.lastIndexOf("\n", offset - 1),
            snapshot.text.text.lastIndexOf("\r", offset - 1),
        ) + 1;
    const leading = snapshot.text.text.slice(lineStart, offset);
    const bracket = /\[((?:[^\]]|\]\])*)$/u.exec(leading);
    if (bracket?.index !== undefined) {
        return { kind: "bracket", start: lineStart + bracket.index, end: offset, closed: false };
    }
    const doubleQuote = /"((?:[^"]|"")*)$/u.exec(leading);
    if (doubleQuote?.index !== undefined) {
        return {
            kind: "doubleQuote",
            start: lineStart + doubleQuote.index,
            end: offset,
            closed: false,
        };
    }
    return undefined;
}

function multipartQualifierBefore(text: string, partStart: number): string {
    const identifier = String.raw`(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_$#@][\p{L}\p{N}_$#@]*)`;
    const match = new RegExp(String.raw`(?:${identifier}\s*\.\s*)+$`, "u").exec(
        text.slice(0, partStart),
    );
    return match?.[0] ?? "";
}

function isIdentifierCompletionCharacter(character: string): boolean {
    return /[\p{L}\p{N}_$#@]/u.test(character);
}

function splitMultipartPrefix(value: string): string[] {
    value = value.trim();
    const parts: string[] = [];
    let start = 0;
    let close = "";
    for (let index = 0; index < value.length; index++) {
        const character = value[index]!;
        if (!close && character === "[") close = "]";
        else if (!close && character === '"') close = '"';
        else if (close && character === close) {
            if (value[index + 1] === close) index++;
            else close = "";
        } else if (!close && character === ".") {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));
    if (value.endsWith(".")) parts.pop();
    return parts;
}

export function completionIdentifierInsertion(
    prefix: PrefixContext,
    value: string,
    quoteIfNeeded = true,
): string {
    if (prefix.delimiter?.kind === "bracket") {
        return `${value.replaceAll("]", "]]")}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        return `${value.replaceAll('"', '""')}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return quoteIfNeeded ? quoteIdentifierIfNeeded(value) : value;
}

export function completionMultipartInsertion(
    prefix: PrefixContext,
    parts: readonly string[],
): string {
    if (prefix.delimiter?.kind === "bracket") {
        const content = parts.map((part) => part.replaceAll("]", "]]")).join("].[");
        return `${content}${prefix.delimiter.closed ? "" : "]"}`;
    }
    if (prefix.delimiter?.kind === "doubleQuote") {
        const content = parts.map((part) => part.replaceAll('"', '""')).join('"."');
        return `${content}${prefix.delimiter.closed ? "" : '"'}`;
    }
    return parts.map(quoteIdentifierIfNeeded).join(".");
}
