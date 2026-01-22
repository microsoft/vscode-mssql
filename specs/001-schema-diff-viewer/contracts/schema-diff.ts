/**
 * Schema Diff Viewer Contracts
 * 
 * TypeScript interfaces for the Schema Diff Viewer feature.
 * These interfaces define the contract between components and services.
 * 
 * @module schema-diff-viewer/contracts
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Type of change made to a schema element
 */
export enum SchemaChangeType {
    /** New element added to the schema */
    Addition = "addition",
    /** Existing element was modified */
    Modification = "modification",
    /** Element was removed from the schema */
    Deletion = "deletion"
}

/**
 * Type of schema entity that was changed
 */
export enum SchemaEntityType {
    /** Database table */
    Table = "table",
    /** Table column */
    Column = "column",
    /** Foreign key relationship */
    ForeignKey = "foreignKey"
}

// ============================================================================
// Core Entities
// ============================================================================

/**
 * Represents a single change to the schema
 */
export interface SchemaChange {
    /** Unique identifier for this change (UUID) */
    id: string;
    /** Type of change: addition, modification, or deletion */
    changeType: SchemaChangeType;
    /** Type of entity changed: table, column, or foreignKey */
    entityType: SchemaEntityType;
    /** ID of the table this change belongs to */
    tableId: string;
    /** Display name of the table (e.g., "dbo.Users") */
    tableName: string;
    /** ID of the specific entity changed */
    entityId: string;
    /** Name of the changed entity for display */
    entityName: string;
    /** Original state before change (null for additions) */
    previousValue: unknown | null;
    /** New state after change (null for deletions) */
    currentValue: unknown | null;
    /** Human-readable description of the change */
    description: string;
}

/**
 * Groups changes by table for hierarchical display
 */
export interface ChangeGroup {
    /** ID of the table */
    tableId: string;
    /** Display name (schema.table format) */
    tableName: string;
    /** Schema name (e.g., "dbo") */
    schemaName: string;
    /** Overall state: Addition if table is new, Deletion if dropped, Modification otherwise */
    aggregateState: SchemaChangeType;
    /** List of individual changes to this table */
    changes: SchemaChange[];
    /** UI state: whether the group is expanded in the drawer */
    isExpanded: boolean;
}

/**
 * Summary of change counts for toolbar display
 */
export interface ChangeCountSummary {
    /** Count of new elements */
    additions: number;
    /** Count of modified elements */
    modifications: number;
    /** Count of deleted elements */
    deletions: number;
    /** Sum of all changes */
    total: number;
}

/**
 * Current state of the diff viewer panel
 */
export interface DiffViewerState {
    /** Whether the drawer is visible */
    isDrawerOpen: boolean;
    /** Current width in pixels (persisted) */
    drawerWidth: number;
    /** Currently selected change for navigation (null if none) */
    selectedChangeId: string | null;
    /** Computed groups of changes */
    changeGroups: ChangeGroup[];
    /** Whether to show visual indicators on canvas elements */
    showCanvasIndicators: boolean;
    /** Summary counts for toolbar */
    changeCounts: ChangeCountSummary;
}

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Input for diff calculation
 */
export interface DiffCalculationInput {
    /** Original schema loaded at session start */
    originalSchema: import("../../../sharedInterfaces/schemaDesigner").SchemaDesigner.Schema;
    /** Current schema from ReactFlow state */
    currentSchema: import("../../../sharedInterfaces/schemaDesigner").SchemaDesigner.Schema;
}

/**
 * Result of diff calculation
 */
export interface DiffCalculationResult {
    /** All changes detected */
    changes: SchemaChange[];
    /** Changes grouped by table */
    changeGroups: ChangeGroup[];
    /** Summary counts */
    summary: ChangeCountSummary;
    /** Whether any changes were detected */
    hasChanges: boolean;
}

/**
 * Service interface for calculating schema diffs
 */
export interface IDiffCalculator {
    /**
     * Calculate differences between original and current schema
     * @param input Original and current schema states
     * @returns Diff calculation result with changes grouped by table
     */
    calculateDiff(input: DiffCalculationInput): DiffCalculationResult;
}

/**
 * Service interface for tracking change counts incrementally
 */
export interface IChangeCountTracker {
    /**
     * Get current change count summary
     */
    getCounts(): ChangeCountSummary;
    
    /**
     * Increment count for a specific change type
     * @param changeType Type of change to increment
     */
    increment(changeType: SchemaChangeType): void;
    
    /**
     * Decrement count for a specific change type
     * @param changeType Type of change to decrement
     */
    decrement(changeType: SchemaChangeType): void;
    
    /**
     * Reset all counts to zero
     */
    reset(): void;
    
    /**
     * Subscribe to count changes
     * @param callback Function called when counts change
     * @returns Unsubscribe function
     */
    subscribe(callback: (counts: ChangeCountSummary) => void): () => void;
}

// ============================================================================
// Component Props Interfaces
// ============================================================================

/**
 * Props for the diff viewer drawer component
 */
export interface DiffViewerDrawerProps {
    /** Whether the drawer is open */
    isOpen: boolean;
    /** Callback when drawer open state changes */
    onOpenChange: (open: boolean) => void;
    /** Initial drawer width */
    initialWidth?: number;
    /** Callback when drawer is resized */
    onResize?: (width: number) => void;
}

/**
 * Props for individual change item component
 */
export interface ChangeItemProps {
    /** The change to display */
    change: SchemaChange;
    /** Whether this item is selected */
    isSelected: boolean;
    /** Callback when item is clicked (for navigation) */
    onClick: (change: SchemaChange) => void;
    /** Callback when undo button is clicked */
    onUndo: (change: SchemaChange) => void;
}

/**
 * Props for change group component (collapsible table section)
 */
export interface ChangeGroupProps {
    /** The group to display */
    group: ChangeGroup;
    /** Callback when group expansion state changes */
    onToggleExpand: (tableId: string) => void;
    /** Callback when a change item is clicked */
    onChangeClick: (change: SchemaChange) => void;
    /** Callback when undo is clicked on a change */
    onChangeUndo: (change: SchemaChange) => void;
    /** ID of currently selected change */
    selectedChangeId: string | null;
}

/**
 * Props for the toolbar button component
 */
export interface ShowChangesButtonProps {
    /** Current change counts */
    changeCounts: ChangeCountSummary;
    /** Whether the diff drawer is currently open */
    isDrawerOpen: boolean;
    /** Callback when button is clicked */
    onClick: () => void;
}

// ============================================================================
// Context Interfaces
// ============================================================================

/**
 * Context value for diff viewer state management
 */
export interface DiffViewerContextValue {
    /** Current diff viewer state */
    state: DiffViewerState;
    /** Toggle drawer open/closed */
    toggleDrawer: () => void;
    /** Set drawer width */
    setDrawerWidth: (width: number) => void;
    /** Select a change for navigation */
    selectChange: (changeId: string | null) => void;
    /** Undo a specific change */
    undoChange: (change: SchemaChange) => void;
    /** Recalculate diff (called when drawer opens) */
    recalculateDiff: () => void;
    /** Navigate to element in canvas */
    navigateToElement: (change: SchemaChange) => void;
}

// ============================================================================
// Event Types (for eventBus integration)
// ============================================================================

/**
 * Events emitted by the diff viewer system
 */
export interface DiffViewerEvents {
    /** Emitted when diff drawer opens/closes */
    "diffDrawer:toggle": { isOpen: boolean };
    /** Emitted when a change is selected */
    "diffDrawer:selectChange": { changeId: string | null };
    /** Emitted when per-item undo is requested */
    "diffDrawer:undoChange": { change: SchemaChange };
    /** Emitted when diff calculation completes */
    "diffDrawer:diffCalculated": { result: DiffCalculationResult };
    /** Emitted when change counts update */
    "diffDrawer:countsUpdated": { counts: ChangeCountSummary };
}
