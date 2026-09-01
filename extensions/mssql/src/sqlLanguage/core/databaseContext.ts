/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-statement database context map (design 05 §4.4, §6.1 core/databaseContext).
 * `USE db` switches the effective database for every FOLLOWING statement in
 * document order (USE persists across GO). Diagnostics use this to suppress
 * binder claims for statements whose effective database is not the hydrated
 * one; completions use it for the same honesty when qualifying names.
 */

import { SketchedStatement } from "./overlay";

export interface DatabaseContextMap {
    /**
     * Effective database name for the statement at a global ordinal, or
     * undefined when no USE preceded it (session default database applies).
     */
    effectiveDatabaseAt(ordinal: number): string | undefined;
    /** True when any USE statement occurs in the document. */
    readonly hasUse: boolean;
}

export function buildDatabaseContext(statements: readonly SketchedStatement[]): DatabaseContextMap {
    // Sparse switch list: [ordinal after which the database applies, name].
    const switches: { fromOrdinal: number; database: string }[] = [];
    for (const { ordinal, sketch } of statements) {
        if (sketch.kind === "use" && sketch.useDatabase !== undefined) {
            switches.push({ fromOrdinal: ordinal + 1, database: sketch.useDatabase });
        }
    }
    return {
        hasUse: switches.length > 0,
        effectiveDatabaseAt(ordinal: number): string | undefined {
            let current: string | undefined;
            for (const entry of switches) {
                if (entry.fromOrdinal > ordinal) {
                    break;
                }
                current = entry.database;
            }
            return current;
        },
    };
}
