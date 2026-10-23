/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LexResult, TokenKind, tokenIndexAt } from "./lexer";

/** Classify the caret, including unterminated tokens at EOF, for popup completion. */
export function completionLexicalSuppressionAt(
    lexed: LexResult,
    offset: number,
): "comment" | "string" | "sqlcmd" | undefined {
    if (offset <= 0) {
        return undefined;
    }
    const token = lexed.tokens[tokenIndexAt(lexed.tokens, offset - 1)];
    if (!token) {
        return undefined;
    }
    switch (token.kind) {
        case TokenKind.LineComment:
            return "comment";
        case TokenKind.BlockComment:
            return offset < token.end || token.unterminated ? "comment" : undefined;
        case TokenKind.StringLiteral:
            return offset < token.end || token.unterminated ? "string" : undefined;
        case TokenKind.SqlCmdDirective:
            return "sqlcmd";
        default:
            return undefined;
    }
}
