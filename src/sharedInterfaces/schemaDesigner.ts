/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ISchema {
    tables: ITable[];
}

export interface ITable {
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
    columns: IColumn[];
    /**
     * Foreign keys of the table
     */
    foreignKeys: IForeignKey[];
}

export interface IColumn {
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
     * Is the column primary key
     */
    isPrimaryKey: boolean;
    /**
     * Is the column identity
     */
    isIdentity: boolean;
}

export interface IForeignKey {
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
}

export enum OnAction {
    CASCADE = "0",
    NO_ACTION = "1",
    SET_NULL = "2",
    SET_DEFAULT = "3",
}

export interface GetSchemaModelRequestParams {
    connectionUri: string;
    databaseName: string;
}

export interface GetSchemaModelResponse {
    schemaModel: ISchema;
    sessionId: string;
}

export interface ModelReadyNotificationParams {
    model: ISchema;
    originalModel: ISchema;
    sessionId: string;
    code: string;
}

export interface PublishSchemaRequestParams {
    connectionUri: string;
    databaseName: string;
    modifiedSchema: ISchema;
}

export interface ISchemaDesignerService {
    getSchemaModel(
        request: GetSchemaModelRequestParams,
    ): Thenable<GetSchemaModelResponse>;
    onModelReady(listener: (model: ModelReadyNotificationParams) => void): void;
    publishSchema(request: PublishSchemaRequestParams): Thenable<void>;
}

export interface SchemaDesignerWebviewState {
    schema: ISchema;
}

export interface SchemaDesignerReducers {
    publishSchema: {
        modifiedSchema: ISchema;
    };
    saveAs: {
        format: "svg" | "png" | "jpg";
        svgFileContents: string;
        width: number;
        height: number;
    };
}
