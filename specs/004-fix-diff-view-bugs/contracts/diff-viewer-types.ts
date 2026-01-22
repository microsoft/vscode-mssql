/**
 * Type definitions for Diff Viewer Bug Fixes
 * Feature: 004-fix-diff-view-bugs
 */

import { SchemaDesigner } from "../../../../extensions/mssql/src/sharedInterfaces/schemaDesigner";

/**
 * Details about a foreign key modification to distinguish
 * property-only changes from structural changes.
 */
export interface ForeignKeyModificationDetails {
    /**
     * Whether the FK columns or referenced columns changed.
     * - true: Structural change → show old edge red, new edge green
     * - false: Property change → show single edge yellow
     */
    isStructural: boolean;

    /**
     * Original FK state before modification.
     * Used to render the "old" red edge for structural changes.
     */
    originalForeignKey?: SchemaDesigner.ForeignKey;

    /**
     * For structural changes, the ID of the edge representing
     * the old relationship (before column changes).
     */
    oldEdgeId?: string;
}

/**
 * Extended SchemaChange with FK modification details.
 * Adds metadata needed for rendering FK changes differently.
 */
export interface ExtendedSchemaChange extends SchemaDesigner.SchemaChange {
    /**
     * Additional details for foreign key modifications.
     * Only present when entityType is ForeignKey and changeType is Modification.
     */
    fkModificationDetails?: ForeignKeyModificationDetails;
}

/**
 * Data for a "ghost" node representing a deleted table.
 * Ghost nodes are rendered on canvas only when drawer is open.
 */
export interface GhostNodeData extends SchemaDesigner.Table {
    /**
     * Flag indicating this is a ghost (deleted) node.
     * Used by rendering code to apply deleted styling.
     */
    isGhostNode: true;

    /**
     * Original position of the table before deletion.
     * Used to render the ghost at the same location.
     */
    originalPosition: {
        x: number;
        y: number;
    };
}

/**
 * Data for a "ghost" edge representing a deleted foreign key.
 */
export interface GhostEdgeData {
    /** Unique edge ID (same as original FK ID) */
    id: string;

    /** Source table ID */
    sourceTableId: string;

    /** Target table ID */
    targetTableId: string;

    /** Source column name */
    sourceColumn: string;

    /** Target column name */
    targetColumn: string;

    /** Original FK data for rendering */
    fkData: SchemaDesigner.ForeignKey;
}

/**
 * Information about a table rename (name and/or schema change).
 * Used to display old name with strikethrough next to new name.
 */
export interface RenameDisplayInfo {
    /** Previous fully qualified name (schema.name) */
    oldDisplayName: string;

    /** Previous schema name */
    oldSchema: string;

    /** Previous table name */
    oldName: string;

    /** Whether the schema was changed */
    schemaChanged: boolean;

    /** Whether the table name was changed */
    nameChanged: boolean;
}

/**
 * Extended diff result with additional data for this feature.
 */
export interface ExtendedDiffResultV2 extends SchemaDesigner.DiffCalculationResult {
    /**
     * Deleted tables to render as ghost nodes.
     * Only populated when drawer is open.
     */
    ghostNodes: GhostNodeData[];

    /**
     * Deleted foreign keys to render as ghost edges.
     * Only populated when drawer is open.
     */
    ghostEdges: GhostEdgeData[];

    /**
     * Rename info indexed by table ID.
     * Only contains entries for tables that were renamed.
     */
    tableRenameInfo: { [tableId: string]: RenameDisplayInfo };

    /**
     * FK modification type indexed by FK ID.
     * 'property' = name/actions changed → yellow edge
     * 'structural' = columns/refs changed → red old + green new
     */
    fkModificationType: { [fkId: string]: "property" | "structural" };
}

/**
 * State extension for DiffViewerState.
 * These fields are added to the existing DiffViewerState interface.
 */
export interface DiffViewerStateExtension {
    /** Tables to render as ghost nodes when drawer is open */
    ghostNodes: GhostNodeData[];

    /** FK edges to render as ghost edges when drawer is open */
    ghostEdges: GhostEdgeData[];

    /** Rename info for tables with name/schema changes */
    tableRenameInfo: { [tableId: string]: RenameDisplayInfo };

    /** FK modification type for styling edges */
    fkModificationType: { [fkId: string]: "property" | "structural" };
}

/**
 * Props for SchemaDesignerTableNode extended with rename support.
 */
export interface TableNodeRenameProps {
    /** Rename info if table was renamed, undefined otherwise */
    renameInfo?: RenameDisplayInfo;

    /** Whether this is a ghost (deleted) node */
    isGhostNode?: boolean;
}

/**
 * Edge data extended with modification styling info.
 */
export interface StyledEdgeData {
    /** Base FK data */
    fkData: SchemaDesigner.ForeignKey;

    /** Edge styling based on change type */
    changeStyle?: "added" | "modified" | "deleted" | "structural-old" | "structural-new";

    /** Whether this edge should show reveal highlight */
    isHighlighted?: boolean;

    /** Whether this is a ghost (deleted) edge */
    isGhostEdge?: boolean;
}
