/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conservative, regex-based extraction of the single table target of a
 * `SELECT ... FROM [schema.]table [WHERE ...]` statement. Returns `undefined`
 * for anything that isn't unambiguously a single real table (JOIN, UNION,
 * subquery, CTE, comma-join, multiple statements, non-SELECT) -- a wrong
 * guess is worse than the `UnknownTable` fallback it feeds.
 */
export function parseSingleTableFromClause(
    queryText: string,
): { tableName: string; schemaName?: string } | undefined {
    const stripped = stripSqlNoise(queryText);

    const statements = stripped.split(";").filter((s) => s.trim().length > 0);
    if (statements.length !== 1) {
        return undefined;
    }

    const trimmed = stripped.trim();
    if (!/^select\b/i.test(trimmed)) {
        return undefined;
    }

    if (/\bjoin\b/i.test(stripped) || /\bunion\b/i.test(stripped)) {
        return undefined;
    }

    const fromMatches = stripped.match(/\bfrom\b/gi);
    if (!fromMatches || fromMatches.length !== 1) {
        return undefined;
    }

    const fromClauseMatch = stripped.match(
        /\bfrom\b([\s\S]*?)(?:\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\boption\b|$)/i,
    );
    if (!fromClauseMatch) {
        return undefined;
    }

    const clause = fromClauseMatch[1].trim();
    if (clause.includes("(") || clause.includes(",") || clause.length === 0) {
        return undefined;
    }

    const identifierPattern = /\[[^\]]+\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*/;
    const leadingIdentifiersPattern = new RegExp(
        `^(?:${identifierPattern.source})(?:\\.(?:${identifierPattern.source})){0,2}`,
    );
    const identifierChain = clause.match(leadingIdentifiersPattern)?.[0];
    if (!identifierChain) {
        return undefined;
    }

    const parts = identifierChain.match(new RegExp(identifierPattern.source, "g")) ?? [];
    if (parts.length === 0) {
        return undefined;
    }

    const unquote = (part: string): string => {
        if (part.startsWith("[") && part.endsWith("]")) {
            return part.slice(1, -1);
        }
        if (part.startsWith('"') && part.endsWith('"')) {
            return part.slice(1, -1);
        }
        return part;
    };

    const tableName = unquote(parts[parts.length - 1]);
    const schemaName = parts.length >= 2 ? unquote(parts[parts.length - 2]) : undefined;
    return { tableName, schemaName };
}

function stripSqlNoise(queryText: string): string {
    return queryText
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/--[^\n\r]*/g, " ")
        .replace(/'(?:[^']|'')*'/g, " ");
}
