/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Enum representing the type of database object metadata.
 */
export enum MetadataType {
    Table = 0,
    View = 1,
    SProc = 2,
    Function = 3,
    Schema = 4,
    Database = 5,
}

/**
 * Represents metadata for a database object such as a table, view, stored procedure, or function.
 */
export interface ObjectMetadata {
    metadataType: MetadataType;
    metadataTypeName: string;
    schema: string;
    name: string;
    parentName?: string;
    parentTypeName?: string;
    urn?: string;
}

/**
 * Represents metadata for a column in a table or view.
 */
export interface ColumnMetadata {
    /** Default value expression, null if none */
    defaultValue?: string;
    /** Escaped column identifier */
    escapedName: string;
    /** Whether the column is computed */
    isComputed: boolean;
    /** Whether the computed column is deterministic */
    isDeterministic: boolean;
    /** Whether the column is an identity column */
    isIdentity: boolean;
    /** Column position (0-based) */
    ordinal: number;
    /** Whether the column has extended properties */
    hasExtendedProperties: boolean;
    /** Whether the column is calculated (computed, identity, or non-updatable) */
    isCalculated?: boolean;
    /** Whether the column is part of the primary key */
    isKey?: boolean;
    /** Whether the column can be trusted for uniqueness */
    isTrustworthyForUniqueness?: boolean;
}

/**
 * Represents information about a database.
 */
export interface DatabaseInfo {
    options: { [key: string]: any };
}

//#region metadata/list

/**
 * Parameters for the metadata list request.
 */
export interface MetadataListParams {
    ownerUri: string;
}

/**
 * Result of the metadata list request.
 */
export interface MetadataListResult {
    metadata: ObjectMetadata[];
}

//#endregion

//#region metadata/table

/**
 * Parameters for the table metadata request.
 */
export interface TableMetadataParams {
    ownerUri: string;
    schema: string;
    objectName: string;
}

/**
 * Result of the table metadata request.
 */
export interface TableMetadataResult {
    columns: ColumnMetadata[];
}

//#endregion

//#region metadata/view

/**
 * Parameters for the view metadata request.
 * Uses the same structure as TableMetadataParams.
 */
export type ViewMetadataParams = TableMetadataParams;

/**
 * Result of the view metadata request.
 * Uses the same structure as TableMetadataResult.
 */
export type ViewMetadataResult = TableMetadataResult;

//#endregion

//#region connection/listdatabases

/**
 * Parameters for the list databases request.
 */
export interface ListDatabasesParams {
    ownerUri: string;
    includeDetails?: boolean;
}

/**
 * Result of the list databases request.
 */
export interface ListDatabasesResult {
    databaseNames?: string[];
    databases?: DatabaseInfo[];
}

//#endregion

//#region metadata/getServerContext

/**
 * Parameters for the get server contextualization request.
 */
export interface GetServerContextualizationParams {
    ownerUri: string;
    databaseName: string;
}

/**
 * Result of the get server contextualization request.
 */
export interface GetServerContextualizationResult {
    context: string;
}

//#endregion
