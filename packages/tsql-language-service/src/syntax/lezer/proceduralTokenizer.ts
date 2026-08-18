/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalTokenizer, type InputStream, type Stack } from "@lezer/lr";
import {
    BlockChunk,
    ComputeChunk,
    ConditionChunk,
    GroupedQueryChunk,
    Return,
    StatementChunk,
    With,
} from "./generated/tsqlParser.terms.js";

const statementStarters = new Set([
    "alter",
    "begin",
    "break",
    "checkpoint",
    "close",
    "commit",
    "continue",
    "create",
    "deallocate",
    "declare",
    "delete",
    "drop",
    "exec",
    "execute",
    "fetch",
    "get",
    "goto",
    "if",
    "insert",
    "merge",
    "move",
    "open",
    "print",
    "raiserror",
    "return",
    "revert",
    "rollback",
    "save",
    "select",
    "set",
    "throw",
    "truncate",
    "update",
    "use",
    "waitfor",
    "while",
    "with",
]);
const controlStarters = new Set(["begin", "if", "while"]);
/**
 * Words that continue a grouped query statement after its parentheses close.
 *
 * `(SELECT 1) UNION SELECT 2` is one statement; `(SELECT 1) SELECT 2` is two. Without this set the
 * scan would run past the closing parenthesis to the end of the batch and swallow whatever follows,
 * because a grouped statement needs no terminator.
 */
const groupedQueryContinuations = new Set([
    "union",
    "except",
    "intersect",
    "order",
    "for",
    "option",
    "compute",
]);
const nonBlockBeginFollowers = new Set([
    "conversation",
    "dialog",
    "distributed",
    "tran",
    "transaction",
]);
const nonBlockEndFollowers = new Set(["conversation"]);

/** Keeps each mounted region in its own token group so unrelated LR states never invoke it. */
export const computeToken = new ExternalTokenizer((input) => {
    readCompute(input);
});

export const conditionToken = new ExternalTokenizer((input) => {
    readCondition(input);
});

export const blockToken = new ExternalTokenizer((input, stack) => {
    readBlock(input, stack);
});

export const statementToken = new ExternalTokenizer((input) => {
    readStatement(input);
});

/** Scans one statement-leading parenthesized SELECT for the dedicated grouped-query parser. */
export const groupedQueryToken = new ExternalTokenizer((input, stack) => {
    if (!isStatementLeading(stack)) return;
    if (!looksLikeGroupedSelect(input)) return;
    const boundary = findBoundary(input, "grouped");
    if (boundary <= 0) return;
    input.advance(boundary);
    input.acceptToken(GroupedQueryChunk);
});

function looksLikeGroupedSelect(input: InputStream): boolean {
    if (input.peek(0) !== 40) return false;
    let offset = 0;
    while (input.peek(offset) === 40) {
        offset++;
        while (isWhitespace(input.peek(offset))) offset++;
    }
    return wordAt(input, offset)?.text === "select";
}

function readCompute(input: InputStream): boolean {
    if (wordAt(input, 0)?.text !== "compute") return false;
    const boundary = findBoundary(input, "statement");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(ComputeChunk);
    return true;
}

function readCondition(input: InputStream): boolean {
    const boundary = findBoundary(input, "condition");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(ConditionChunk);
    return true;
}

function readBlock(input: InputStream, stack: Stack): boolean {
    const firstWord = wordAt(input, 0)?.text;
    if (firstWord === "return" && stack.canShift(Return) && isStructuredFunctionReturn(input)) {
        return false;
    }
    if (
        firstWord === "atomic" ||
        firstWord === "try" ||
        firstWord === "catch" ||
        firstWord === "external" ||
        firstWord === "tran" ||
        firstWord === "transaction" ||
        firstWord === "distributed"
    ) {
        return false;
    }
    // After BEGIN ATOMIC the WITH clause belongs to the structured atomic header. A normal BEGIN
    // block does not shift WITH directly, so its leading CTE remains safely mounted as BlockChunk.
    if (firstWord === "with" && stack.canShift(With)) return false;
    const boundary = findBoundary(input, "block");
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(BlockChunk);
    return true;
}

function isStructuredFunctionReturn(input: InputStream): boolean {
    let offset = "return".length;
    while (isWhitespace(input.peek(offset))) offset++;
    const direct = wordAt(input, offset)?.text;
    if (direct === "select") return true;
    if (input.peek(offset) !== 40) return false;
    offset++;
    while (isWhitespace(input.peek(offset))) offset++;
    const parenthesized = wordAt(input, offset)?.text;
    return parenthesized === "select" || parenthesized === "with";
}

function readStatement(input: InputStream): boolean {
    const firstWord = wordAt(input, 0);
    if (firstWord && controlStarters.has(firstWord.text)) return false;
    const boundary = findBoundary(input, "statement", firstWord?.text);
    if (boundary <= 0) return false;
    input.advance(boundary);
    input.acceptToken(StatementChunk);
    return true;
}

function findBoundary(
    input: InputStream,
    mode: "condition" | "block" | "statement" | "grouped",
    initialStatementWord?: string,
): number {
    let offset = 0;
    let parentheses = 0;
    let nestedBegins = 0;
    let cases = 0;
    // Grouped mode only: whether the leading parenthesised group has closed, and the last word
    // seen outside parentheses. Together they tell a continuation of this statement apart from the
    // start of the next one.
    let groupClosed = false;
    let lastWord = "";
    let withBodyStarted = false;
    let quote: "string" | "quoted" | "bracket" | undefined;
    let blockComments = 0;
    while (input.peek(offset) >= 0) {
        const current = input.peek(offset);
        const next = input.peek(offset + 1);
        if (blockComments > 0) {
            if (current === 47 && next === 42) {
                blockComments++;
                offset += 2;
            } else if (current === 42 && next === 47) {
                blockComments--;
                offset += 2;
            } else offset++;
            continue;
        }
        if (quote) {
            const close = quote === "string" ? 39 : quote === "quoted" ? 34 : 93;
            if (current === close && next === close) offset += 2;
            else {
                offset++;
                if (current === close) quote = undefined;
            }
            continue;
        }
        if (current === 45 && next === 45) {
            while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
            continue;
        }
        if (current === 47 && next === 42) {
            blockComments = 1;
            offset += 2;
            continue;
        }
        if (current === 39 || current === 34 || current === 91) {
            quote = current === 39 ? "string" : current === 34 ? "quoted" : "bracket";
            offset++;
            continue;
        }
        if (current === 40) {
            parentheses++;
            offset++;
            continue;
        }
        if (current === 41) {
            // A StatementChunk mounted inside WAITFOR starts after the outer opening parenthesis,
            // so its matching close appears at local depth zero and belongs to the host grammar.
            // Balanced parentheses opened by the mounted SQL still remain inside the chunk.
            if ((mode === "statement" || mode === "grouped") && parentheses === 0) {
                return trimEnd(input, offset);
            }
            parentheses = Math.max(0, parentheses - 1);
            offset++;
            // A grouped query begins at its own opening parenthesis, so depth returning to zero
            // means the group just closed. The statement ends there unless a set operator or a
            // trailing clause continues it: a grouped statement needs no terminator, and without
            // this the scan would consume the next statement as part of this one.
            if (mode === "grouped" && parentheses === 0) {
                const following = nextWordAfterTrivia(input, offset);
                if (!following || !groupedQueryContinuations.has(following.text)) {
                    return trimEnd(input, offset);
                }
                groupClosed = true;
                lastWord = "";
            }
            continue;
        }
        // Keep the terminator inside the mounted controlled statement. Otherwise the outer IF
        // grammar sees a stray semicolon between the true branch and its ELSE clause.
        if (parentheses === 0 && current === 59) {
            if (mode === "statement") return offset + 1;
            if (mode === "grouped") return offset;
        }
        if (parentheses === 0 && isWordStart(current)) {
            const word = wordAt(input, offset)!;
            // Mounted procedural regions must never consume a SQL client batch separator.
            if (word.text === "go" && isBatchSeparatorAt(input, offset, word.end)) {
                return trimEnd(input, offset);
            }
            if (mode === "condition" && statementStarters.has(word.text)) {
                if (!(word.text === "update" && nextNonTrivia(input, word.end) === 40))
                    return trimEnd(input, offset);
            } else if (mode === "statement" || mode === "grouped") {
                if (word.text === "else" || word.text === "end") return trimEnd(input, offset);
                // Once the leading group has closed, a set-operator chain may continue across
                // lines. A line-leading statement word ends this statement only when it is not
                // continuing that chain, which the previous word at depth zero decides.
                if (
                    mode === "grouped" &&
                    groupClosed &&
                    offset > 0 &&
                    statementStarters.has(word.text) &&
                    !groupedQueryContinuations.has(lastWord) &&
                    lastWord !== "all" &&
                    isLineLeadingWord(input, offset)
                ) {
                    return trimEnd(input, offset);
                }
                const previousWord = lastWord;
                if (
                    mode === "statement" &&
                    offset > 0 &&
                    statementStarters.has(word.text) &&
                    isLineLeadingWord(input, offset) &&
                    !isStatementContinuation(
                        initialStatementWord,
                        word.text,
                        previousWord,
                        withBodyStarted,
                    )
                ) {
                    return trimEnd(input, offset);
                }
                if (
                    initialStatementWord === "with" &&
                    !withBodyStarted &&
                    isCteBodyStarter(word.text)
                ) {
                    withBodyStarted = true;
                }
                lastWord = word.text;
                // A semicolon-less controlled statement ends before the next line-leading control
                // statement. This preserves classic IF/ELSE and WHILE scripts without treating
                // ordinary multi-line SELECT/FROM clauses as separate bodies.
                if (
                    offset > 0 &&
                    controlStarters.has(word.text) &&
                    isLineLeadingWord(input, offset)
                ) {
                    return trimEnd(input, offset);
                }
            } else if (mode === "block") {
                if (word.text === "case") cases++;
                else if (word.text === "begin") {
                    const following = nextWordAfterTrivia(input, word.end)?.text;
                    if (!following || !nonBlockBeginFollowers.has(following)) nestedBegins++;
                } else if (word.text === "end") {
                    const following = nextWordAfterTrivia(input, word.end)?.text;
                    // END CONVERSATION is a Service Broker statement, not the terminator for the
                    // surrounding BEGIN, TRY, or CATCH region mounted by this tokenizer.
                    if (following && nonBlockEndFollowers.has(following)) {
                        offset = word.end;
                        continue;
                    }
                    if (cases > 0) cases--;
                    else if (nestedBegins > 0) nestedBegins--;
                    else return trimEnd(input, offset);
                }
            }
            offset = word.end;
            continue;
        }
        offset++;
    }
    return trimEnd(input, offset);
}

/**
 * A small set of statement-leading keywords are also legal continuations of a controlled body.
 * Everything else ends the mounted statement when it starts a new line. The mounted
 * ControlledStatementRoot remains the final invariant and rejects any missed boundary.
 */
function isStatementContinuation(
    initialWord: string | undefined,
    currentWord: string,
    previousWord: string,
    withBodyStarted: boolean,
): boolean {
    if (
        (previousWord === "union" || previousWord === "intersect" || previousWord === "except") &&
        currentWord === "select"
    ) {
        return true;
    }
    if (initialWord === "with" && !withBodyStarted && isCteBodyStarter(currentWord)) return true;
    if (initialWord === "update" && currentWord === "set") return true;
    if (
        initialWord === "insert" &&
        (currentWord === "select" ||
            currentWord === "with" ||
            currentWord === "exec" ||
            currentWord === "execute")
    ) {
        return true;
    }
    if (initialWord === "declare" && currentWord === "select") return true;
    if (initialWord === "execute" || initialWord === "exec") return currentWord === "with";
    if (initialWord === "select" || initialWord === "delete") return currentWord === "with";
    if (
        initialWord === "merge" &&
        (currentWord === "update" || currentWord === "delete" || currentWord === "insert")
    ) {
        return true;
    }
    return false;
}

function isCteBodyStarter(word: string): boolean {
    return (
        word === "select" ||
        word === "insert" ||
        word === "update" ||
        word === "delete" ||
        word === "merge"
    );
}

function isStatementLeading(stack: Stack): boolean {
    return (stack.context as SqlLexicalContext | null)?.statementLeading ?? stack.pos === 0;
}

interface SqlLexicalContext {
    readonly lineLeading: boolean;
    readonly statementLeading: boolean;
}

function isLineLeadingWord(input: InputStream, start: number): boolean {
    for (let offset = start - 1; offset >= 0; offset--) {
        const code = input.peek(offset);
        if (isLineBreak(code)) return true;
        if (code !== 9 && code !== 32) return false;
    }
    return true;
}

function isBatchSeparatorAt(input: InputStream, start: number, wordEnd: number): boolean {
    for (let offset = start - 1; offset >= 0; offset--) {
        const code = input.peek(offset);
        if (isLineBreak(code)) break;
        if (code !== 9 && code !== 32) return false;
    }

    let offset = wordEnd;
    while (input.peek(offset) === 9 || input.peek(offset) === 32) offset++;
    while (input.peek(offset) >= 48 && input.peek(offset) <= 57) offset++;
    while (input.peek(offset) === 9 || input.peek(offset) === 32) offset++;
    if (input.peek(offset) === 45 && input.peek(offset + 1) === 45) {
        offset += 2;
        while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
    }
    return input.peek(offset) < 0 || isLineBreak(input.peek(offset));
}

function wordAt(input: InputStream, offset: number): { text: string; end: number } | undefined {
    if (!isWordStart(input.peek(offset))) return undefined;
    let end = offset + 1;
    while (isWordPart(input.peek(end))) end++;
    let text = "";
    for (let index = offset; index < end; index++) text += String.fromCharCode(input.peek(index));
    return { text: text.toLowerCase(), end };
}

function nextNonTrivia(input: InputStream, offset: number): number {
    while (isWhitespace(input.peek(offset))) offset++;
    return input.peek(offset);
}

function nextWordAfterTrivia(
    input: InputStream,
    initialOffset: number,
): { text: string; end: number } | undefined {
    let offset = initialOffset;
    while (input.peek(offset) >= 0) {
        while (isWhitespace(input.peek(offset))) offset++;
        if (input.peek(offset) === 45 && input.peek(offset + 1) === 45) {
            while (input.peek(offset) >= 0 && !isLineBreak(input.peek(offset))) offset++;
            continue;
        }
        if (input.peek(offset) === 47 && input.peek(offset + 1) === 42) {
            let depth = 1;
            offset += 2;
            while (input.peek(offset) >= 0 && depth > 0) {
                if (input.peek(offset) === 47 && input.peek(offset + 1) === 42) {
                    depth++;
                    offset += 2;
                } else if (input.peek(offset) === 42 && input.peek(offset + 1) === 47) {
                    depth--;
                    offset += 2;
                } else offset++;
            }
            continue;
        }
        return wordAt(input, offset);
    }
    return undefined;
}

function trimEnd(input: InputStream, offset: number): number {
    while (offset > 0 && isWhitespace(input.peek(offset - 1))) offset--;
    return offset;
}

function isWordStart(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
}

function isWordPart(code: number): boolean {
    return isWordStart(code) || (code >= 48 && code <= 57) || code === 35 || code === 64;
}

function isWhitespace(code: number): boolean {
    return (
        (code >= 0x0000 && code <= 0x000d) ||
        (code >= 0x000e && code <= 0x0020) ||
        code === 0x0085 ||
        code === 0x00a0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200b) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000
    );
}

function isLineBreak(code: number): boolean {
    return code === 10 || code === 13;
}
