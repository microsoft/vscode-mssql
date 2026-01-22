/**
 * Type definitions for column-level diff indicators
 * Feature: 003-fix-diff-visual-issues
 * 
 * These types extend the existing diff viewer infrastructure to support
 * column-level change visualization in table nodes.
 */

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

/**
 * Maps column names to their change types within a specific table.
 * Used by useColumnDiffIndicator hook to determine indicator color.
 */
export interface ColumnChangeMap {
    [columnName: string]: SchemaDesigner.SchemaChangeType;
}

/**
 * Maps table IDs to their column change maps.
 * Stored in DiffViewerState for efficient lookup.
 */
export interface TableColumnChanges {
    [tableId: string]: ColumnChangeMap;
}

/**
 * Information about a deleted column needed for inline display.
 * Includes original position to maintain visual ordering.
 */
export interface DeletedColumnInfo {
    /** Column name (for display) */
    name: string;
    /** Data type (for display in column list) */
    dataType: string;
    /** Whether this was a primary key column */
    isPrimaryKey: boolean;
    /** Original index in the column array (for sorting) */
    originalIndex: number;
}

/**
 * Maps table IDs to arrays of their deleted columns.
 * Used to render deleted columns inline in table nodes.
 */
export interface DeletedColumnsMap {
    [tableId: string]: DeletedColumnInfo[];
}

/**
 * Diff indicator state for a single column.
 * Returned by useColumnDiffIndicator hook.
 */
export interface ColumnDiffIndicator {
    /** Whether to show the indicator dot */
    showIndicator: boolean;
    /** The change type (determines color) */
    changeType: SchemaDesigner.SchemaChangeType | undefined;
}

/**
 * State for managing reveal highlight animations.
 * Only one element can be highlighted at a time.
 */
export interface RevealHighlightState {
    /** ID of the currently highlighted element (table or FK) */
    highlightedElementId: string | null;
    /** Type of element being highlighted */
    highlightedElementType: "table" | "foreignKey" | null;
}

/**
 * Extended diff result including column-level changes.
 * Returned by diffCalculator.calculateDiff().
 */
export interface ExtendedDiffResult {
    /** Existing fields */
    changes: SchemaDesigner.SchemaChange[];
    changeGroups: SchemaDesigner.ChangeGroup[];
    summary: SchemaDesigner.ChangeCountSummary;
    
    /** New fields for column indicators */
    tableColumnChanges: TableColumnChanges;
    deletedColumns: DeletedColumnsMap;
}

/**
 * Hook signature for useColumnDiffIndicator.
 * 
 * @param tableId - The table containing the column
 * @param columnName - The name of the column to check
 * @returns ColumnDiffIndicator with showIndicator and changeType
 */
export type UseColumnDiffIndicatorHook = (
    tableId: string,
    columnName: string
) => ColumnDiffIndicator;

/**
 * Hook signature for useRevealHighlight.
 * 
 * @returns Object with highlight state and control functions
 */
export interface UseRevealHighlightReturn {
    /** Currently highlighted element ID */
    highlightedId: string | null;
    /** Currently highlighted element type */
    highlightedType: "table" | "foreignKey" | null;
    /** Trigger highlight for a table */
    highlightTable: (tableId: string) => void;
    /** Trigger highlight for a foreign key */
    highlightForeignKey: (fkId: string) => void;
    /** Clear current highlight */
    clearHighlight: () => void;
    /** Check if specific element is highlighted */
    isHighlighted: (elementId: string) => boolean;
}

/**
 * Props for columns that may be deleted.
 * Used when rendering the merged column list in table nodes.
 */
export interface RenderableColumn {
    /** Column name */
    name: string;
    /** Data type string */
    dataType: string;
    /** Whether this is a primary key */
    isPrimaryKey: boolean;
    /** Whether this column was deleted */
    isDeleted: boolean;
    /** Original position (for sorting deleted columns) */
    originalIndex?: number;
    /** Change type if any */
    changeType?: SchemaDesigner.SchemaChangeType;
}
