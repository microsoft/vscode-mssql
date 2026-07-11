/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The two shipped scan rules (SQLCMD_MODE_PLAN.md §3.4). Deliberately a thin
 * module: the framework is the product here — future rules plug in beside
 * these, they don't grow this file into a rules engine.
 *
 * Both sample the first 50 lines (the ask). Detection is conservative and
 * string/comment-aware where it matters: `::` casts are NOT sqlcmd, a `\`
 * inside a T-SQL string is NOT psql.
 */

import { scanLine } from "../sql/batchSplitter";
import { SQLCMD_DIRECTIVE_HEADS } from "../sql/sqlcmdPreprocessor";
import { ScanRule } from "./scanDetect";

const HEAD_LINES = 50;

export interface SqlcmdDetection {
    /** Count of directive lines seen in the sample. */
    directives: number;
    /** 0-based line of the first directive (for diagnostics counts only). */
    firstLine: number;
}

/**
 * SQLCMD rule: a line starting (in lexer region "code") with `:` whose head
 * token is a known sqlcmd command — functional or recognized-but-rejected;
 * a file full of :out/:exit is still a sqlcmd file.
 */
export const sqlcmdDetectRule: ScanRule<SqlcmdDetection> = {
    id: "sqlcmd",
    sampling: { kind: "headLines", lines: HEAD_LINES },
    detect(sample) {
        let state = { region: "code", blockDepth: 0 } as ReturnType<typeof scanLine>;
        let directives = 0;
        let firstLine = -1;
        for (let i = 0; i < sample.lines.length; i++) {
            const line = sample.lines[i];
            if (state.region === "code") {
                const match = /^\s*:(!!|[A-Za-z]+)/.exec(line);
                if (
                    match &&
                    (match[1] === "!!" || SQLCMD_DIRECTIVE_HEADS.has(match[1].toLowerCase()))
                ) {
                    directives++;
                    if (firstLine < 0) {
                        firstLine = i;
                    }
                    continue; // directive lines don't feed region tracking
                }
            }
            state = scanLine(line, state);
        }
        return directives > 0 ? { directives, firstLine } : undefined;
    },
};

export interface PsqlDetection {
    /** Count of strong Postgres signals in the sample. */
    signals: number;
}

/** psql meta-commands that basically never open a T-SQL line. */
const PSQL_META =
    /^\s*\\(c|cd|conninfo|copy|d[a-zA-Z]*|echo|i|ir|l|list|pset|q|set|timing|unset|watch|x)\b/;
/** Strong lexical Postgres signals. */
const PSQL_SYNTAX = [
    /\bCREATE\s+EXTENSION\b/i,
    /\bplpgsql\b/i,
    /\$\$/, // dollar-quoted bodies
    /\bRETURNS\s+\w+\s+AS\s+\$/i,
];

/**
 * PSQL rule: backslash meta-commands at line start (outside strings/
 * comments) or strong Postgres syntax. One meta-command OR two syntax
 * signals — a lone `$$` in a T-SQL script shouldn't kill diagnostics.
 */
export const psqlDetectRule: ScanRule<PsqlDetection> = {
    id: "psql",
    sampling: { kind: "headLines", lines: HEAD_LINES },
    detect(sample) {
        let state = { region: "code", blockDepth: 0 } as ReturnType<typeof scanLine>;
        let metaCommands = 0;
        let syntaxSignals = 0;
        for (const line of sample.lines) {
            if (state.region === "code") {
                if (PSQL_META.test(line)) {
                    metaCommands++;
                    continue;
                }
                for (const pattern of PSQL_SYNTAX) {
                    if (pattern.test(line)) {
                        syntaxSignals++;
                        break;
                    }
                }
            }
            state = scanLine(line, state);
        }
        const signals = metaCommands * 2 + syntaxSignals;
        return metaCommands >= 1 || syntaxSignals >= 2 ? { signals } : undefined;
    },
};

/** The shipped rule set, in evaluation order. */
export const QUERY_STUDIO_SCAN_RULES = [sqlcmdDetectRule, psqlDetectRule] as const;
