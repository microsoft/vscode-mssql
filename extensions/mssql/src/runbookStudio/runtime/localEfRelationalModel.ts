/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral EF relational model and semantic comparison core.
 *
 * This module does not load or execute repository code. The separately
 * approval-governed exact-ref provider produces this closed manifest and
 * passes it through `createLocalEfRelationalModel`; comparison stays a pure
 * operation over two host-owned same-run values.
 */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";

export const LOCAL_EF_RELATIONAL_MODEL_SCHEMA_VERSION = 1 as const;
export const LOCAL_EF_RELATIONAL_DIFF_SCHEMA_VERSION = 1 as const;

const MAX_TABLES = 2_000;
const MAX_COLUMNS_PER_TABLE = 1_000;
const MAX_NAMED_OBJECTS_PER_TABLE = 2_000;
const MAX_UNSUPPORTED_FACTS = 1_000;
const MAX_RENAME_CANDIDATES = 100;

export interface LocalEfRelationalColumn {
    name: string;
    storeType: string;
    nullable: boolean;
    identity: boolean;
    computed: boolean;
    maxLength?: number;
    precision?: number;
    scale?: number;
    defaultKind?: "none" | "constant" | "sql";
    collation?: string;
}

export interface LocalEfRelationalKey {
    name: string;
    columns: string[];
}

export interface LocalEfRelationalIndex extends LocalEfRelationalKey {
    unique: boolean;
    filterSha256?: string;
}

export interface LocalEfRelationalForeignKey extends LocalEfRelationalKey {
    principalSchema: string;
    principalTable: string;
    principalColumns: string[];
    onDelete: string;
}

export interface LocalEfRelationalCheck {
    name: string;
    sqlSha256: string;
}

export interface LocalEfRelationalTable {
    schema: string;
    name: string;
    columns: LocalEfRelationalColumn[];
    primaryKey?: LocalEfRelationalKey;
    uniqueConstraints: LocalEfRelationalKey[];
    indexes: LocalEfRelationalIndex[];
    foreignKeys: LocalEfRelationalForeignKey[];
    checks: LocalEfRelationalCheck[];
    temporal: boolean;
}

export interface LocalEfRelationalModelInput {
    provider: { name: string; version: string };
    source: {
        commit: string;
        projectPath: string;
        dbContext: string;
        targetFramework: string;
        sourceSnapshotSha256: string;
        toolchainSha256: string;
    };
    complete: boolean;
    unsupported: Array<{ scope: string; name: string; reason: string }>;
    tables: LocalEfRelationalTable[];
}

export interface LocalEfRelationalModel extends LocalEfRelationalModelInput {
    schemaVersion: typeof LOCAL_EF_RELATIONAL_MODEL_SCHEMA_VERSION;
    modelSha256: string;
}

export type LocalEfRelationalChangeKind =
    | "addTable"
    | "dropTable"
    | "addColumn"
    | "dropColumn"
    | "alterColumn"
    | "addPrimaryKey"
    | "dropPrimaryKey"
    | "alterPrimaryKey"
    | "addUniqueConstraint"
    | "dropUniqueConstraint"
    | "alterUniqueConstraint"
    | "addIndex"
    | "dropIndex"
    | "alterIndex"
    | "addForeignKey"
    | "dropForeignKey"
    | "alterForeignKey"
    | "addCheck"
    | "dropCheck"
    | "alterCheck"
    | "alterTemporal";

export interface LocalEfRelationalChange {
    kind: LocalEfRelationalChangeKind;
    objectType:
        | "table"
        | "column"
        | "primaryKey"
        | "uniqueConstraint"
        | "index"
        | "foreignKey"
        | "check";
    path: string;
    risk: "safe" | "review" | "destructive";
    changedProperties: string[];
}

export interface LocalEfRenameCandidate {
    objectType: "table" | "column";
    fromPath: string;
    toPath: string;
    similarity: number;
}

export interface LocalEfRelationalDiff {
    schemaVersion: typeof LOCAL_EF_RELATIONAL_DIFF_SCHEMA_VERSION;
    comparable: boolean;
    reason: "comparable" | "incompleteModel" | "providerChanged" | "projectChanged";
    baseModelSha256: string;
    headModelSha256: string;
    changes: LocalEfRelationalChange[];
    renameCandidates: LocalEfRenameCandidate[];
    changeCounts: Record<string, number>;
    destructiveChangeCount: number;
    reviewChangeCount: number;
    requiresRenameDecision: boolean;
    potentialDataLoss: boolean;
    diffSha256: string;
}

export function createLocalEfRelationalModel(
    input: LocalEfRelationalModelInput,
): LocalEfRelationalModel {
    validateModelHeader(input);
    if (input.tables.length > MAX_TABLES || input.unsupported.length > MAX_UNSUPPORTED_FACTS) {
        throw new Error("Entity Framework relational model exceeds the bounded manifest limits");
    }
    const tables = input.tables.map(normalizeTable).sort(compareTable);
    assertUnique(tables, (table) => tablePath(table), "table");
    const tableByPath = new Map(tables.map((table) => [tablePath(table), table]));
    for (const table of tables) {
        const columns = new Set(table.columns.map((column) => column.name));
        validateKeyColumns(table.primaryKey, columns, `${tablePath(table)} primary key`);
        for (const key of table.uniqueConstraints) {
            validateKeyColumns(key, columns, `${tablePath(table)} unique constraint`);
        }
        for (const index of table.indexes) {
            validateKeyColumns(index, columns, `${tablePath(table)} index`);
        }
        for (const foreignKey of table.foreignKeys) {
            validateKeyColumns(foreignKey, columns, `${tablePath(table)} foreign key`);
            if (foreignKey.principalColumns.length !== foreignKey.columns.length) {
                throw new Error(`Foreign key '${foreignKey.name}' has mismatched column counts`);
            }
            const principal = tableByPath.get(
                identifierPath(foreignKey.principalSchema, foreignKey.principalTable),
            );
            if (!principal) {
                throw new Error(`Foreign key '${foreignKey.name}' references an absent table`);
            }
            const principalColumns = new Set(principal.columns.map((column) => column.name));
            if (foreignKey.principalColumns.some((column) => !principalColumns.has(column))) {
                throw new Error(
                    `Foreign key '${foreignKey.name}' references an absent principal column`,
                );
            }
        }
    }
    const normalized: LocalEfRelationalModelInput = {
        provider: {
            name: boundedText(input.provider.name, "provider name"),
            version: boundedText(input.provider.version, "provider version"),
        },
        source: {
            commit: input.source.commit.toLowerCase(),
            projectPath: safeRelativePath(input.source.projectPath),
            dbContext: boundedText(input.source.dbContext, "DbContext"),
            targetFramework: boundedText(input.source.targetFramework, "target framework"),
            sourceSnapshotSha256: sha256(input.source.sourceSnapshotSha256, "source snapshot"),
            toolchainSha256: sha256(input.source.toolchainSha256, "toolchain"),
        },
        complete: input.complete,
        unsupported: input.unsupported
            .map((fact) => ({
                scope: boundedText(fact.scope, "unsupported scope"),
                name: boundedText(fact.name, "unsupported name"),
                reason: boundedText(fact.reason, "unsupported reason", 1_000),
            }))
            .sort((left, right) =>
                canonicalRunbookJson(left).localeCompare(canonicalRunbookJson(right)),
            ),
        tables,
    };
    const modelSha256 = digest(normalized);
    return {
        schemaVersion: LOCAL_EF_RELATIONAL_MODEL_SCHEMA_VERSION,
        ...normalized,
        modelSha256,
    };
}

export function compareLocalEfRelationalModels(
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): LocalEfRelationalDiff {
    const reason = comparisonReason(base, head);
    if (reason !== "comparable") {
        return finalizeDiff(base, head, reason, [], []);
    }
    const changes: LocalEfRelationalChange[] = [];
    const renameCandidates: LocalEfRenameCandidate[] = [];
    const baseTables = new Map(base.tables.map((table) => [tablePath(table), table]));
    const headTables = new Map(head.tables.map((table) => [tablePath(table), table]));
    const droppedTables = [...baseTables.entries()].filter(([key]) => !headTables.has(key));
    const addedTables = [...headTables.entries()].filter(([key]) => !baseTables.has(key));
    for (const [key] of droppedTables) {
        changes.push(change("dropTable", "table", key, "destructive"));
    }
    for (const [key] of addedTables) {
        changes.push(change("addTable", "table", key, "safe"));
    }
    for (const [fromPath, before] of droppedTables) {
        for (const [toPath, after] of addedTables) {
            const similarity = tableSimilarity(before, after);
            if (similarity >= 0.75 && renameCandidates.length < MAX_RENAME_CANDIDATES) {
                renameCandidates.push({ objectType: "table", fromPath, toPath, similarity });
            }
        }
    }
    for (const [key, before] of baseTables) {
        const after = headTables.get(key);
        if (!after) {
            continue;
        }
        compareTableContents(before, after, changes, renameCandidates);
    }
    return finalizeDiff(base, head, reason, changes, renameCandidates);
}

function compareTableContents(
    before: LocalEfRelationalTable,
    after: LocalEfRelationalTable,
    changes: LocalEfRelationalChange[],
    renameCandidates: LocalEfRenameCandidate[],
): void {
    const parent = tablePath(before);
    const beforeColumns = new Map(before.columns.map((column) => [column.name, column]));
    const afterColumns = new Map(after.columns.map((column) => [column.name, column]));
    const droppedColumns = [...beforeColumns.entries()].filter(([name]) => !afterColumns.has(name));
    const addedColumns = [...afterColumns.entries()].filter(([name]) => !beforeColumns.has(name));
    for (const [name] of droppedColumns) {
        changes.push(change("dropColumn", "column", `${parent}.${quote(name)}`, "destructive"));
    }
    for (const [name, column] of addedColumns) {
        changes.push(
            change(
                "addColumn",
                "column",
                `${parent}.${quote(name)}`,
                column.nullable || column.defaultKind !== "none" ? "safe" : "review",
            ),
        );
    }
    for (const [fromName, fromColumn] of droppedColumns) {
        for (const [toName, toColumn] of addedColumns) {
            const similarity = columnSimilarity(fromColumn, toColumn);
            if (similarity >= 0.85 && renameCandidates.length < MAX_RENAME_CANDIDATES) {
                renameCandidates.push({
                    objectType: "column",
                    fromPath: `${parent}.${quote(fromName)}`,
                    toPath: `${parent}.${quote(toName)}`,
                    similarity,
                });
            }
        }
    }
    for (const [name, oldColumn] of beforeColumns) {
        const newColumn = afterColumns.get(name);
        if (!newColumn) {
            continue;
        }
        const changedProperties = differingProperties(oldColumn, newColumn);
        if (changedProperties.length > 0) {
            changes.push({
                ...change(
                    "alterColumn",
                    "column",
                    `${parent}.${quote(name)}`,
                    columnAlterRisk(oldColumn, newColumn),
                ),
                changedProperties,
            });
        }
    }
    compareOptionalNamedObject(parent, "primaryKey", before.primaryKey, after.primaryKey, changes);
    compareNamedObjects(
        parent,
        "uniqueConstraint",
        before.uniqueConstraints,
        after.uniqueConstraints,
        changes,
    );
    compareNamedObjects(parent, "index", before.indexes, after.indexes, changes);
    compareNamedObjects(parent, "foreignKey", before.foreignKeys, after.foreignKeys, changes);
    compareNamedObjects(parent, "check", before.checks, after.checks, changes);
    if (before.temporal !== after.temporal) {
        changes.push(change("alterTemporal", "table", parent, "review", ["temporal"]));
    }
}

type NamedObjectType = "uniqueConstraint" | "index" | "foreignKey" | "check";

function compareNamedObjects<T extends { name: string }>(
    parent: string,
    objectType: NamedObjectType,
    before: readonly T[],
    after: readonly T[],
    changes: LocalEfRelationalChange[],
): void {
    const oldObjects = new Map(before.map((item) => [item.name, item]));
    const newObjects = new Map(after.map((item) => [item.name, item]));
    const title = objectType === "uniqueConstraint" ? "UniqueConstraint" : capitalize(objectType);
    for (const [name, oldValue] of oldObjects) {
        const newValue = newObjects.get(name);
        if (!newValue) {
            changes.push(
                change(
                    `drop${title}` as LocalEfRelationalChangeKind,
                    objectType,
                    `${parent}.${quote(name)}`,
                    objectType === "index" ? "safe" : "review",
                ),
            );
        } else if (canonicalRunbookJson(oldValue) !== canonicalRunbookJson(newValue)) {
            changes.push(
                change(
                    `alter${title}` as LocalEfRelationalChangeKind,
                    objectType,
                    `${parent}.${quote(name)}`,
                    "review",
                    differingProperties(oldValue, newValue),
                ),
            );
        }
    }
    for (const [name] of newObjects) {
        if (!oldObjects.has(name)) {
            changes.push(
                change(
                    `add${title}` as LocalEfRelationalChangeKind,
                    objectType,
                    `${parent}.${quote(name)}`,
                    "safe",
                ),
            );
        }
    }
}

function compareOptionalNamedObject(
    parent: string,
    objectType: "primaryKey",
    before: LocalEfRelationalKey | undefined,
    after: LocalEfRelationalKey | undefined,
    changes: LocalEfRelationalChange[],
): void {
    const path = `${parent}.${quote(after?.name ?? before?.name ?? "PRIMARY")}`;
    if (before && !after) {
        changes.push(change("dropPrimaryKey", objectType, path, "review"));
    } else if (!before && after) {
        changes.push(change("addPrimaryKey", objectType, path, "safe"));
    } else if (before && after && canonicalRunbookJson(before) !== canonicalRunbookJson(after)) {
        changes.push(
            change(
                "alterPrimaryKey",
                objectType,
                path,
                "review",
                differingProperties(before, after),
            ),
        );
    }
}

function finalizeDiff(
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
    reason: LocalEfRelationalDiff["reason"],
    changes: LocalEfRelationalChange[],
    renameCandidates: LocalEfRenameCandidate[],
): LocalEfRelationalDiff {
    changes.sort((left, right) =>
        `${left.path}\0${left.kind}`.localeCompare(`${right.path}\0${right.kind}`),
    );
    renameCandidates.sort((left, right) =>
        `${left.fromPath}\0${left.toPath}`.localeCompare(`${right.fromPath}\0${right.toPath}`),
    );
    const changeCounts: Record<string, number> = {};
    for (const item of changes) {
        changeCounts[item.kind] = (changeCounts[item.kind] ?? 0) + 1;
    }
    const destructiveChangeCount = changes.filter((item) => item.risk === "destructive").length;
    const reviewChangeCount = changes.filter((item) => item.risk === "review").length;
    const facts = {
        comparable: reason === "comparable",
        reason,
        baseModelSha256: base.modelSha256,
        headModelSha256: head.modelSha256,
        changes,
        renameCandidates,
        changeCounts,
        destructiveChangeCount,
        reviewChangeCount,
        requiresRenameDecision: renameCandidates.length > 0,
        potentialDataLoss:
            destructiveChangeCount > 0 ||
            changes.some(
                (item) =>
                    item.kind === "alterColumn" &&
                    item.changedProperties.some((property) =>
                        [
                            "storeType",
                            "nullable",
                            "maxLength",
                            "precision",
                            "scale",
                            "identity",
                            "computed",
                        ].includes(property),
                    ),
            ),
    };
    return {
        schemaVersion: LOCAL_EF_RELATIONAL_DIFF_SCHEMA_VERSION,
        ...facts,
        diffSha256: digest(facts),
    };
}

function comparisonReason(
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): LocalEfRelationalDiff["reason"] {
    if (
        !base.complete ||
        !head.complete ||
        base.unsupported.length > 0 ||
        head.unsupported.length > 0
    ) {
        return "incompleteModel";
    }
    if (
        base.provider.name !== head.provider.name ||
        base.provider.version !== head.provider.version ||
        base.source.targetFramework !== head.source.targetFramework ||
        base.source.toolchainSha256 !== head.source.toolchainSha256
    ) {
        return "providerChanged";
    }
    if (
        base.source.projectPath !== head.source.projectPath ||
        base.source.dbContext !== head.source.dbContext
    ) {
        return "projectChanged";
    }
    return "comparable";
}

function normalizeTable(table: LocalEfRelationalTable): LocalEfRelationalTable {
    if (typeof table.temporal !== "boolean") {
        throw new Error(`Table '${table.name}' has an invalid temporal flag`);
    }
    if (
        table.columns.length > MAX_COLUMNS_PER_TABLE ||
        table.uniqueConstraints.length > MAX_NAMED_OBJECTS_PER_TABLE ||
        table.indexes.length > MAX_NAMED_OBJECTS_PER_TABLE ||
        table.foreignKeys.length > MAX_NAMED_OBJECTS_PER_TABLE ||
        table.checks.length > MAX_NAMED_OBJECTS_PER_TABLE
    ) {
        throw new Error(`Table '${table.name}' exceeds the bounded manifest limits`);
    }
    const columns = table.columns
        .map((column) => {
            if (
                typeof column.nullable !== "boolean" ||
                typeof column.identity !== "boolean" ||
                typeof column.computed !== "boolean" ||
                (column.defaultKind !== undefined &&
                    !["none", "constant", "sql"].includes(column.defaultKind))
            ) {
                throw new Error(`Column '${column.name}' has invalid relational facets`);
            }
            return {
                name: boundedText(column.name, "column name"),
                storeType: boundedText(column.storeType, "store type"),
                nullable: column.nullable,
                identity: column.identity,
                computed: column.computed,
                ...(column.maxLength === undefined
                    ? {}
                    : { maxLength: boundedInteger(column.maxLength) }),
                ...(column.precision === undefined
                    ? {}
                    : { precision: boundedInteger(column.precision) }),
                ...(column.scale === undefined ? {} : { scale: boundedInteger(column.scale) }),
                defaultKind: column.defaultKind ?? "none",
                ...(column.collation === undefined
                    ? {}
                    : { collation: boundedText(column.collation, "collation") }),
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    assertUnique(columns, (column) => column.name, `column in ${table.name}`);
    const normalizeKey = <T extends LocalEfRelationalKey>(value: T): T => ({
        ...value,
        name: boundedText(value.name, "object name"),
        columns: boundedColumnReferences(value.columns),
    });
    const primaryKey = table.primaryKey ? normalizeKey(table.primaryKey) : undefined;
    const uniqueConstraints = table.uniqueConstraints.map(normalizeKey).sort(compareNamed);
    const indexes = table.indexes
        .map((index) => {
            if (typeof index.unique !== "boolean") {
                throw new Error(`Index '${index.name}' has an invalid uniqueness flag`);
            }
            return {
                ...normalizeKey(index),
                unique: index.unique,
                ...(index.filterSha256
                    ? { filterSha256: sha256(index.filterSha256, "index filter") }
                    : {}),
            };
        })
        .sort(compareNamed);
    const foreignKeys = table.foreignKeys
        .map((foreignKey) => ({
            ...normalizeKey(foreignKey),
            principalSchema: boundedText(foreignKey.principalSchema, "principal schema"),
            principalTable: boundedText(foreignKey.principalTable, "principal table"),
            principalColumns: boundedColumnReferences(foreignKey.principalColumns),
            onDelete: boundedText(foreignKey.onDelete, "delete action"),
        }))
        .sort(compareNamed);
    const checks = table.checks
        .map((check) => ({
            name: boundedText(check.name, "check name"),
            sqlSha256: sha256(check.sqlSha256, "check SQL"),
        }))
        .sort(compareNamed);
    assertUnique(uniqueConstraints, (item) => item.name, "unique constraint");
    assertUnique(indexes, (item) => item.name, "index");
    assertUnique(foreignKeys, (item) => item.name, "foreign key");
    assertUnique(checks, (item) => item.name, "check");
    return {
        schema: boundedText(table.schema, "table schema"),
        name: boundedText(table.name, "table name"),
        columns,
        ...(primaryKey ? { primaryKey } : {}),
        uniqueConstraints,
        indexes,
        foreignKeys,
        checks,
        temporal: table.temporal,
    };
}

function validateModelHeader(input: LocalEfRelationalModelInput): void {
    if (typeof input.complete !== "boolean") {
        throw new Error("Entity Framework model completeness is invalid");
    }
    if (!/^[a-f0-9]{40,64}$/i.test(input.source.commit)) {
        throw new Error("Entity Framework model commit is invalid");
    }
    sha256(input.source.sourceSnapshotSha256, "source snapshot");
    sha256(input.source.toolchainSha256, "toolchain");
}

function boundedColumnReferences(values: readonly string[]): string[] {
    if (values.length === 0 || values.length > MAX_COLUMNS_PER_TABLE) {
        throw new Error("Entity Framework model column references exceed the bounded limits");
    }
    const normalized = values.map((column) => boundedText(column, "column reference"));
    if (new Set(normalized).size !== normalized.length) {
        throw new Error("Entity Framework model contains duplicate column references");
    }
    return normalized;
}

function validateKeyColumns(
    key: LocalEfRelationalKey | undefined,
    available: ReadonlySet<string>,
    label: string,
): void {
    if (!key) {
        return;
    }
    if (key.columns.length === 0 || key.columns.some((column) => !available.has(column))) {
        throw new Error(`${label} references an absent column`);
    }
}

function tableSimilarity(before: LocalEfRelationalTable, after: LocalEfRelationalTable): number {
    const beforeColumns = new Set(before.columns.map((column) => columnSignature(column, true)));
    const afterColumns = new Set(after.columns.map((column) => columnSignature(column, true)));
    return jaccard(beforeColumns, afterColumns);
}

function columnSimilarity(before: LocalEfRelationalColumn, after: LocalEfRelationalColumn): number {
    const properties: Array<keyof LocalEfRelationalColumn> = [
        "storeType",
        "nullable",
        "identity",
        "computed",
        "maxLength",
        "precision",
        "scale",
        "defaultKind",
        "collation",
    ];
    const equal = properties.filter((property) => before[property] === after[property]).length;
    return Number((equal / properties.length).toFixed(4));
}

function columnAlterRisk(
    before: LocalEfRelationalColumn,
    after: LocalEfRelationalColumn,
): LocalEfRelationalChange["risk"] {
    if (
        (before.nullable && !after.nullable) ||
        before.storeType !== after.storeType ||
        (before.maxLength !== undefined &&
            after.maxLength !== undefined &&
            after.maxLength < before.maxLength) ||
        (before.precision !== undefined &&
            after.precision !== undefined &&
            after.precision < before.precision) ||
        before.identity !== after.identity ||
        before.computed !== after.computed
    ) {
        return "review";
    }
    return "safe";
}

function differingProperties(before: object, after: object): string[] {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
        .filter((key) => canonicalRunbookJson(left[key]) !== canonicalRunbookJson(right[key]))
        .sort();
}

function change(
    kind: LocalEfRelationalChangeKind,
    objectType: LocalEfRelationalChange["objectType"],
    path: string,
    risk: LocalEfRelationalChange["risk"],
    changedProperties: string[] = [],
): LocalEfRelationalChange {
    return { kind, objectType, path, risk, changedProperties };
}

function identifierPath(schema: string, name: string): string {
    return `${quote(schema)}.${quote(name)}`;
}

function tablePath(table: Pick<LocalEfRelationalTable, "schema" | "name">): string {
    return identifierPath(table.schema, table.name);
}

function quote(value: string): string {
    return "[" + value.split("]").join("]]") + "]";
}

function columnSignature(column: LocalEfRelationalColumn, includeName: boolean): string {
    return canonicalRunbookJson({
        ...(includeName ? { name: column.name } : {}),
        storeType: column.storeType,
        nullable: column.nullable,
        identity: column.identity,
        computed: column.computed,
        maxLength: column.maxLength,
        precision: column.precision,
        scale: column.scale,
        defaultKind: column.defaultKind,
        collation: column.collation,
    });
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    if (left.size === 0 && right.size === 0) {
        return 1;
    }
    let intersection = 0;
    for (const value of left) {
        if (right.has(value)) {
            intersection++;
        }
    }
    return Number((intersection / (left.size + right.size - intersection)).toFixed(4));
}

function compareTable(left: LocalEfRelationalTable, right: LocalEfRelationalTable): number {
    return tablePath(left).localeCompare(tablePath(right));
}

function compareNamed(left: { name: string }, right: { name: string }): number {
    return left.name.localeCompare(right.name);
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string, label: string): void {
    const seen = new Set<string>();
    for (const item of items) {
        const value = key(item);
        if (seen.has(value)) {
            throw new Error(`Entity Framework model contains a duplicate ${label} '${value}'`);
        }
        seen.add(value);
    }
}

function boundedText(value: string, label: string, maxLength = 256): string {
    const text = value.trim();
    if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
        throw new Error(`Entity Framework model ${label} is invalid`);
    }
    return text;
}

function safeRelativePath(value: string): string {
    const normalized = value.replace(/\\/g, "/");
    if (
        !normalized ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.startsWith("/") ||
        /^[A-Za-z]:\//.test(normalized) ||
        /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
        throw new Error("Entity Framework model project path is invalid");
    }
    return normalized;
}

function boundedInteger(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
        throw new Error("Entity Framework model numeric facet is invalid");
    }
    return value;
}

function sha256(value: string, label: string): string {
    const normalized = value.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error(`Entity Framework model ${label} digest is invalid`);
    }
    return normalized;
}

function digest(value: unknown): string {
    return crypto.createHash("sha256").update(canonicalRunbookJson(value)).digest("hex");
}

function capitalize(value: string): string {
    return `${value[0].toUpperCase()}${value.slice(1)}`;
}
