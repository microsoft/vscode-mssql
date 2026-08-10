/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type Token, TokenType } from "./lexer.js";
import { ALIAS_STOP_KEYWORDS, type JoinKeyword, JoinKeywords } from "./grammar.js";

export function canStartAlias(token?: Token): boolean {
    if (!token) {
        return false;
    }

    if (token.type !== TokenType.Identifier && token.type !== TokenType.Keyword) {
        return false;
    }

    return !ALIAS_STOP_KEYWORDS.has(token.value);
}

export function isJoinToken(token: Token | undefined, next?: Token): boolean {
    if (!token) return false;

    switch (token.value as JoinKeyword) {
        case JoinKeywords.JOIN:
            return true;

        case JoinKeywords.HASH:
        case JoinKeywords.MERGE:
        case JoinKeywords.LOOP:
            return next?.value === JoinKeywords.JOIN;

        case JoinKeywords.INNER:
            return (
                [
                    JoinKeywords.JOIN,
                    JoinKeywords.HASH,
                    JoinKeywords.MERGE,
                    JoinKeywords.LOOP,
                ] as string[]
            ).includes(next?.value ?? "");

        case JoinKeywords.LEFT:
        case JoinKeywords.RIGHT:
        case JoinKeywords.FULL:
            return (
                [
                    "OUTER",
                    JoinKeywords.JOIN,
                    JoinKeywords.HASH,
                    JoinKeywords.MERGE,
                    JoinKeywords.LOOP,
                ] as string[]
            ).includes(next?.value ?? "");

        case JoinKeywords.CROSS:
            return next?.value === JoinKeywords.JOIN || next?.value === JoinKeywords.APPLY;

        case JoinKeywords.OUTER:
            return next?.value === JoinKeywords.APPLY;

        default:
            return false;
    }
}

export function isFromBoundary(token?: Token): boolean {
    if (!token) return true;

    return [
        "WHERE",
        "GROUP",
        "HAVING",
        "ORDER",
        "UNION",
        "EXCEPT",
        "INTERSECT",
        "FOR",
        "OPTION",
        "OFFSET",
        "FETCH",
    ].includes(token.value);
}

export function isClauseBoundary(token?: Token): boolean {
    if (!token) {
        return true;
    }

    if (token.type === TokenType.Semicolon || token.type === TokenType.CloseParen) {
        return true;
    }

    return [
        "FROM",
        "WHERE",
        "GROUP",
        "HAVING",
        "ORDER",
        "UNION",
        "EXCEPT",
        "INTERSECT",
        "JOIN",
        "ON",
        "APPLY",
        "FOR",
        "OPTION",
        "OFFSET",
        "FETCH",
        "OUTPUT",
        "RANGE",
        "ROWS",
    ].includes(token.value);
}

export function isInsertRecoveryBoundary(token?: Token): boolean {
    if (!token) {
        return true;
    }

    return (
        token.type === TokenType.Semicolon ||
        token.type === TokenType.CloseParen ||
        token.type === TokenType.Comma
    );
}

export function isSetOperator(token: Token | null): boolean {
    if (!token || token.type !== TokenType.Keyword) return false;

    const val = token.value;
    return val === "UNION" || val === "EXCEPT" || val === "INTERSECT";
}

export function isMergeBoundary(token?: Token): boolean {
    if (!token) return true;

    return (
        token.type === TokenType.Semicolon ||
        token.value === "WHEN" ||
        token.value === "OUTPUT" ||
        token.value === "OPTION"
    );
}
