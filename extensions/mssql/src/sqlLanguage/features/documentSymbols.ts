/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Document symbols (design 05 §14.2) — LS-0 scope: batches with their
 * statements, statement labels from the leading word, CREATE/ALTER object
 * names surfaced when trivially extractable from the token stream. CTE/temp
 * table/label symbols deepen with the B9 sketch parser/overlay.
 */

import { DocumentSymbolResult, SqlLanguageRange } from "../api";
import { Token, TokenKind, isTrivia } from "../core/lexer";
import { SegmentResult, StatementSegment } from "../core/segmenter";
import { TextSnapshot } from "../core/text/textSnapshot";

export function computeDocumentSymbols(
    snapshot: TextSnapshot,
    tokens: readonly Token[],
    segments: SegmentResult,
): DocumentSymbolResult[] {
    const multipleBatches = segments.batches.length > 1;
    const batchNodes: DocumentSymbolResult[] = [];

    segments.batches.forEach((batch, index) => {
        const children = batch.statements.map((s) => statementSymbol(snapshot, tokens, s));
        if (multipleBatches) {
            batchNodes.push({
                name:
                    batch.repeatCount > 1
                        ? `Batch ${index + 1} (GO ${batch.repeatCount})`
                        : `Batch ${index + 1}`,
                kind: "batch",
                range: toRange(snapshot, batch.start, batch.end),
                children,
            });
        } else {
            batchNodes.push(...children);
        }
    });

    return batchNodes;
}

function statementSymbol(
    snapshot: TextSnapshot,
    tokens: readonly Token[],
    statement: StatementSegment,
): DocumentSymbolResult {
    let name = statement.leadingWord ?? firstWordFallback(snapshot, statement);
    let kind: DocumentSymbolResult["kind"] = "statement";

    if (statement.leadingWord === "CREATE" || statement.leadingWord === "ALTER") {
        const objectName = createdObjectName(snapshot, tokens, statement);
        if (objectName !== undefined) {
            name = `${statement.leadingWord} ${objectName}`;
            kind = "object";
        }
    }

    return {
        name,
        kind,
        range: toRange(snapshot, statement.start, statement.end),
    };
}

function firstWordFallback(snapshot: TextSnapshot, statement: StatementSegment): string {
    const text = snapshot.text.slice(
        statement.start,
        Math.min(statement.end, statement.start + 30),
    );
    const word = /^[^\s]+/.exec(text);
    return word !== null ? word[0] : "statement";
}

/**
 * CREATE|ALTER [OR ALTER] <kind> <name parts> — return "kind name" when the
 * shape is unambiguous in the token stream.
 */
function createdObjectName(
    snapshot: TextSnapshot,
    tokens: readonly Token[],
    statement: StatementSegment,
): string | undefined {
    const words: string[] = [];
    for (let i = statement.firstToken + 1; i <= statement.lastToken && words.length < 8; i++) {
        const t = tokens[i];
        if (isTrivia(t.kind)) {
            continue;
        }
        if (t.kind === TokenKind.Identifier) {
            const raw = snapshot.slice(t);
            const upper = raw.toUpperCase();
            if (words.length === 0 && (upper === "OR" || upper === "ALTER")) {
                continue; // CREATE OR ALTER prefix
            }
            // The first collected word is the object kind (PROCEDURE/VIEW/...,
            // reserved). After that, a reserved word (AS, WITH, ...) ends the name.
            if (words.length > 0 && t.keyword?.reserved === true) {
                break;
            }
            words.push(raw);
            continue;
        }
        if (
            t.kind === TokenKind.BracketedIdentifier ||
            t.kind === TokenKind.QuotedIdentifier ||
            t.kind === TokenKind.TempName ||
            t.kind === TokenKind.GlobalTempName
        ) {
            words.push(snapshot.slice(t));
            continue;
        }
        if (t.kind === TokenKind.Punctuation && snapshot.text.charCodeAt(t.start) === 46 /* . */) {
            words.push(".");
            continue;
        }
        break;
    }
    if (words.length < 2) {
        return undefined;
    }
    const objectKind = words[0].toUpperCase();
    const nameParts = words.slice(1).join("").replace(/\.+/g, ".");
    return `${objectKind} ${nameParts}`;
}

function toRange(snapshot: TextSnapshot, start: number, end: number): SqlLanguageRange {
    return { start: snapshot.positionAt(start), end: snapshot.positionAt(end) };
}
