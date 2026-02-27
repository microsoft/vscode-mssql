/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Edge, MarkerType, Node, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContextProps } from "../../schemaDesignerStateProvider";
import eventBus from "../../schemaDesignerEvents";
import {
    buildFlowComponentsFromSchema,
    createSchemaDesignerIndex,
    getColumnById,
    getTableById,
    buildSchemaFromFlowState,
    getTableHeight,
    getTableWidth,
    layoutFlowComponents,
} from "../../model";
import {
    calculateSchemaDiff,
    ChangeAction,
    ChangeCategory,
    SchemaChange,
    SchemaChangesSummary,
} from "../../diff/diffUtils";
import {
    getDeletedColumnIdsByTable,
    getDeletedForeignKeyIds,
    getDeletedTableIds,
    getModifiedColumnHighlights,
    getModifiedForeignKeyIds,
    getModifiedTableHighlights,
    getNewColumnIds,
    getNewForeignKeyIds,
    getNewTableIds,
    type ModifiedColumnHighlight,
    type ModifiedTableHighlight,
} from "../../diff/diffHighlights";
import {
    buildDeletedForeignKeyEdges,
    filterDeletedNodes,
    toSchemaTables,
} from "../../diff/deletedVisualUtils";
import {
    canRevertChange as canRevertChangeCore,
    computeRevertedSchema,
    CanRevertResult,
} from "../../diff/revertChange";
import { locConstants } from "../../../../common/locConstants";
import { buildForeignKeyEdgeId, removeEdgesForForeignKey } from "../../schemaDesignerEdgeUtils";

export interface HighlightOverride {
    newTableIds: Set<string>;
    newColumnIds: Set<string>;
    newForeignKeyIds: Set<string>;
    modifiedForeignKeyIds: Set<string>;
    modifiedColumnHighlights: Map<string, ModifiedColumnHighlight>;
    modifiedTableHighlights: Map<string, ModifiedTableHighlight>;
    deletedColumnsByTable: Map<string, SchemaDesigner.Column[]>;
    deletedForeignKeyEdges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[];
    baselineColumnOrderByTable: Map<string, string[]>;
    deletedTableNodes: Node<SchemaDesigner.TableWithDeletedFlag>[];
    /** Override for revertChange when copilot highlights are active */
    revertChange?: (change: SchemaChange) => void;
    /** Override for canRevertChange when copilot highlights are active */
    canRevertChange?: (change: SchemaChange) => CanRevertResult;
    /** Accept action (e.g. accept copilot change) */
    acceptChange?: (change: SchemaChange) => void;
}

export interface SchemaDesignerChangeContextProps {
    showChangesHighlight: boolean;
    setShowChangesHighlight: (value: boolean) => void;
    newTableIds: Set<string>;
    newColumnIds: Set<string>;
    newForeignKeyIds: Set<string>;
    modifiedForeignKeyIds: Set<string>;
    modifiedColumnHighlights: Map<string, ModifiedColumnHighlight>;
    modifiedTableHighlights: Map<string, ModifiedTableHighlight>;
    deletedColumnsByTable: Map<string, SchemaDesigner.Column[]>;
    deletedForeignKeyEdges: Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[];
    baselineColumnOrderByTable: Map<string, string[]>;
    deletedTableNodes: Node<SchemaDesigner.TableWithDeletedFlag>[];
    schemaChangesCount: number;
    schemaChangesSummary: SchemaChangesSummary | undefined;
    structuredSchemaChanges: SchemaChange[];
    revertChange: (change: SchemaChange) => void;
    canRevertChange: (change: SchemaChange) => CanRevertResult;
    /** Accept action available when copilot highlight override is active */
    acceptChange?: (change: SchemaChange) => void;
    /** Set a highlight override to replace diff-computed highlights (e.g. copilot) */
    setHighlightOverride: (override: HighlightOverride | null) => void;
}

export const useSchemaDesignerChangeState = (
    context: SchemaDesignerContextProps,
): SchemaDesignerChangeContextProps => {
    const reactFlow = useReactFlow<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>();
    const [showChangesHighlight, setShowChangesHighlight] = useState<boolean>(false);
    const [schemaChangesCount, setSchemaChangesCount] = useState<number>(0);
    const [schemaChangesSummary, setSchemaChangesSummary] = useState<
        SchemaChangesSummary | undefined
    >(undefined);
    const [structuredSchemaChanges, setStructuredSchemaChanges] = useState<SchemaChange[]>([]);
    const [newTableIds, setNewTableIds] = useState<Set<string>>(new Set());
    const [newColumnIds, setNewColumnIds] = useState<Set<string>>(new Set());
    const [newForeignKeyIds, setNewForeignKeyIds] = useState<Set<string>>(new Set());
    const [modifiedForeignKeyIds, setModifiedForeignKeyIds] = useState<Set<string>>(new Set());
    const [modifiedColumnHighlights, setModifiedColumnHighlights] = useState<
        Map<string, ModifiedColumnHighlight>
    >(new Map());
    const [modifiedTableHighlights, setModifiedTableHighlights] = useState<
        Map<string, ModifiedTableHighlight>
    >(new Map());
    const [deletedColumnsByTable, setDeletedColumnsByTable] = useState<
        Map<string, SchemaDesigner.Column[]>
    >(new Map());
    const [deletedForeignKeyEdges, setDeletedForeignKeyEdges] = useState<
        Edge<SchemaDesigner.ForeignKeyWithDeletedFlag>[]
    >([]);
    const [baselineColumnOrderByTable, setBaselineColumnOrderByTable] = useState<
        Map<string, string[]>
    >(new Map());
    const [deletedTableNodes, setDeletedTableNodes] = useState<
        Node<SchemaDesigner.TableWithDeletedFlag>[]
    >([]);
    const [highlightOverride, setHighlightOverride] = useState<HighlightOverride | undefined>(
        undefined,
    );

    const baselineSchemaRef = useRef<SchemaDesigner.Schema | undefined>(undefined);
    const lastHasChangesRef = useRef<boolean | undefined>(undefined);

    const notifyDirtyState = useCallback(
        (hasChanges: boolean) => {
            if (lastHasChangesRef.current === hasChanges) {
                return;
            }
            lastHasChangesRef.current = hasChanges;
            void context.extensionRpc.sendNotification(
                SchemaDesigner.SchemaDesignerDirtyStateNotification.type,
                { hasChanges },
            );
        },
        [context.extensionRpc],
    );

    const resetChangeState = useCallback(
        (resetHighlight: boolean) => {
            if (resetHighlight) {
                setShowChangesHighlight(false);
            }
            setSchemaChangesCount(0);
            setSchemaChangesSummary(undefined);
            setStructuredSchemaChanges([]);
            setNewTableIds(new Set());
            setNewColumnIds(new Set());
            setNewForeignKeyIds(new Set());
            setModifiedColumnHighlights(new Map());
            setModifiedTableHighlights(new Map());
            setModifiedForeignKeyIds(new Set());
            setDeletedColumnsByTable(new Map());
            setDeletedForeignKeyEdges([]);
            setBaselineColumnOrderByTable(new Map());
            setDeletedTableNodes([]);
            notifyDirtyState(false);
        },
        [notifyDirtyState],
    );

    const ensureBaselineSchema = useCallback(async () => {
        if (!baselineSchemaRef.current) {
            baselineSchemaRef.current = await context.extensionRpc.sendRequest(
                SchemaDesigner.GetBaselineSchemaRequest.type,
            );
        }
        return baselineSchemaRef.current;
    }, [context.extensionRpc]);

    const updateSchemaChanges = useCallback(async () => {
        if (!context.isInitialized) {
            return;
        }

        try {
            const baselineSchema = await ensureBaselineSchema();
            if (!baselineSchema) {
                return;
            }

            const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
            const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
            const currentSchema = buildSchemaFromFlowState(nodes, edges);
            const summary = calculateSchemaDiff(baselineSchema, currentSchema);

            setStructuredSchemaChanges(summary.groups.flatMap((group) => group.changes));
            setSchemaChangesSummary(summary);

            const orderMap = new Map<string, string[]>();
            for (const table of baselineSchema.tables) {
                orderMap.set(
                    table.id,
                    (table.columns ?? []).map((column) => column.id),
                );
            }
            setBaselineColumnOrderByTable(orderMap);
            setNewTableIds(getNewTableIds(summary));
            setNewColumnIds(getNewColumnIds(summary));
            setNewForeignKeyIds(getNewForeignKeyIds(summary));
            setModifiedColumnHighlights(getModifiedColumnHighlights(summary));
            setModifiedTableHighlights(getModifiedTableHighlights(summary));
            setModifiedForeignKeyIds(getModifiedForeignKeyIds(summary));

            const deletedColumnsByTableIds = getDeletedColumnIdsByTable(summary);
            const deletedForeignKeyIds = getDeletedForeignKeyIds(summary);
            const deletedTableIds = getDeletedTableIds(summary);
            const baselineTablesById = new Map(
                baselineSchema.tables.map((table) => [table.id, table]),
            );
            const deletedColumns = new Map<string, SchemaDesigner.Column[]>();
            if (deletedColumnsByTableIds.size > 0) {
                for (const [tableId, columnIds] of deletedColumnsByTableIds) {
                    const baselineTable = baselineTablesById.get(tableId);
                    if (!baselineTable) {
                        continue;
                    }
                    const columns = baselineTable.columns.filter((column) =>
                        columnIds.has(column.id),
                    );
                    if (columns.length > 0) {
                        deletedColumns.set(
                            tableId,
                            columns.map((column) => ({ ...column })),
                        );
                    }
                }
            }

            const currentNodes = filterDeletedNodes(
                reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            );
            let bottomY = 100;
            if (currentNodes.length > 0) {
                const visibleCurrentNodes = currentNodes.filter((n) => n.hidden !== true);
                if (visibleCurrentNodes.length > 0) {
                    bottomY = visibleCurrentNodes.reduce((maxY, node) => {
                        const nodeBottom = node.position.y + getTableHeight(node.data);
                        return Math.max(maxY, nodeBottom);
                    }, 0);
                    bottomY += 50;
                }
            }

            const { nodes: baselineNodes } = (() => {
                const { nodes: rawNodes, edges: rawEdges } =
                    buildFlowComponentsFromSchema(baselineSchema);
                return layoutFlowComponents(rawNodes, rawEdges);
            })();

            const deletedNodes =
                deletedTableIds.size > 0
                    ? baselineNodes
                          .filter((node) => deletedTableIds.has(node.id))
                          .map((node, index) => ({
                              ...node,
                              id: `deleted-${node.id}`,
                              data: { ...node.data, isDeleted: true },
                              position: {
                                  x: 100 + (index % 3) * (getTableWidth() + 50),
                                  y:
                                      bottomY +
                                      Math.floor(index / 3) * (getTableHeight(node.data) + 50),
                              },
                              draggable: true,
                              selectable: false,
                              connectable: false,
                              deletable: false,
                              focusable: false,
                          }))
                    : [];

            const deletedEdges =
                deletedForeignKeyIds.size > 0
                    ? buildDeletedForeignKeyEdges({
                          baselineSchema,
                          currentNodes,
                          deletedForeignKeyIds,
                          deletedTableNodes: deletedNodes,
                      })
                    : [];

            setDeletedColumnsByTable(deletedColumns);
            setDeletedForeignKeyEdges(deletedEdges);
            setDeletedTableNodes(deletedNodes);
            setSchemaChangesCount(summary.totalChanges);
            notifyDirtyState(summary.totalChanges > 0);
        } catch {
            // Ignore diff errors; schema designer should remain usable.
        }
    }, [context.isInitialized, ensureBaselineSchema, notifyDirtyState, reactFlow]);

    useEffect(() => {
        baselineSchemaRef.current = undefined;
        resetChangeState(true);
    }, [context.baselineRevision, resetChangeState]);

    useEffect(() => {
        if (!context.isInitialized) {
            return;
        }
        const rafId = requestAnimationFrame(() => {
            void updateSchemaChanges();
        });
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [
        context.baselineRevision,
        context.isInitialized,
        context.schemaRevision,
        updateSchemaChanges,
    ]);

    const canRevertChange = useCallback(
        (change: SchemaChange): CanRevertResult => {
            const baselineSchema = baselineSchemaRef.current;
            const loc = locConstants.schemaDesigner.changesPanel;

            if (!baselineSchema) {
                return { canRevert: false, reason: loc.cannotRevertForeignKey };
            }

            const currentNodes = filterDeletedNodes(
                reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            );
            const currentSchema = {
                tables: toSchemaTables(currentNodes),
            };

            const messages = {
                cannotRevertForeignKey: loc.cannotRevertForeignKey,
                cannotRevertDeletedColumn: loc.cannotRevertDeletedColumn,
            };

            return canRevertChangeCore(
                change,
                baselineSchema,
                currentSchema,
                structuredSchemaChanges,
                messages,
            );
        },
        [reactFlow, structuredSchemaChanges],
    );

    const revertChange = useCallback(
        (change: SchemaChange) => {
            const baselineSchema = baselineSchemaRef.current;
            if (!baselineSchema) {
                return;
            }

            const existingNodes = filterDeletedNodes(
                reactFlow.getNodes() as Node<SchemaDesigner.Table>[],
            );
            let existingEdges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
            const currentSchema = {
                tables: toSchemaTables(existingNodes),
            };

            if (change.category === ChangeCategory.Table && change.action === ChangeAction.Add) {
                const nodeToDelete = existingNodes.find((n) => n.id === change.tableId);
                if (nodeToDelete) {
                    void reactFlow.deleteElements({ nodes: [nodeToDelete] });
                    eventBus.emit("pushState");
                    context.notifySchemaChanged();
                    return;
                }
            }

            if (change.category === ChangeCategory.Table && change.action === ChangeAction.Delete) {
                const baselineTable = baselineSchema.tables.find(
                    (table) => table.id === change.tableId,
                );
                if (baselineTable) {
                    void context.addTable({ ...baselineTable, foreignKeys: [] });
                    eventBus.emit("pushState");
                    context.notifySchemaChanged();
                    return;
                }
            }

            const result = computeRevertedSchema(change, baselineSchema, currentSchema);

            if (!result.success) {
                console.error("Failed to revert change:", result.error);
                return;
            }

            const updatedNodes = existingNodes.map((node) => {
                const revertedTable = result.tables.find((table) => table.id === node.id);
                if (revertedTable) {
                    return {
                        ...node,
                        data: revertedTable,
                    };
                }
                return node;
            });

            if (change.category === ChangeCategory.ForeignKey) {
                const currentNode = updatedNodes.find((node) => node.id === change.tableId);

                if (change.action === ChangeAction.Add) {
                    existingEdges = removeEdgesForForeignKey(existingEdges, change.objectId);
                } else if (
                    change.action === ChangeAction.Delete ||
                    change.action === ChangeAction.Modify
                ) {
                    existingEdges = removeEdgesForForeignKey(existingEdges, change.objectId);

                    const baselineTable = baselineSchema.tables.find(
                        (table) => table.id === change.tableId,
                    );
                    const baselineForeignKey = baselineTable?.foreignKeys?.find(
                        (foreignKey) => foreignKey.id === change.objectId,
                    );

                    if (baselineForeignKey && currentNode) {
                        const updatedSchemaIndex = createSchemaDesignerIndex({
                            tables: updatedNodes.map((node) => node.data),
                        });
                        const referencedTable = getTableById(
                            updatedSchemaIndex,
                            baselineForeignKey.referencedTableId,
                        );

                        if (referencedTable) {
                            for (
                                let index = 0;
                                index < baselineForeignKey.columnsIds.length;
                                index++
                            ) {
                                const sourceColumnId = baselineForeignKey.columnsIds[index];
                                const referencedColumnId =
                                    baselineForeignKey.referencedColumnsIds[index];

                                if (!sourceColumnId || !referencedColumnId) {
                                    continue;
                                }

                                const sourceColumn = getColumnById(
                                    updatedSchemaIndex,
                                    currentNode.id,
                                    sourceColumnId,
                                );
                                const targetColumn = getColumnById(
                                    updatedSchemaIndex,
                                    referencedTable.id,
                                    referencedColumnId,
                                );

                                if (!sourceColumn || !targetColumn) {
                                    continue;
                                }

                                existingEdges.push({
                                    id: buildForeignKeyEdgeId(
                                        currentNode.id,
                                        referencedTable.id,
                                        sourceColumn.id,
                                        targetColumn.id,
                                    ),
                                    source: currentNode.id,
                                    target: referencedTable.id,
                                    sourceHandle: `right-${sourceColumn.id}`,
                                    targetHandle: `left-${targetColumn.id}`,
                                    markerEnd: { type: MarkerType.ArrowClosed },
                                    data: {
                                        ...baselineForeignKey,
                                        columnsIds: [sourceColumn.id],
                                        referencedColumnsIds: [targetColumn.id],
                                    },
                                });
                            }
                        }
                    }
                }

                reactFlow.setEdges(existingEdges);
            }

            reactFlow.setNodes(updatedNodes);
            eventBus.emit("refreshFlowState");
            eventBus.emit("pushState");
            context.notifySchemaChanged();
        },
        [context, reactFlow],
    );

    return useMemo(
        () => ({
            showChangesHighlight,
            setShowChangesHighlight,
            newTableIds: highlightOverride?.newTableIds ?? newTableIds,
            newColumnIds: highlightOverride?.newColumnIds ?? newColumnIds,
            newForeignKeyIds: highlightOverride?.newForeignKeyIds ?? newForeignKeyIds,
            modifiedForeignKeyIds:
                highlightOverride?.modifiedForeignKeyIds ?? modifiedForeignKeyIds,
            modifiedColumnHighlights:
                highlightOverride?.modifiedColumnHighlights ?? modifiedColumnHighlights,
            modifiedTableHighlights:
                highlightOverride?.modifiedTableHighlights ?? modifiedTableHighlights,
            deletedColumnsByTable:
                highlightOverride?.deletedColumnsByTable ?? deletedColumnsByTable,
            deletedForeignKeyEdges:
                highlightOverride?.deletedForeignKeyEdges ?? deletedForeignKeyEdges,
            baselineColumnOrderByTable:
                highlightOverride?.baselineColumnOrderByTable ?? baselineColumnOrderByTable,
            deletedTableNodes: highlightOverride?.deletedTableNodes ?? deletedTableNodes,
            schemaChangesCount,
            schemaChangesSummary,
            structuredSchemaChanges,
            revertChange: highlightOverride?.revertChange ?? revertChange,
            canRevertChange: highlightOverride?.canRevertChange ?? canRevertChange,
            acceptChange: highlightOverride?.acceptChange,
            setHighlightOverride: (override: HighlightOverride | null) =>
                setHighlightOverride(override ?? undefined),
        }),
        [
            baselineColumnOrderByTable,
            canRevertChange,
            deletedColumnsByTable,
            deletedForeignKeyEdges,
            deletedTableNodes,
            highlightOverride,
            modifiedColumnHighlights,
            modifiedForeignKeyIds,
            modifiedTableHighlights,
            newColumnIds,
            newForeignKeyIds,
            newTableIds,
            revertChange,
            schemaChangesCount,
            schemaChangesSummary,
            showChangesHighlight,
            structuredSchemaChanges,
        ],
    );
};
