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
 * a non-identifying failure code -- survives. Server error messages are free-form and commonly
 * echo object names or SQL fragments, so a default export replaces them with a fixed summary.
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
 * The error code survives because it is actionable and non-identifying. The free-form message does
 * not: SQL Server frequently includes an object name or query fragment in it.
 */
export function redactCatalogFetch(fetch: CatalogFetch): CatalogFetch {
    const { databaseName: _database, objectName: _object, query: _query, ...rest } = fetch;
    return fetch.error
        ? {
              ...rest,
              error: {
                  message: "Server metadata request failed.",
                  ...(fetch.error.code === undefined ? {} : { code: fetch.error.code }),
              },
          }
        : rest;
}

/** Keeps the extension, which is diagnostic, and drops the path, which is not. */
function redactUri(uri: string): string {
    const extension = /\.[A-Za-z0-9]+$/u.exec(uri)?.[0] ?? "";
    return `document${extension}`;
}
