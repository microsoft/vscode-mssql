/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resource and latency policy for catalog-backed language features.
 *
 * These are runtime options rather than query-local constants so hosts can tune constrained
 * browser workers and very large enterprise catalogs without forking the metadata implementation.
 */
export interface MetadataRuntimeOptions {
    /** Rows per keyset-paginated identity query. */
    readonly objectPageSize: number;
    /** Maximum object identities retained for one database before reporting truncation. */
    readonly objectResultLimit: number;
    /** Maximum rows retained for one columns/parameters detail query. */
    readonly detailResultLimit: number;
    /** Inactive connection/database/profile catalog sessions retained by the host. */
    readonly catalogSessionCacheSize: number;
    /** Scripted object-definition documents retained by the host. */
    readonly definitionCacheSize: number;
    /** Schema used only when a backend does not report the connected principal's default. */
    readonly defaultSchema: string;
    /** Target wait for an interactive request that already has usable results. */
    readonly interactiveLatencyBudgetMs: number;
    /** Extended target when completion would otherwise return no items. */
    readonly emptyCompletionLatencyBudgetMs: number;
}

export const defaultMetadataRuntimeOptions: MetadataRuntimeOptions = Object.freeze({
    objectPageSize: 20_000,
    objectResultLimit: 250_000,
    detailResultLimit: 50_000,
    catalogSessionCacheSize: 8,
    definitionCacheSize: 32,
    defaultSchema: "dbo",
    interactiveLatencyBudgetMs: 1_000,
    emptyCompletionLatencyBudgetMs: 5_000,
});

export function resolveMetadataRuntimeOptions(
    overrides: Partial<MetadataRuntimeOptions> = {},
): MetadataRuntimeOptions {
    const resolved = { ...defaultMetadataRuntimeOptions, ...overrides };
    for (const key of [
        "objectPageSize",
        "objectResultLimit",
        "detailResultLimit",
        "catalogSessionCacheSize",
        "definitionCacheSize",
        "interactiveLatencyBudgetMs",
        "emptyCompletionLatencyBudgetMs",
    ] as const) {
        const value = resolved[key];
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new RangeError(
                `Invalid metadata runtime option '${key}': expected a positive integer.`,
            );
        }
    }
    if (resolved.defaultSchema.trim().length === 0) {
        throw new RangeError("Invalid metadata runtime option 'defaultSchema': expected a name.");
    }
    return Object.freeze(resolved);
}
