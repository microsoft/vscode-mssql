/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer } from "@lezer/lr";
import { BrokerPriorityEnd } from "./generated/tsqlParser.terms.js";

/**
 * Ends a bare `CREATE/ALTER BROKER PRIORITY ... FOR CONVERSATION` without making the optional
 * `SET (...)` tail ambiguous with a following SET statement. This tokenizer is mounted only in
 * the LR state immediately after `FOR CONVERSATION`.
 */
export const brokerPriorityEndToken = new ExternalTokenizer((input) => {
    if (!startsWithSetKeyword(input)) input.acceptToken(BrokerPriorityEnd);
});

function startsWithSetKeyword(input: { readonly next: number; peek(offset: number): number }): boolean {
    if (lower(input.next) !== 115 || lower(input.peek(1)) !== 101 || lower(input.peek(2)) !== 116) {
        return false;
    }
    return !isIdentifierPart(input.peek(3));
}

function lower(code: number): number {
    return code >= 65 && code <= 90 ? code + 32 : code;
}

function isIdentifierPart(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 35 ||
        code === 64 ||
        code >= 128
    );
}
