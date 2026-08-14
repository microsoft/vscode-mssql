/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextTracker } from "@lezer/lr";
import { horizontalWhitespace, lineBreak, lineContentStart } from "./generated/tsqlParser.terms.js";

interface SqlLexicalContext {
    readonly lineLeading: boolean;
}

/** Tracks line-leading state without tokenizer lookbehind; strict hashes protect fragment reuse. */
export const sqlServerContext = new ContextTracker<SqlLexicalContext>({
    start: Object.freeze({ lineLeading: true }),
    shift(context, term) {
        if (term === lineBreak) return context.lineLeading ? context : { lineLeading: true };
        if (term === horizontalWhitespace) return context;
        if (term === lineContentStart)
            return context.lineLeading ? { lineLeading: false } : context;
        return context.lineLeading ? { lineLeading: false } : context;
    },
    hash: (context) => (context.lineLeading ? 1 : 0),
    strict: true,
});
