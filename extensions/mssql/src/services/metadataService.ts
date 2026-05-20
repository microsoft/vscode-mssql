/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { SimpleExecuteResult } from "vscode-mssql";
import {
    GetServerContextualizationRequest,
    ListDatabasesRequest,
    MetadataListRequest,
    TableMetadataRequest,
    ViewMetadataRequest,
} from "../models/contracts/metadataContracts";
import {
    ColumnMetadata,
    DabDatabaseObjectMetadata,
    DabStoredProcedureParameterMetadata,
    DabViewColumnMetadata,
    DatabaseInfo,
    GetServerContextualizationParams,
    GetServerContextualizationResult,
    ListDatabasesParams,
    ListDatabasesResult,
    MetadataListParams,
    MetadataListResult,
    ObjectMetadata,
    TableMetadataParams,
    TableMetadataResult,
} from "../sharedInterfaces/metadata";
import { bracketEscapeSqlIdentifier } from "../models/utils";
import { escapeStringLiteral } from "../utils/sqlStringUtils";
import { getErrorMessage } from "../utils/utils";

const simpleExecuteRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void,
    void
>("query/simpleexecute");

const listDabViewsQuery = `
SELECT
    SCHEMA_NAME(v.schema_id) AS [schema_name],
    v.name AS [object_name],
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name) AS [object_id]
FROM sys.views AS v
WHERE v.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(v.schema_id), v.name;`;

const listDabStoredProceduresQuery = `
SELECT
    SCHEMA_NAME(p.schema_id) AS [schema_name],
    p.name AS [object_name],
    CONCAT('stored-procedure:', SCHEMA_NAME(p.schema_id), '.', p.name) AS [object_id]
FROM sys.procedures AS p
WHERE p.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(p.schema_id), p.name;`;

const listDabViewColumnsQuery = `
;WITH ranked_unique_indexes AS
(
    SELECT
        i.object_id,
        i.index_id,
        ROW_NUMBER() OVER (
            PARTITION BY i.object_id
            ORDER BY
                CASE WHEN i.is_primary_key = 1 THEN 0 ELSE 1 END,
                i.index_id
        ) AS [rank]
    FROM sys.indexes AS i
    INNER JOIN sys.views AS v
        ON v.object_id = i.object_id
    WHERE v.is_ms_shipped = 0
        AND i.is_unique = 1
        AND i.is_hypothetical = 0
        AND i.has_filter = 0
),
selected_unique_index AS
(
    SELECT
        object_id,
        index_id
    FROM ranked_unique_indexes
    WHERE [rank] = 1
)
SELECT
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name) AS [object_id],
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name, ':', c.name) AS [column_id],
    c.name AS [column_name],
    TYPE_NAME(c.user_type_id) AS [data_type],
    c.column_id AS [ordinal],
    CAST(CASE WHEN ic.column_id IS NULL THEN 0 ELSE 1 END AS bit) AS [is_primary_key]
FROM sys.views AS v
INNER JOIN sys.columns AS c
    ON c.object_id = v.object_id
LEFT JOIN selected_unique_index AS sui
    ON sui.object_id = v.object_id
LEFT JOIN sys.index_columns AS ic
    ON ic.object_id = sui.object_id
    AND ic.index_id = sui.index_id
    AND ic.column_id = c.column_id
    AND ic.key_ordinal > 0
    AND ic.is_included_column = 0
WHERE v.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(v.schema_id), v.name, c.column_id;`;

const listDabStoredProcedureParametersQuery = `
SELECT
    CONCAT('stored-procedure:', SCHEMA_NAME(sp.schema_id), '.', sp.name) AS [object_id],
    p.name AS [parameter_name],
    p.parameter_id AS [ordinal]
FROM sys.procedures AS sp
INNER JOIN sys.parameters AS p
    ON p.object_id = sp.object_id
WHERE sp.is_ms_shipped = 0
    AND p.parameter_id > 0
ORDER BY SCHEMA_NAME(sp.schema_id), sp.name, p.parameter_id;`;

function getDabViewColumnsQuery(schema: string, viewName: string): string {
    return `
DECLARE @schemaName sysname = N'${escapeStringLiteral(schema)}';
DECLARE @viewName sysname = N'${escapeStringLiteral(viewName)}';
DECLARE @viewObjectId int = OBJECT_ID(QUOTENAME(@schemaName) + N'.' + QUOTENAME(@viewName));

;WITH selected_unique_index AS
(
    SELECT TOP (1)
        i.object_id,
        i.index_id
    FROM sys.indexes AS i
    WHERE i.object_id = @viewObjectId
        AND i.is_unique = 1
        AND i.is_hypothetical = 0
        AND i.has_filter = 0
    ORDER BY
        CASE WHEN i.is_primary_key = 1 THEN 0 ELSE 1 END,
        i.index_id
)
SELECT
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name, ':', c.name) AS [column_id],
    c.name AS [column_name],
    TYPE_NAME(c.user_type_id) AS [data_type],
    c.column_id AS [ordinal],
    CAST(CASE
        WHEN EXISTS (
            SELECT 1
            FROM selected_unique_index AS sui
            INNER JOIN sys.index_columns AS ic
                ON ic.object_id = sui.object_id
                AND ic.index_id = sui.index_id
                AND ic.column_id = c.column_id
                AND ic.key_ordinal > 0
                AND ic.is_included_column = 0
        ) THEN 1
        ELSE 0
    END AS bit) AS [is_primary_key]
FROM sys.views AS v
INNER JOIN sys.columns AS c
    ON c.object_id = v.object_id
WHERE v.object_id = @viewObjectId
ORDER BY c.column_id;`;
}

function getDabStoredProcedureParametersQuery(schema: string, procedureName: string): string {
    return `
DECLARE @schemaName sysname = N'${escapeStringLiteral(schema)}';
DECLARE @procedureName sysname = N'${escapeStringLiteral(procedureName)}';
DECLARE @procedureObjectId int = OBJECT_ID(
    QUOTENAME(@schemaName) + N'.' + QUOTENAME(@procedureName)
);

SELECT
    p.name AS [parameter_name],
    p.parameter_id AS [ordinal]
FROM sys.parameters AS p
WHERE p.object_id = @procedureObjectId
    AND p.parameter_id > 0
ORDER BY p.parameter_id;`;
}

/**
 * Interface for the Metadata Service that handles database metadata operations.
 */
export interface IMetadataService {
    /**
     * Gets the SQL Tools Service client instance.
     */
    readonly sqlToolsClient: SqlToolsServiceClient;

    /**
     * Retrieves metadata for all database objects (tables, views, stored procedures, functions).
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to an array of ObjectMetadata
     */
    getMetadata(ownerUri: string): Promise<ObjectMetadata[]>;

    /**
     * Retrieves column metadata for a specific table.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The table name
     * @returns A Promise that resolves to an array of ColumnMetadata
     */
    getTableInfo(ownerUri: string, schema: string, objectName: string): Promise<ColumnMetadata[]>;

    /**
     * Retrieves column metadata for a specific view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The view name
     * @returns A Promise that resolves to an array of ColumnMetadata
     */
    getViewInfo(ownerUri: string, schema: string, objectName: string): Promise<ColumnMetadata[]>;

    listDabViews(ownerUri: string, databaseName?: string): Promise<DabDatabaseObjectMetadata[]>;

    listDabStoredProcedures(
        ownerUri: string,
        databaseName?: string,
    ): Promise<DabDatabaseObjectMetadata[]>;

    getDabViewColumnsByView(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, DabViewColumnMetadata[]>>;

    getDabViewColumns(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
    ): Promise<DabViewColumnMetadata[]>;

    getDabStoredProcedureParametersByProcedure(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, DabStoredProcedureParameterMetadata[]>>;

    getDabStoredProcedureParameters(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
    ): Promise<DabStoredProcedureParameterMetadata[]>;

    /**
     * Lists all databases on the connected server.
     *
     * @param ownerUri - The URI identifying the connection
     * @param includeDetails - Whether to include detailed database information
     * @returns A Promise that resolves to either an array of database names or DatabaseInfo objects
     */
    getDatabases(ownerUri: string, includeDetails?: boolean): Promise<string[] | DatabaseInfo[]>;

    /**
     * Generates CREATE scripts for database objects (used for AI contextualization).
     *
     * @param ownerUri - The URI identifying the connection
     * @param databaseName - The target database name
     * @returns A Promise that resolves to a string containing the generated CREATE statements
     */
    getServerContext(ownerUri: string, databaseName: string): Promise<string>;
}

export class MetadataService implements IMetadataService {
    constructor(private _client: SqlToolsServiceClient) {}

    /**
     * Gets the SQL Tools Service client instance.
     * @returns The SQL Tools Service client used for database operations.
     */
    public get sqlToolsClient(): SqlToolsServiceClient {
        return this._client;
    }

    /**
     * Retrieves metadata for all database objects (tables, views, stored procedures, functions).
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to an array of ObjectMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getMetadata(ownerUri: string): Promise<ObjectMetadata[]> {
        try {
            const params: MetadataListParams = {
                ownerUri: ownerUri,
            };

            const result: MetadataListResult = await this._client.sendRequest(
                MetadataListRequest.type,
                params,
            );

            return result?.metadata ?? [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Retrieves column metadata for a specific table.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The table name
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getTableInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<ColumnMetadata[]> {
        return this.getObjectColumnInfo(ownerUri, schema, objectName, "table");
    }

    /**
     * Retrieves column metadata for a specific view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The view name
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getViewInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<ColumnMetadata[]> {
        return this.getObjectColumnInfo(ownerUri, schema, objectName, "view");
    }

    public async listDabViews(
        ownerUri: string,
        databaseName?: string,
    ): Promise<DabDatabaseObjectMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(ownerUri, listDabViewsQuery, databaseName);
            return this.parseDabDatabaseObjects(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async listDabStoredProcedures(
        ownerUri: string,
        databaseName?: string,
    ): Promise<DabDatabaseObjectMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                listDabStoredProceduresQuery,
                databaseName,
            );
            return this.parseDabDatabaseObjects(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getDabViewColumns(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
    ): Promise<DabViewColumnMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getDabViewColumnsQuery(schema, objectName),
                databaseName,
            );
            return this.parseDabViewColumns(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getDabViewColumnsByView(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, DabViewColumnMetadata[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                listDabViewColumnsQuery,
                databaseName,
            );
            return this.parseDabViewColumnsByObject(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getDabStoredProcedureParameters(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
    ): Promise<DabStoredProcedureParameterMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getDabStoredProcedureParametersQuery(schema, objectName),
                databaseName,
            );
            return this.parseDabStoredProcedureParameters(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getDabStoredProcedureParametersByProcedure(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, DabStoredProcedureParameterMetadata[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                listDabStoredProcedureParametersQuery,
                databaseName,
            );
            return this.parseDabStoredProcedureParametersByObject(result);
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Retrieves column metadata for a specific table or view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The object name
     * @param objectType - The type of object ("table" or "view")
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    private async getObjectColumnInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
        objectType: "table" | "view",
    ): Promise<ColumnMetadata[]> {
        try {
            const params: TableMetadataParams = {
                ownerUri: ownerUri,
                schema: schema,
                objectName: objectName,
            };

            const requestType =
                objectType === "table" ? TableMetadataRequest.type : ViewMetadataRequest.type;

            const result: TableMetadataResult = await this._client.sendRequest(requestType, params);

            return result?.columns ?? [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    private async executeSimpleQuery(
        ownerUri: string,
        queryString: string,
        databaseName?: string,
    ): Promise<SimpleExecuteResult> {
        return this._client.sendRequest(simpleExecuteRequest, {
            ownerUri,
            queryString: this.withDatabaseContext(queryString, databaseName),
        });
    }

    private withDatabaseContext(queryString: string, databaseName?: string): string {
        if (!databaseName?.trim()) {
            return queryString;
        }
        return `USE ${bracketEscapeSqlIdentifier(databaseName.trim())};
${queryString}`;
    }

    private getCellDisplayValue(
        result: SimpleExecuteResult,
        rowIndex: number,
        columnIndex: number,
    ): string | undefined {
        const row = result?.rows?.[rowIndex];
        const cell = row?.[columnIndex];
        if (!cell || cell.isNull) {
            return undefined;
        }
        return cell.displayValue;
    }

    private getBooleanCellValue(
        result: SimpleExecuteResult,
        rowIndex: number,
        columnIndex: number,
    ): boolean {
        const value = (this.getCellDisplayValue(result, rowIndex, columnIndex) ?? "")
            .trim()
            .toLowerCase();
        return value === "1" || value === "true";
    }

    private parseDabDatabaseObjects(result: SimpleExecuteResult): DabDatabaseObjectMetadata[] {
        return (result?.rows ?? [])
            .map((_, index) => {
                const schema = this.getCellDisplayValue(result, index, 0);
                const name = this.getCellDisplayValue(result, index, 1);
                const id = this.getCellDisplayValue(result, index, 2);
                if (!schema || !name || !id) {
                    return undefined;
                }
                return { id, schema, name };
            })
            .filter((object): object is DabDatabaseObjectMetadata => !!object);
    }

    private parseDabViewColumns(result: SimpleExecuteResult): DabViewColumnMetadata[] {
        return (result?.rows ?? [])
            .map((_, index) => {
                const id = this.getCellDisplayValue(result, index, 0);
                const name = this.getCellDisplayValue(result, index, 1);
                const dataType = this.getCellDisplayValue(result, index, 2);
                const ordinal = Number(this.getCellDisplayValue(result, index, 3) ?? 0);
                const isPrimaryKey = this.getBooleanCellValue(result, index, 4);
                if (!id || !name || !dataType) {
                    return undefined;
                }
                return { id, name, dataType, ordinal, isPrimaryKey };
            })
            .filter((column): column is DabViewColumnMetadata => !!column);
    }

    private parseDabViewColumnsByObject(
        result: SimpleExecuteResult,
    ): Map<string, DabViewColumnMetadata[]> {
        const columnsByObject = new Map<string, DabViewColumnMetadata[]>();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const id = this.getCellDisplayValue(result, index, 1);
            const name = this.getCellDisplayValue(result, index, 2);
            const dataType = this.getCellDisplayValue(result, index, 3);
            const ordinal = Number(this.getCellDisplayValue(result, index, 4) ?? 0);
            const isPrimaryKey = this.getBooleanCellValue(result, index, 5);
            if (!objectId || !id || !name || !dataType) {
                continue;
            }

            const columns = columnsByObject.get(objectId) ?? [];
            columns.push({ id, name, dataType, ordinal, isPrimaryKey });
            columnsByObject.set(objectId, columns);
        }

        return columnsByObject;
    }

    private parseDabStoredProcedureParameters(
        result: SimpleExecuteResult,
    ): DabStoredProcedureParameterMetadata[] {
        return (result?.rows ?? [])
            .map((_, index) => {
                const name = this.getCellDisplayValue(result, index, 0);
                const ordinal = Number(this.getCellDisplayValue(result, index, 1) ?? 0);
                if (!name) {
                    return undefined;
                }
                const parameter: DabStoredProcedureParameterMetadata = {
                    name,
                    ordinal,
                };
                return parameter;
            })
            .filter((parameter): parameter is DabStoredProcedureParameterMetadata => !!parameter);
    }

    private parseDabStoredProcedureParametersByObject(
        result: SimpleExecuteResult,
    ): Map<string, DabStoredProcedureParameterMetadata[]> {
        const parametersByObject = new Map<string, DabStoredProcedureParameterMetadata[]>();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const name = this.getCellDisplayValue(result, index, 1);
            const ordinal = Number(this.getCellDisplayValue(result, index, 2) ?? 0);
            if (!objectId || !name) {
                continue;
            }

            const parameters = parametersByObject.get(objectId) ?? [];
            parameters.push({ name, ordinal });
            parametersByObject.set(objectId, parameters);
        }

        return parametersByObject;
    }

    /**
     * Lists all databases on the connected server.
     *
     * @param ownerUri - The URI identifying the connection
     * @param includeDetails - Whether to include detailed database information (default: false)
     * @returns A Promise that resolves to either an array of database names or DatabaseInfo objects
     * @throws Logs error and re-throws if the request fails
     */
    public async getDatabases(
        ownerUri: string,
        includeDetails: boolean = false,
    ): Promise<string[] | DatabaseInfo[]> {
        try {
            const params: ListDatabasesParams = {
                ownerUri: ownerUri,
                includeDetails: includeDetails,
            };

            const result: ListDatabasesResult = await this._client.sendRequest(
                ListDatabasesRequest.type,
                params,
            );

            if (includeDetails && result.databases) {
                return result.databases;
            }

            return result.databaseNames || [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Generates CREATE scripts for database objects (used for AI contextualization).
     *
     * @param ownerUri - The URI identifying the connection
     * @param databaseName - The target database name
     * @returns A Promise that resolves to a string containing the generated CREATE statements
     * @throws Logs error and re-throws if the request fails
     */
    public async getServerContext(ownerUri: string, databaseName: string): Promise<string> {
        try {
            const params: GetServerContextualizationParams = {
                ownerUri: ownerUri,
                databaseName: databaseName,
            };

            const result: GetServerContextualizationResult = await this._client.sendRequest(
                GetServerContextualizationRequest.type,
                params,
            );

            return result.context;
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }
}
