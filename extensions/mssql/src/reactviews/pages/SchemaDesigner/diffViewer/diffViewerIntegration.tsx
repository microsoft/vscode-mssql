/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { useContext, useEffect, useState, useCallback, useRef } from "react";
import { SchemaDesignerContext, stateStack } from "../schemaDesignerStateProvider";
import { DiffViewerProvider, useDiffViewerOptional } from "./diffViewerContext";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { flowUtils } from "../schemaDesignerUtils";
import { usePersistedDrawerWidth } from "./usePersistedDrawerWidth";
import eventBus from "../schemaDesignerEvents";
import { TablePositionMap } from "./diffCalculator";

/** Default drawer width in pixels */
const DEFAULT_DRAWER_WIDTH = 320;

/**
 * Component that listens for schema changes and triggers diff recalculation.
 * This enables live change count updates in the toolbar without opening the drawer.
 */
const SchemaChangeListener: React.FC = () => {
    const diffViewer = useDiffViewerOptional();

    useEffect(() => {
        if (!diffViewer) return;

        // Handler for general schema changes - small delay for ReactFlow state sync
        const handleSchemaChange = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    diffViewer.recalculateDiff();
                });
            });
        };

        // T022, T023: Handler for undo/redo - immediate recalculation for responsive UI
        // Undo operations need immediate feedback in drawer, toolbar, and canvas
        const handleUndoRedo = () => {
            // Immediate recalculation for undo/redo to sync drawer, toolbar, and canvas
            diffViewer.recalculateDiff();
        };

        eventBus.on("pushState", handleSchemaChange);
        eventBus.on("undo", handleUndoRedo);
        eventBus.on("redo", handleUndoRedo);

        return () => {
            eventBus.off("pushState", handleSchemaChange);
            eventBus.off("undo", handleUndoRedo);
            eventBus.off("redo", handleUndoRedo);
        };
    }, [diffViewer]);

    return null; // This component doesn't render anything
};

export interface DiffViewerIntegrationProps {
    children: React.ReactNode;
}

/**
 * Integration component that connects the SchemaDesignerContext to the DiffViewerProvider.
 * This handles:
 * - Storing the original schema from initial load
 * - Providing current schema extraction
 * - Navigation and undo callbacks
 */
export const DiffViewerIntegration: React.FC<DiffViewerIntegrationProps> = ({ children }) => {
    const context = useContext(SchemaDesignerContext);
    const [originalSchema, setOriginalSchema] = useState<SchemaDesigner.Schema | undefined>(
        undefined,
    );
    const [originalTablePositions, setOriginalTablePositions] = useState<
        TablePositionMap | undefined
    >(undefined);
    const hasCapturedInitialState = useRef(false);

    // Capture original schema from session when initialization completes
    useEffect(() => {
        if (context?.isInitialized && context.originalSchemaFromSession) {
            setOriginalSchema(context.originalSchemaFromSession);
        }
    }, [context?.isInitialized, context?.originalSchemaFromSession]);

    // Capture initial state once it's available from the provider
    useEffect(() => {
        const handleInitialStateReady = () => {
            if (hasCapturedInitialState.current) {
                return;
            }
            const initialState = stateStack.getCurrentState();
            if (!initialState) {
                return;
            }
            const positions: TablePositionMap = {};
            for (const node of initialState.nodes) {
                positions[node.id] = { x: node.position.x, y: node.position.y };
            }
            setOriginalTablePositions(positions);
            hasCapturedInitialState.current = true;
            if (!context?.originalSchemaFromSession && !originalSchema) {
                const schema = flowUtils.extractSchemaModel(initialState.nodes, initialState.edges);
                setOriginalSchema(schema);
            }
        };

        eventBus.on("initialStateReady", handleInitialStateReady);
        return () => {
            eventBus.off("initialStateReady", handleInitialStateReady);
        };
    }, [context?.originalSchemaFromSession, originalSchema]);

    // Reset change tracker when designer is re-initialized
    useEffect(() => {
        if (!context?.isInitialized) {
            setOriginalSchema(undefined);
            setOriginalTablePositions(undefined);
            hasCapturedInitialState.current = false;
        }
    }, [context?.isInitialized]);

    // Callback to get current schema
    const getCurrentSchema = useCallback((): SchemaDesigner.Schema => {
        return context?.extractSchema() ?? { tables: [] };
    }, [context]);

    // Navigation callback - zoom to the element on canvas
    const handleNavigateToEntity = useCallback(
        (change: SchemaDesigner.SchemaChange) => {
            // For foreign keys, center on the edge; for tables/columns, center on the table
            if (
                change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey &&
                change.entityId
            ) {
                if (context?.setCenterOnEdge) {
                    context.setCenterOnEdge(change.entityId, true);
                }
            } else if (context?.setCenter && change.tableId) {
                context.setCenter(change.tableId, true);
            }
        },
        [context],
    );

    /**
     * Undo a specific change by reverting to the original state.
     * - Additions: Delete the added entity
     * - Deletions: Restore the deleted entity
     * - Modifications: Revert to the previous value
     */
    const handleUndoChange = useCallback(
        async (change: SchemaDesigner.SchemaChange) => {
            if (!context || !originalSchema) {
                return;
            }

            const { changeType, entityType } = change;

            switch (entityType) {
                case SchemaDesigner.SchemaEntityType.Table:
                    await handleUndoTableChange(change, changeType);
                    break;
                case SchemaDesigner.SchemaEntityType.Column:
                case SchemaDesigner.SchemaEntityType.ForeignKey:
                    await handleUndoEntityChange(change, changeType);
                    break;
            }
        },
        [context, originalSchema],
    );

    /**
     * Handle undo for table-level changes
     */
    const handleUndoTableChange = useCallback(
        async (
            change: SchemaDesigner.SchemaChange,
            changeType: SchemaDesigner.SchemaChangeType,
        ) => {
            if (!context) return;

            switch (changeType) {
                case SchemaDesigner.SchemaChangeType.Addition:
                    // Added table → delete it
                    if (change.currentValue) {
                        await context.deleteTable(change.currentValue as SchemaDesigner.Table);
                    }
                    break;
                case SchemaDesigner.SchemaChangeType.Deletion:
                    // Deleted table → restore it
                    if (change.previousValue) {
                        await context.addTable(change.previousValue as SchemaDesigner.Table);
                    }
                    break;
                case SchemaDesigner.SchemaChangeType.Modification:
                    // Modified table → revert to original
                    if (change.previousValue) {
                        // Get the original table from the originalSchema
                        const originalTable = originalSchema?.tables.find(
                            (t) => t.id === change.tableId,
                        );
                        if (originalTable) {
                            await context.updateTable(originalTable);
                        }
                    }
                    break;
            }
        },
        [context, originalSchema],
    );

    /**
     * Handle undo for column and foreign key changes
     * These require updating the parent table
     */
    const handleUndoEntityChange = useCallback(
        async (
            change: SchemaDesigner.SchemaChange,
            changeType: SchemaDesigner.SchemaChangeType,
        ) => {
            if (!context || !originalSchema) return;

            // Get the current table
            const currentTable = context.getTableWithForeignKeys(change.tableId);
            if (!currentTable) return;

            // Get the original table for reference
            const originalTable = originalSchema.tables.find((t) => t.id === change.tableId);

            // Create a modified copy of the current table
            const updatedTable = { ...currentTable };

            if (change.entityType === SchemaDesigner.SchemaEntityType.Column) {
                updatedTable.columns = [...currentTable.columns];

                switch (changeType) {
                    case SchemaDesigner.SchemaChangeType.Addition:
                        // Remove the added column
                        updatedTable.columns = updatedTable.columns.filter(
                            (c) => c.id !== change.entityId,
                        );
                        break;
                    case SchemaDesigner.SchemaChangeType.Deletion:
                        // Restore the deleted column
                        if (change.previousValue) {
                            const restoredColumn = change.previousValue as SchemaDesigner.Column;
                            const originalIndex = originalTable?.columns.findIndex(
                                (c) => c.id === change.entityId,
                            );
                            if (
                                originalIndex !== undefined &&
                                originalIndex >= 0 &&
                                originalIndex <= updatedTable.columns.length
                            ) {
                                updatedTable.columns.splice(originalIndex, 0, restoredColumn);
                            } else {
                                updatedTable.columns.push(restoredColumn);
                            }
                        }
                        break;
                    case SchemaDesigner.SchemaChangeType.Modification:
                        // Revert to original column
                        const originalColumn = originalTable?.columns.find(
                            (c) => c.id === change.entityId,
                        );
                        if (originalColumn) {
                            const colIndex = updatedTable.columns.findIndex(
                                (c) => c.id === change.entityId,
                            );
                            if (colIndex >= 0) {
                                updatedTable.columns[colIndex] = originalColumn;
                            }
                        }
                        break;
                }
            } else if (change.entityType === SchemaDesigner.SchemaEntityType.ForeignKey) {
                updatedTable.foreignKeys = [...currentTable.foreignKeys];

                switch (changeType) {
                    case SchemaDesigner.SchemaChangeType.Addition:
                        // Remove the added foreign key
                        updatedTable.foreignKeys = updatedTable.foreignKeys.filter(
                            (fk) => fk.id !== change.entityId,
                        );
                        break;
                    case SchemaDesigner.SchemaChangeType.Deletion:
                        // Restore the deleted foreign key
                        if (change.previousValue) {
                            const restoredFK = change.previousValue as SchemaDesigner.ForeignKey;
                            const originalIndex = originalTable?.foreignKeys.findIndex(
                                (fk) => fk.id === change.entityId,
                            );
                            if (
                                originalIndex !== undefined &&
                                originalIndex >= 0 &&
                                originalIndex <= updatedTable.foreignKeys.length
                            ) {
                                updatedTable.foreignKeys.splice(originalIndex, 0, restoredFK);
                            } else {
                                updatedTable.foreignKeys.push(restoredFK);
                            }
                        }
                        break;
                    case SchemaDesigner.SchemaChangeType.Modification:
                        // Revert to original foreign key
                        const originalFK = originalTable?.foreignKeys.find(
                            (fk) => fk.id === change.entityId,
                        );
                        if (originalFK) {
                            const fkIndex = updatedTable.foreignKeys.findIndex(
                                (fk) => fk.id === change.entityId,
                            );
                            if (fkIndex >= 0) {
                                updatedTable.foreignKeys[fkIndex] = originalFK;
                            }
                        }
                        break;
                }
            }

            await context.updateTable(updatedTable);
        },
        [context, originalSchema],
    );

    // Drawer width persistence
    const [persistedWidth, setPersistedWidth] = usePersistedDrawerWidth(DEFAULT_DRAWER_WIDTH);

    const handleDrawerWidthChange = useCallback(
        (width: number) => {
            setPersistedWidth(width);
        },
        [setPersistedWidth],
    );

    if (!context) {
        return <>{children}</>;
    }

    return (
        <DiffViewerProvider
            originalSchema={originalSchema ?? { tables: [] }}
            originalTablePositions={originalTablePositions}
            getCurrentSchema={getCurrentSchema}
            onNavigateToEntity={handleNavigateToEntity}
            onUndoChange={handleUndoChange}
            initialDrawerWidth={persistedWidth}
            onDrawerWidthChange={handleDrawerWidthChange}>
            <SchemaChangeListener />
            {children}
        </DiffViewerProvider>
    );
};

export default DiffViewerIntegration;
