/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Closed SQL Server migration-proposal generator. It consumes only validated
 * relational models, a same-run semantic diff/risk document, and explicit
 * rename decisions. Unsupported constructs fail the whole proposal; this
 * module never emits approximate SQL. Generated SQL still requires separate
 * digest-bound approval before an owned-target apply activity may execute it. */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";
import type { LocalEfMigrationRiskDocument } from "./localEfMigrationRisk";
import type {
    LocalEfRelationalChange,
    LocalEfRelationalColumn,
    LocalEfRelationalDiff,
    LocalEfRelationalForeignKey,
    LocalEfRelationalIndex,
    LocalEfRelationalKey,
    LocalEfRelationalModel,
    LocalEfRelationalTable,
    LocalEfRenameCandidate,
} from "./localEfRelationalModel";

export const LOCAL_EF_MIGRATION_MANIFEST_SCHEMA_VERSION = 1 as const;
const MAX_RENAME_DECISIONS_BYTES = 64 * 1024;
const MAX_OPERATIONS = 5_000;

export interface LocalEfRenameDecision {
    objectType: "table" | "column";
    fromPath: string;
    toPath: string;
    action: "rename" | "dropAdd";
}

export interface LocalEfMigrationOperation {
    sequence: number;
    kind: string;
    objectType: string;
    path: string;
    risk: "safe" | "review" | "destructive";
    forwardStatementCount: number;
    rollbackStatementCount: number;
}

export interface LocalEfMigrationManifest {
    schemaVersion: typeof LOCAL_EF_MIGRATION_MANIFEST_SCHEMA_VERSION;
    baseModelSha256: string;
    headModelSha256: string;
    diffSha256: string;
    riskSha256: string;
    renameDecisions: LocalEfRenameDecision[];
    operations: LocalEfMigrationOperation[];
    potentialDataLoss: boolean;
    rollbackCompleteness: "complete" | "schemaOnly";
    forwardScriptSha256: string;
    rollbackScriptSha256: string;
    manifestSha256: string;
}

export interface LocalEfMigrationProposal {
    manifest: LocalEfMigrationManifest;
    forwardSql: string;
    rollbackSql: string;
}

export class LocalEfMigrationGenerationError extends Error {
    public constructor(
        public readonly code:
            | "invalidInput"
            | "renameDecisionRequired"
            | "modelIncomparable"
            | "unsupportedOperation",
        message: string,
    ) {
        super(message);
        this.name = "LocalEfMigrationGenerationError";
    }
}

interface RenderedOperation {
    kind: string;
    objectType: string;
    path: string;
    risk: LocalEfMigrationOperation["risk"];
    priority: number;
    forward: string[];
    rollback: string[];
    losesData: boolean;
}

export function parseLocalEfRenameDecisions(value: string): LocalEfRenameDecision[] {
    if (Buffer.byteLength(value, "utf8") > MAX_RENAME_DECISIONS_BYTES) {
        invalid("Rename decisions exceed the bounded input limit.");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        invalid("Rename decisions must be a JSON array.");
    }
    if (!Array.isArray(parsed) || parsed.length > 100) {
        invalid("Rename decisions must be a bounded JSON array.");
    }
    const decisions = parsed.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            invalid(`Rename decision ${index + 1} is invalid.`);
        }
        const record = item as Record<string, unknown>;
        if (
            Object.keys(record).some(
                (key) => !["objectType", "fromPath", "toPath", "action"].includes(key),
            ) ||
            (record.objectType !== "table" && record.objectType !== "column") ||
            typeof record.fromPath !== "string" ||
            typeof record.toPath !== "string" ||
            (record.action !== "rename" && record.action !== "dropAdd")
        ) {
            invalid(`Rename decision ${index + 1} is invalid.`);
        }
        return {
            objectType: record.objectType,
            fromPath: boundedPath(record.fromPath),
            toPath: boundedPath(record.toPath),
            action: record.action,
        } as LocalEfRenameDecision;
    });
    const identities = decisions.map(decisionIdentity);
    if (new Set(identities).size !== identities.length) {
        invalid("Rename decisions contain a duplicate candidate.");
    }
    return decisions.sort((left, right) =>
        decisionIdentity(left).localeCompare(decisionIdentity(right)),
    );
}

export function generateLocalEfMigrationProposal(input: {
    base: LocalEfRelationalModel;
    head: LocalEfRelationalModel;
    diff: LocalEfRelationalDiff;
    risk: LocalEfMigrationRiskDocument;
    renameDecisions: LocalEfRenameDecision[];
}): LocalEfMigrationProposal {
    validateInputs(input);
    const decisions = validateRenameDecisions(input.diff.renameCandidates, input.renameDecisions);
    const renamedChangeKeys = new Set<string>();
    const operations: RenderedOperation[] = [];
    for (const decision of decisions) {
        if (decision.action === "rename") {
            operations.push(renderRename(decision));
            renamedChangeKeys.add(`drop:${decision.fromPath}`);
            renamedChangeKeys.add(`add:${decision.toPath}`);
        }
    }
    for (const change of input.diff.changes) {
        const direction = change.kind.startsWith("drop") ? "drop" : "add";
        if (renamedChangeKeys.has(`${direction}:${change.path}`)) {
            continue;
        }
        operations.push(...renderChange(change, input.base, input.head));
    }
    if (operations.length > MAX_OPERATIONS) {
        unsupported("The migration exceeds the bounded operation limit.");
    }
    operations.sort(
        (left, right) =>
            left.priority - right.priority ||
            `${left.path}\0${left.kind}`.localeCompare(`${right.path}\0${right.kind}`),
    );
    const forwardSql = script(
        "EF relational migration proposal",
        operations.flatMap((item) => item.forward),
    );
    const rollbackSql = script(
        "EF relational migration rollback proposal",
        [...operations].reverse().flatMap((item) => item.rollback),
    );
    const forwardScriptSha256 = sha256(forwardSql);
    const rollbackScriptSha256 = sha256(rollbackSql);
    const manifestFacts = {
        baseModelSha256: input.base.modelSha256,
        headModelSha256: input.head.modelSha256,
        diffSha256: input.diff.diffSha256,
        riskSha256: input.risk.riskSha256,
        renameDecisions: decisions,
        operations: operations.map((operation, index) => ({
            sequence: index + 1,
            kind: operation.kind,
            objectType: operation.objectType,
            path: operation.path,
            risk: operation.risk,
            forwardStatementCount: operation.forward.length,
            rollbackStatementCount: operation.rollback.length,
        })),
        potentialDataLoss: operations.some((operation) => operation.losesData),
        rollbackCompleteness: (operations.some((operation) => operation.losesData)
            ? "schemaOnly"
            : "complete") as LocalEfMigrationManifest["rollbackCompleteness"],
        forwardScriptSha256,
        rollbackScriptSha256,
    };
    return {
        manifest: {
            schemaVersion: LOCAL_EF_MIGRATION_MANIFEST_SCHEMA_VERSION,
            ...manifestFacts,
            manifestSha256: sha256(canonicalRunbookJson(manifestFacts)),
        },
        forwardSql,
        rollbackSql,
    };
}

function validateInputs(input: {
    base: LocalEfRelationalModel;
    head: LocalEfRelationalModel;
    diff: LocalEfRelationalDiff;
    risk: LocalEfMigrationRiskDocument;
}): void {
    if (
        !input.diff.comparable ||
        !input.risk.comparable ||
        input.diff.baseModelSha256 !== input.base.modelSha256 ||
        input.diff.headModelSha256 !== input.head.modelSha256 ||
        input.risk.diffSha256 !== input.diff.diffSha256
    ) {
        throw new LocalEfMigrationGenerationError(
            "modelIncomparable",
            "The migration inputs are incomplete, changed, or incomparable.",
        );
    }
}

function validateRenameDecisions(
    candidates: readonly LocalEfRenameCandidate[],
    decisions: readonly LocalEfRenameDecision[],
): LocalEfRenameDecision[] {
    const candidatesByIdentity = new Map(
        candidates.map((candidate) => [decisionIdentity(candidate), candidate]),
    );
    if (decisions.some((decision) => !candidatesByIdentity.has(decisionIdentity(decision)))) {
        throw new LocalEfMigrationGenerationError(
            "renameDecisionRequired",
            "Every rename decision must identify an exact candidate from the reviewed diff.",
        );
    }

    // A rename heuristic is a bipartite graph: a dropped column can resemble
    // several added columns (and vice versa). Requiring a decision for every
    // edge would demand contradictory answers. Instead, require one explicit
    // decision per connected candidate group. A `rename` selects one exact
    // edge; `dropAdd` rejects renaming for the whole group.
    const groups = renameCandidateGroups(candidates);
    for (const group of groups) {
        const groupDecisions = decisions.filter((decision) =>
            group.has(decisionIdentity(decision)),
        );
        if (groupDecisions.length !== 1) {
            throw new LocalEfMigrationGenerationError(
                "renameDecisionRequired",
                "Every ambiguous rename group requires exactly one explicit rename or drop/add decision.",
            );
        }
    }
    return [...decisions].sort((left, right) =>
        decisionIdentity(left).localeCompare(decisionIdentity(right)),
    );
}

function renameCandidateGroups(candidates: readonly LocalEfRenameCandidate[]): Array<Set<string>> {
    const remaining = new Map(
        candidates.map((candidate) => [decisionIdentity(candidate), candidate]),
    );
    const groups: Array<Set<string>> = [];
    while (remaining.size > 0) {
        const first = remaining.values().next().value as LocalEfRenameCandidate;
        const group = new Set<string>();
        const fromPaths = new Set([`${first.objectType}\0${first.fromPath}`]);
        const toPaths = new Set([`${first.objectType}\0${first.toPath}`]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const [identity, candidate] of remaining) {
                const from = `${candidate.objectType}\0${candidate.fromPath}`;
                const to = `${candidate.objectType}\0${candidate.toPath}`;
                if (fromPaths.has(from) || toPaths.has(to)) {
                    group.add(identity);
                    fromPaths.add(from);
                    toPaths.add(to);
                    remaining.delete(identity);
                    changed = true;
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function renderRename(decision: LocalEfRenameDecision): RenderedOperation {
    const from = parsePath(decision.fromPath);
    const to = parsePath(decision.toPath);
    if (decision.objectType === "column") {
        if (from.length !== 3 || to.length !== 3 || from[0] !== to[0] || from[1] !== to[1]) {
            unsupported("Column rename candidates must remain in the same table.");
        }
        return {
            kind: "renameColumn",
            objectType: "column",
            path: decision.toPath,
            risk: "review",
            priority: 50,
            forward: [spRename(decision.fromPath, to[2], "COLUMN")],
            rollback: [spRename(decision.toPath, from[2], "COLUMN")],
            losesData: false,
        };
    }
    if (from.length !== 2 || to.length !== 2 || from[0] !== to[0]) {
        unsupported("Table rename candidates must remain in the same schema.");
    }
    return {
        kind: "renameTable",
        objectType: "table",
        path: decision.toPath,
        risk: "review",
        priority: 50,
        forward: [spRename(decision.fromPath, to[1], "OBJECT")],
        rollback: [spRename(decision.toPath, from[1], "OBJECT")],
        losesData: false,
    };
}

function renderChange(
    change: LocalEfRelationalChange,
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): RenderedOperation[] {
    switch (change.kind) {
        case "addTable":
            return renderAddTable(requireTable(head, change.path), change);
        case "dropTable":
            unsupported(`Dropping table ${change.path} is not reversible without data backup.`);
        case "addColumn":
            return [renderAddColumn(requireColumn(head, change.path), change)];
        case "dropColumn":
            return [renderDropColumn(requireColumn(base, change.path), change)];
        case "alterColumn":
            return [
                renderAlterColumn(
                    requireColumn(base, change.path),
                    requireColumn(head, change.path),
                    change,
                ),
            ];
        case "addPrimaryKey":
        case "dropPrimaryKey":
        case "alterPrimaryKey":
            return [renderKeyChange(change, base, head, "primaryKey")];
        case "addUniqueConstraint":
        case "dropUniqueConstraint":
        case "alterUniqueConstraint":
            return [renderKeyChange(change, base, head, "uniqueConstraint")];
        case "addIndex":
        case "dropIndex":
        case "alterIndex":
            return [renderIndexChange(change, base, head)];
        case "addForeignKey":
        case "dropForeignKey":
        case "alterForeignKey":
            return [renderForeignKeyChange(change, base, head)];
        case "addCheck":
        case "dropCheck":
        case "alterCheck":
            unsupported(`Check-constraint SQL for ${change.path} is retained only as a digest.`);
        case "alterTemporal":
            unsupported(`Temporal-table changes for ${change.path} require a dedicated provider.`);
    }
}

function renderAddTable(
    table: LocalEfRelationalTable,
    change: LocalEfRelationalChange,
): RenderedOperation[] {
    assertRenderableTable(table);
    if (table.foreignKeys.length > 0) {
        unsupported(
            `New table ${tablePath(table)} contains foreign keys that require phased creation.`,
        );
    }
    const definitions = table.columns.map((column) => renderColumnDefinition(column));
    if (table.primaryKey) {
        definitions.push(renderKeyConstraint("PRIMARY KEY", table.primaryKey));
    }
    definitions.push(...table.uniqueConstraints.map((key) => renderKeyConstraint("UNIQUE", key)));
    const create = `CREATE TABLE ${tablePath(table)} (\n    ${definitions.join(",\n    ")}\n);`;
    const operations: RenderedOperation[] = [
        {
            kind: change.kind,
            objectType: change.objectType,
            path: change.path,
            risk: change.risk,
            priority: 60,
            forward: [create],
            rollback: [`DROP TABLE ${tablePath(table)};`],
            losesData: false,
        },
    ];
    for (const index of table.indexes) {
        assertRenderableIndex(index, change.path);
        operations.push({
            kind: "addIndex",
            objectType: "index",
            path: `${change.path}.${quote(index.name)}`,
            risk: "safe",
            priority: 70,
            forward: [renderCreateIndex(table, index)],
            rollback: [`DROP INDEX ${quote(index.name)} ON ${tablePath(table)};`],
            losesData: false,
        });
    }
    return operations;
}

function renderAddColumn(
    located: { table: LocalEfRelationalTable; column: LocalEfRelationalColumn },
    change: LocalEfRelationalChange,
): RenderedOperation {
    return {
        kind: change.kind,
        objectType: change.objectType,
        path: change.path,
        risk: change.risk,
        priority: 61,
        forward: [
            `ALTER TABLE ${tablePath(located.table)} ADD ${renderColumnDefinition(located.column)};`,
        ],
        rollback: [
            `ALTER TABLE ${tablePath(located.table)} DROP COLUMN ${quote(located.column.name)};`,
        ],
        losesData: false,
    };
}

function renderDropColumn(
    located: { table: LocalEfRelationalTable; column: LocalEfRelationalColumn },
    change: LocalEfRelationalChange,
): RenderedOperation {
    return {
        kind: change.kind,
        objectType: change.objectType,
        path: change.path,
        risk: change.risk,
        priority: 25,
        forward: [
            `ALTER TABLE ${tablePath(located.table)} DROP COLUMN ${quote(located.column.name)};`,
        ],
        rollback: [
            `ALTER TABLE ${tablePath(located.table)} ADD ${renderColumnDefinition(located.column)};`,
        ],
        losesData: true,
    };
}

function renderAlterColumn(
    before: { table: LocalEfRelationalTable; column: LocalEfRelationalColumn },
    after: { table: LocalEfRelationalTable; column: LocalEfRelationalColumn },
    change: LocalEfRelationalChange,
): RenderedOperation {
    if (
        before.column.identity !== after.column.identity ||
        before.column.computedSha256 !== after.column.computedSha256 ||
        before.column.defaultSha256 !== after.column.defaultSha256
    ) {
        unsupported(
            `Column generation/default changes for ${change.path} need a named-constraint provider.`,
        );
    }
    return {
        kind: change.kind,
        objectType: change.objectType,
        path: change.path,
        risk: change.risk,
        priority: 55,
        forward: [
            `ALTER TABLE ${tablePath(after.table)} ALTER COLUMN ${renderColumnDefinition(after.column, false)};`,
        ],
        rollback: [
            `ALTER TABLE ${tablePath(before.table)} ALTER COLUMN ${renderColumnDefinition(before.column, false)};`,
        ],
        losesData: change.risk !== "safe",
    };
}

function renderKeyChange(
    change: LocalEfRelationalChange,
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
    kind: "primaryKey" | "uniqueConstraint",
): RenderedOperation {
    const before = findKey(base, change.path, kind);
    const after = findKey(head, change.path, kind);
    const table = after?.table ?? before?.table;
    if (!table) {
        invalid(`Constraint ${change.path} was not found in either model.`);
    }
    const forward: string[] = [];
    const rollback: string[] = [];
    if (before) {
        forward.push(
            `ALTER TABLE ${tablePath(before.table)} DROP CONSTRAINT ${quote(before.key.name)};`,
        );
        rollback.unshift(addKey(before.table, before.key, kind));
    }
    if (after) {
        forward.push(addKey(after.table, after.key, kind));
        rollback.unshift(
            `ALTER TABLE ${tablePath(after.table)} DROP CONSTRAINT ${quote(after.key.name)};`,
        );
    }
    return rendered(change, 40, forward, rollback, false);
}

function renderIndexChange(
    change: LocalEfRelationalChange,
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): RenderedOperation {
    const before = findIndex(base, change.path);
    const after = findIndex(head, change.path);
    if (before) {
        assertRenderableIndex(before.index, change.path);
    }
    if (after) {
        assertRenderableIndex(after.index, change.path);
    }
    const forward: string[] = [];
    const rollback: string[] = [];
    if (before) {
        forward.push(`DROP INDEX ${quote(before.index.name)} ON ${tablePath(before.table)};`);
        rollback.unshift(renderCreateIndex(before.table, before.index));
    }
    if (after) {
        forward.push(renderCreateIndex(after.table, after.index));
        rollback.unshift(`DROP INDEX ${quote(after.index.name)} ON ${tablePath(after.table)};`);
    }
    return rendered(change, change.kind.startsWith("drop") ? 20 : 70, forward, rollback, false);
}

function renderForeignKeyChange(
    change: LocalEfRelationalChange,
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): RenderedOperation {
    const before = findForeignKey(base, change.path);
    const after = findForeignKey(head, change.path);
    const forward: string[] = [];
    const rollback: string[] = [];
    if (before) {
        forward.push(
            `ALTER TABLE ${tablePath(before.table)} DROP CONSTRAINT ${quote(before.key.name)};`,
        );
        rollback.unshift(addForeignKey(before.table, before.key));
    }
    if (after) {
        forward.push(addForeignKey(after.table, after.key));
        rollback.unshift(
            `ALTER TABLE ${tablePath(after.table)} DROP CONSTRAINT ${quote(after.key.name)};`,
        );
    }
    return rendered(change, change.kind.startsWith("drop") ? 10 : 80, forward, rollback, false);
}

function rendered(
    change: LocalEfRelationalChange,
    priority: number,
    forward: string[],
    rollback: string[],
    losesData: boolean,
): RenderedOperation {
    if (forward.length === 0 || rollback.length === 0) {
        invalid(`Migration operation ${change.path} is incomplete.`);
    }
    return {
        kind: change.kind,
        objectType: change.objectType,
        path: change.path,
        risk: change.risk,
        priority,
        forward,
        rollback,
        losesData,
    };
}

function assertRenderableTable(table: LocalEfRelationalTable): void {
    if (table.temporal || table.checks.length > 0) {
        unsupported(`Table ${tablePath(table)} uses temporal or check-constraint SQL.`);
    }
    for (const column of table.columns) {
        renderColumnDefinition(column);
    }
    for (const index of table.indexes) {
        assertRenderableIndex(index, tablePath(table));
    }
}

function renderColumnDefinition(column: LocalEfRelationalColumn, allowIdentity = true): string {
    if (
        column.computed ||
        column.computedSha256 ||
        column.defaultKind !== "none" ||
        column.defaultSha256
    ) {
        unsupported(`Column ${column.name} contains an expression retained only as a digest.`);
    }
    const storeType = safeStoreType(column.storeType);
    const collation = column.collation ? ` COLLATE ${safeCollation(column.collation)}` : "";
    const identity = column.identity
        ? allowIdentity
            ? ` IDENTITY(${column.identitySeed ?? 1},${column.identityIncrement ?? 1})`
            : unsupported(`Identity changes for column ${column.name} cannot use ALTER COLUMN.`)
        : "";
    return `${quote(column.name)} ${storeType}${collation}${identity} ${column.nullable ? "NULL" : "NOT NULL"}`;
}

function renderKeyConstraint(prefix: "PRIMARY KEY" | "UNIQUE", key: LocalEfRelationalKey): string {
    return `CONSTRAINT ${quote(key.name)} ${prefix} (${columnList(key.columns)})`;
}

function addKey(
    table: LocalEfRelationalTable,
    key: LocalEfRelationalKey,
    kind: "primaryKey" | "uniqueConstraint",
): string {
    const prefix = kind === "primaryKey" ? "PRIMARY KEY" : "UNIQUE";
    return `ALTER TABLE ${tablePath(table)} ADD ${renderKeyConstraint(prefix, key)};`;
}

function assertRenderableIndex(index: LocalEfRelationalIndex, path: string): void {
    if (index.filterSha256 && !index.notNullFilterColumns) {
        unsupported(`Filtered index ${path} is retained only as a digest.`);
    }
}

function renderCreateIndex(table: LocalEfRelationalTable, index: LocalEfRelationalIndex): string {
    const filter = index.notNullFilterColumns
        ? ` WHERE ${index.notNullFilterColumns.map((column) => `${quote(column)} IS NOT NULL`).join(" AND ")}`
        : "";
    return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(index.name)} ON ${tablePath(table)} (${columnList(index.columns)})${filter};`;
}

function addForeignKey(table: LocalEfRelationalTable, key: LocalEfRelationalForeignKey): string {
    return `ALTER TABLE ${tablePath(table)} ADD CONSTRAINT ${quote(key.name)} FOREIGN KEY (${columnList(key.columns)}) REFERENCES ${quote(key.principalSchema)}.${quote(key.principalTable)} (${columnList(key.principalColumns)})${deleteAction(key.onDelete)};`;
}

function deleteAction(value: string): string {
    switch (value.toLowerCase().replace(/[_\s]/g, "")) {
        case "cascade":
            return " ON DELETE CASCADE";
        case "setnull":
            return " ON DELETE SET NULL";
        case "setdefault":
            return " ON DELETE SET DEFAULT";
        case "noaction":
        case "restrict":
            return " ON DELETE NO ACTION";
        default:
            unsupported("The foreign-key delete action is not supported.");
    }
}

function requireTable(model: LocalEfRelationalModel, path: string): LocalEfRelationalTable {
    const table = model.tables.find((candidate) => tablePath(candidate) === path);
    if (!table) {
        invalid(`Table ${path} was not found in the expected model.`);
    }
    return table;
}

function requireColumn(
    model: LocalEfRelationalModel,
    path: string,
): { table: LocalEfRelationalTable; column: LocalEfRelationalColumn } {
    const parts = parsePath(path);
    if (parts.length !== 3) {
        invalid(`Column path ${path} is invalid.`);
    }
    const table = requireTable(model, `${quote(parts[0])}.${quote(parts[1])}`);
    const column = table.columns.find((candidate) => candidate.name === parts[2]);
    if (!column) {
        invalid(`Column ${path} was not found in the expected model.`);
    }
    return { table, column };
}

function findKey(
    model: LocalEfRelationalModel,
    path: string,
    kind: "primaryKey" | "uniqueConstraint",
): { table: LocalEfRelationalTable; key: LocalEfRelationalKey } | undefined {
    const located = locateNamed(model, path);
    const key =
        kind === "primaryKey"
            ? located.table.primaryKey?.name === located.name
                ? located.table.primaryKey
                : undefined
            : located.table.uniqueConstraints.find((candidate) => candidate.name === located.name);
    return key ? { table: located.table, key } : undefined;
}

function findIndex(
    model: LocalEfRelationalModel,
    path: string,
): { table: LocalEfRelationalTable; index: LocalEfRelationalIndex } | undefined {
    const located = locateNamed(model, path);
    const index = located.table.indexes.find((candidate) => candidate.name === located.name);
    return index ? { table: located.table, index } : undefined;
}

function findForeignKey(
    model: LocalEfRelationalModel,
    path: string,
): { table: LocalEfRelationalTable; key: LocalEfRelationalForeignKey } | undefined {
    const located = locateNamed(model, path);
    const key = located.table.foreignKeys.find((candidate) => candidate.name === located.name);
    return key ? { table: located.table, key } : undefined;
}

function locateNamed(
    model: LocalEfRelationalModel,
    path: string,
): { table: LocalEfRelationalTable; name: string } {
    const parts = parsePath(path);
    if (parts.length !== 3) {
        invalid(`Named-object path ${path} is invalid.`);
    }
    return {
        table: requireTable(model, `${quote(parts[0])}.${quote(parts[1])}`),
        name: parts[2],
    };
}

function parsePath(value: string): string[] {
    const parts: string[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        if (value[cursor] !== "[") {
            invalid(`Relational path ${value} is invalid.`);
        }
        cursor++;
        let part = "";
        let closed = false;
        while (cursor < value.length) {
            if (value[cursor] === "]") {
                if (value[cursor + 1] === "]") {
                    part += "]";
                    cursor += 2;
                    continue;
                }
                cursor++;
                closed = true;
                break;
            }
            part += value[cursor++];
        }
        if (!closed || part.length === 0 || part.length > 512) {
            invalid(`Relational path ${value} is invalid.`);
        }
        parts.push(part);
        if (cursor < value.length) {
            if (value[cursor] !== ".") {
                invalid(`Relational path ${value} is invalid.`);
            }
            cursor++;
        }
    }
    return parts;
}

function tablePath(table: Pick<LocalEfRelationalTable, "schema" | "name">): string {
    return `${quote(table.schema)}.${quote(table.name)}`;
}

function quote(value: string): string {
    return `[${value.replace(/]/g, "]]")}]`;
}

function columnList(columns: readonly string[]): string {
    if (columns.length === 0) {
        invalid("A key or index has no columns.");
    }
    return columns.map(quote).join(", ");
}

function safeStoreType(value: string): string {
    const type = value.trim();
    if (
        type.length === 0 ||
        type.length > 256 ||
        !/^(?:(?:\[[A-Za-z_][A-Za-z0-9_@$# ]*\]|[A-Za-z_][A-Za-z0-9_@$#]*)\.)?(?:\[[A-Za-z_][A-Za-z0-9_@$# ]*\]|[A-Za-z_][A-Za-z0-9_@$# ]*)(?:\s*\(\s*(?:max|[0-9]+)(?:\s*,\s*[0-9]+)?\s*\))?$/i.test(
            type,
        )
    ) {
        unsupported("The SQL Server store type is not in the closed grammar.");
    }
    return type;
}

function safeCollation(value: string): string {
    const collation = value.trim();
    if (!/^[A-Za-z0-9_]{1,128}$/.test(collation)) {
        unsupported("The SQL Server collation is not in the closed grammar.");
    }
    return collation;
}

function spRename(path: string, newName: string, kind: "COLUMN" | "OBJECT"): string {
    return `EXEC sys.sp_rename N'${literal(path)}', N'${literal(newName)}', N'${kind}';`;
}

function literal(value: string): string {
    if (value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
        invalid("A migration identifier is invalid.");
    }
    return value.replace(/'/g, "''");
}

function script(label: string, statements: readonly string[]): string {
    if (statements.length === 0) {
        return `-- ${label}\n-- No schema changes were required.\n`;
    }
    return [
        `-- ${label}`,
        "SET XACT_ABORT ON;",
        "BEGIN TRY",
        "    BEGIN TRANSACTION;",
        ...statements.map((statement) => indent(statement, 4)),
        "    COMMIT TRANSACTION;",
        "END TRY",
        "BEGIN CATCH",
        "    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;",
        "    THROW;",
        "END CATCH;",
        "",
    ].join("\n");
}

function indent(value: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return value
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
}

function decisionIdentity(value: { objectType: string; fromPath: string; toPath: string }): string {
    return `${value.objectType}\0${value.fromPath}\0${value.toPath}`;
}

function boundedPath(value: string): string {
    const path = value.trim();
    if (path.length === 0 || path.length > 2_048 || /[\u0000-\u001f\u007f]/.test(path)) {
        invalid("A rename path is invalid.");
    }
    parsePath(path);
    return path;
}

function sha256(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function invalid(message: string): never {
    throw new LocalEfMigrationGenerationError("invalidInput", message);
}

function unsupported(message: string): never {
    throw new LocalEfMigrationGenerationError("unsupportedOperation", message);
}
