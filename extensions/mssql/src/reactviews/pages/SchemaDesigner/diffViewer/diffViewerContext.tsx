/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import {
    getDiffCalculator,
    TableColumnChanges,
    DeletedColumnsMap,
    TablePositionMap,
} from "./diffCalculator";
import { ChangeCountTracker } from "./changeCountTracker";

/**
 * Default drawer width in pixels
 */
const DEFAULT_DRAWER_WIDTH = 320;

/**
 * Minimum drawer width in pixels
 */
const MIN_DRAWER_WIDTH = 200;

/**
 * Maximum drawer width as percentage of viewport
 */
const MAX_DRAWER_WIDTH_PERCENT = 0.5;

/**
 * Context value for diff viewer state management
 */
export interface DiffViewerContextValue {
    /** Current diff viewer state */
    state: SchemaDesigner.DiffViewerState;
    /** Toggle drawer open/closed */
    toggleDrawer: () => void;
    /** Set drawer open state explicitly */
    setDrawerOpen: (open: boolean) => void;
    /** Set drawer width */
    setDrawerWidth: (width: number) => void;
    /** Select a change for navigation */
    selectChange: (changeId: string | undefined) => void;
    /** Toggle expansion state of a change group */
    toggleGroupExpansion: (tableId: string) => void;
    /** Undo a specific change */
    undoChange: (change: SchemaDesigner.SchemaChange) => void;
    /** Recalculate diff (called when drawer opens) */
    recalculateDiff: () => void;
    /** Navigate to element in canvas */
    navigateToElement: (change: SchemaDesigner.SchemaChange) => void;
    /** Get the change count tracker instance */
    changeCountTracker: ChangeCountTracker;
    /** Trigger reveal highlight animation on an element */
    triggerRevealHighlight: (elementId: string, elementType: "table" | "foreignKey") => void;
    /** Clear the current reveal highlight */
    clearRevealHighlight: () => void;
}

/**
 * Props for the DiffViewerProvider component
 */
export interface DiffViewerProviderProps {
    /** Child components */
    children: React.ReactNode;
    /** Original schema loaded at session start */
    originalSchema: SchemaDesigner.Schema;
    /** Original table positions for ghost node placement */
    originalTablePositions?: TablePositionMap;
    /** Function to get current schema from ReactFlow state */
    getCurrentSchema: () => SchemaDesigner.Schema;
    /** Callback to navigate canvas to an entity */
    onNavigateToEntity?: (change: SchemaDesigner.SchemaChange) => void;
    /** Callback when a change is undone */
    onUndoChange?: (change: SchemaDesigner.SchemaChange) => void;
    /** Callback to persist drawer width */
    onDrawerWidthChange?: (width: number) => void;
    /** Initial drawer width from persisted state */
    initialDrawerWidth?: number;
}

/**
 * Create the context with undefined default
 */
const DiffViewerContext = createContext<DiffViewerContextValue | undefined>(undefined);

/**
 * Provider component for diff viewer state
 */
export const DiffViewerProvider: React.FC<DiffViewerProviderProps> = ({
    children,
    originalSchema,
    originalTablePositions,
    getCurrentSchema,
    onNavigateToEntity,
    onUndoChange,
    onDrawerWidthChange,
    initialDrawerWidth,
}) => {
    // State
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [drawerWidth, setDrawerWidthState] = useState(initialDrawerWidth || DEFAULT_DRAWER_WIDTH);
    const [selectedChangeId, setSelectedChangeId] = useState<string | undefined>(undefined);
    const [changeGroups, setChangeGroups] = useState<SchemaDesigner.ChangeGroup[]>([]);
    const [groupExpansion, setGroupExpansion] = useState<Record<string, boolean>>({});
    const [changeCounts, setChangeCounts] = useState<SchemaDesigner.ChangeCountSummary>({
        additions: 0,
        modifications: 0,
        deletions: 0,
        total: 0,
    });
    const [deletedTableIds, setDeletedTableIds] = useState<Set<string>>(new Set());
    const [deletedForeignKeyIds, setDeletedForeignKeyIds] = useState<Set<string>>(new Set());
    // Column-level change tracking for UI indicators
    const [tableColumnChanges, setTableColumnChanges] = useState<TableColumnChanges>({});
    const [deletedColumns, setDeletedColumns] = useState<DeletedColumnsMap>({});
    // Reveal highlight state for animation
    const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
    const [highlightedElementType, setHighlightedElementType] = useState<
        "table" | "foreignKey" | null
    >(null);
    // Ghost nodes/edges for deleted elements visualization (T005)
    const [ghostNodes, setGhostNodes] = useState<SchemaDesigner.GhostNodeData[]>([]);
    const [ghostEdges, setGhostEdges] = useState<SchemaDesigner.GhostEdgeData[]>([]);
    // Table rename info for strikethrough display (T006)
    const [tableRenameInfo, setTableRenameInfo] = useState<{
        [tableId: string]: SchemaDesigner.RenameDisplayInfo;
    }>({});
    // FK modification type tracking (T006)
    const [fkModificationType, setFkModificationType] = useState<{
        [fkId: string]: "property" | "structural";
    }>({});

    // Get shared instances
    const diffCalculator = useMemo(() => getDiffCalculator(), []);
    const changeCountTracker = useMemo(() => new ChangeCountTracker(), []);

    // Subscribe to change count updates
    React.useEffect(() => {
        const unsubscribe = changeCountTracker.subscribe((counts) => {
            setChangeCounts(counts);
        });
        return unsubscribe;
    }, [changeCountTracker]);

    /**
     * Recalculate diff from schemas
     */
    const recalculateDiff = useCallback(() => {
        const currentSchema = getCurrentSchema();
        const result = diffCalculator.calculateDiff({
            originalSchema,
            currentSchema,
            originalTablePositions,
        });
        const nextGroups = result.changeGroups.map((group) => {
            const persisted = groupExpansion[group.tableId];
            if (persisted === undefined) {
                return group;
            }
            return { ...group, isExpanded: persisted };
        });
        setChangeGroups(nextGroups);
        setChangeCounts(result.summary);
        // Update the tracker with the calculated counts
        changeCountTracker.setFromSummary(result.summary);

        // Populate column-level change tracking from extended result
        setTableColumnChanges(result.tableColumnChanges);
        setDeletedColumns(result.deletedColumns);

        // Extract deleted table and foreign key IDs for canvas indicators
        const deletedTables = new Set<string>();
        const deletedFKs = new Set<string>();
        for (const change of result.changes) {
            if (change.changeType === SchemaDesigner.SchemaChangeType.Deletion) {
                if (change.entityType === SchemaDesigner.SchemaEntityType.Table) {
                    deletedTables.add(change.entityId);
                } else if (change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey) {
                    deletedFKs.add(change.entityId);
                }
            }
        }
        setDeletedTableIds(deletedTables);
        setDeletedForeignKeyIds(deletedFKs);

        // Set ghost nodes and edges for deleted element visualization (T012)
        setGhostNodes(result.ghostNodes);
        setGhostEdges(result.ghostEdges);

        // Set table rename info for strikethrough display (T035)
        setTableRenameInfo(result.tableRenameInfo);

        // Set FK modification type map (T045)
        setFkModificationType(result.fkModificationType);
    }, [
        diffCalculator,
        originalSchema,
        originalTablePositions,
        getCurrentSchema,
        changeCountTracker,
        groupExpansion,
    ]);

    /**
     * Toggle drawer open/closed
     */
    const toggleDrawer = useCallback(() => {
        setIsDrawerOpen((prev) => {
            const newState = !prev;
            // Recalculate diff when opening
            if (newState) {
                recalculateDiff();
            }
            return newState;
        });
    }, [recalculateDiff]);

    /**
     * Set drawer open state explicitly
     */
    const setDrawerOpen = useCallback(
        (open: boolean) => {
            setIsDrawerOpen(open);
            if (open) {
                recalculateDiff();
            }
        },
        [recalculateDiff],
    );

    /**
     * Set drawer width with constraints
     */
    const setDrawerWidth = useCallback(
        (width: number) => {
            const maxWidth = window.innerWidth * MAX_DRAWER_WIDTH_PERCENT;
            const constrainedWidth = Math.max(MIN_DRAWER_WIDTH, Math.min(width, maxWidth));
            setDrawerWidthState(constrainedWidth);
            onDrawerWidthChange?.(constrainedWidth);
        },
        [onDrawerWidthChange],
    );

    /**
     * Select a change for navigation
     */
    const selectChange = useCallback((changeId: string | undefined) => {
        setSelectedChangeId(changeId);
    }, []);

    /**
     * Toggle group expansion
     */
    const toggleGroupExpansion = useCallback((tableId: string) => {
        setChangeGroups((groups) => {
            const nextGroups = groups.map((group) =>
                group.tableId === tableId ? { ...group, isExpanded: !group.isExpanded } : group,
            );
            const updatedGroup = nextGroups.find((group) => group.tableId === tableId);
            if (updatedGroup) {
                setGroupExpansion((prev) => ({
                    ...prev,
                    [tableId]: updatedGroup.isExpanded,
                }));
            }
            return nextGroups;
        });
    }, []);

    /**
     * Undo a specific change
     */
    const undoChange = useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            onUndoChange?.(change);
            // After undo, recalculate diff
            // Note: The parent component should update currentSchema, which will trigger recalculation
        },
        [onUndoChange],
    );

    /**
     * Navigate to element in canvas
     */
    const navigateToElement = useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            setSelectedChangeId(change.id);
            onNavigateToEntity?.(change);

            // Trigger reveal highlight based on entity type
            if (change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey) {
                setHighlightedElementId(change.entityId);
                setHighlightedElementType("foreignKey");
            } else {
                // For table, column changes - highlight the table
                setHighlightedElementId(change.tableId);
                setHighlightedElementType("table");
            }
        },
        [onNavigateToEntity],
    );

    /**
     * Trigger reveal highlight animation on an element
     */
    const triggerRevealHighlight = useCallback(
        (elementId: string, elementType: "table" | "foreignKey") => {
            setHighlightedElementId(elementId);
            setHighlightedElementType(elementType);
        },
        [],
    );

    /**
     * Clear the current reveal highlight
     */
    const clearRevealHighlight = useCallback(() => {
        setHighlightedElementId(null);
        setHighlightedElementType(null);
    }, []);

    // T033: Auto-clear FK highlight after animation completes (~2s)
    // FK edges use CSS animation, unlike table nodes which have onAnimationEnd handler
    React.useEffect(() => {
        if (highlightedElementType === "foreignKey" && highlightedElementId) {
            // CSS animation is 0.8s x 2 iterations = 1.6s, add buffer
            const startTime = performance.now();
            let rafId = 0;

            const tick = (now: number) => {
                if (now - startTime >= 2000) {
                    setHighlightedElementId(null);
                    setHighlightedElementType(null);
                    return;
                }
                rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);

            return () => cancelAnimationFrame(rafId);
        }
    }, [highlightedElementId, highlightedElementType]);

    // Build the state object
    const state: SchemaDesigner.DiffViewerState = useMemo(
        () => ({
            isDrawerOpen,
            drawerWidth,
            selectedChangeId,
            changeGroups,
            showCanvasIndicators: isDrawerOpen,
            changeCounts,
            deletedTableIds,
            deletedForeignKeyIds,
            tableColumnChanges,
            deletedColumns,
            highlightedElementId,
            highlightedElementType,
            ghostNodes,
            ghostEdges,
            tableRenameInfo,
            fkModificationType,
        }),
        [
            isDrawerOpen,
            drawerWidth,
            selectedChangeId,
            changeGroups,
            changeCounts,
            deletedTableIds,
            deletedForeignKeyIds,
            tableColumnChanges,
            deletedColumns,
            highlightedElementId,
            highlightedElementType,
            ghostNodes,
            ghostEdges,
            tableRenameInfo,
            fkModificationType,
        ],
    );

    // Build the context value
    const contextValue: DiffViewerContextValue = useMemo(
        () => ({
            state,
            toggleDrawer,
            setDrawerOpen,
            setDrawerWidth,
            selectChange,
            toggleGroupExpansion,
            undoChange,
            recalculateDiff,
            navigateToElement,
            changeCountTracker,
            triggerRevealHighlight,
            clearRevealHighlight,
        }),
        [
            state,
            toggleDrawer,
            setDrawerOpen,
            setDrawerWidth,
            selectChange,
            toggleGroupExpansion,
            undoChange,
            recalculateDiff,
            navigateToElement,
            changeCountTracker,
            triggerRevealHighlight,
            clearRevealHighlight,
        ],
    );

    return <DiffViewerContext.Provider value={contextValue}>{children}</DiffViewerContext.Provider>;
};

/**
 * Hook to access diff viewer context
 * @throws Error if used outside of DiffViewerProvider
 */
export function useDiffViewer(): DiffViewerContextValue {
    const context = useContext(DiffViewerContext);
    if (!context) {
        throw new Error("useDiffViewer must be used within a DiffViewerProvider");
    }
    return context;
}

/**
 * Hook to safely access diff viewer context without throwing.
 * Returns undefined when used outside of DiffViewerProvider.
 * Use this for components that may be rendered outside the provider context
 * (e.g., ShowChangesButton in toolbar when diff viewer feature is disabled).
 */
export function useDiffViewerOptional(): DiffViewerContextValue | undefined {
    return useContext(DiffViewerContext);
}

/**
 * Hook to access just the diff viewer state (for components that only read state)
 */
export function useDiffViewerState(): SchemaDesigner.DiffViewerState {
    const { state } = useDiffViewer();
    return state;
}

/**
 * Hook to access change counts (for toolbar button)
 */
export function useChangeCounts(): SchemaDesigner.ChangeCountSummary {
    const { state } = useDiffViewer();
    return state.changeCounts;
}

/**
 * Hook to access ghost nodes for deleted table visualization (T013).
 * Returns array of ghost nodes when drawer is open, empty array otherwise.
 */
export function useGhostNodes(): SchemaDesigner.GhostNodeData[] {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        if (!context || !context.state.showCanvasIndicators) {
            return [];
        }
        return context.state.ghostNodes;
    }, [context]);
}

/**
 * Hook to access ghost edges for deleted FK visualization (T013).
 * Returns array of ghost edges when drawer is open, empty array otherwise.
 */
export function useGhostEdges(): SchemaDesigner.GhostEdgeData[] {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        if (!context || !context.state.showCanvasIndicators) {
            return [];
        }
        return context.state.ghostEdges;
    }, [context]);
}

/**
 * Hook to access table rename info for strikethrough display (T036).
 * Returns rename info map when drawer is open, empty object otherwise.
 */
export function useTableRenameInfo(): { [tableId: string]: SchemaDesigner.RenameDisplayInfo } {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        if (!context || !context.state.showCanvasIndicators) {
            return {};
        }
        return context.state.tableRenameInfo;
    }, [context]);
}

/**
 * Hook to get rename info for a specific table.
 * Returns RenameDisplayInfo if table was renamed and drawer is open, undefined otherwise.
 */
export function useTableRename(tableId: string): SchemaDesigner.RenameDisplayInfo | undefined {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        if (!context || !context.state.showCanvasIndicators) {
            return undefined;
        }
        return context.state.tableRenameInfo[tableId];
    }, [context, tableId]);
}

/**
 * Hook to access FK modification type map.
 * Returns map of FK ID to modification type when drawer is open.
 */
export function useFkModificationType(): { [fkId: string]: "property" | "structural" } {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        if (!context || !context.state.showCanvasIndicators) {
            return {};
        }
        return context.state.fkModificationType;
    }, [context]);
}

/**
 * Diff indicator state for a table node
 */
export interface TableDiffIndicator {
    /** Whether to show the indicator */
    showIndicator: boolean;
    /** The aggregate state of changes for this table (uses SchemaChangeType) */
    aggregateState: SchemaDesigner.SchemaChangeType | undefined;
}

/**
 * Hook to get the diff indicator state for a specific table.
 * Returns information about whether to show a colored border and what color.
 *
 * @param tableId - The ID of the table to check
 * @returns TableDiffIndicator with showIndicator and aggregateState
 */
export function useTableDiffIndicator(tableId: string): TableDiffIndicator {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        // If context is not available or drawer is not open, don't show indicators
        if (!context || !context.state.showCanvasIndicators) {
            return { showIndicator: false, aggregateState: undefined };
        }

        // Check if this table was deleted (exists in original but not current)
        if (context.state.deletedTableIds.has(tableId)) {
            return {
                showIndicator: true,
                aggregateState: SchemaDesigner.SchemaChangeType.Deletion,
            };
        }

        // If table was renamed, always show modification indicator
        if (context.state.tableRenameInfo[tableId]) {
            return {
                showIndicator: true,
                aggregateState: SchemaDesigner.SchemaChangeType.Modification,
            };
        }

        // Find the change group for this table
        const changeGroup = context.state.changeGroups.find((group) => group.tableId === tableId);

        if (!changeGroup) {
            return { showIndicator: false, aggregateState: undefined };
        }

        return {
            showIndicator: true,
            aggregateState: changeGroup.aggregateState,
        };
    }, [context, tableId]);
}

/**
 * Diff indicator state for a single column
 */
export interface ColumnDiffIndicator {
    /** Whether to show the indicator dot */
    showIndicator: boolean;
    /** The change type (determines color) */
    changeType: SchemaDesigner.SchemaChangeType | undefined;
}

/**
 * Hook to get the diff indicator state for a specific column in a table.
 * Returns information about whether to show a colored indicator dot.
 *
 * @param tableId - The ID of the table containing the column
 * @param columnName - The name of the column to check
 * @returns ColumnDiffIndicator with showIndicator and changeType
 */
export function useColumnDiffIndicator(tableId: string, columnName: string): ColumnDiffIndicator {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        // If context is not available or drawer is not open, don't show indicators
        if (!context || !context.state.showCanvasIndicators) {
            return { showIndicator: false, changeType: undefined };
        }

        // Check if this table has any column changes
        const tableChanges = context.state.tableColumnChanges[tableId];
        if (!tableChanges) {
            return { showIndicator: false, changeType: undefined };
        }

        // Check if this specific column has a change
        const changeType = tableChanges[columnName];
        if (changeType !== undefined) {
            return {
                showIndicator: true,
                changeType,
            };
        }

        return { showIndicator: false, changeType: undefined };
    }, [context, tableId, columnName]);
}

/**
 * Hook to get deleted columns for a specific table.
 * Returns array of deleted column info for inline display in table nodes.
 *
 * @param tableId - The ID of the table to get deleted columns for
 * @returns Array of deleted column info, or empty array if none
 */
export function useDeletedColumns(tableId: string): Array<{
    name: string;
    dataType: string;
    isPrimaryKey: boolean;
    originalIndex: number;
}> {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        // If context is not available or drawer is not open, return empty array
        if (!context || !context.state.showCanvasIndicators) {
            return [];
        }

        // Get deleted columns for this table
        return context.state.deletedColumns[tableId] || [];
    }, [context, tableId]);
}

/**
 * Diff indicator state for a foreign key edge
 */
export interface ForeignKeyDiffIndicator {
    /** Whether to show the indicator */
    showIndicator: boolean;
    /** The change type for this foreign key */
    changeType: SchemaDesigner.SchemaChangeType | undefined;
}

/**
 * Hook to get the diff indicator state for a specific foreign key.
 * Returns information about whether to show colored styling on the edge.
 *
 * @param foreignKeyId - The ID of the foreign key to check
 * @returns ForeignKeyDiffIndicator with showIndicator and changeType
 */
export function useForeignKeyDiffIndicator(foreignKeyId: string): ForeignKeyDiffIndicator {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        // If context is not available or drawer is not open, don't show indicators
        if (!context || !context.state.showCanvasIndicators) {
            return { showIndicator: false, changeType: undefined };
        }

        // Check if this foreign key was deleted (exists in original but not current)
        if (context.state.deletedForeignKeyIds.has(foreignKeyId)) {
            return {
                showIndicator: true,
                changeType: SchemaDesigner.SchemaChangeType.Deletion,
            };
        }

        // Find if there's a change for this foreign key in any change group
        for (const group of context.state.changeGroups) {
            const fkChange = group.changes.find(
                (change) =>
                    change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey &&
                    change.entityId === foreignKeyId,
            );
            if (fkChange) {
                return {
                    showIndicator: true,
                    changeType: fkChange.changeType,
                };
            }
        }

        return { showIndicator: false, changeType: undefined };
    }, [context, foreignKeyId]);
}

/**
 * Gets the edge style for a specific change type
 */
function getEdgeStyleForChangeType(
    changeType: SchemaDesigner.SchemaChangeType,
): React.CSSProperties {
    switch (changeType) {
        case SchemaDesigner.SchemaChangeType.Addition:
            return {
                stroke: "var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
                strokeWidth: 2,
            };
        case SchemaDesigner.SchemaChangeType.Modification:
            return {
                stroke: "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
                strokeWidth: 2,
            };
        case SchemaDesigner.SchemaChangeType.Deletion:
            return {
                stroke: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
                strokeWidth: 2,
            };
        default:
            return {};
    }
}

/**
 * Hook to compute styled edges based on diff state.
 * Returns edges with added style properties for diff indicators and reveal highlight.
 *
 * @param edges - The original edges from ReactFlow state
 * @returns Edges with diff indicator styles applied
 */
export function useStyledEdgesForDiff<
    T extends {
        id: string;
        style?: React.CSSProperties;
        className?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data?: any;
    },
>(edges: T[]): T[] {
    const context = useContext(DiffViewerContext);

    return useMemo(() => {
        // If context is not available or drawer is not open, return edges unchanged
        if (!context || !context.state.showCanvasIndicators) {
            return edges;
        }

        const {
            deletedForeignKeyIds,
            changeGroups,
            highlightedElementId,
            highlightedElementType,
            fkModificationType,
        } = context.state;

        // Build a map of foreign key ID to change type for quick lookup
        const fkChangeTypes = new Map<string, SchemaDesigner.SchemaChangeType>();

        // Add deleted foreign keys
        for (const fkId of deletedForeignKeyIds) {
            fkChangeTypes.set(fkId, SchemaDesigner.SchemaChangeType.Deletion);
        }

        // Add foreign keys from change groups
        for (const group of changeGroups) {
            for (const change of group.changes) {
                if (change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey) {
                    fkChangeTypes.set(change.entityId, change.changeType);
                }
            }
        }

        // Apply styles to edges
        return edges.map((edge) => {
            const changeType = fkChangeTypes.get(edge.id);
            const isHighlighted =
                highlightedElementId === edge.id && highlightedElementType === "foreignKey";
            const isGhostEdge = edge.data?.isGhostEdge ?? false;

            // T019: Handle ghost edges (deleted foreign keys shown visually)
            if (isGhostEdge) {
                return {
                    ...edge,
                    style: {
                        ...edge.style,
                        stroke: "var(--vscode-editorError-foreground)",
                        strokeDasharray: "5,5",
                        opacity: 0.6,
                    },
                    className: [edge.className, "schema-edge--ghost"].filter(Boolean).join(" "),
                };
            }

            // T046-T048: Handle FK modification types for modified edges
            if (changeType === SchemaDesigner.SchemaChangeType.Modification && fkModificationType) {
                const modType = fkModificationType[edge.id];
                if (modType === "property") {
                    // T046: Yellow stroke for property-only FK modifications
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: "var(--vscode-editorWarning-foreground)",
                        },
                        className: [edge.className, "schema-edge--modified-property"]
                            .filter(Boolean)
                            .join(" "),
                    };
                } else if (modType === "structural") {
                    // T047: Red stroke to indicate structural change
                    // Note: The new edge will be styled green via Addition type
                    return {
                        ...edge,
                        style: {
                            ...edge.style,
                            stroke: "var(--vscode-editorError-foreground)",
                            strokeDasharray: "5,5",
                        },
                        className: [edge.className, "schema-edge--modified-structural-old"]
                            .filter(Boolean)
                            .join(" "),
                    };
                }
            }

            if (changeType || isHighlighted) {
                return {
                    ...edge,
                    style: changeType
                        ? {
                              ...edge.style,
                              ...getEdgeStyleForChangeType(changeType),
                          }
                        : edge.style,
                    className: isHighlighted
                        ? [edge.className, "schema-edge--revealed"].filter(Boolean).join(" ")
                        : edge.className,
                };
            }
            return edge;
        });
    }, [context, edges]);
}
