/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Closed STS v2 projection and migration-scope convergence policy.
 *
 * The query reads catalog metadata only. The comparator checks every table
 * touched by the reviewed migration against the corresponding base/head EF
 * model. It deliberately does not claim whole-database convergence until a
 * base DACPAC/model has been materialized in the rehearsal environment.
 */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";
import type {
    LocalEfRelationalColumn,
    LocalEfRelationalForeignKey,
    LocalEfRelationalIndex,
    LocalEfRelationalKey,
    LocalEfRelationalModel,
    LocalEfRelationalTable,
} from "./localEfRelationalModel";
import type { LocalEfMigrationManifest } from "./localEfMigrationGenerator";

export const MAX_LOCAL_EF_SCHEMA_ROWS = 20_000;
export const MAX_LOCAL_EF_CONVERGENCE_DIFFERENCES = 500;

export const LOCAL_EF_SCHEMA_SCOPE_SQL = `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

WITH schema_rows AS (
    SELECT
        CAST(N'environment' AS nvarchar(32)) AS row_kind,
        CAST(N'' AS nvarchar(128)) AS schema_name,
        CAST(N'' AS nvarchar(128)) AS table_name,
        CAST(N'' AS nvarchar(128)) AS object_name,
        CAST(0 AS int) AS ordinal,
        CONVERT(nvarchar(4000), CASE WHEN CHARINDEX(N'_CS_', CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))) > 0 THEN 1 ELSE 0 END) AS d1,
        CONVERT(nvarchar(4000), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS d2,
        CAST(NULL AS nvarchar(4000)) AS d3,
        CAST(NULL AS nvarchar(4000)) AS d4,
        CAST(NULL AS nvarchar(4000)) AS d5,
        CAST(NULL AS nvarchar(4000)) AS d6,
        CAST(NULL AS nvarchar(4000)) AS d7,
        CAST(NULL AS nvarchar(4000)) AS d8,
        CAST(NULL AS nvarchar(4000)) AS d9,
        CAST(NULL AS nvarchar(4000)) AS d10,
        CAST(NULL AS nvarchar(4000)) AS d11,
        CAST(NULL AS nvarchar(4000)) AS d12
    UNION ALL
    SELECT N'table', SCHEMA_NAME(t.schema_id), t.name, t.name, 0,
        CONVERT(nvarchar(4000), CASE WHEN t.temporal_type <> 0 THEN 1 ELSE 0 END),
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sys.tables AS t
    WHERE t.is_ms_shipped = 0
    UNION ALL
    SELECT N'column', SCHEMA_NAME(t.schema_id), t.name, c.name, c.column_id,
        CONVERT(nvarchar(4000), ty.name),
        CONVERT(nvarchar(4000), c.max_length),
        CONVERT(nvarchar(4000), c.precision),
        CONVERT(nvarchar(4000), c.scale),
        CONVERT(nvarchar(4000), c.is_nullable),
        CONVERT(nvarchar(4000), c.is_identity),
        CONVERT(nvarchar(4000), ic.seed_value),
        CONVERT(nvarchar(4000), ic.increment_value),
        CONVERT(nvarchar(4000), c.is_computed),
        CONVERT(nvarchar(4000), CASE WHEN dc.object_id IS NULL THEN 0 ELSE 1 END),
        CONVERT(nvarchar(4000), c.collation_name),
        NULL
    FROM sys.tables AS t
    INNER JOIN sys.columns AS c ON c.object_id = t.object_id
    INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.identity_columns AS ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    LEFT JOIN sys.default_constraints AS dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
    WHERE t.is_ms_shipped = 0
    UNION ALL
    SELECT N'key', SCHEMA_NAME(t.schema_id), t.name, kc.name, ic.key_ordinal,
        CONVERT(nvarchar(4000), CASE kc.type WHEN 'PK' THEN N'primaryKey' ELSE N'uniqueConstraint' END),
        CONVERT(nvarchar(4000), c.name),
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sys.tables AS t
    INNER JOIN sys.key_constraints AS kc ON kc.parent_object_id = t.object_id
    INNER JOIN sys.index_columns AS ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id AND ic.key_ordinal > 0
    INNER JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.is_ms_shipped = 0
    UNION ALL
    SELECT N'index', SCHEMA_NAME(t.schema_id), t.name, i.name, CASE WHEN ic.is_included_column = 1 THEN 10000 + ic.index_column_id ELSE ic.key_ordinal END,
        CONVERT(nvarchar(4000), c.name),
        CONVERT(nvarchar(4000), i.is_unique),
        CONVERT(nvarchar(4000), ic.is_included_column),
        CONVERT(nvarchar(4000), i.filter_definition),
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sys.tables AS t
    INNER JOIN sys.indexes AS i ON i.object_id = t.object_id
    INNER JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND (ic.key_ordinal > 0 OR ic.is_included_column = 1)
    INNER JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.is_ms_shipped = 0 AND i.is_hypothetical = 0 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
    UNION ALL
    SELECT N'foreignKey', SCHEMA_NAME(pt.schema_id), pt.name, fk.name, fkc.constraint_column_id,
        CONVERT(nvarchar(4000), pc.name),
        CONVERT(nvarchar(4000), SCHEMA_NAME(rt.schema_id)),
        CONVERT(nvarchar(4000), rt.name),
        CONVERT(nvarchar(4000), rc.name),
        CONVERT(nvarchar(4000), fk.delete_referential_action_desc),
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sys.foreign_keys AS fk
    INNER JOIN sys.tables AS pt ON pt.object_id = fk.parent_object_id
    INNER JOIN sys.tables AS rt ON rt.object_id = fk.referenced_object_id
    INNER JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
    INNER JOIN sys.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
    INNER JOIN sys.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
    WHERE pt.is_ms_shipped = 0
    UNION ALL
    SELECT N'check', SCHEMA_NAME(t.schema_id), t.name, cc.name, 0,
        CONVERT(nvarchar(4000), CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varchar(max), cc.definition COLLATE Latin1_General_100_BIN2_UTF8)), 2)),
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM sys.check_constraints AS cc
    INNER JOIN sys.tables AS t ON t.object_id = cc.parent_object_id
    WHERE t.is_ms_shipped = 0
)
SELECT row_kind, schema_name, table_name, object_name, ordinal,
       d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12
FROM schema_rows
ORDER BY row_kind, schema_name, table_name, object_name, ordinal;
`;

interface LiveColumn {
    name: string;
    storeType: string;
    nullable: boolean;
    identity: boolean;
    identitySeed?: number;
    identityIncrement?: number;
    computed: boolean;
    hasDefault: boolean;
    collation?: string;
}

interface LiveIndex {
    name: string;
    columns: string[];
    includedColumns: string[];
    unique: boolean;
    notNullFilterColumns?: string[];
    unsupportedFilter: boolean;
}

interface LiveForeignKey extends LocalEfRelationalForeignKey {}

interface LiveTable {
    schema: string;
    name: string;
    temporal: boolean;
    columns: LiveColumn[];
    primaryKey?: LocalEfRelationalKey;
    uniqueConstraints: LocalEfRelationalKey[];
    indexes: LiveIndex[];
    foreignKeys: LiveForeignKey[];
    checks: Array<{ name: string; sqlSha256: string }>;
}

export interface LocalEfLiveSchema {
    caseSensitive: boolean;
    collation?: string;
    tables: LiveTable[];
}

export interface LocalEfConvergenceDifference {
    kind: "missing" | "unexpected" | "changed";
    objectType:
        | "table"
        | "column"
        | "primaryKey"
        | "uniqueConstraint"
        | "index"
        | "foreignKey"
        | "check";
    path: string;
    property: string;
    expected: string;
    actual: string;
}

export interface LocalEfMigrationConvergenceResult {
    schemaVersion: 1;
    expectedState: "head" | "base";
    expectedModelSha256: string;
    manifestSha256: string;
    scopeTableCount: number;
    checkedObjectCount: number;
    differenceCount: number;
    differences: LocalEfConvergenceDifference[];
    differencesTruncated: boolean;
    complete: boolean;
    converged: boolean;
    comparisonSha256: string;
    verifiedAtUtc: string;
}

export class LocalEfMigrationConvergenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LocalEfMigrationConvergenceError";
    }
}

export function projectLocalEfLiveSchema(rows: unknown[][]): LocalEfLiveSchema {
    if (rows.length === 0 || rows.length > MAX_LOCAL_EF_SCHEMA_ROWS) {
        invalid("The live schema projection is empty or exceeds the bounded row limit.");
    }
    const environment = rows.filter((row) => text(row[0]) === "environment");
    if (environment.length !== 1) {
        invalid("The live schema projection must contain one environment row.");
    }
    const caseSensitive = bool(environment[0][5]);
    const collation = optionalText(environment[0][6]);
    const tables = new Map<string, LiveTable>();
    const tableFor = (row: unknown[]): LiveTable => {
        const schema = name(row[1], "schema");
        const tableName = name(row[2], "table");
        const key = folded(`${schema}\0${tableName}`, caseSensitive);
        const table = tables.get(key);
        if (!table) {
            invalid(`Schema metadata referenced absent table '${schema}.${tableName}'.`);
        }
        return table;
    };
    for (const row of rows) {
        if (text(row[0]) !== "table") {
            continue;
        }
        const schema = name(row[1], "schema");
        const tableName = name(row[2], "table");
        const key = folded(`${schema}\0${tableName}`, caseSensitive);
        if (tables.has(key)) {
            invalid(`The live schema contains duplicate table '${schema}.${tableName}'.`);
        }
        tables.set(key, {
            schema,
            name: tableName,
            temporal: bool(row[5]),
            columns: [],
            uniqueConstraints: [],
            indexes: [],
            foreignKeys: [],
            checks: [],
        });
    }
    const keyParts = new Map<
        string,
        { table: LiveTable; name: string; kind: string; values: Array<[number, string]> }
    >();
    const indexParts = new Map<
        string,
        {
            table: LiveTable;
            name: string;
            unique: boolean;
            filter?: string;
            values: Array<[number, string, boolean]>;
        }
    >();
    const foreignKeyParts = new Map<
        string,
        {
            table: LiveTable;
            name: string;
            principalSchema: string;
            principalTable: string;
            onDelete: string;
            values: Array<[number, string, string]>;
        }
    >();
    for (const row of rows) {
        const kind = text(row[0]);
        if (kind === "environment" || kind === "table") {
            continue;
        }
        const table = tableFor(row);
        const objectName = name(row[3], `${kind} name`);
        const ordinal = integer(row[4], "ordinal");
        const objectKey = folded(`${table.schema}\0${table.name}\0${objectName}`, caseSensitive);
        if (kind === "column") {
            table.columns.push({
                name: objectName,
                storeType: liveStoreType(
                    name(row[5], "type"),
                    integer(row[6], "max length"),
                    integer(row[7], "precision"),
                    integer(row[8], "scale"),
                ),
                nullable: bool(row[9]),
                identity: bool(row[10]),
                identitySeed: optionalNumber(row[11]),
                identityIncrement: optionalNumber(row[12]),
                computed: bool(row[13]),
                hasDefault: bool(row[14]),
                collation: optionalText(row[15]),
            });
        } else if (kind === "key") {
            const keyKind = text(row[5]);
            if (keyKind !== "primaryKey" && keyKind !== "uniqueConstraint") {
                invalid("The live schema returned an unsupported key kind.");
            }
            const part = keyParts.get(objectKey) ?? {
                table,
                name: objectName,
                kind: keyKind,
                values: [],
            };
            if (part.kind !== keyKind) {
                invalid(`Key '${objectName}' changed kind inside one projection.`);
            }
            part.values.push([ordinal, name(row[6], "key column")]);
            keyParts.set(objectKey, part);
        } else if (kind === "index") {
            const part = indexParts.get(objectKey) ?? {
                table,
                name: objectName,
                unique: bool(row[6]),
                filter: optionalText(row[8]),
                values: [],
            };
            part.values.push([ordinal, name(row[5], "index column"), bool(row[7])]);
            indexParts.set(objectKey, part);
        } else if (kind === "foreignKey") {
            const part = foreignKeyParts.get(objectKey) ?? {
                table,
                name: objectName,
                principalSchema: name(row[6], "principal schema"),
                principalTable: name(row[7], "principal table"),
                onDelete: name(row[9], "delete action"),
                values: [],
            };
            part.values.push([
                ordinal,
                name(row[5], "foreign key column"),
                name(row[8], "principal column"),
            ]);
            foreignKeyParts.set(objectKey, part);
        } else if (kind === "check") {
            table.checks.push({ name: objectName, sqlSha256: sha256Text(row[5]) });
        } else {
            invalid(`The live schema returned unsupported row kind '${kind}'.`);
        }
    }
    for (const part of keyParts.values()) {
        const value = {
            name: part.name,
            columns: ordered(part.values).map((item) => item[1]),
        };
        if (part.kind === "primaryKey") {
            if (part.table.primaryKey) {
                invalid(
                    `Table '${part.table.schema}.${part.table.name}' has multiple primary keys.`,
                );
            }
            part.table.primaryKey = value;
        } else {
            part.table.uniqueConstraints.push(value);
        }
    }
    for (const part of indexParts.values()) {
        const values = ordered(part.values);
        const filter = projectNotNullFilter(part.filter);
        part.table.indexes.push({
            name: part.name,
            columns: values.filter((item) => !item[2]).map((item) => item[1]),
            includedColumns: values.filter((item) => item[2]).map((item) => item[1]),
            unique: part.unique,
            notNullFilterColumns: filter.columns,
            unsupportedFilter: filter.unsupported,
        });
    }
    for (const part of foreignKeyParts.values()) {
        const values = ordered(part.values);
        part.table.foreignKeys.push({
            name: part.name,
            columns: values.map((item) => item[1]),
            principalSchema: part.principalSchema,
            principalTable: part.principalTable,
            principalColumns: values.map((item) => item[2]),
            onDelete: part.onDelete,
        });
    }
    const sorted = [...tables.values()].sort((a, b) => tablePath(a).localeCompare(tablePath(b)));
    for (const table of sorted) {
        table.columns.sort((a, b) => a.name.localeCompare(b.name));
        table.uniqueConstraints.sort(namedCompare);
        table.indexes.sort(namedCompare);
        table.foreignKeys.sort(namedCompare);
        table.checks.sort(namedCompare);
    }
    return { caseSensitive, collation, tables: sorted };
}

export function verifyLocalEfMigrationScope(input: {
    expectedState: "head" | "base";
    expected: LocalEfRelationalModel;
    manifest: LocalEfMigrationManifest;
    live: LocalEfLiveSchema;
    now?: () => Date;
}): LocalEfMigrationConvergenceResult {
    const expectedDigest =
        input.expectedState === "head"
            ? input.manifest.headModelSha256
            : input.manifest.baseModelSha256;
    if (input.expected.modelSha256 !== expectedDigest) {
        invalid("The expected model does not match the reviewed migration manifest.");
    }
    const scope = migrationScope(input.manifest);
    if (scope.length === 0) {
        invalid("The reviewed migration has no table scope to verify.");
    }
    const differences: LocalEfConvergenceDifference[] = [];
    let checkedObjectCount = 0;
    for (const scopePath of scope) {
        const parts = parseBracketPath(scopePath);
        if (parts.length < 2) {
            invalid(`Migration scope path '${scopePath}' is invalid.`);
        }
        const expected = findTable(
            input.expected.tables,
            parts[0],
            parts[1],
            input.live.caseSensitive,
        );
        const actual = findTable(input.live.tables, parts[0], parts[1], input.live.caseSensitive);
        checkedObjectCount += objectCount(expected) + objectCount(actual);
        if (!expected && !actual) {
            continue;
        }
        compareTable(expected, actual, input.live.caseSensitive, differences);
    }
    differences.sort((a, b) =>
        `${a.path}\0${a.objectType}\0${a.property}\0${a.kind}`.localeCompare(
            `${b.path}\0${b.objectType}\0${b.property}\0${b.kind}`,
        ),
    );
    const differenceCount = differences.length;
    const projected = differences.slice(0, MAX_LOCAL_EF_CONVERGENCE_DIFFERENCES);
    const facts = {
        expectedState: input.expectedState,
        expectedModelSha256: input.expected.modelSha256,
        manifestSha256: input.manifest.manifestSha256,
        scopeTableCount: scope.length,
        checkedObjectCount,
        differenceCount,
        differences: projected,
        differencesTruncated: differenceCount > projected.length,
        complete: true,
        converged: differenceCount === 0,
    };
    return {
        schemaVersion: 1,
        ...facts,
        comparisonSha256: crypto
            .createHash("sha256")
            .update(canonicalRunbookJson(facts), "utf8")
            .digest("hex"),
        verifiedAtUtc: (input.now ?? (() => new Date()))().toISOString(),
    };
}

function compareTable(
    expected: LocalEfRelationalTable | undefined,
    actual: LiveTable | undefined,
    caseSensitive: boolean,
    differences: LocalEfConvergenceDifference[],
): void {
    const path = tablePath(expected ?? actual!);
    if (!expected || !actual) {
        differences.push({
            kind: expected ? "missing" : "unexpected",
            objectType: "table",
            path,
            property: "existence",
            expected: expected ? "present" : "absent",
            actual: actual ? "present" : "absent",
        });
        return;
    }
    changed(differences, "table", path, "temporal", expected.temporal, actual.temporal);
    compareNamedCollection(
        expected.columns,
        actual.columns,
        caseSensitive,
        "column",
        path,
        differences,
        compareColumn,
    );
    compareOptionalKey(
        expected.primaryKey,
        actual.primaryKey,
        caseSensitive,
        "primaryKey",
        path,
        differences,
    );
    compareNamedCollection(
        expected.uniqueConstraints,
        actual.uniqueConstraints,
        caseSensitive,
        "uniqueConstraint",
        path,
        differences,
        (left, right, itemPath, output) => compareKey(left, right, itemPath, output, caseSensitive),
    );
    compareNamedCollection(
        expected.indexes,
        actual.indexes,
        caseSensitive,
        "index",
        path,
        differences,
        (left, right, itemPath, output) =>
            compareIndex(left, right, itemPath, output, caseSensitive),
    );
    compareNamedCollection(
        expected.foreignKeys,
        actual.foreignKeys,
        caseSensitive,
        "foreignKey",
        path,
        differences,
        (left, right, itemPath, output) =>
            compareForeignKey(left, right, itemPath, output, caseSensitive),
    );
    compareNamedCollection(
        expected.checks,
        actual.checks,
        caseSensitive,
        "check",
        path,
        differences,
        (left, right, itemPath, output) => {
            changed(
                output,
                "check",
                itemPath,
                "sqlSha256",
                left.sqlSha256.toLowerCase(),
                right.sqlSha256.toLowerCase(),
            );
        },
    );
}

function compareColumn(
    expected: LocalEfRelationalColumn,
    actual: LiveColumn,
    path: string,
    differences: LocalEfConvergenceDifference[],
): void {
    changed(
        differences,
        "column",
        path,
        "storeType",
        normalizeStoreType(expected.storeType),
        normalizeStoreType(actual.storeType),
    );
    changed(differences, "column", path, "nullable", expected.nullable, actual.nullable);
    changed(differences, "column", path, "identity", expected.identity, actual.identity);
    if (expected.identity && actual.identity) {
        changed(
            differences,
            "column",
            path,
            "identitySeed",
            expected.identitySeed ?? 1,
            actual.identitySeed ?? 1,
        );
        changed(
            differences,
            "column",
            path,
            "identityIncrement",
            expected.identityIncrement ?? 1,
            actual.identityIncrement ?? 1,
        );
    }
    changed(differences, "column", path, "computed", expected.computed, actual.computed);
    changed(
        differences,
        "column",
        path,
        "default",
        (expected.defaultKind ?? "none") !== "none",
        actual.hasDefault,
    );
    if (expected.collation) {
        changed(
            differences,
            "column",
            path,
            "collation",
            expected.collation.toLowerCase(),
            (actual.collation ?? "").toLowerCase(),
        );
    }
}

function compareKey(
    expected: LocalEfRelationalKey,
    actual: LocalEfRelationalKey,
    path: string,
    differences: LocalEfConvergenceDifference[],
    caseSensitive: boolean,
): void {
    changed(
        differences,
        "uniqueConstraint",
        path,
        "columns",
        identities(expected.columns, caseSensitive),
        identities(actual.columns, caseSensitive),
    );
}

function compareIndex(
    expected: LocalEfRelationalIndex,
    actual: LiveIndex,
    path: string,
    differences: LocalEfConvergenceDifference[],
    caseSensitive: boolean,
): void {
    changed(
        differences,
        "index",
        path,
        "columns",
        identities(expected.columns, caseSensitive),
        identities(actual.columns, caseSensitive),
    );
    changed(differences, "index", path, "includedColumns", [], actual.includedColumns);
    changed(differences, "index", path, "unique", expected.unique, actual.unique);
    changed(differences, "index", path, "filterSupported", true, !actual.unsupportedFilter);
    changed(
        differences,
        "index",
        path,
        "notNullFilterColumns",
        identities(expected.notNullFilterColumns ?? [], caseSensitive),
        identities(actual.notNullFilterColumns ?? [], caseSensitive),
    );
}

function compareForeignKey(
    expected: LocalEfRelationalForeignKey,
    actual: LiveForeignKey,
    path: string,
    differences: LocalEfConvergenceDifference[],
    caseSensitive: boolean,
): void {
    changed(
        differences,
        "foreignKey",
        path,
        "columns",
        identities(expected.columns, caseSensitive),
        identities(actual.columns, caseSensitive),
    );
    changed(
        differences,
        "foreignKey",
        path,
        "principalSchema",
        folded(expected.principalSchema, caseSensitive),
        folded(actual.principalSchema, caseSensitive),
    );
    changed(
        differences,
        "foreignKey",
        path,
        "principalTable",
        folded(expected.principalTable, caseSensitive),
        folded(actual.principalTable, caseSensitive),
    );
    changed(
        differences,
        "foreignKey",
        path,
        "principalColumns",
        identities(expected.principalColumns, caseSensitive),
        identities(actual.principalColumns, caseSensitive),
    );
    changed(
        differences,
        "foreignKey",
        path,
        "onDelete",
        normalizeDeleteAction(expected.onDelete),
        normalizeDeleteAction(actual.onDelete),
    );
}

function compareOptionalKey(
    expected: LocalEfRelationalKey | undefined,
    actual: LocalEfRelationalKey | undefined,
    caseSensitive: boolean,
    objectType: "primaryKey",
    table: string,
    differences: LocalEfConvergenceDifference[],
): void {
    if (!expected || !actual) {
        if (expected !== actual) {
            differences.push({
                kind: expected ? "missing" : "unexpected",
                objectType,
                path: `${table}.${quote((expected ?? actual!).name)}`,
                property: "existence",
                expected: expected ? "present" : "absent",
                actual: actual ? "present" : "absent",
            });
        }
        return;
    }
    const path = `${table}.${quote(expected.name)}`;
    changed(
        differences,
        objectType,
        path,
        "name",
        folded(expected.name, caseSensitive),
        folded(actual.name, caseSensitive),
    );
    changed(
        differences,
        objectType,
        path,
        "columns",
        identities(expected.columns, caseSensitive),
        identities(actual.columns, caseSensitive),
    );
}

function compareNamedCollection<L extends { name: string }, R extends { name: string }>(
    expected: readonly L[],
    actual: readonly R[],
    caseSensitive: boolean,
    objectType: Exclude<LocalEfConvergenceDifference["objectType"], "table" | "primaryKey">,
    table: string,
    differences: LocalEfConvergenceDifference[],
    compare: (left: L, right: R, path: string, output: LocalEfConvergenceDifference[]) => void,
): void {
    const expectedMap = new Map(expected.map((item) => [folded(item.name, caseSensitive), item]));
    const actualMap = new Map(actual.map((item) => [folded(item.name, caseSensitive), item]));
    for (const key of new Set([...expectedMap.keys(), ...actualMap.keys()])) {
        const left = expectedMap.get(key);
        const right = actualMap.get(key);
        const itemPath = `${table}.${quote((left ?? right!).name)}`;
        if (!left || !right) {
            differences.push({
                kind: left ? "missing" : "unexpected",
                objectType,
                path: itemPath,
                property: "existence",
                expected: left ? "present" : "absent",
                actual: right ? "present" : "absent",
            });
        } else {
            compare(left, right, itemPath, differences);
        }
    }
}

function migrationScope(manifest: LocalEfMigrationManifest): string[] {
    const scope = new Set<string>();
    const add = (path: string) => {
        const parts = parseBracketPath(path);
        if (parts.length >= 2) {
            scope.add(`${quote(parts[0])}.${quote(parts[1])}`);
        }
    };
    manifest.operations.forEach((operation) => add(operation.path));
    manifest.renameDecisions.forEach((decision) => {
        add(decision.fromPath);
        add(decision.toPath);
    });
    return [...scope].sort();
}

function liveStoreType(type: string, maxLength: number, precision: number, scale: number): string {
    const lower = type.toLowerCase();
    if (["nvarchar", "nchar"].includes(lower)) {
        return `${lower}(${maxLength === -1 ? "max" : maxLength / 2})`;
    }
    if (["varchar", "char", "varbinary", "binary"].includes(lower)) {
        return `${lower}(${maxLength === -1 ? "max" : maxLength})`;
    }
    if (["decimal", "numeric"].includes(lower)) {
        return `${lower}(${precision},${scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(lower) && scale !== 7) {
        return `${lower}(${scale})`;
    }
    return lower;
}

function normalizeStoreType(value: string): string {
    return value
        .toLowerCase()
        .replace(/\s+/gu, "")
        .replace(/^(numeric)\(/u, "decimal(");
}

function projectNotNullFilter(value: string | undefined): {
    columns?: string[];
    unsupported: boolean;
} {
    if (!value) {
        return { unsupported: false };
    }
    const normalized = value.replace(/[()]/gu, " ").trim();
    const columns: string[] = [];
    for (const part of normalized.split(/\s+AND\s+/iu)) {
        const match = /^\s*\[((?:[^\]]|\]\])+)\]\s+IS\s+NOT\s+NULL\s*$/iu.exec(part);
        if (!match) {
            return { unsupported: true };
        }
        columns.push(match[1].replace(/\]\]/gu, "]"));
    }
    return { columns, unsupported: false };
}

function parseBracketPath(value: string): string[] {
    const parts: string[] = [];
    const expression = /\[((?:[^\]]|\]\])*)\]/gu;
    let match: RegExpExecArray | null;
    let last = 0;
    while ((match = expression.exec(value))) {
        if (!/^[.\s]*$/u.test(value.slice(last, match.index))) {
            return [];
        }
        parts.push(match[1].replace(/\]\]/gu, "]"));
        last = expression.lastIndex;
    }
    return /^[.\s]*$/u.test(value.slice(last)) ? parts : [];
}

function findTable<T extends { schema: string; name: string }>(
    tables: readonly T[],
    schema: string,
    nameValue: string,
    caseSensitive: boolean,
): T | undefined {
    const identity = folded(`${schema}\0${nameValue}`, caseSensitive);
    return tables.find(
        (table) => folded(`${table.schema}\0${table.name}`, caseSensitive) === identity,
    );
}

function objectCount(table: LocalEfRelationalTable | LiveTable | undefined): number {
    if (!table) {
        return 0;
    }
    return (
        1 +
        table.columns.length +
        (table.primaryKey ? 1 : 0) +
        table.uniqueConstraints.length +
        table.indexes.length +
        table.foreignKeys.length +
        table.checks.length
    );
}

function changed(
    differences: LocalEfConvergenceDifference[],
    objectType: LocalEfConvergenceDifference["objectType"],
    path: string,
    property: string,
    expected: unknown,
    actual: unknown,
): void {
    const left = display(expected);
    const right = display(actual);
    if (left !== right) {
        differences.push({
            kind: "changed",
            objectType,
            path,
            property,
            expected: left,
            actual: right,
        });
    }
}

function display(value: unknown): string {
    const result = Array.isArray(value) ? value.join(", ") : String(value);
    return result.length > 512 ? `${result.slice(0, 511)}…` : result;
}

function normalizeDeleteAction(value: string): string {
    const normalized = value.toLowerCase().replace(/[_\s]/gu, "");
    return normalized === "restrict" ? "noaction" : normalized;
}

function folded(value: string, caseSensitive: boolean): string {
    return caseSensitive ? value : value.toLowerCase();
}

function identities(values: readonly string[], caseSensitive: boolean): string[] {
    return values.map((value) => folded(value, caseSensitive));
}

function quote(value: string): string {
    return `[${value.replace(/\]/gu, "]]")}]`;
}

function tablePath(table: { schema: string; name: string }): string {
    return `${quote(table.schema)}.${quote(table.name)}`;
}

function namedCompare(left: { name: string }, right: { name: string }): number {
    return left.name.localeCompare(right.name);
}

function ordered<T extends [number, ...unknown[]]>(values: T[]): T[] {
    return [...values].sort((left, right) => left[0] - right[0]);
}

function text(value: unknown): string {
    if (typeof value !== "string") {
        invalid("The live schema projection contains a non-text field.");
    }
    return value;
}

function optionalText(value: unknown): string | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    return text(value);
}

function name(value: unknown, label: string): string {
    const result = text(value).trim();
    if (result.length === 0 || result.length > 128 || /[\u0000-\u001f\u007f]/u.test(result)) {
        invalid(`The live schema ${label} is invalid.`);
    }
    return result;
}

function integer(value: unknown, label: string): number {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) {
        invalid(`The live schema ${label} is invalid.`);
    }
    return result;
}

function optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const result = Number(value);
    if (!Number.isFinite(result)) {
        invalid("The live schema contains an invalid numeric field.");
    }
    return result;
}

function bool(value: unknown): boolean {
    if (value === true || value === 1 || value === "1" || value === "true") {
        return true;
    }
    if (value === false || value === 0 || value === "0" || value === "false") {
        return false;
    }
    invalid("The live schema contains an invalid Boolean field.");
}

function sha256Text(value: unknown): string {
    const result = text(value).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(result)) {
        invalid("The live schema contains an invalid SHA-256 value.");
    }
    return result;
}

function invalid(message: string): never {
    throw new LocalEfMigrationConvergenceError(message);
}
