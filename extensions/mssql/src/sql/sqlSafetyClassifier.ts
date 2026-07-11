/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Production-safety SQL classifier: does this text plausibly MODIFY the
 * database? Deliberately over-broad — it gates a "you are about to modify
 * production" confirmation, so a false positive costs one extra click and a
 * false negative costs someone's data. Comments, string literals, and
 * quoted identifiers are stripped first so `SELECT 'DROP TABLE x'` and
 * `SELECT [Delete] FROM t` never trip it; EXEC counts as modifying because
 * a procedure can do anything.
 */

const MODIFYING_KEYWORDS = new RegExp(
    "\\b(" +
        [
            "INSERT",
            "UPDATE",
            "DELETE",
            "MERGE",
            "DROP",
            "ALTER",
            "CREATE",
            "TRUNCATE",
            "GRANT",
            "REVOKE",
            "DENY",
            "EXEC",
            "EXECUTE",
            "BACKUP",
            "RESTORE",
            "KILL",
            "BULK",
            "DBCC",
            "ENABLE",
            "DISABLE",
            // SELECT ... INTO creates a table; INSERT INTO double-matches.
            "INTO",
            "WRITETEXT",
            "UPDATETEXT",
            "RECONFIGURE",
            "SHUTDOWN",
        ].join("|") +
        ")\\b",
    "i",
);

/**
 * Remove the constructs whose CONTENT must never classify: line and block
 * comments (nested blocks handled), 'strings' (with '' escapes),
 * [bracketed identifiers] (with ]] escapes), and "quoted identifiers".
 */
export function stripSqlNonCode(text: string): string {
    let out = "";
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        const next = i + 1 < n ? text[i + 1] : "";
        if (c === "-" && next === "-") {
            const eol = text.indexOf("\n", i);
            i = eol < 0 ? n : eol; // keep the newline as separation
            continue;
        }
        if (c === "/" && next === "*") {
            let depth = 1;
            i += 2;
            while (i < n && depth > 0) {
                if (text[i] === "/" && text[i + 1] === "*") {
                    depth++;
                    i += 2;
                } else if (text[i] === "*" && text[i + 1] === "/") {
                    depth--;
                    i += 2;
                } else {
                    i++;
                }
            }
            out += " ";
            continue;
        }
        if (c === "'") {
            i++;
            while (i < n) {
                if (text[i] === "'" && text[i + 1] === "'") {
                    i += 2;
                } else if (text[i] === "'") {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            out += "''";
            continue;
        }
        if (c === "[") {
            i++;
            while (i < n) {
                if (text[i] === "]" && text[i + 1] === "]") {
                    i += 2;
                } else if (text[i] === "]") {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
            out += " x ";
            continue;
        }
        if (c === '"') {
            i++;
            while (i < n && text[i] !== '"') {
                i++;
            }
            i++;
            out += " x ";
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/** True when the text contains anything beyond reads (see module doc). */
export function isModifyingSql(text: string): boolean {
    return MODIFYING_KEYWORDS.test(stripSqlNonCode(text));
}
