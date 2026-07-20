/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, bounded recognition of repository-owned tSQLt tests. Discovery is
 * deliberately separate from execution: finding a stored procedure never
 * grants authority to invoke it against a database.
 */

export const MAX_DISCOVERED_SQL_TESTS = 1000;
const MAX_DISCOVERED_TEST_CLASSES = 1000;

export interface RepositorySqlTestSource {
    relativePath: string;
    text: string;
}

export interface DiscoveredRepositorySqlTest {
    framework: "tSQLt";
    suite: string;
    name: string;
    relativePath: string;
    line: number;
}

export interface RepositorySqlTestAnalysis {
    tests: DiscoveredRepositorySqlTest[];
    tSqltClassCount: number;
    tSqltSourceFileCount: number;
    duplicateDefinitionCount: number;
    truncated: boolean;
}

const SQL_IDENTIFIER = String.raw`(?:\[(?:[^\]]|\]\])+\]|"(?:[^"]|"")+"|[A-Za-z_@#][A-Za-z0-9_@$#]*)`;
const PROCEDURE_PATTERN = new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+(${SQL_IDENTIFIER})\s*\.\s*(${SQL_IDENTIFIER})`,
    "gi",
);
const NEW_TEST_CLASS_PATTERN =
    /(?:\bEXEC(?:UTE)?\s+)?(?:\[tSQLt\]|tSQLt)\s*\.\s*(?:\[NewTestClass\]|NewTestClass)\s+(?:@ClassName\s*=\s*)?N?'((?:''|[^'])+)'/gi;
const TSQLT_REFERENCE_PATTERN = /(?:\[tSQLt\]|tSQLt)\s*\.\s*(?:\[|[A-Za-z_])/i;

export function analyzeRepositorySqlTests(
    sources: readonly RepositorySqlTestSource[],
): RepositorySqlTestAnalysis {
    const orderedSources = [...sources]
        .map((source) => ({
            relativePath: normalizeRelativePath(source.relativePath),
            text: source.text,
        }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const declaredClasses = new Map<string, string>();
    let truncated = false;
    for (const source of orderedSources) {
        const commentFree = maskSql(source.text, false);
        for (const match of commentFree.matchAll(NEW_TEST_CLASS_PATTERN)) {
            const className = match[1].replace(/''/g, "'").trim();
            if (!className) {
                continue;
            }
            const key = className.toLocaleLowerCase();
            if (!declaredClasses.has(key)) {
                if (declaredClasses.size >= MAX_DISCOVERED_TEST_CLASSES) {
                    truncated = true;
                    continue;
                }
                declaredClasses.set(key, className);
            }
        }
    }

    const testsByIdentity = new Map<string, DiscoveredRepositorySqlTest>();
    const tSqltSourceFiles = new Set<string>();
    const observedSuites = new Map<string, string>(declaredClasses);
    let duplicateDefinitionCount = 0;
    for (const source of orderedSources) {
        const commentFree = maskSql(source.text, false);
        const procedureText = maskSql(source.text, true);
        const referencesTsqlt = TSQLT_REFERENCE_PATTERN.test(commentFree);
        for (const match of procedureText.matchAll(PROCEDURE_PATTERN)) {
            const suite = unquoteIdentifier(match[1]);
            const name = unquoteIdentifier(match[2]);
            const suiteKey = suite.toLocaleLowerCase();
            if (
                !/^test/i.test(name) ||
                suiteKey === "tsqlt" ||
                (!referencesTsqlt && !declaredClasses.has(suiteKey))
            ) {
                continue;
            }
            const identity = `${suiteKey}.${name.toLocaleLowerCase()}`;
            if (testsByIdentity.has(identity)) {
                duplicateDefinitionCount++;
                continue;
            }
            if (testsByIdentity.size >= MAX_DISCOVERED_SQL_TESTS) {
                truncated = true;
                continue;
            }
            testsByIdentity.set(identity, {
                framework: "tSQLt",
                suite,
                name,
                relativePath: source.relativePath,
                line: lineAt(source.text, match.index ?? 0),
            });
            tSqltSourceFiles.add(source.relativePath);
            if (!observedSuites.has(suiteKey)) {
                if (observedSuites.size >= MAX_DISCOVERED_TEST_CLASSES) {
                    truncated = true;
                } else {
                    observedSuites.set(suiteKey, suite);
                }
            }
        }
    }
    return {
        tests: [...testsByIdentity.values()].sort(
            (left, right) =>
                left.suite.localeCompare(right.suite) ||
                left.name.localeCompare(right.name) ||
                left.relativePath.localeCompare(right.relativePath) ||
                left.line - right.line,
        ),
        tSqltClassCount: observedSuites.size,
        tSqltSourceFileCount: tSqltSourceFiles.size,
        duplicateDefinitionCount,
        truncated,
    };
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function unquoteIdentifier(identifier: string): string {
    if (identifier.startsWith("[") && identifier.endsWith("]")) {
        return identifier.slice(1, -1).replace(/\]\]/g, "]");
    }
    if (identifier.startsWith('"') && identifier.endsWith('"')) {
        return identifier.slice(1, -1).replace(/""/g, '"');
    }
    return identifier;
}

function lineAt(text: string, index: number): number {
    let line = 1;
    for (let position = text.indexOf("\n"); position >= 0 && position < index; ) {
        line++;
        position = text.indexOf("\n", position + 1);
    }
    return line;
}

/** Replace comments and, optionally, string literals with spaces while
 * preserving offsets/newlines used for source locations. */
function maskSql(text: string, maskStrings: boolean): string {
    const result = text.split("");
    let index = 0;
    let state: "normal" | "lineComment" | "blockComment" | "string" = "normal";
    while (index < text.length) {
        const current = text[index];
        const next = text[index + 1];
        if (state === "lineComment") {
            if (current === "\n") {
                state = "normal";
            } else {
                result[index] = " ";
            }
            index++;
            continue;
        }
        if (state === "blockComment") {
            if (current === "*" && next === "/") {
                result[index] = result[index + 1] = " ";
                index += 2;
                state = "normal";
                continue;
            }
            if (current !== "\n" && current !== "\r") {
                result[index] = " ";
            }
            index++;
            continue;
        }
        if (state === "string") {
            if (maskStrings && current !== "\n" && current !== "\r") {
                result[index] = " ";
            }
            if (current === "'" && next === "'") {
                if (maskStrings) {
                    result[index + 1] = " ";
                }
                index += 2;
                continue;
            }
            if (current === "'") {
                state = "normal";
            }
            index++;
            continue;
        }
        if (current === "-" && next === "-") {
            result[index] = result[index + 1] = " ";
            index += 2;
            state = "lineComment";
        } else if (current === "/" && next === "*") {
            result[index] = result[index + 1] = " ";
            index += 2;
            state = "blockComment";
        } else if (current === "'") {
            if (maskStrings) {
                result[index] = " ";
            }
            index++;
            state = "string";
        } else {
            index++;
        }
    }
    return result.join("");
}
