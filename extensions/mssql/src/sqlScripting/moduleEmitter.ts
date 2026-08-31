/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ModuleEmitter (design 05 §13.3): scripts views, procedures, and functions
 * from their STORED catalog definition text. Head rewrites are TOKEN-LEVEL
 * over the full-fidelity lexer — comments, whitespace, and edge tokens
 * between the head and the object name are preserved exactly:
 *
 *   CREATE            → ALTER            (operation "alter")
 *   CREATE OR ALTER   → ALTER            (operation "alter")
 *   ALTER             → CREATE           (operation "create"; stored text
 *                                         reflects the LAST alter statement)
 *   CREATE / ALTER    → CREATE OR ALTER  (operation "createOrAlter", gated
 *                                         on server capability ≥ 2016 SP1)
 *
 * A stored text whose first significant token is not CREATE/ALTER cannot be
 * rewritten honestly — the emitter refuses (unavailableReason "unsupported")
 * instead of guessing. Anchors: header, objectName, and header parameters.
 * Pure: no vscode, no node builtins (lint-enforced).
 */

import { Token, TokenKind, isTrivia, lex, nextSignificant } from "../sqlLanguage/core/lexer";
import { LangObjectInfo } from "../sqlLanguage/provider/types";
import { ScriptAnchor, ScriptOperation } from "./api";

export interface ModuleEmitInput {
    readonly info: LangObjectInfo;
    /** Stored module text (sys.sql_modules definition). */
    readonly definitionText: string;
    readonly operation: "create" | "alter" | "createOrAlter";
    readonly createOrAlterSupported: boolean;
}

export interface ModuleEmitOutput {
    readonly text: string;
    readonly anchors: readonly ScriptAnchor[];
    readonly fidelityNotes: readonly string[];
    readonly unavailable?: "unsupported";
}

/** Words that introduce the module kind after CREATE/ALTER [OR ALTER]. */
const MODULE_KIND_WORDS = new Set(["PROCEDURE", "PROC", "VIEW", "FUNCTION", "TRIGGER"]);

interface ModuleHead {
    /** Significant token indexes forming the head (CREATE [OR ALTER] | ALTER). */
    readonly tokenIndexes: readonly number[];
    readonly kind: "create" | "alter" | "createOrAlter";
}

function upper(text: string, token: Token): string {
    return text.slice(token.start, token.end).toUpperCase();
}

/** Read the head token run of a stored module definition. */
function readHead(text: string, tokens: readonly Token[]): ModuleHead | undefined {
    const first = nextSignificant(tokens, 0);
    const head = tokens[first];
    if (head === undefined || head.kind !== TokenKind.Identifier) {
        return undefined;
    }
    const word = upper(text, head);
    if (word === "ALTER") {
        return { tokenIndexes: [first], kind: "alter" };
    }
    if (word !== "CREATE") {
        return undefined;
    }
    // CREATE OR ALTER?
    const second = nextSignificant(tokens, first + 1);
    if (tokens[second] !== undefined && upper(text, tokens[second]) === "OR") {
        const third = nextSignificant(tokens, second + 1);
        if (tokens[third] !== undefined && upper(text, tokens[third]) === "ALTER") {
            return { tokenIndexes: [first, second, third], kind: "createOrAlter" };
        }
    }
    return { tokenIndexes: [first], kind: "create" };
}

export function emitModuleScript(input: ModuleEmitInput): ModuleEmitOutput {
    const stored = input.definitionText;
    const { tokens } = lex(stored);
    const head = readHead(stored, tokens);
    if (head === undefined) {
        return {
            text:
                `-- ${input.info.schema}.${input.info.name}: the stored definition does not ` +
                "begin with CREATE or ALTER; it cannot be rewritten honestly.\r\n",
            anchors: [],
            fidelityNotes: ["stored definition head is not CREATE/ALTER — rewrite refused"],
            unavailable: "unsupported",
        };
    }

    const notes: string[] = [];
    let text: string;
    if (input.operation === "createOrAlter") {
        if (!input.createOrAlterSupported) {
            return {
                text:
                    `-- ${input.info.schema}.${input.info.name}: CREATE OR ALTER requires ` +
                    "SQL Server 2016 SP1 or later; the connected server does not support it.\r\n",
                anchors: [],
                fidelityNotes: ["CREATE OR ALTER not supported by the connected server"],
                unavailable: "unsupported",
            };
        }
        text =
            head.kind === "createOrAlter"
                ? stored
                : rewriteHead(stored, tokens, head, "CREATE OR ALTER");
    } else if (input.operation === "alter") {
        text = head.kind === "alter" ? stored : rewriteHead(stored, tokens, head, "ALTER");
    } else {
        text = head.kind === "create" ? stored : rewriteHead(stored, tokens, head, "CREATE");
        if (head.kind === "alter") {
            notes.push("stored definition was an ALTER statement; head rewritten to CREATE");
        }
    }

    // Anchors are computed on the FINAL text (head rewrite shifts offsets).
    return { text, anchors: moduleAnchors(text), fidelityNotes: notes };
}

/**
 * Replace the head token run with `replacement`, preserving every character
 * outside the run — including comments and whitespace BETWEEN head tokens
 * (they collapse into the replacement only when the run is multi-token).
 */
function rewriteHead(
    text: string,
    tokens: readonly Token[],
    head: ModuleHead,
    replacement: string,
): string {
    const start = tokens[head.tokenIndexes[0]].start;
    const end = tokens[head.tokenIndexes[head.tokenIndexes.length - 1]].end;
    return text.slice(0, start) + replacement + text.slice(end);
}

/** header + objectName + parameter anchors over an emitted module script. */
function moduleAnchors(text: string): ScriptAnchor[] {
    const { tokens } = lex(text);
    const anchors: ScriptAnchor[] = [];
    const positionOf = buildLineIndex(text);

    const first = nextSignificant(tokens, 0);
    if (tokens[first] !== undefined && tokens[first].kind !== TokenKind.EndOfFile) {
        anchors.push(anchorAt({ kind: "header" }, tokens[first], positionOf));
    }

    // Find the module-kind keyword, then the dotted object name after it.
    let kindIndex = -1;
    for (let i = first; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (t.kind === TokenKind.Identifier && MODULE_KIND_WORDS.has(upper(text, t))) {
            kindIndex = i;
            break;
        }
    }
    if (kindIndex < 0) {
        return anchors;
    }
    let nameEnd = -1;
    let i = nextSignificant(tokens, kindIndex + 1);
    while (i < tokens.length) {
        const t = tokens[i];
        if (
            t.kind !== TokenKind.Identifier &&
            t.kind !== TokenKind.BracketedIdentifier &&
            t.kind !== TokenKind.QuotedIdentifier
        ) {
            break;
        }
        nameEnd = i;
        const dot = nextSignificant(tokens, i + 1);
        if (tokens[dot] === undefined || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        i = nextSignificant(tokens, dot + 1);
    }
    if (nameEnd >= 0) {
        anchors.push(anchorAt({ kind: "objectName" }, tokens[nameEnd], positionOf));
    }

    // Header parameters: first occurrence of each @name between the object
    // name and the module-body AS at paren depth 0.
    const seen = new Set<string>();
    let depth = 0;
    for (let p = (nameEnd >= 0 ? nameEnd : kindIndex) + 1; p < tokens.length; p++) {
        const t = tokens[p];
        if (t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isTrivia(t.kind)) {
            continue;
        }
        const raw = text.slice(t.start, t.end);
        if (t.kind === TokenKind.Punctuation) {
            if (raw === "(") {
                depth++;
            } else if (raw === ")") {
                depth = Math.max(0, depth - 1);
            }
            continue;
        }
        if (t.kind === TokenKind.Identifier && depth === 0 && raw.toUpperCase() === "AS") {
            break; // module body begins
        }
        if (t.kind === TokenKind.Variable) {
            const folded = raw.toLowerCase();
            if (!seen.has(folded)) {
                seen.add(folded);
                anchors.push(anchorAt({ kind: "parameter", name: raw }, t, positionOf));
            }
        }
    }
    return anchors;
}

function anchorAt(
    symbol: ScriptAnchor["symbol"],
    token: Token,
    positionOf: (offset: number) => { line: number; character: number },
): ScriptAnchor {
    const position = positionOf(token.start);
    return {
        symbol,
        span: { start: token.start, end: token.end },
        line: position.line,
        character: position.character,
    };
}

/** Small offset→position index (module text is lexed once anyway). */
function buildLineIndex(text: string): (offset: number) => { line: number; character: number } {
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 10) {
            starts.push(i + 1);
        } else if (ch === 13) {
            if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
                i++;
            }
            starts.push(i + 1);
        }
    }
    return (offset: number) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= offset) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return { line: low, character: offset - starts[low] };
    };
}

/** Operations the module emitter can honestly serve for a module kind. */
export function moduleOperations(createOrAlterSupported: boolean): readonly ScriptOperation[] {
    return createOrAlterSupported ? ["create", "alter", "createOrAlter"] : ["create", "alter"];
}
