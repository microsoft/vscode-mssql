/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
        maxLength: number;
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
         * Unique constraint of the column
         */
        isUnique: boolean;
        /**
         * Collation of the column
         */
        collation: string;
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
        CASCADE = "0",
        NO_ACTION = "1",
        SET_NULL = "2",
        SET_DEFAULT = "3",
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
        connectionUri: string;
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
        /**
         * Updated schema model
         */
        updatedSchema: Schema;
    }

    export interface GenerateScriptResponse {
        /**
         * Script to create the schema
         */
        scripts: TableScript[];

        /**
         * Combined script to create the schema
         */
        combinedScript: string;
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
         * List of reports
         * This is the list of reports that indicates the changes made to the schema
         */
        reports: SchemaDesignerReport[];
        /**
         * Script to update the schema
         */
        updateScript: string;
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

    export interface SchemaDesignerWebviewState {}

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
}
