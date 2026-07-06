/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LARGE-CATALOG fixture generator (B16 scale tests): deterministic FakeBackend
 * transcripts that answer the MetadataService H0–H7 hydration queries plus the
 * CHECKSUM_AGG digest, sized to stress the TypeScript metadata stack (10k
 * tables, 80k+ columns, a 1000-column wide table, chained FK pairs) without a
 * real server. Fully deterministic: fixed names ("s0"..; "T000001"..;
 * "C01"..), object_ids sequential from 101, no randomness, no clock reads —
 * the same spec always produces byte-identical transcripts. Large result sets
 * page at 512 rows so the backpressured paging path is exercised.
 *
 * Matcher-order lessons (B15): the H4 (is_primary_key) and H5B
 * (foreign_key_columns) scripts are listed BEFORE the H3 sys.columns script —
 * their SQL also contains the substring "sys.columns". Likewise the digest
 * (CHECKSUM_AGG) script is listed BEFORE the H2 script — the digest SQL also
 * contains "FROM sys.objects o WHERE". H7 (extended_properties) collides with
 * nothing: it uses COL_NAME() instead of a sys.columns join by design.
 *
 * H4 rows are emitted in the 5-column extended shape (object_id, name,
 * index_name, is_primary_key, is_unique_constraint): the current parser reads
 * only indexes 0/1, so the extra columns are harmless today and already match
 * the extended key query.
 *
 * Object id layout (sequential from 101):
 *   tables            101 .. 100+tables          (schema round-robin "s0"..)
 *   dbo.WideTable     101+tables                 (when wideTable is enabled)
 *   procedures        next `procedures` ids      (schema round-robin "s0"..)
 *   FK constraints    next `foreignKeys` ids     (FK k: table k → table k+1)
 * Schema ids: 1.."schemas" are "s0".."s{n-1}"; when the wide table is enabled
 * an extra schema "dbo" is appended (id schemas+1) — expectedCounts includes
 * it.
 */

import { FakeScript } from "../../../src/services/sqlDataPlane/fakeBackend";

export interface LargeCatalogSpec {
    /** User schemas "s0".."s{n-1}" (default 10). */
    schemas?: number;
    /** Tables "T000001".. spread round-robin across schemas (default 10_000). */
    tables?: number;
    /** Columns "C01".. per regular table (default 8). */
    columnsPerTable?: number;
    /**
     * One extra table "dbo.WideTable" (adds the "dbo" schema); pass undefined
     * explicitly to disable. Default { columns: 1000 }.
     */
    wideTable?: { columns: number } | undefined;
    /** Procedures "P000001".., 3 int params each (default 200). */
    procedures?: number;
    /**
     * Chained FK pairs between consecutive tables (FK k: table k → table
     * k+1), one column pair each (default 2000; clamped to tables-1).
     */
    foreignKeys?: number;
}

type Row = (string | number | boolean | null)[];

/** Rows per page on every fixture result set — large sets exercise paging. */
const PAGE_SIZE = 512;
/** First catalog object_id; ids run sequentially from here (see layout above). */
const FIRST_OBJECT_ID = 101;
/** Fixed modify_date — determinism over realism. */
const MODIFY_DATE = "2026-01-01T00:00:00";
const PARAMS_PER_PROCEDURE = 3;

interface ResolvedSpec {
    schemas: number;
    tables: number;
    columnsPerTable: number;
    wideTable: { columns: number } | undefined;
    procedures: number;
    /** Clamped chain length (at most tables-1 consecutive pairs exist). */
    foreignKeys: number;
}

function resolveSpec(spec: LargeCatalogSpec = {}): ResolvedSpec {
    const tables = spec.tables ?? 10_000;
    return {
        schemas: spec.schemas ?? 10,
        tables,
        columnsPerTable: spec.columnsPerTable ?? 8,
        // "wideTable" in spec distinguishes explicit undefined (disable) from omitted (default)
        wideTable: "wideTable" in spec ? spec.wideTable : { columns: 1000 },
        procedures: spec.procedures ?? 200,
        foreignKeys: Math.max(0, Math.min(spec.foreignKeys ?? 2_000, tables - 1)),
    };
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");
const tableName = (i: number): string => `T${pad(i + 1, 6)}`;
const procedureName = (j: number): string => `P${pad(j + 1, 6)}`;
/** "C01".."C08" for 8 columns; "C0001".."C1000" for the 1000-column wide table. */
const columnName = (ordinal: number, count: number): string =>
    `C${pad(ordinal, Math.max(2, String(count).length))}`;

const wideTableId = (s: ResolvedSpec): number => FIRST_OBJECT_ID + s.tables;
const procedureId = (s: ResolvedSpec, j: number): number =>
    FIRST_OBJECT_ID + s.tables + (s.wideTable ? 1 : 0) + j;
const objectCount = (s: ResolvedSpec): number => s.tables + (s.wideTable ? 1 : 0) + s.procedures;
const constraintId = (s: ResolvedSpec, k: number): number => FIRST_OBJECT_ID + objectCount(s) + k;

// --- H-series row builders (each ordered exactly like the real query) --------

/** H1: sys.schemas ordered by schema_id. */
function schemaRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    for (let i = 0; i < s.schemas; i++) {
        rows.push([i + 1, `s${i}`]);
    }
    if (s.wideTable) {
        rows.push([s.schemas + 1, "dbo"]);
    }
    return rows;
}

/** H2: sys.objects ordered by object_id (tables, wide table, procedures). */
function objectRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    for (let i = 0; i < s.tables; i++) {
        rows.push([FIRST_OBJECT_ID + i, (i % s.schemas) + 1, tableName(i), "U", MODIFY_DATE]);
    }
    if (s.wideTable) {
        rows.push([wideTableId(s), s.schemas + 1, "WideTable", "U", MODIFY_DATE]);
    }
    for (let j = 0; j < s.procedures; j++) {
        rows.push([procedureId(s, j), (j % s.schemas) + 1, procedureName(j), "P", MODIFY_DATE]);
    }
    return rows;
}

/** H3: sys.columns ordered by object_id, column_id (int columns throughout). */
function columnRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    const pushColumns = (objectId: number, count: number): void => {
        for (let c = 1; c <= count; c++) {
            // int: max_length 4, precision 10, scale 0 → typeDisplay "int"
            rows.push([objectId, c, columnName(c, count), "int", 4, 10, 0, false, false, false]);
        }
    };
    for (let i = 0; i < s.tables; i++) {
        pushColumns(FIRST_OBJECT_ID + i, s.columnsPerTable);
    }
    if (s.wideTable) {
        pushColumns(wideTableId(s), s.wideTable.columns);
    }
    return rows;
}

/** H4: one PK (first column) per table, 5-column extended shape (see header). */
function keyRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    if (s.columnsPerTable > 0) {
        for (let i = 0; i < s.tables; i++) {
            rows.push([
                FIRST_OBJECT_ID + i,
                columnName(1, s.columnsPerTable),
                `PK_${tableName(i)}`,
                true,
                false,
            ]);
        }
    }
    if (s.wideTable && s.wideTable.columns > 0) {
        rows.push([
            wideTableId(s),
            columnName(1, s.wideTable.columns),
            "PK_WideTable",
            true,
            false,
        ]);
    }
    return rows;
}

/** H5: sys.foreign_keys ordered by constraint object_id (table k → table k+1). */
function foreignKeyRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    for (let k = 0; k < s.foreignKeys; k++) {
        rows.push([
            constraintId(s, k),
            `FK${pad(k + 1, 6)}`,
            FIRST_OBJECT_ID + k,
            FIRST_OBJECT_ID + k + 1,
        ]);
    }
    return rows;
}

/** H5B: sys.foreign_key_columns — one first-column pair per FK. */
function foreignKeyColumnRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    const column = columnName(1, s.columnsPerTable);
    for (let k = 0; k < s.foreignKeys; k++) {
        rows.push([constraintId(s, k), column, column]);
    }
    return rows;
}

/** H6: sys.parameters ordered by object_id, parameter_id (3 int params each). */
function parameterRows(s: ResolvedSpec): Row[] {
    const rows: Row[] = [];
    for (let j = 0; j < s.procedures; j++) {
        for (let p = 1; p <= PARAMS_PER_PROCEDURE; p++) {
            rows.push([procedureId(s, j), p, `@p${p}`, "int", 4, 10, 0, false]);
        }
    }
    return rows;
}

// --- public API ---------------------------------------------------------------

function script(match: (text: string) => boolean, columns: string[], rows: Row[]): FakeScript {
    return {
        match,
        events: [
            { type: "resultSet", columns, rows, pageSize: PAGE_SIZE },
            { type: "complete", status: "succeeded" },
        ],
    };
}

/**
 * FakeBackend scripts answering the full H0–H7 + digest hydration sequence
 * for the specced catalog. Matcher order is load-bearing — see file header.
 */
export function largeCatalogScripts(spec?: LargeCatalogSpec): FakeScript[] {
    const s = resolveSpec(spec);
    return [
        // H0 environment probe
        script(
            (t) => t.includes("SERVERPROPERTY"),
            ["engine_edition", "default_schema", "collation_name"],
            [[5, "dbo", "SQL_Latin1_General_CP1_CI_AS"]],
        ),
        // H4 primary keys — BEFORE H3 (its SQL also contains "sys.columns")
        script(
            (t) => t.includes("is_primary_key"),
            ["object_id", "name", "index_name", "is_primary_key", "is_unique_constraint"],
            keyRows(s),
        ),
        // H5B FK column pairs — BEFORE H3 (its SQL also contains "sys.columns")
        script(
            (t) => t.includes("foreign_key_columns"),
            ["constraint_object_id", "parent_column", "referenced_column"],
            foreignKeyColumnRows(s),
        ),
        // digest — BEFORE H2 (its SQL also contains "FROM sys.objects o WHERE")
        script(
            (t) => t.includes("CHECKSUM_AGG"),
            ["object_count", "object_hash"],
            [[objectCount(s), 424242]],
        ),
        // H6 routine parameters
        script(
            (t) => t.includes("sys.parameters"),
            [
                "object_id",
                "parameter_id",
                "name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_output",
            ],
            parameterRows(s),
        ),
        // H7 descriptions — empty but SUCCEEDED (a missing script would fail
        // the section and drop the hydration mode to "partial")
        script(
            (t) => t.includes("extended_properties"),
            ["major_id", "minor_id", "column_name", "description"],
            [],
        ),
        // H1 schemas
        script((t) => t.includes("sys.schemas"), ["schema_id", "name"], schemaRows(s)),
        // H2 objects
        script(
            (t) => t.includes("FROM sys.objects o WHERE"),
            ["object_id", "schema_id", "name", "type", "modify_date"],
            objectRows(s),
        ),
        // H3 columns
        script(
            (t) => t.includes("sys.columns"),
            [
                "object_id",
                "column_id",
                "name",
                "type_name",
                "max_length",
                "precision",
                "scale",
                "is_nullable",
                "is_identity",
                "is_computed",
            ],
            columnRows(s),
        ),
        // H5 FK edges
        script(
            (t) => t.includes("sys.foreign_keys"),
            ["object_id", "name", "parent_object_id", "referenced_object_id"],
            foreignKeyRows(s),
        ),
    ];
}

/** The stats a full hydration of the specced catalog must report. */
export function expectedCounts(spec?: LargeCatalogSpec): {
    schemas: number;
    objects: number;
    columns: number;
    foreignKeys: number;
} {
    const s = resolveSpec(spec);
    return {
        schemas: s.schemas + (s.wideTable ? 1 : 0),
        objects: objectCount(s),
        columns: s.tables * s.columnsPerTable + (s.wideTable ? s.wideTable.columns : 0),
        foreignKeys: s.foreignKeys,
    };
}
