/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CatalogFetch, LanguageServiceStats, StatsExportOptions } from "./contracts.js";

/**
 * One document's statistics, prepared for copying out.
 *
 * Redaction is a transform over the published record rather than a second collection path. Two
 * paths would eventually disagree, and the moment they did the exported log would describe a
 * session that never happened -- which is worse than exporting nothing.
 *
 * What is removed is exactly the three fields the contract names as identifying: the database name,
 * the object name, and the SQL text. Everything else -- timings, row counts, outcomes, sections, and
 * the failure messages -- survives, because those are what make a report actionable and none of them
 * name a customer's schema.
 *
 * The document URI is replaced rather than dropped: a report needs to distinguish two documents,
 * and a file path is as identifying as a table name.
 */

export function exportStats(stats: LanguageServiceStats, options: StatsExportOptions = {}): string {
    return JSON.stringify(redactStats(stats, options), undefined, 2);
}

export function redactStats(
    stats: LanguageServiceStats,
    options: StatsExportOptions = {},
): LanguageServiceStats {
    if (options.includeIdentifiers) return stats;
    return {
        ...stats,
        document: { ...stats.document, uri: redactUri(stats.document.uri) },
        metadata: {
            ...stats.metadata,
            scopes: stats.metadata.scopes.map((scope) => {
                const { databaseName: _omitted, ...rest } = scope;
                return rest;
            }),
            fetches: stats.metadata.fetches.map(redactCatalogFetch),
        },
    };
}

/**
 * Strips a fetch of the three fields that identify a customer's catalog.
 *
 * `error.message` is deliberately kept. A server error can quote an object name, which is a real
 * leak, but a failure with no reason is the bug report this feature exists to prevent -- so the
 * message stays and the caller is told, rather than being silently given a log that cannot explain
 * its own failures.
 */
export function redactCatalogFetch(fetch: CatalogFetch): CatalogFetch {
    const { databaseName: _database, objectName: _object, query: _query, ...rest } = fetch;
    return rest;
}

/** Keeps the extension, which is diagnostic, and drops the path, which is not. */
function redactUri(uri: string): string {
    const extension = /\.[A-Za-z0-9]+$/u.exec(uri)?.[0] ?? "";
    return `document${extension}`;
}
