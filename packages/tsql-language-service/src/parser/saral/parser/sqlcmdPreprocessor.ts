/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type ParseIssue } from "../ast/types.js";

export interface PreprocessResult {
    text: string;
    issues: ParseIssue[];
    /**
     * Translates an offset from the preprocessed (AST) text
     * back to the offset in the user's original raw text.
     */
    mapOffset: (preprocessedOffset: number) => number;
}

interface OffsetAnchor {
    prep: number;
    orig: number;
}

export interface SqlCmdOptions {
    /** Pre-defined variables (e.g. from a .sqlproj file or CLI arguments) */
    initialVariables?: Record<string, string>;
    /** Callback for the LSP to resolve :r file includes from unsaved editor buffers */
    resolveInclude?: (filename: string) => string | null;
}

export class SqlCmdPreprocessor {
    // Matches $(VariableName)
    private readonly VAR_REGEX = /\$\(([a-zA-Z0-9_]+)\)/g;
    // Matches :setvar VariableName Value (basic implementation)
    private readonly SETVAR_REGEX = /^:setvar\s+([a-zA-Z0-9_]+)\s*(.*)$/gim;
    // Matches :r FileName
    private readonly R_REGEX = /^:r\s+(.*)$/gim;

    public process(input: string, options?: SqlCmdOptions): PreprocessResult {
        let text = input;
        const issues: ParseIssue[] = [];
        const variables = { ...options?.initialVariables };

        // Fast-path: If the file obviously contains no SQLCMD directives, bail early.
        // This prevents unnecessary regex allocations and string building for standard SQL.
        if (!text.includes("$(") && !text.includes(":setvar") && !text.includes(":r")) {
            return {
                text,
                issues,
                mapOffset: (offset: number) => offset,
            };
        }

        // 1. We will build this out fully, but we must first blank out directives
        // like :setvar and :r so they don't crash the T-SQL parser.
        // To preserve offsets perfectly for the remaining text, we replace the directive
        // line with whitespace of the exact same length.

        this.SETVAR_REGEX.lastIndex = 0;
        text = text.replace(this.SETVAR_REGEX, (match, varName, value) => {
            // Clean up surrounding quotes if present
            const cleanValue = value.replace(/^["']|["']$/g, "").trim();
            variables[varName] = cleanValue;

            // Blank out the line with exact spaces to keep 1:1 offset mapping
            return " ".repeat(match.length);
        });

        this.R_REGEX.lastIndex = 0;
        text = text.replace(this.R_REGEX, (match) => {
            // Blank out the :r line so the single-file parser never sees
            // it. Whether the include actually resolves is a workspace
            // fact this preprocessor has no business asserting — that's
            // entirely the host's responsibility (file existence, project
            // conventions, etc.), not something to flag as a parser issue.
            // Future: options.resolveInclude could inline the file text.
            return " ".repeat(match.length);
        });

        // 2. Expand $(Variables) and track offset shifts
        let prepText = "";
        const anchors: OffsetAnchor[] = [{ prep: 0, orig: 0 }];
        let lastOrigIndex = 0;
        let currentPrepIndex = 0;

        // $(Var) references inside comments are inert — the lexer discards
        // comments entirely, so substituting or warning about them would
        // only produce noisy, irrelevant diagnostics (e.g. "-- uses $(Env)
        // for staging" should never raise SQLCMD_UNKNOWN_VAR).
        const commentRanges = this.findCommentRanges(text);

        // Reset regex state
        this.VAR_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = this.VAR_REGEX.exec(text)) !== null) {
            const varName = match[1];
            const origMatchStart = match.index;
            const origMatchEnd = origMatchStart + match[0].length;

            // Append text before the match
            const textBefore = text.slice(lastOrigIndex, origMatchStart);
            prepText += textBefore;
            currentPrepIndex += textBefore.length;

            if (this.isInsideAnyRange(origMatchStart, commentRanges)) {
                // Inside a comment: leave untouched, no substitution, no diagnostic.
                prepText += match[0];
                currentPrepIndex += match[0].length;
            } else if (variables[varName] !== undefined) {
                const expandedValue = variables[varName];
                prepText += expandedValue;
                currentPrepIndex += expandedValue.length;

                // We just changed the length of the string. Add a new anchor
                // for the text immediately following the substitution.
                anchors.push({
                    prep: currentPrepIndex,
                    orig: origMatchEnd,
                });
            } else {
                // Missing variable: Leave as-is, emit diagnostic
                prepText += match[0];
                currentPrepIndex += match[0].length;

                issues.push({
                    code: "SQLCMD_UNKNOWN_VAR",
                    message: `SQLCMD variable '${varName}' is not defined.`,
                    start: origMatchStart,
                    end: origMatchEnd,
                });
            }

            lastOrigIndex = origMatchEnd;
        }

        // Append remaining text
        prepText += text.slice(lastOrigIndex);

        return {
            text: prepText,
            issues,
            mapOffset: (prepOffset: number) => {
                // Binary search or linear search for the closest preceding anchor
                let anchor = anchors[0];
                for (let i = 1; i < anchors.length; i++) {
                    if (anchors[i].prep <= prepOffset) anchor = anchors[i];
                    else break;
                }
                return anchor.orig + (prepOffset - anchor.prep);
            },
        };
    }

    // Scans for '--' line comments and (nestable) '/* */' block comments,
    // skipping over single-quoted string literals so that comment-looking
    // text inside a string (e.g. '--not a comment') is never mistaken for
    // one. Mirrors the lexer's own comment handling (see lexer.ts
    // skipWhitespaceAndComments) so the two stay consistent.
    private findCommentRanges(text: string): Array<{ start: number; end: number }> {
        const ranges: Array<{ start: number; end: number }> = [];
        const len = text.length;
        let i = 0;

        while (i < len) {
            const ch = text[i];

            if (ch === "'") {
                i++;
                while (i < len) {
                    if (text[i] === "'") {
                        if (text[i + 1] === "'") {
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    i++;
                }
                continue;
            }

            if (ch === "-" && text[i + 1] === "-") {
                const start = i;
                while (i < len && text[i] !== "\n") i++;
                ranges.push({ start, end: i });
                continue;
            }

            if (ch === "/" && text[i + 1] === "*") {
                const start = i;
                i += 2;
                let depth = 1;

                while (i < len && depth > 0) {
                    if (text[i] === "/" && text[i + 1] === "*") {
                        depth++;
                        i += 2;
                        continue;
                    }
                    if (text[i] === "*" && text[i + 1] === "/") {
                        depth--;
                        i += 2;
                        continue;
                    }
                    i++;
                }

                ranges.push({ start, end: i });
                continue;
            }

            i++;
        }

        return ranges;
    }

    private isInsideAnyRange(
        offset: number,
        ranges: Array<{ start: number; end: number }>,
    ): boolean {
        return ranges.some((r) => offset >= r.start && offset < r.end);
    }
}
