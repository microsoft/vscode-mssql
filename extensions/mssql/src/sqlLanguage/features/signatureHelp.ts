/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native signature help (design 05 §12.2, B11/LS-3). Two shapes:
 *
 *  1. Call expressions `name(arg, …)` — the innermost enclosing unclosed
 *     paren with a name-chain callee wins. Curated builtins come from the
 *     data asset (multiple overloads where the asset has them); user
 *     scalar/table functions come from pinned metadata (parameters ready
 *     only). The active parameter is the comma index at the call's paren
 *     depth; grouping parens are stepped over without polluting the count.
 *
 *  2. EXEC procName args — one signature from routine metadata; the active
 *     parameter is the argument-segment index, and a NAMED argument
 *     (`@p = …`) in the caret's segment resolves by name and WINS over the
 *     positional index.
 *
 * Honest empty everywhere the callee cannot be bound (unknown routines,
 * parameters not ready, dynamic EXEC, USE-switched statements, comments and
 * strings). Pure: no vscode, no node builtins, no I/O (lint-enforced).
 */

import { SignatureHelpResult, SignatureInfo } from "../api";
import { resolveNameParts } from "../core/binder";
import { Token, TokenKind, isTrivia, tokenIndexAt } from "../core/lexer";
import { findEnclosingCall } from "../core/nameChain";
import { ScriptOverlay } from "../core/overlay";
import { StatementSketch } from "../core/sketch";
import { BuiltinFunctionInfo, TSQL_BUILTIN_FUNCTIONS } from "../data/builtinFunctions.generated";
import { IPinnedMetadataView, LangParam } from "../provider/types";

export type SignatureCalleeKind = "builtin" | "function" | "procedure" | "none";

export interface SignatureHelpComputeInput {
    readonly text: string;
    readonly offset: number;
    readonly tokens: readonly Token[];
    readonly sketch: StatementSketch;
    readonly overlay: ScriptOverlay;
    readonly batchIndex: number;
    readonly ordinal: number;
    readonly pinned: IPinnedMetadataView;
    /** Effective database at this statement when a USE precedes it (§4.4). */
    readonly effectiveDatabase?: string;
}

export interface SignatureHelpComputation {
    readonly result: SignatureHelpResult | undefined;
    /** Callee kind for telemetry (never identifier text). */
    readonly calleeKind: SignatureCalleeKind;
}

const NONE: SignatureHelpComputation = { result: undefined, calleeKind: "none" };

const BUILTIN_BY_NAME = new Map<string, BuiltinFunctionInfo>(
    TSQL_BUILTIN_FUNCTIONS.map((fn) => [fn.name, fn]),
);

export function computeSignatureHelp(input: SignatureHelpComputeInput): SignatureHelpComputation {
    const { tokens, offset, pinned } = input;
    const fold = (value: string): string =>
        pinned.env.caseSensitive ? value : value.toLowerCase();

    // Typing positions inside comments/strings/sqlcmd get nothing.
    const atIndex = tokenIndexAt(tokens, Math.max(0, offset - 1));
    const at = tokens[atIndex];
    if (at !== undefined && offset > at.start && offset <= at.end) {
        if (
            at.kind === TokenKind.LineComment ||
            at.kind === TokenKind.BlockComment ||
            at.kind === TokenKind.SqlCmdDirective
        ) {
            return NONE;
        }
        if (at.kind === TokenKind.StringLiteral && (offset < at.end || at.unterminated === true)) {
            return NONE;
        }
    }

    // USE moved the statement off the hydrated database: no catalog claims.
    const current = pinned.env.currentDatabase;
    const catalogSuppressed =
        input.effectiveDatabase !== undefined &&
        (current === undefined || fold(input.effectiveDatabase) !== fold(current));

    // ---- innermost enclosing call expression -------------------------------
    const call = findEnclosingCall({
        text: input.text,
        tokens,
        offset,
        statementStart: input.sketch.span.start,
    });
    if (call !== undefined) {
        if (call.parts.length === 1) {
            const builtin = BUILTIN_BY_NAME.get(call.parts[0].toUpperCase());
            if (builtin !== undefined) {
                return builtinSignatures(builtin, call.commas);
            }
        }
        if (catalogSuppressed) {
            return NONE;
        }
        const resolution = resolveNameParts(call.parts, {
            overlay: input.overlay,
            batchIndex: input.batchIndex,
            ordinal: input.ordinal,
            pinned,
            caseSensitive: pinned.env.caseSensitive,
        });
        if (resolution.kind !== "catalog") {
            return NONE; // honest empty: the callee cannot be bound
        }
        const info = pinned.getObject(resolution.ref);
        if (
            info === undefined ||
            (info.kind !== "scalarFunction" && info.kind !== "tableFunction")
        ) {
            return NONE;
        }
        if (pinned.readiness.parameters !== "ready") {
            return NONE;
        }
        const params = pinned.getParameters(resolution.ref);
        if (params === undefined) {
            return NONE;
        }
        const shown = params.filter((p) => p.ordinal !== 0);
        const returns = params.find((p) => p.ordinal === 0);
        const label =
            info.schema +
            "." +
            info.name +
            "(" +
            shown.map(paramLabel).join(", ") +
            ")" +
            (returns !== undefined ? " → " + returns.typeDisplay : "");
        return {
            result: {
                signatures: [
                    {
                        label,
                        parameters: shown.map((p) => ({ label: paramLabel(p) })),
                    },
                ],
                activeSignature: 0,
                activeParameter: call.commas,
            },
            calleeKind: "function",
        };
    }

    // ---- EXEC argument context ---------------------------------------------
    const exec = input.sketch.exec;
    if (
        exec !== undefined &&
        exec.procParts.length > 0 &&
        offset >= exec.procSpan.end &&
        !catalogSuppressed
    ) {
        const resolution = resolveNameParts(exec.procParts, {
            overlay: input.overlay,
            batchIndex: input.batchIndex,
            ordinal: input.ordinal,
            pinned,
            caseSensitive: pinned.env.caseSensitive,
        });
        if (resolution.kind !== "catalog") {
            return NONE;
        }
        if (pinned.readiness.parameters !== "ready") {
            return NONE;
        }
        const params = pinned.getParameters(resolution.ref);
        const info = pinned.getObject(resolution.ref);
        if (params === undefined || info === undefined) {
            return NONE;
        }
        const shown = params.filter((p) => p.ordinal !== 0);
        const label =
            info.schema +
            "." +
            info.name +
            (shown.length > 0 ? " " : "") +
            shown.map(paramLabel).join(", ");
        const segment = execSegmentIndex(input, exec.procSpan.end);
        let active = segment;
        const named = exec.args[segment]?.name;
        if (named !== undefined) {
            const namedIndex = shown.findIndex((p) => fold(p.name) === fold(named));
            if (namedIndex >= 0) {
                active = namedIndex; // named-argument resolution wins (§12.2)
            }
        }
        return {
            result: {
                signatures: [
                    {
                        label,
                        parameters: shown.map((p) => ({ label: paramLabel(p) })),
                    },
                ],
                activeSignature: 0,
                activeParameter: active,
            },
            calleeKind: "procedure",
        };
    }

    return NONE;
}

function paramLabel(p: LangParam): string {
    return p.name + " " + p.typeDisplay + (p.isOutput ? " OUTPUT" : "");
}

function builtinSignatures(builtin: BuiltinFunctionInfo, commas: number): SignatureHelpComputation {
    const signatures: SignatureInfo[] = builtin.signatures.map((signature) => ({
        label: signature.label + " → " + signature.returnType,
        documentation: builtin.description,
        parameters: signature.parameters.map((p) => ({
            label: p.name,
            documentation: p.typeDisplay + (p.optional === true ? " (optional)" : ""),
        })),
    }));
    // Prefer the first overload that still has a parameter for the caret;
    // otherwise the widest one (best available context).
    let activeSignature = builtin.signatures.findIndex((s) => s.parameters.length > commas);
    if (activeSignature < 0) {
        let widest = 0;
        builtin.signatures.forEach((s, i) => {
            if (s.parameters.length > builtin.signatures[widest].parameters.length) {
                widest = i;
            }
        });
        activeSignature = widest;
    }
    return {
        result: { signatures, activeSignature, activeParameter: commas },
        calleeKind: "builtin",
    };
}

/** Argument-segment index at the caret: top-level commas after the proc name. */
function execSegmentIndex(input: SignatureHelpComputeInput, argsStart: number): number {
    const { text, tokens, offset } = input;
    let i = tokenIndexAt(tokens, argsStart);
    if (tokens[i] !== undefined && tokens[i].end <= argsStart) {
        i++;
    }
    let depth = 0;
    let commas = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t.start >= offset || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (
            !isTrivia(t.kind) &&
            (t.kind === TokenKind.Punctuation || t.kind === TokenKind.Operator)
        ) {
            const raw = text.slice(t.start, t.end);
            if (raw === "(") {
                depth++;
            } else if (raw === ")") {
                depth = Math.max(0, depth - 1);
            } else if (raw === "," && depth === 0) {
                commas++;
            }
        }
        i++;
    }
    return commas;
}
