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
        /**
         * Snapshot of the schema when the Schema Designer session was first created (or last published).
         * Used as the baseline for diffing against current edits.
         */
        baselineSchema: Schema;
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

    export interface SchemaDesignerDirtyStateParams {
        hasChanges: boolean;
    }
    export namespace SchemaDesignerDirtyStateNotification {
        export const type = new NotificationType<SchemaDesignerDirtyStateParams>(
            "schemaDesignerDirtyState",
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

    export namespace GetBaselineSchemaRequest {
        export const type = new RequestType<void, Schema, void>("getBaselineSchema");
    }

    // Types with isDeleted flag for tracking deletions in the UI
    export type TableWithDeletedFlag = Table & { isDeleted?: boolean };
    export type ColumnWithDeletedFlag = Column & { isDeleted?: boolean };
    export type ForeignKeyWithDeletedFlag = ForeignKey & { isDeleted?: boolean };
}
