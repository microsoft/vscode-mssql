/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import isEqual from "lodash/isEqual";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { locConstants } from "../../../common/locConstants";
import {
    calculateSchemaDiff,
    ChangeAction,
    ChangeCategory,
    SchemaChange,
    COLUMN_PROPERTIES,
    diffObject,
    FOREIGN_KEY_PROPERTIES,
    PropertyChange,
    SchemaChangesSummary,
    TABLE_PROPERTIES,
} from "../diff/diffUtils";
import {
    AiLedgerApplyResult,
    AiLedgerDiffOperation,
    AiLedgerOperation,
    Column,
    ForeignKey,
    LedgerSnapshot,
    PendingAiItem,
    PendingAiTableGroup,
    Table,
} from "./operations";

function cloneValue<T>(value: T): T {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

function mapById<T extends { id: string }>(items: T[]): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of items) {
        map.set(item.id, item);
    }
    return map;
}

export function toAiLedgerItemKey(
    category: ChangeCategory,
    tableId: string,
    objectId?: string,
): string {
    switch (category) {
        case ChangeCategory.Table:
            return `table:${tableId}`;
        case ChangeCategory.Column:
            return `column:${tableId}:${objectId ?? "unknown"}`;
        case ChangeCategory.ForeignKey:
            return `foreignKey:${tableId}:${objectId ?? "unknown"}`;
        default:
            return `${tableId}:${objectId ?? "unknown"}`;
    }
}

function toQualifiedName(schema: string, name: string): string {
    return `${schema}.${name}`;
}

function buildGroupTitle(
    originalSchema: string,
    originalName: string,
    currentSchema: string,
    currentName: string,
    isDeleted: boolean,
): string {
    const original = toQualifiedName(originalSchema, originalName);
    const current = toQualifiedName(currentSchema, currentName);
    const baseTitle = original === current ? current : `${original} -> ${current}`;
    return isDeleted
        ? `${baseTitle} ${locConstants.schemaDesigner.aiLedgerDeletedSuffix}`
        : baseTitle;
}

function buildItemFriendlyName(item: {
    category: ChangeCategory;
    tableSchema: string;
    tableName: string;
    objectName?: string;
}): string {
    if (item.category === ChangeCategory.Table) {
        return toQualifiedName(item.tableSchema, item.tableName);
    }
    return item.objectName ?? locConstants.schemaDesigner.aiLedgerUnnamed;
}

function buildItemTitle(item: {
    action: ChangeAction;
    category: ChangeCategory;
    tableSchema: string;
    tableName: string;
    objectName?: string;
}): string {
    const target =
        item.category === ChangeCategory.Table
            ? toQualifiedName(item.tableSchema, item.tableName)
            : (item.objectName ?? locConstants.schemaDesigner.aiLedgerUnnamed);
    const actionLabel =
        item.action === ChangeAction.Add
            ? locConstants.schemaDesigner.aiLedgerActionAdd
            : item.action === ChangeAction.Delete
              ? locConstants.schemaDesigner.aiLedgerActionDelete
              : locConstants.schemaDesigner.aiLedgerActionModify;
    const categoryLabel =
        item.category === ChangeCategory.Table
            ? locConstants.schemaDesigner.aiLedgerCategoryTable
            : item.category === ChangeCategory.Column
              ? locConstants.schemaDesigner.aiLedgerCategoryColumn
              : locConstants.schemaDesigner.aiLedgerCategoryForeignKey;
    return `${actionLabel} ${categoryLabel}: ${target}`;
}

function getSnapshotName(snapshot: LedgerSnapshot | null): string | undefined {
    if (!snapshot) {
        return undefined;
    }
    return snapshot.name;
}

function computePropertyChanges(
    category: ChangeCategory,
    baselineSnapshot: LedgerSnapshot,
    currentSnapshot: LedgerSnapshot,
): PropertyChange[] {
    if (category === ChangeCategory.Table) {
        return diffObject(baselineSnapshot as Table, currentSnapshot as Table, TABLE_PROPERTIES);
    }
    if (category === ChangeCategory.Column) {
        return diffObject(baselineSnapshot as Column, currentSnapshot as Column, COLUMN_PROPERTIES);
    }
    return diffObject(
        baselineSnapshot as ForeignKey,
        currentSnapshot as ForeignKey,
        FOREIGN_KEY_PROPERTIES,
    );
}

function buildCanonicalItem(args: {
    source: PendingAiItem;
    baselineSnapshot: LedgerSnapshot | null;
    currentSnapshot: LedgerSnapshot | null;
    appliedOps: AiLedgerOperation[];
    baselineTableSchema?: string;
    baselineTableName?: string;
    currentTableSchema?: string;
    currentTableName?: string;
}): PendingAiItem | undefined {
    const {
        source,
        baselineSnapshot,
        currentSnapshot,
        appliedOps,
        baselineTableSchema,
        baselineTableName,
        currentTableSchema,
        currentTableName,
    } = args;

    if (baselineSnapshot === null && currentSnapshot === null) {
        return undefined;
    }

    if (
        baselineSnapshot !== null &&
        currentSnapshot !== null &&
        isEqual(baselineSnapshot, currentSnapshot)
    ) {
        return undefined;
    }

    let action: ChangeAction;
    let propertyChanges: PropertyChange[] | undefined;
    if (baselineSnapshot === null) {
        action = ChangeAction.Add;
    } else if (currentSnapshot === null) {
        action = ChangeAction.Delete;
    } else {
        action = ChangeAction.Modify;
        propertyChanges = computePropertyChanges(
            source.category,
            baselineSnapshot,
            currentSnapshot,
        );
    }

    const resolvedTableSchema =
        currentTableSchema ??
        baselineTableSchema ??
        source.currentTableSchema ??
        source.baselineTableSchema ??
        source.tableSchema;
    const resolvedTableName =
        currentTableName ??
        baselineTableName ??
        source.currentTableName ??
        source.baselineTableName ??
        source.tableName;
    const resolvedObjectName =
        getSnapshotName(currentSnapshot) ?? getSnapshotName(baselineSnapshot) ?? source.objectName;

    return {
        ...source,
        action,
        tableSchema: resolvedTableSchema,
        tableName: resolvedTableName,
        objectName: resolvedObjectName,
        title: buildItemTitle({
            action,
            category: source.category,
            tableSchema: resolvedTableSchema,
            tableName: resolvedTableName,
            objectName: resolvedObjectName,
        }),
        friendlyName: buildItemFriendlyName({
            category: source.category,
            tableSchema: resolvedTableSchema,
            tableName: resolvedTableName,
            objectName: resolvedObjectName,
        }),
        baselineTableSchema,
        baselineTableName,
        currentTableSchema,
        currentTableName,
        baselineSnapshot: cloneValue(baselineSnapshot),
        currentSnapshot: cloneValue(currentSnapshot),
        propertyChanges,
        appliedOps: [...appliedOps],
    };
}

function normalizeIncomingItem(item: PendingAiItem): PendingAiItem | undefined {
    return buildCanonicalItem({
        source: item,
        baselineSnapshot: item.baselineSnapshot,
        currentSnapshot: item.currentSnapshot,
        appliedOps: item.appliedOps,
        baselineTableSchema: item.baselineTableSchema,
        baselineTableName: item.baselineTableName,
        currentTableSchema: item.currentTableSchema,
        currentTableName: item.currentTableName,
    });
}

function mergePendingItems(
    existing: PendingAiItem,
    incoming: PendingAiItem,
): PendingAiItem | undefined {
    return buildCanonicalItem({
        source: existing,
        baselineSnapshot: existing.baselineSnapshot,
        currentSnapshot: incoming.currentSnapshot,
        appliedOps: [...existing.appliedOps, ...incoming.appliedOps],
        baselineTableSchema: existing.baselineTableSchema ?? incoming.baselineTableSchema,
        baselineTableName: existing.baselineTableName ?? incoming.baselineTableName,
        currentTableSchema: incoming.currentTableSchema ?? incoming.baselineTableSchema,
        currentTableName: incoming.currentTableName ?? incoming.baselineTableName,
    });
}

export function applyPendingAiDisplayRules(items: PendingAiItem[]): PendingAiItem[] {
    const tableItem = items.find((item) => item.category === ChangeCategory.Table);
    if (!tableItem) {
        return items;
    }
    if (tableItem.action === ChangeAction.Add) {
        // Match changes-panel behavior: for table creation, suppress child column adds.
        return items.filter(
            (item) =>
                !(
                    item.category === ChangeCategory.Column &&
                    item.action === ChangeAction.Add &&
                    item.tableId === tableItem.tableId
                ),
        );
    }
    if (tableItem.action === ChangeAction.Delete) {
        return [tableItem];
    }
    return items;
}

export function getVisiblePendingAiItems(groups: PendingAiTableGroup[]): PendingAiItem[] {
    const visibleItemsWithIndex = groups
        .flatMap((group) => applyPendingAiDisplayRules(group.items))
        .map((item, index) => ({
            item,
            index,
        }));

    visibleItemsWithIndex.sort((a, b) => {
        const aHasOrder = typeof a.item.order === "number";
        const bHasOrder = typeof b.item.order === "number";
        if (aHasOrder && bHasOrder && a.item.order !== b.item.order) {
            return (a.item.order ?? 0) - (b.item.order ?? 0);
        }
        return a.index - b.index;
    });

    return visibleItemsWithIndex.map(({ item }) => item);
}

export function toPendingAiSchemaChange(item: PendingAiItem): SchemaChange {
    return {
        id: `ai-${item.key}`,
        action: item.action,
        category: item.category,
        tableId: item.tableId,
        tableSchema: item.currentTableSchema ?? item.tableSchema,
        tableName: item.currentTableName ?? item.tableName,
        objectId: item.objectId,
        objectName: item.objectName,
        propertyChanges: item.propertyChanges,
    };
}

export function getVisiblePendingAiSchemaChanges(groups: PendingAiTableGroup[]): SchemaChange[] {
    return getVisiblePendingAiItems(groups).map(toPendingAiSchemaChange);
}

function buildGroupFromItems(
    tableId: string,
    items: PendingAiItem[],
    existing?: PendingAiTableGroup,
): PendingAiTableGroup {
    const tableItem = items.find((item) => item.category === ChangeCategory.Table);
    const originalTableSchema =
        existing?.originalTableSchema ??
        tableItem?.baselineTableSchema ??
        items.find((item) => item.baselineTableSchema)?.baselineTableSchema ??
        tableItem?.tableSchema ??
        items[0].tableSchema;
    const originalTableName =
        existing?.originalTableName ??
        tableItem?.baselineTableName ??
        items.find((item) => item.baselineTableName)?.baselineTableName ??
        tableItem?.tableName ??
        items[0].tableName;
    const currentTableSchema =
        tableItem?.currentTableSchema ??
        tableItem?.baselineTableSchema ??
        items.find((item) => item.currentTableSchema)?.currentTableSchema ??
        existing?.currentTableSchema ??
        originalTableSchema;
    const currentTableName =
        tableItem?.currentTableName ??
        tableItem?.baselineTableName ??
        items.find((item) => item.currentTableName)?.currentTableName ??
        existing?.currentTableName ??
        originalTableName;
    const isDeleted = tableItem?.action === ChangeAction.Delete;

    return {
        key: `table:${tableId}`,
        tableKey: tableId,
        tableId,
        originalTableSchema,
        originalTableName,
        currentTableSchema,
        currentTableName,
        isDeleted,
        title: buildGroupTitle(
            originalTableSchema,
            originalTableName,
            currentTableSchema,
            currentTableName,
            isDeleted,
        ),
        friendlyName: toQualifiedName(currentTableSchema, currentTableName),
        items: [...items],
    };
}

export function createAiLedgerDiffOperations(
    baselineSchema: SchemaDesigner.Schema,
    currentSchema: SchemaDesigner.Schema,
    summary?: SchemaChangesSummary,
): AiLedgerDiffOperation[] {
    const effectiveSummary = summary ?? calculateSchemaDiff(baselineSchema, currentSchema);
    const baselineTablesById = mapById(baselineSchema.tables ?? []);
    const currentTablesById = mapById(currentSchema.tables ?? []);
    const diffOperations: AiLedgerDiffOperation[] = [];

    for (const group of effectiveSummary.groups) {
        for (const change of group.changes) {
            const baselineTable = baselineTablesById.get(change.tableId);
            const currentTable = currentTablesById.get(change.tableId);
            let baselineSnapshot: LedgerSnapshot | null = null;
            let currentSnapshot: LedgerSnapshot | null = null;

            if (change.category === ChangeCategory.Table) {
                baselineSnapshot = baselineTable ? cloneValue(baselineTable) : null;
                currentSnapshot = currentTable ? cloneValue(currentTable) : null;
            } else if (change.category === ChangeCategory.Column) {
                baselineSnapshot =
                    baselineTable?.columns.find((column) => column.id === change.objectId) ?? null;
                currentSnapshot =
                    currentTable?.columns.find((column) => column.id === change.objectId) ?? null;
                baselineSnapshot = cloneValue(baselineSnapshot);
                currentSnapshot = cloneValue(currentSnapshot);
            } else if (change.category === ChangeCategory.ForeignKey) {
                baselineSnapshot =
                    baselineTable?.foreignKeys.find((fk) => fk.id === change.objectId) ?? null;
                currentSnapshot =
                    currentTable?.foreignKeys.find((fk) => fk.id === change.objectId) ?? null;
                baselineSnapshot = cloneValue(baselineSnapshot);
                currentSnapshot = cloneValue(currentSnapshot);
            }

            const tableSchema = currentTable?.schema ?? baselineTable?.schema ?? change.tableSchema;
            const tableName = currentTable?.name ?? baselineTable?.name ?? change.tableName;
            const objectName =
                getSnapshotName(currentSnapshot) ??
                getSnapshotName(baselineSnapshot) ??
                change.objectName;

            diffOperations.push({
                key: toAiLedgerItemKey(change.category, change.tableId, change.objectId),
                category: change.category,
                action: change.action,
                tableId: change.tableId,
                tableSchema,
                tableName,
                objectId: change.objectId,
                objectName,
                baselineTableSchema: baselineTable?.schema,
                baselineTableName: baselineTable?.name,
                currentTableSchema: currentTable?.schema,
                currentTableName: currentTable?.name,
                baselineSnapshot,
                currentSnapshot,
                propertyChanges: change.propertyChanges ? [...change.propertyChanges] : undefined,
            });
        }
    }

    return diffOperations;
}

export function buildPendingItems(
    diffOperations: AiLedgerDiffOperation[],
    operations: AiLedgerOperation[],
): PendingAiItem[] {
    let nextOrder = 0;
    const operationsByKey = new Map<string, AiLedgerOperation[]>();
    for (const operation of operations) {
        const key = toAiLedgerItemKey(operation.category, operation.tableId, operation.objectId);
        const existing = operationsByKey.get(key);
        if (existing) {
            existing.push(operation);
        } else {
            operationsByKey.set(key, [operation]);
        }
    }

    const items: PendingAiItem[] = [];
    const seenKeys = new Set<string>();
    for (const diffOperation of diffOperations) {
        const item: PendingAiItem = {
            id: diffOperation.key,
            key: diffOperation.key,
            order: nextOrder,
            category: diffOperation.category,
            action: diffOperation.action,
            tableId: diffOperation.tableId,
            tableKey: diffOperation.tableId,
            tableSchema: diffOperation.tableSchema,
            tableName: diffOperation.tableName,
            objectId: diffOperation.objectId,
            objectName: diffOperation.objectName,
            title: buildItemTitle(diffOperation),
            friendlyName: buildItemFriendlyName(diffOperation),
            baselineTableSchema: diffOperation.baselineTableSchema,
            baselineTableName: diffOperation.baselineTableName,
            currentTableSchema: diffOperation.currentTableSchema,
            currentTableName: diffOperation.currentTableName,
            baselineSnapshot: cloneValue(diffOperation.baselineSnapshot),
            currentSnapshot: cloneValue(diffOperation.currentSnapshot),
            propertyChanges: diffOperation.propertyChanges
                ? [...diffOperation.propertyChanges]
                : undefined,
            appliedOps: [...(operationsByKey.get(diffOperation.key) ?? [])],
        };
        const normalized = normalizeIncomingItem(item);
        if (normalized) {
            items.push(normalized);
            seenKeys.add(diffOperation.key);
            nextOrder += 1;
        }
    }

    for (const [key, operationHistory] of operationsByKey) {
        if (seenKeys.has(key) || operationHistory.length === 0) {
            continue;
        }

        const firstOperation = operationHistory[0];
        const lastOperation = operationHistory[operationHistory.length - 1];
        const baselineSnapshot = cloneValue(firstOperation.beforeSnapshot);
        const currentSnapshot = cloneValue(lastOperation.afterSnapshot);

        const tableSchema = lastOperation.tableSchema || firstOperation.tableSchema || "dbo";
        const tableName = lastOperation.tableName || firstOperation.tableName || "(table)";
        const objectName =
            getSnapshotName(currentSnapshot) ??
            getSnapshotName(baselineSnapshot) ??
            lastOperation.objectName ??
            firstOperation.objectName;

        const fallbackItem: PendingAiItem = {
            id: key,
            key,
            order: nextOrder,
            category: lastOperation.category,
            action: lastOperation.action,
            tableId: lastOperation.tableId,
            tableKey: lastOperation.tableId,
            tableSchema,
            tableName,
            objectId: lastOperation.objectId ?? firstOperation.objectId,
            objectName,
            title: buildItemTitle({
                action: lastOperation.action,
                category: lastOperation.category,
                tableSchema,
                tableName,
                objectName,
            }),
            friendlyName: buildItemFriendlyName({
                category: lastOperation.category,
                tableSchema,
                tableName,
                objectName,
            }),
            baselineTableSchema: firstOperation.tableSchema,
            baselineTableName: firstOperation.tableName,
            currentTableSchema: lastOperation.tableSchema,
            currentTableName: lastOperation.tableName,
            baselineSnapshot,
            currentSnapshot,
            propertyChanges: undefined,
            appliedOps: [...operationHistory],
        };

        const normalized = normalizeIncomingItem(fallbackItem);
        if (normalized) {
            items.push(normalized);
            nextOrder += 1;
        }
    }

    return items;
}

export function groupPendingItemsByTable(items: PendingAiItem[]): PendingAiTableGroup[] {
    const itemsByTable = new Map<string, PendingAiItem[]>();
    for (const item of items) {
        const existing = itemsByTable.get(item.tableId);
        if (existing) {
            existing.push(item);
        } else {
            itemsByTable.set(item.tableId, [item]);
        }
    }

    const groups: PendingAiTableGroup[] = [];
    for (const [tableId, tableItems] of itemsByTable) {
        if (tableItems.length === 0) {
            continue;
        }
        groups.push(buildGroupFromItems(tableId, tableItems));
    }
    return groups;
}

export function createAiLedgerApplyResult(
    baselineSchema: SchemaDesigner.Schema,
    currentSchema: SchemaDesigner.Schema,
    operations: AiLedgerOperation[],
): AiLedgerApplyResult {
    const diffOperations = createAiLedgerDiffOperations(baselineSchema, currentSchema);
    const pendingItems = buildPendingItems(diffOperations, operations);
    const pendingGroups = groupPendingItemsByTable(pendingItems);
    return {
        operations,
        diffOperations,
        pendingItems,
        pendingGroups,
    };
}

export function mergePendingAiTableGroups(
    existingGroups: PendingAiTableGroup[],
    incomingGroups: PendingAiTableGroup[],
): PendingAiTableGroup[] {
    const groups: PendingAiTableGroup[] = existingGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item })),
    }));
    const groupIndexByTableId = new Map<string, number>(
        groups.map((group, index) => [group.tableId, index]),
    );
    let nextOrder = 0;

    // Normalize existing order once to preserve current visual order, then append new operations.
    for (const group of groups) {
        for (const item of group.items) {
            if (typeof item.order === "number") {
                nextOrder = Math.max(nextOrder, item.order + 1);
                continue;
            }
            item.order = nextOrder;
            nextOrder += 1;
        }
    }

    for (const incomingGroup of incomingGroups) {
        const existingGroupIndex = groupIndexByTableId.get(incomingGroup.tableId);
        if (existingGroupIndex === undefined) {
            const appendedItems: PendingAiItem[] = [];
            for (const incomingItem of incomingGroup.items) {
                const normalized = normalizeIncomingItem(incomingItem);
                if (!normalized) {
                    continue;
                }
                appendedItems.push({
                    ...normalized,
                    order: nextOrder,
                });
                nextOrder += 1;
            }

            if (appendedItems.length === 0) {
                continue;
            }

            const newGroup = buildGroupFromItems(
                incomingGroup.tableId,
                appendedItems,
                incomingGroup,
            );
            groups.push(newGroup);
            groupIndexByTableId.set(incomingGroup.tableId, groups.length - 1);
            continue;
        }

        const existingGroup = groups[existingGroupIndex];
        const nextItems = existingGroup.items.map((item) => ({ ...item }));
        const itemIndexByKey = new Map<string, number>(
            nextItems.map((item, index) => [item.key, index]),
        );
        const incomingKeys = new Set(incomingGroup.items.map((item) => item.key));
        const netZeroConsolidatedKeys = new Set<string>();

        for (const incomingItem of incomingGroup.items) {
            const existingItemIndex = itemIndexByKey.get(incomingItem.key);
            const existingItem =
                existingItemIndex !== undefined ? nextItems[existingItemIndex] : undefined;
            if (!existingItem) {
                const normalized = normalizeIncomingItem(incomingItem);
                if (normalized) {
                    nextItems.push({
                        ...normalized,
                        order: nextOrder,
                    });
                    itemIndexByKey.set(incomingItem.key, nextItems.length - 1);
                    nextOrder += 1;
                }
                continue;
            }

            const mergedItem = mergePendingItems(existingItem, incomingItem);
            if (!mergedItem) {
                nextItems.splice(existingItemIndex ?? 0, 1);
                netZeroConsolidatedKeys.add(incomingItem.key);
                itemIndexByKey.clear();
                nextItems.forEach((item, index) => itemIndexByKey.set(item.key, index));
                continue;
            }

            nextItems[existingItemIndex ?? 0] = {
                ...mergedItem,
                order: existingItem.order,
            };
        }

        // Safety guard: preserve pre-existing entries unless they were explicitly
        // consolidated to net-zero by an incoming update for the same key.
        for (const existingItem of existingGroup.items) {
            if (
                !incomingKeys.has(existingItem.key) &&
                !nextItems.some((item) => item.key === existingItem.key)
            ) {
                nextItems.push({ ...existingItem });
            }
            if (
                incomingKeys.has(existingItem.key) &&
                !netZeroConsolidatedKeys.has(existingItem.key) &&
                !nextItems.some((item) => item.key === existingItem.key)
            ) {
                nextItems.push({ ...existingItem });
            }
        }

        if (nextItems.length === 0) {
            groups.splice(existingGroupIndex, 1);
            groupIndexByTableId.clear();
            groups.forEach((group, index) => groupIndexByTableId.set(group.tableId, index));
            continue;
        }

        groups[existingGroupIndex] = buildGroupFromItems(
            incomingGroup.tableId,
            nextItems,
            existingGroup,
        );
    }

    return groups.filter((group) => group.items.length > 0);
}

export function flattenPendingAiItems(groups: PendingAiTableGroup[]): PendingAiItem[] {
    return groups.flatMap((group) => group.items);
}
