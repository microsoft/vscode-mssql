/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

export namespace SchemaDesigner {
    /**
     * Represents a schema model
     * This is the schema model that is used to create the schema designer
     */
    export interface Schema {
        /**
         * Tables in the schema
         */
        tables: Table[];
    }

    export type Table = {
        /**
         * Id of the table
         */
        id: string;
        /**
         * Name of the table
         */
        name: string;
        /**
         * Schema of the table
         */
        schema: string;
        /**
         * Columns of the table
         */
        columns: Column[];
        /**
         * Foreign keys of the table
         */
        foreignKeys: ForeignKey[];
    };

    export interface Column {
        /**
         * Id of the column
         */
        id: string;
        /**
         * Name of the column
         */
        name: string;
        /**
         * Data type of the column
         */
        dataType: string;
        /**
         * Max length of the column
         */
        maxLength: string;
        /**
         * Precision of the column
         */
        precision: number;
        /**
         * Scale of the column
         */
        scale: number;
        /**
         * Is the column primary key
         */
        isPrimaryKey: boolean;
        /**
         * Is the column identity
         */
        isIdentity: boolean;
        /**
         * Seed of the column
         */
        identitySeed: number;
        /**
         * Increment of the column
         */
        identityIncrement: number;
        /**
         * Is the column nullable
         */
        isNullable: boolean;
        /**
         * Default value of the column
         */
        defaultValue: string;
        /**
         * Is column computed.
         */
        isComputed: boolean;
        /**
         * Computed column formula
         */
        computedFormula: string;
        /**
         * Is column persisted.
         */
        computedPersisted: boolean;
    }

    export type ForeignKey = {
        /**
         * Id of the foreign key
         */
        id: string;
        /**
         * Name of the foreign key
         */
        name: string;
        /**
         * Parent columns of the relationship
         */
        columns: string[];
        /**
         * Referenced schema of the relationship
         */
        referencedSchemaName: string;
        /**
         * Referenced table of the relationship
         */
        referencedTableName: string;
        /**
         * Referenced columns of the relationship
         */
        referencedColumns: string[];
        /**
         * On delete action of the relationship
         */
        onDeleteAction: OnAction;
        /**
         * On update action of the relationship
         */
        onUpdateAction: OnAction;
    };

    export enum OnAction {
        CASCADE = 0,
        NO_ACTION = 1,
        SET_NULL = 2,
        SET_DEFAULT = 3,
    }

    export enum SchemaDesignerActiveView {
        SchemaDesigner = "schemaDesigner",
        Dab = "dab",
    }

    /**
     * Represents a script for a table
     */
    export interface TableScript {
        /**
         * Unique identifier for the table
         */
        tableId: string;
        /**
         * Script of the table
         */
        script: string;
    }

    /**
     * Schema designer model ready event
     * This event is sent when the schema designer model is ready
     */
    export interface SchemaDesignerSession {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
    }

    /**
     * Request parameters for creating a schema designer session
     */
    export interface CreateSessionRequest {
        /**
         * Connection URI which is used to connect to the database
         */
        connectionString: string;
        /**
         * Access token for the connection
         * This is used to authenticate the connection to the database
         */
        accessToken?: string;
        /**
         * Database name to fetch the schema from
         */
        databaseName: string;
    }

    /**
     * Response for creating a schema designer session
     */
    export interface CreateSessionResponse {
        /**
         * Schema model
         * This is the schema model that is used to create the schema designer
         */
        schema: Schema;
        /**
         * List of datatypes
         * This is the list of datatypes that are used to create the schema designer
         */
        dataTypes: string[];
        /**
         * List of schemas
         * This is the list of schemas that are used to create the schema designer
         */
        schemaNames: string[];
        /**
         * Session id
         * This is the session id that is used to identify the schema designer session
         */
        sessionId: string;
    }

    export interface DisposeSessionRequest {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
    }

    export interface GenerateScriptRequest {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
    }

    export interface GenerateScriptResponse {
        /**
         * Script to create the schema
         */
        script: string;
    }

    export interface GetDefinitionRequest {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
        /**
         * Table id for which the definition is requested
         */
        updatedSchema: Schema;
    }

    export interface GetDefinitionResponse {
        /**
         * Script for the schema
         */
        script: string;
    }

    export interface GetReportRequest {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
        /**
         * Updated schema model
         * This is the updated schema model that is used to create the schema designer
         */
        updatedSchema: Schema;
    }

    export interface GetReportResponse {
        /**
         * Has the schema changed
         */
        hasSchemaChanged: boolean;
        /**
         * DacFx report
         * This is the DacFx report that indicates the changes made to the schema
         */
        dacReport: DacReport;
    }

    /**
     * DacFx report
     * This is the DacFx report that indicates the changes made to the schema
     */
    export interface DacReport {
        report: string;
        requireTableRecreation: boolean;
        possibleDataLoss: boolean;
        hasWarnings: boolean;
    }

    export interface PublishSessionRequest {
        /**
         * Session id for the schema designer session
         */
        sessionId: string;
    }

    export interface SchemaDesignerReport {
        tableId: string;
        tableName: string;
        updateScript: string;
        actionsPerformed: string[];
        tableState: SchemaDesignerReportTableState;
    }

    export enum SchemaDesignerReportTableState {
        Created = 0,
        Updated = 1,
        Dropped = 2,
    }

    export interface ISchemaDesignerService {
        /**
         * Creates a schema designer session
         * @param request - Request parameters for creating a schema designer session
         * @returns - Response for creating a schema designer session
         */
        createSession(request: CreateSessionRequest): Thenable<CreateSessionResponse>;

        /**
         * Disposes the schema designer session
         * @param request - Request parameters for disposing a schema designer session
         */
        disposeSession(request: DisposeSessionRequest): Thenable<void>;

        /**
         * Publishes the schema designer session
         */
        publishSession(request: PublishSessionRequest): Thenable<void>;

        /**
         * Gets the definition for the schema designer session
         * @param request - Request parameters for getting the definition of a schema designer session
         * @returns - Response for getting the definition of a schema designer session
         */
        getDefinition(request: GetDefinitionRequest): Thenable<GetDefinitionResponse>;

        /**
         * Gets the create as script for the schema designer session
         * @param request - Request parameters for getting the create as script
         * @returns - Response for getting the create as script
         */
        generateScript(request: GenerateScriptRequest): Thenable<GenerateScriptResponse>;

        /**
         * Gets the report for the schema designer session
         * @param request - Request parameters for getting the report
         */
        getReport(request: GetReportRequest): Thenable<GetReportResponse>;

        /**
         * Callback for when the schema designer model is ready
         * @param listener - Callback function that is called when the schema designer model is ready
         */
        onSchemaReady(listener: (model: SchemaDesignerSession) => void): void;
    }

    export interface SchemaDesignerWebviewState {
        enableExpandCollapseButtons?: boolean;
        enableDAB?: boolean;
        activeView?: SchemaDesignerActiveView;
    }

    export interface ExportFileOptions {
        format: string;
        fileContents: string;
        width: number;
        height: number;
    }

    export interface GetScriptOptions {
        updatedSchema: Schema;
    }

    export interface GetReportOptions {
        updatedSchema: Schema;
    }

    export interface CopyToClipboardOptions {
        text: string;
    }

    export interface OpenInEditorOptions {
        text: string;
    }

    export interface SchemaDesignerReducers {
        exportToFile: ExportFileOptions;
        getScript: GetScriptOptions;
        getReport: GetReportOptions;
        copyToClipboard: CopyToClipboardOptions;
        openInEditor: OpenInEditorOptions;
    }

    export interface SchemaDesignerCacheItem {
        schemaDesignerDetails: SchemaDesigner.CreateSessionResponse;
        isDirty: boolean;
    }

    export interface PublishSessionParams {
        schema: Schema;
    }
    export interface PublishSessionResponse {
        success: boolean;
        error: string | undefined;
        updatedSchema: Schema;
    }
    export namespace PublishSessionRequest {
        export const type = new RequestType<PublishSessionParams, PublishSessionResponse, void>(
            "publishSession",
        );
    }

    export namespace CloseSchemaDesignerNotification {
        export const type = new NotificationType<void>("closeDesigner");
    }
    export interface OpenInEditorParams {
        text: string;
    }

    export namespace OpenInEditorWithConnectionNotification {
        export const type = new NotificationType<void>("openInEditorWithConnection");
    }
    export namespace OpenInEditorNotification {
        export const type = new NotificationType<OpenInEditorOptions>("openInEditor");
    }

    export namespace CopyToClipboardNotification {
        export const type = new NotificationType<OpenInEditorParams>("copyToClipboard");
    }

    export interface UpdatedSchemaParams {
        updatedSchema: Schema;
    }
    export interface GetReportWebviewResponse {
        report: GetReportResponse;
        error?: string;
    }
    export namespace GetReportWebviewRequest {
        export const type = new RequestType<UpdatedSchemaParams, GetReportWebviewResponse, void>(
            "getReport",
        );
    }

    export namespace ExportToFileNotification {
        export const type = new NotificationType<ExportFileOptions>("exportToFile");
    }
    export namespace GetDefinitionRequest {
        export const type = new RequestType<UpdatedSchemaParams, GetDefinitionResponse, void>(
            "getDefinition",
        );
    }
    export namespace InitializeSchemaDesignerRequest {
        export const type = new RequestType<void, CreateSessionResponse, void>(
            "initializeSchemaDesigner",
        );
    }

    // =========================================================================
    // Diff Viewer Types
    // =========================================================================

    /**
     * Type of change made to a schema element
     */
    export enum SchemaChangeType {
        /** New element added to the schema */
        Addition = "addition",
        /** Existing element was modified */
        Modification = "modification",
        /** Element was removed from the schema */
        Deletion = "deletion",
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
        ForeignKey = "foreignKey",
    }

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
        /** Currently selected change for navigation (undefined if none) */
        selectedChangeId: string | undefined;
        /** Computed groups of changes */
        changeGroups: ChangeGroup[];
        /** Whether to show visual indicators on canvas elements */
        showCanvasIndicators: boolean;
        /** Summary counts for toolbar */
        changeCounts: ChangeCountSummary;
        /** IDs of tables that were deleted from the original schema (for canvas indicators) */
        deletedTableIds: Set<string>;
        /** IDs of foreign keys that were deleted from the original schema (for canvas indicators) */
        deletedForeignKeyIds: Set<string>;
        /** Column-level changes indexed by table ID and column name */
        tableColumnChanges: { [tableId: string]: { [columnName: string]: SchemaChangeType } };
        /** Deleted columns indexed by table ID, with original position info */
        deletedColumns: {
            [tableId: string]: Array<{
                name: string;
                dataType: string;
                isPrimaryKey: boolean;
                originalIndex: number;
            }>;
        };
        /** Currently highlighted element ID for reveal animation */
        highlightedElementId: string | null;
        /** Type of currently highlighted element */
        highlightedElementType: "table" | "foreignKey" | null;
        /** Ghost nodes representing deleted tables (visible when drawer is open) */
        ghostNodes: GhostNodeData[];
        /** Ghost edges representing deleted foreign keys (visible when drawer is open) */
        ghostEdges: GhostEdgeData[];
        /** Rename info indexed by table ID for tables that were renamed */
        tableRenameInfo: { [tableId: string]: RenameDisplayInfo };
        /** FK modification type indexed by FK ID ('property' = yellow, 'structural' = red/green) */
        fkModificationType: { [fkId: string]: "property" | "structural" };
    }

    /**
     * Input for diff calculation
     */
    export interface DiffCalculationInput {
        /** Original schema loaded at session start */
        originalSchema: Schema;
        /** Current schema from ReactFlow state */
        currentSchema: Schema;
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
        originalForeignKey?: ForeignKey;

        /**
         * For structural changes, the ID of the edge representing
         * the old relationship (before column changes).
         */
        oldEdgeId?: string;
    }

    /**
     * Data for a "ghost" node representing a deleted table.
     * Ghost nodes are rendered on canvas only when drawer is open.
     */
    export interface GhostNodeData extends Table {
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
        fkData: ForeignKey;
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
}
