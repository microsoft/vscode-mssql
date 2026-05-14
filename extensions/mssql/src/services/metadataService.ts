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
    DatabaseInfo,
    GetServerContextualizationParams,
    GetServerContextualizationResult,
    ListDatabasesParams,
    ListDatabasesResult,
    MetadataListParams,
    MetadataListResult,
    MetadataType,
    ObjectMetadata,
    StoredProcedureMetadataResult,
    StoredProcedureParameterMetadata,
    TableMetadataParams,
    TableMetadataResult,
} from "../sharedInterfaces/metadata";
import { getErrorMessage } from "../utils/utils";

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
     * Retrieves view object metadata directly from the database catalog.
     *
     * This is a fallback for connections where metadata/list does not return view objects.
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to view metadata
     */
    getViews(ownerUri: string, databaseName?: string): Promise<ObjectMetadata[]>;

    /**
     * Retrieves stored procedure object metadata directly from the database catalog.
     *
     * This is a fallback for connections where metadata/list does not return stored procedures.
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to stored procedure metadata
     */
    getStoredProcedures(ownerUri: string, databaseName?: string): Promise<ObjectMetadata[]>;

    /**
     * Retrieves function object metadata directly from the database catalog.
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to function metadata
     */
    getFunctions(ownerUri: string, databaseName?: string): Promise<ObjectMetadata[]>;

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

    /**
     * Retrieves column metadata for all views in the current database.
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to a map keyed by lower-case schema.object name
     */
    getAllViewInfo(ownerUri: string, databaseName?: string): Promise<Map<string, ColumnMetadata[]>>;

    /**
     * Retrieves parameter metadata for a specific stored procedure.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The stored procedure name
     * @returns A Promise that resolves to stored procedure parameter metadata
     */
    getStoredProcedureInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<StoredProcedureMetadataResult>;

    /**
     * Retrieves parameter metadata for all stored procedures in the current database.
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to a map keyed by lower-case schema.object name
     */
    getAllStoredProcedureInfo(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, StoredProcedureMetadataResult>>;

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

    public async getStoredProcedureInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<StoredProcedureMetadataResult> {
        try {
            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri,
                    queryString: buildStoredProcedureParametersQuery(schema, objectName),
                },
            );

            return { parameters: getStoredProcedureParametersFromResult(result) };
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getAllViewInfo(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, ColumnMetadata[]>> {
        try {
            console.log("[DAB candidates] metadata bulk getAllViewInfo query", {
                ownerUri,
                databaseName,
            });
            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri,
                    queryString: buildAllViewColumnsQuery(databaseName),
                },
            );

            const viewInfo = getViewColumnsByObjectFromResult(result);
            console.log("[DAB candidates] metadata bulk getAllViewInfo parsed", {
                rowCount: result?.rowCount,
                viewCount: viewInfo.size,
            });
            return viewInfo;
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getAllStoredProcedureInfo(
        ownerUri: string,
        databaseName?: string,
    ): Promise<Map<string, StoredProcedureMetadataResult>> {
        try {
            console.log("[DAB candidates] metadata bulk getAllStoredProcedureInfo query", {
                ownerUri,
                databaseName,
            });
            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri,
                    queryString: buildAllStoredProcedureParametersQuery(databaseName),
                },
            );

            const procedureInfo = getStoredProcedureParametersByObjectFromResult(result);
            console.log("[DAB candidates] metadata bulk getAllStoredProcedureInfo parsed", {
                rowCount: result?.rowCount,
                storedProcedureCount: procedureInfo.size,
            });
            return procedureInfo;
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    public async getViews(ownerUri: string, databaseName?: string): Promise<ObjectMetadata[]> {
        console.log("[DAB candidates] metadata fallback getViews query", {
            ownerUri,
            databaseName,
        });
        return this.getObjectListFromQuery(
            ownerUri,
            buildViewsQuery(databaseName),
            MetadataType.View,
            "View",
        );
    }

    public async getStoredProcedures(
        ownerUri: string,
        databaseName?: string,
    ): Promise<ObjectMetadata[]> {
        console.log("[DAB candidates] metadata fallback getStoredProcedures query", {
            ownerUri,
            databaseName,
        });
        return this.getObjectListFromQuery(
            ownerUri,
            buildStoredProceduresQuery(databaseName),
            MetadataType.SProc,
            "StoredProcedure",
        );
    }

    public async getFunctions(ownerUri: string, databaseName?: string): Promise<ObjectMetadata[]> {
        console.log("[DAB candidates] metadata getFunctions query", { ownerUri, databaseName });
        return this.getObjectListFromQuery(
            ownerUri,
            buildFunctionsQuery(databaseName),
            MetadataType.Function,
            "Function",
        );
    }

    private async getObjectListFromQuery(
        ownerUri: string,
        queryString: string,
        metadataType: MetadataType,
        metadataTypeName: string,
    ): Promise<ObjectMetadata[]> {
        try {
            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >("query/simpleexecute"),
                {
                    ownerUri,
                    queryString,
                },
            );

            const metadata = getObjectMetadataFromResult(result, metadataType, metadataTypeName);
            console.log("[DAB candidates] metadata fallback query parsed", {
                metadataTypeName,
                rowCount: result?.rowCount,
                objectCount: metadata.length,
            });
            return metadata;
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

function buildViewsQuery(databaseName?: string): string {
    const databasePrefix = getDatabaseObjectPrefix(databaseName);
    return `
SELECT
    s.name AS SchemaName,
    v.name AS ObjectName
FROM ${databasePrefix}sys.views v
INNER JOIN ${databasePrefix}sys.schemas s ON v.schema_id = s.schema_id
WHERE s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
ORDER BY s.name, v.name`;
}

function buildStoredProceduresQuery(databaseName?: string): string {
    const databasePrefix = getDatabaseObjectPrefix(databaseName);
    return `
SELECT
    s.name AS SchemaName,
    p.name AS ObjectName
FROM ${databasePrefix}sys.procedures p
INNER JOIN ${databasePrefix}sys.schemas s ON p.schema_id = s.schema_id
WHERE s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
ORDER BY s.name, p.name`;
}

function buildFunctionsQuery(databaseName?: string): string {
    const databasePrefix = getDatabaseObjectPrefix(databaseName);
    return `
SELECT
    s.name AS SchemaName,
    o.name AS ObjectName
FROM ${databasePrefix}sys.objects o
INNER JOIN ${databasePrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN ('AF', 'FN', 'IF', 'TF')
    AND s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
ORDER BY s.name, o.name`;
}

function escapeSqlIdentifierPart(value: string): string {
    return value.replace(/]/g, "]]");
}

function getDatabaseObjectPrefix(databaseName?: string): string {
    return databaseName ? `[${escapeSqlIdentifierPart(databaseName)}].` : "";
}

function escapeSqlStringLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

function buildStoredProcedureParametersQuery(schema: string, objectName: string): string {
    const escapedSchema = escapeSqlStringLiteral(schema);
    const escapedObjectName = escapeSqlStringLiteral(objectName);
    return `
SELECT
    p.name AS ParameterName,
    TYPE_NAME(p.user_type_id) AS DataType,
    p.has_default_value AS HasDefaultValue,
    CONVERT(nvarchar(max), p.default_value) AS DefaultValue,
    p.is_output AS IsOutput
FROM sys.parameters p
INNER JOIN sys.objects o ON p.object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = N'${escapedSchema}'
    AND o.name = N'${escapedObjectName}'
    AND o.type IN ('P', 'PC')
ORDER BY p.parameter_id`;
}

function buildAllViewColumnsQuery(databaseName?: string): string {
    const databasePrefix = getDatabaseObjectPrefix(databaseName);
    return `
SELECT
    s.name AS SchemaName,
    v.name AS ObjectName,
    c.name AS ColumnName,
    TYPE_NAME(c.user_type_id) AS DataType,
    c.is_computed AS IsComputed,
    COLUMNPROPERTY(c.object_id, c.name, 'IsDeterministic') AS IsDeterministic,
    CONVERT(bit, CASE WHEN ic.column_id IS NULL THEN 0 ELSE 1 END) AS IsKey
FROM ${databasePrefix}sys.views v
INNER JOIN ${databasePrefix}sys.schemas s ON v.schema_id = s.schema_id
INNER JOIN ${databasePrefix}sys.columns c ON v.object_id = c.object_id
LEFT JOIN (
    SELECT DISTINCT ic.object_id, ic.column_id
    FROM ${databasePrefix}sys.indexes i
    INNER JOIN ${databasePrefix}sys.index_columns ic
        ON i.object_id = ic.object_id
        AND i.index_id = ic.index_id
    WHERE i.is_unique = 1
        AND i.is_hypothetical = 0
) ic ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
ORDER BY s.name, v.name, c.column_id`;
}

function buildAllStoredProcedureParametersQuery(databaseName?: string): string {
    const databasePrefix = getDatabaseObjectPrefix(databaseName);
    return `
SELECT
    s.name AS SchemaName,
    o.name AS ObjectName,
    p.name AS ParameterName,
    TYPE_NAME(p.user_type_id) AS DataType,
    p.has_default_value AS HasDefaultValue,
    CONVERT(nvarchar(max), p.default_value) AS DefaultValue,
    p.is_output AS IsOutput
FROM ${databasePrefix}sys.parameters p
INNER JOIN ${databasePrefix}sys.objects o ON p.object_id = o.object_id
INNER JOIN ${databasePrefix}sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN ('P', 'PC')
    AND s.name NOT IN (N'sys', N'INFORMATION_SCHEMA')
ORDER BY s.name, o.name, p.parameter_id`;
}

function getObjectKey(schema: string, objectName: string): string {
    return `${schema}.${objectName}`.toLowerCase();
}

function getCellDisplayValue(row: SimpleExecuteResult["rows"][number], index: number): string {
    const cell = row[index];
    return !cell || cell.isNull ? "" : cell.displayValue.trim();
}

function parseSqlBoolean(value: string): boolean {
    return value === "1" || value.toLowerCase() === "true";
}

function getObjectMetadataFromResult(
    result: SimpleExecuteResult,
    metadataType: MetadataType,
    metadataTypeName: string,
): ObjectMetadata[] {
    if (!result?.rows?.length) {
        return [];
    }

    return result.rows
        .map((row): ObjectMetadata | undefined => {
            const schema = getCellDisplayValue(row, 0);
            const name = getCellDisplayValue(row, 1);
            if (!schema || !name) {
                return undefined;
            }

            return {
                metadataType,
                metadataTypeName,
                schema,
                name,
            };
        })
        .filter((object): object is ObjectMetadata => !!object);
}

function getStoredProcedureParametersFromResult(
    result: SimpleExecuteResult,
): StoredProcedureParameterMetadata[] {
    if (!result?.rows?.length) {
        return [];
    }

    return result.rows
        .map((row): StoredProcedureParameterMetadata | undefined => {
            const rawName = getCellDisplayValue(row, 0);
            if (!rawName) {
                return undefined;
            }

            const hasDefaultValue = parseSqlBoolean(getCellDisplayValue(row, 2));
            const defaultValue = getCellDisplayValue(row, 3);
            return {
                name: rawName.startsWith("@") ? rawName.slice(1) : rawName,
                dataType: getCellDisplayValue(row, 1) || undefined,
                required: !hasDefaultValue,
                default: hasDefaultValue ? defaultValue || null : undefined,
            };
        })
        .filter((parameter): parameter is StoredProcedureParameterMetadata => !!parameter);
}

function getViewColumnsByObjectFromResult(
    result: SimpleExecuteResult,
): Map<string, ColumnMetadata[]> {
    const columnsByObject = new Map<string, ColumnMetadata[]>();
    if (!result?.rows?.length) {
        return columnsByObject;
    }

    for (const row of result.rows) {
        const schema = getCellDisplayValue(row, 0);
        const objectName = getCellDisplayValue(row, 1);
        const columnName = getCellDisplayValue(row, 2);
        if (!schema || !objectName || !columnName) {
            continue;
        }

        const key = getObjectKey(schema, objectName);
        const columns = columnsByObject.get(key) ?? [];
        const isKey = parseSqlBoolean(getCellDisplayValue(row, 6));
        columns.push({
            escapedName: columnName,
            isComputed: parseSqlBoolean(getCellDisplayValue(row, 4)),
            isDeterministic: parseSqlBoolean(getCellDisplayValue(row, 5)),
            isIdentity: false,
            ordinal: columns.length,
            hasExtendedProperties: false,
            isKey,
            isTrustworthyForUniqueness: isKey,
        });
        columnsByObject.set(key, columns);
    }

    return columnsByObject;
}

function getStoredProcedureParametersByObjectFromResult(
    result: SimpleExecuteResult,
): Map<string, StoredProcedureMetadataResult> {
    const parametersByObject = new Map<string, StoredProcedureMetadataResult>();
    if (!result?.rows?.length) {
        return parametersByObject;
    }

    for (const row of result.rows) {
        const schema = getCellDisplayValue(row, 0);
        const objectName = getCellDisplayValue(row, 1);
        const rawName = getCellDisplayValue(row, 2);
        if (!schema || !objectName || !rawName) {
            continue;
        }

        const hasDefaultValue = parseSqlBoolean(getCellDisplayValue(row, 4));
        const defaultValue = getCellDisplayValue(row, 5);
        const key = getObjectKey(schema, objectName);
        const procedureInfo = parametersByObject.get(key) ?? { parameters: [] };
        procedureInfo.parameters.push({
            name: rawName.startsWith("@") ? rawName.slice(1) : rawName,
            dataType: getCellDisplayValue(row, 3) || undefined,
            required: !hasDefaultValue,
            default: hasDefaultValue ? defaultValue || null : undefined,
        });
        parametersByObject.set(key, procedureInfo);
    }

    return parametersByObject;
}
