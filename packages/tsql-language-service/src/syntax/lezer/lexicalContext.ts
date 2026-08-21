/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextTracker } from "@lezer/lr";
import {
    Semicolon,
    horizontalWhitespace,
    lineBreak,
    lineContentStart,
} from "./generated/tsqlParser.terms.js";

interface SqlLexicalContext {
    readonly lineLeading: boolean;
    readonly statementLeading: boolean;
}

/** Tracks line-leading state without tokenizer lookbehind; strict hashes protect fragment reuse. */
export const sqlServerContext = new ContextTracker<SqlLexicalContext>({
    start: Object.freeze({ lineLeading: true, statementLeading: true }),
    shift(context, term) {
        if (term === lineBreak) {
            return context.lineLeading && context.statementLeading
                ? context
                : { lineLeading: true, statementLeading: true };
        }
        if (term === horizontalWhitespace) return context;
        if (term === lineContentStart) {
            return context.lineLeading
                ? { lineLeading: false, statementLeading: context.statementLeading }
                : context;
        }
        if (term === Semicolon) {
            return { lineLeading: false, statementLeading: true };
        }
        return context.lineLeading || context.statementLeading
            ? { lineLeading: false, statementLeading: false }
            : context;
    },
    hash: (context) => (context.lineLeading ? 1 : 0) | (context.statementLeading ? 2 : 0),
    strict: true,
});
