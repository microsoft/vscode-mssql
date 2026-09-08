/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decides how a row is addressed, and says so out loud.
 *
 * The old editor made this choice silently and only surfaced it as a failure at commit time,
 * which is the worst moment to learn that a table cannot identify its own rows. The strategy is
 * computed when the session opens and carries an explanation the UI shows, so someone editing a
 * heap knows before they type that their edit matches on every column.
 */

import { ColumnMetadata, TableMetadata } from "./tableMetadata";
import { isComparableType } from "../types/typeTraits";

export type KeyStrategyKind = "primaryKey" | "uniqueIndex" | "allColumns" | "none";

export interface KeyStrategy {
    readonly kind: KeyStrategyKind;
    /** Columns that address a row, in order. Empty when nothing can. */
    readonly columns: readonly string[];
    /** Index or constraint the columns came from, when they came from one. */
    readonly source?: string;
    /** True when an edit could match more than one row and so needs a guard. */
    readonly isAmbiguous: boolean;
    /** Shown in the UI. Plain sentence, no jargon that only means something to the engine. */
    readonly explanation: string;
    /** False when the object cannot be edited at all; `explanation` says why. */
    readonly canEdit: boolean;
}

function isComparable(column: ColumnMetadata): boolean {
    return isComparableType(column.typeName);
}

export function chooseKeyStrategy(table: TableMetadata): KeyStrategy {
    const byName = new Map(table.columns.map((c) => [c.name, c]));
    const projected = (names: readonly string[]) => names.every((n) => byName.has(n));

    // A primary key is the only identity that is guaranteed unique and non-null, so it wins
    // whenever one exists and is fully projected.
    const primaryKey = table.indexes.find((i) => i.isPrimaryKey && projected(i.columns));
    if (primaryKey) {
        return {
            kind: "primaryKey",
            columns: primaryKey.columns,
            source: primaryKey.name,
            isAmbiguous: false,
            canEdit: true,
            explanation: `Rows are identified by the primary key (${primaryKey.columns.join(", ")}).`,
        };
    }

    // A unique index works as well, provided none of its columns are nullable: SQL Server lets
    // a unique index hold one null per column, so a nullable one cannot address those rows.
    const uniqueIndex = table.indexes.find(
        (i) => i.isUnique && !i.isNullable && projected(i.columns),
    );
    if (uniqueIndex) {
        return {
            kind: "uniqueIndex",
            columns: uniqueIndex.columns,
            source: uniqueIndex.name,
            isAmbiguous: false,
            canEdit: true,
            explanation: `Rows are identified by the unique index ${uniqueIndex.name} (${uniqueIndex.columns.join(", ")}).`,
        };
    }

    if (table.objectType === "view") {
        return {
            kind: "none",
            columns: [],
            isAmbiguous: true,
            canEdit: false,
            explanation:
                "This view has no unique index, so a row in it cannot be identified. Add a unique index to the view, or edit the underlying table.",
        };
    }

    // Last resort: match on every comparable column. Correct when the row is unique, and the
    // compiled statement refuses to run when it is not, so this can never hit the wrong row.
    const comparable = table.columns.filter((c) => isComparable(c) && !c.isComputed);
    if (comparable.length === 0) {
        return {
            kind: "none",
            columns: [],
            isAmbiguous: true,
            canEdit: false,
            explanation:
                "This table has no key and no comparable columns, so a row cannot be identified. Add a primary key to edit it.",
        };
    }

    return {
        kind: "allColumns",
        columns: comparable.map((c) => c.name),
        isAmbiguous: true,
        canEdit: true,
        explanation:
            "This table has no primary key or unique index, so rows are identified by all of their values. An edit that would change more than one row is refused.",
    };
}
