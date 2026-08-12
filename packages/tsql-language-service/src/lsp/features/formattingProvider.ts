/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FormattingOptions, TextEdit } from "vscode-languageserver-types";
import type { SqlToken } from "../../analysis/contracts.js";
import type { SqlFeatureDocument, SqlFeatureDocumentAccessor } from "./featureDocument.js";
import { offsetsToRange } from "./rangeUtils.js";

/** Parser-aware indentation formatter which preserves non-leading source text byte-for-byte. */
export class SqlFormattingProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async formatDocument(uri: string, options: FormattingOptions): Promise<TextEdit[]> {
        const document = await this.documents.getDocument(uri);
        if (!document || document.text.length === 0) {
            return [];
        }
        const formatted = formatIndentation(document, options);
        return formatted === document.text
            ? []
            : [
                  {
                      range: offsetsToRange(document, 0, document.text.length),
                      newText: formatted,
                  },
              ];
    }
}

function formatIndentation(document: SqlFeatureDocument, options: FormattingOptions): string {
    const newline = document.text.includes("\r\n") ? "\r\n" : "\n";
    const hasFinalNewline = /\r?\n$/u.test(document.text);
    const lines = document.text.split(/\r?\n/u);
    if (hasFinalNewline) {
        lines.pop();
    }
    const tokensByLine = groupTokensByLine(document.analysis.tokens);
    const unit = options.insertSpaces ? " ".repeat(Math.max(1, options.tabSize)) : "\t";
    let indent = 0;
    const result = lines.map((line, lineNumber) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return "";
        }
        const tokens = tokensByLine.get(lineNumber) ?? [];
        const leadingClosers = countLeadingClosers(tokens);
        const lineIndent = Math.max(0, indent - leadingClosers);
        const formatted = `${unit.repeat(lineIndent)}${line.trimStart().trimEnd()}`;
        indent = Math.max(0, lineIndent + indentationDelta(tokens, leadingClosers));
        if (/^GO(?:\s+\d+)?(?:\s*--.*)?$/iu.test(trimmed)) {
            indent = 0;
            return trimmed;
        }
        return formatted;
    });
    return `${result.join(newline)}${hasFinalNewline ? newline : ""}`;
}

function groupTokensByLine(tokens: readonly SqlToken[]): Map<number, SqlToken[]> {
    const result = new Map<number, SqlToken[]>();
    for (const token of tokens) {
        if (token.channel !== "code") {
            continue;
        }
        const line = token.start.line;
        const values = result.get(line) ?? [];
        values.push(token);
        result.set(line, values);
    }
    return result;
}

function countLeadingClosers(tokens: readonly SqlToken[]): number {
    let result = 0;
    for (const token of tokens) {
        const keyword = keywordOf(token);
        if (token.text === ")" || keyword === "END" || keyword === "ELSE") {
            result++;
            continue;
        }
        break;
    }
    return result;
}

function indentationDelta(tokens: readonly SqlToken[], alreadyClosed: number): number {
    let opens = 0;
    let closes = 0;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const keyword = keywordOf(token);
        if (token.text === "(" || keyword === "CASE") {
            opens++;
        } else if (keyword === "BEGIN" && !isTransactionBegin(tokens[index + 1])) {
            opens++;
        } else if (token.text === ")" || keyword === "END") {
            closes++;
        } else if (keyword === "ELSE") {
            opens++;
            closes++;
        }
    }
    return opens - Math.max(0, closes - alreadyClosed);
}

function keywordOf(token: SqlToken): string {
    return token.consumedAs === "keyword" || token.role === "keyword"
        ? token.text.toUpperCase()
        : "";
}

function isTransactionBegin(token: SqlToken | undefined): boolean {
    return Boolean(
        token && ["TRAN", "TRANSACTION", "DISTRIBUTED"].includes(token.text.toUpperCase()),
    );
}
