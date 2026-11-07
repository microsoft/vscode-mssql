/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import { getLogger } from "../models/logger";
import { bracketEscapeSqlIdentifier } from "../models/utils";
import { Dab } from "../sharedInterfaces/dab";
import { escapeStringLiteral } from "../utils/sqlStringUtils";
import { getErrorMessage } from "../utils/utils";
import { RequestType } from "vscode-languageclient";
import type { SimpleExecuteResult } from "vscode-mssql";

const logger = getLogger("DabMetadataService");

const simpleExecuteRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

function getNoLockTableHint(options?: Dab.DabMetadataQueryOptions): string {
    return options?.useNoLock ? " WITH (NOLOCK)" : "";
}

/**
 * DAB reads a table-valued parameter as "table type" and cannot map it, so report
 * it the same way to mark the procedure as unsupported.
 */
function getParameterDataTypeExpression(): string {
    return "CASE WHEN t.is_table_type = 1 THEN N'table type' ELSE TYPE_NAME(p.user_type_id) END";
}

function getListDabViewsQuery(options?: Dab.DabMetadataQueryOptions): string {
    const tableHint = getNoLockTableHint(options);
    return `
SELECT
    SCHEMA_NAME(v.schema_id) AS [schema_name],
    v.name AS [object_name],
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name) AS [object_id]
FROM sys.views AS v${tableHint}
WHERE v.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(v.schema_id), v.name;`;
}

function getListDabStoredProceduresQuery(options?: Dab.DabMetadataQueryOptions): string {
    const tableHint = getNoLockTableHint(options);
    return `
SELECT
    SCHEMA_NAME(p.schema_id) AS [schema_name],
    p.name AS [object_name],
    CONCAT('stored-procedure:', SCHEMA_NAME(p.schema_id), '.', p.name) AS [object_id]
FROM sys.procedures AS p${tableHint}
WHERE p.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(p.schema_id), p.name;`;
}

function getListDabViewColumnsQuery(options?: Dab.DabMetadataQueryOptions): string {
    const tableHint = getNoLockTableHint(options);
    return `
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
    FROM sys.indexes AS i${tableHint}
    INNER JOIN sys.views AS v${tableHint}
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
FROM sys.views AS v${tableHint}
INNER JOIN sys.columns AS c${tableHint}
    ON c.object_id = v.object_id
LEFT JOIN selected_unique_index AS sui
    ON sui.object_id = v.object_id
LEFT JOIN sys.index_columns AS ic${tableHint}
    ON ic.object_id = sui.object_id
    AND ic.index_id = sui.index_id
    AND ic.column_id = c.column_id
    AND ic.key_ordinal > 0
    AND ic.is_included_column = 0
WHERE v.is_ms_shipped = 0
ORDER BY SCHEMA_NAME(v.schema_id), v.name, c.column_id;`;
}

/**
 * Traces the columns of each view without a unique index back to the unique keys of
 * its base tables. Browse information makes SQL Server report every key column it
 * needs to identify a row, and adds the ones the view leaves out as hidden columns.
 */
function getListDabViewSourceKeysQuery(options?: Dab.DabMetadataQueryOptions): string {
    const tableHint = getNoLockTableHint(options);
    return `
;WITH views_without_unique_index AS
(
    SELECT
        v.object_id,
        v.schema_id,
        v.name
    FROM sys.views AS v${tableHint}
    WHERE v.is_ms_shipped = 0
        AND NOT EXISTS (
            SELECT 1
            FROM sys.indexes AS i${tableHint}
            WHERE i.object_id = v.object_id
                AND i.is_unique = 1
                AND i.is_hypothetical = 0
                AND i.has_filter = 0
        )
)
SELECT
    CONCAT('view:', SCHEMA_NAME(v.schema_id), '.', v.name) AS [object_id],
    r.name AS [column_name],
    CAST(r.is_hidden AS bit) AS [is_hidden],
    CONCAT(r.source_database, N'.', r.source_schema, N'.', r.source_table) AS [source_table]
FROM views_without_unique_index AS v
CROSS APPLY sys.dm_exec_describe_first_result_set(
    N'SELECT * FROM ' + QUOTENAME(SCHEMA_NAME(v.schema_id)) + N'.' + QUOTENAME(v.name),
    NULL,
    1
) AS r
WHERE r.error_number IS NULL
    AND r.is_part_of_unique_key = 1
    AND r.source_table IS NOT NULL
ORDER BY SCHEMA_NAME(v.schema_id), v.name, r.column_ordinal;`;
}

/**
 * Reads the first result set of each stored procedure the same way DAB does at
 * startup, so procedures that would stop DAB can be found before deployment.
 */
function getListDabStoredProcedureResultColumnsQuery(
    options?: Dab.DabMetadataQueryOptions,
): string {
    const tableHint = getNoLockTableHint(options);
    return `
SELECT
    CONCAT('stored-procedure:', SCHEMA_NAME(sp.schema_id), '.', sp.name) AS [object_id],
    r.name AS [column_name],
    COALESCE(TYPE_NAME(r.system_type_id), r.system_type_name) AS [data_type],
    r.column_ordinal AS [ordinal]
FROM sys.procedures AS sp${tableHint}
CROSS APPLY sys.dm_exec_describe_first_result_set_for_object(sp.object_id, 0) AS r
WHERE sp.is_ms_shipped = 0
    AND r.is_hidden IS NOT NULL
    AND r.is_hidden = 0
ORDER BY SCHEMA_NAME(sp.schema_id), sp.name, r.column_ordinal;`;
}

function getListDabStoredProcedureParametersQuery(options?: Dab.DabMetadataQueryOptions): string {
    const tableHint = getNoLockTableHint(options);
    return `
SELECT
    CONCAT('stored-procedure:', SCHEMA_NAME(sp.schema_id), '.', sp.name) AS [object_id],
    p.name AS [parameter_name],
    ${getParameterDataTypeExpression()} AS [data_type],
    p.parameter_id AS [ordinal]
FROM sys.procedures AS sp${tableHint}
INNER JOIN sys.parameters AS p${tableHint}
    ON p.object_id = sp.object_id
INNER JOIN sys.types AS t${tableHint}
    ON t.user_type_id = p.user_type_id
WHERE sp.is_ms_shipped = 0
    AND p.parameter_id > 0
ORDER BY SCHEMA_NAME(sp.schema_id), sp.name, p.parameter_id;`;
}

function getDabViewColumnsQuery(
    schema: string,
    viewName: string,
    options?: Dab.DabMetadataQueryOptions,
): string {
    const tableHint = getNoLockTableHint(options);
    return `
DECLARE @schemaName sysname = N'${escapeStringLiteral(schema)}';
DECLARE @viewName sysname = N'${escapeStringLiteral(viewName)}';
DECLARE @viewObjectId int = OBJECT_ID(QUOTENAME(@schemaName) + N'.' + QUOTENAME(@viewName));

;WITH selected_unique_index AS
(
    SELECT TOP (1)
        i.object_id,
        i.index_id
    FROM sys.indexes AS i${tableHint}
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
            INNER JOIN sys.index_columns AS ic${tableHint}
                ON ic.object_id = sui.object_id
                AND ic.index_id = sui.index_id
                AND ic.column_id = c.column_id
                AND ic.key_ordinal > 0
                AND ic.is_included_column = 0
        ) THEN 1
        ELSE 0
    END AS bit) AS [is_primary_key]
FROM sys.views AS v${tableHint}
INNER JOIN sys.columns AS c${tableHint}
    ON c.object_id = v.object_id
WHERE v.object_id = @viewObjectId
ORDER BY c.column_id;`;
}

function getDabStoredProcedureParametersQuery(
    schema: string,
    procedureName: string,
    options?: Dab.DabMetadataQueryOptions,
): string {
    const tableHint = getNoLockTableHint(options);
    return `
DECLARE @schemaName sysname = N'${escapeStringLiteral(schema)}';
DECLARE @procedureName sysname = N'${escapeStringLiteral(procedureName)}';
DECLARE @procedureObjectId int = OBJECT_ID(
    QUOTENAME(@schemaName) + N'.' + QUOTENAME(@procedureName)
);

SELECT
    p.name AS [parameter_name],
    ${getParameterDataTypeExpression()} AS [data_type],
    p.parameter_id AS [ordinal]
FROM sys.parameters AS p${tableHint}
INNER JOIN sys.types AS t${tableHint}
    ON t.user_type_id = p.user_type_id
WHERE p.object_id = @procedureObjectId
    AND p.parameter_id > 0
ORDER BY p.parameter_id;`;
}

export interface IDabMetadataService {
    listDabViews(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabDatabaseObjectMetadata[]>;

    listDabStoredProcedures(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabDatabaseObjectMetadata[]>;

    getDabViewColumnsByView(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabViewColumnMetadata[]>>;

    getDabViewColumns(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabViewColumnMetadata[]>;

    getDabStoredProcedureParametersByProcedure(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabStoredProcedureParameterMetadata[]>>;

    getDabStoredProcedureParameters(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabStoredProcedureParameterMetadata[]>;

    /**
     * Returns key column names for views without a unique index, taken from the
     * unique keys of their base tables. Views with no traceable key are left out.
     */
    getDabViewSourceKeysByView(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, string[]>>;

    getDabStoredProcedureResultColumnsByProcedure(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabStoredProcedureResultColumnMetadata[]>>;
}

export class DabMetadataService implements IDabMetadataService {
    constructor(private _client: SqlToolsServiceClient) {}

    public async listDabViews(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabDatabaseObjectMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabViewsQuery(options),
                databaseName,
            );
            return this.parseDabDatabaseObjects(result);
        } catch (error) {
            logger.error(`Failed to list DAB views: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async listDabStoredProcedures(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabDatabaseObjectMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabStoredProceduresQuery(options),
                databaseName,
            );
            return this.parseDabDatabaseObjects(result);
        } catch (error) {
            logger.error(`Failed to list DAB stored procedures: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async getDabViewColumns(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabViewColumnMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getDabViewColumnsQuery(schema, objectName, options),
                databaseName,
            );
            return this.parseDabViewColumns(result);
        } catch (error) {
            logger.error(`Failed to get DAB view columns: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async getDabViewColumnsByView(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabViewColumnMetadata[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabViewColumnsQuery(options),
                databaseName,
            );
            return this.parseDabViewColumnsByObject(result);
        } catch (error) {
            logger.error(`Failed to get DAB view columns by view: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async getDabStoredProcedureParameters(
        ownerUri: string,
        schema: string,
        objectName: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Dab.DabStoredProcedureParameterMetadata[]> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getDabStoredProcedureParametersQuery(schema, objectName, options),
                databaseName,
            );
            return this.parseDabStoredProcedureParameters(result);
        } catch (error) {
            logger.error(
                `Failed to get DAB stored procedure parameters: ${getErrorMessage(error)}`,
            );
            throw error;
        }
    }

    public async getDabStoredProcedureParametersByProcedure(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabStoredProcedureParameterMetadata[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabStoredProcedureParametersQuery(options),
                databaseName,
            );
            return this.parseDabStoredProcedureParametersByObject(result);
        } catch (error) {
            logger.error(
                `Failed to get DAB stored procedure parameters by procedure: ${getErrorMessage(error)}`,
            );
            throw error;
        }
    }

    public async getDabViewSourceKeysByView(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, string[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabViewSourceKeysQuery(options),
                databaseName,
            );
            return this.parseDabViewSourceKeysByObject(result);
        } catch (error) {
            logger.error(`Failed to get DAB view source keys: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async getDabStoredProcedureResultColumnsByProcedure(
        ownerUri: string,
        databaseName?: string,
        options?: Dab.DabMetadataQueryOptions,
    ): Promise<Map<string, Dab.DabStoredProcedureResultColumnMetadata[]>> {
        try {
            const result = await this.executeSimpleQuery(
                ownerUri,
                getListDabStoredProcedureResultColumnsQuery(options),
                databaseName,
            );
            return this.parseDabStoredProcedureResultColumnsByObject(result);
        } catch (error) {
            logger.error(
                `Failed to get DAB stored procedure result columns: ${getErrorMessage(error)}`,
            );
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

    private getPositiveOrdinalCellValue(
        result: SimpleExecuteResult,
        rowIndex: number,
        columnIndex: number,
    ): number | undefined {
        const rawValue = this.getCellDisplayValue(result, rowIndex, columnIndex);
        if (!rawValue) {
            return undefined;
        }

        const ordinal = Number(rawValue);
        return Number.isInteger(ordinal) && ordinal > 0 ? ordinal : undefined;
    }

    private parseDabDatabaseObjects(result: SimpleExecuteResult): Dab.DabDatabaseObjectMetadata[] {
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
            .filter((object): object is Dab.DabDatabaseObjectMetadata => !!object);
    }

    private parseDabViewColumns(result: SimpleExecuteResult): Dab.DabViewColumnMetadata[] {
        return (result?.rows ?? [])
            .map((_, index) => {
                const id = this.getCellDisplayValue(result, index, 0);
                const name = this.getCellDisplayValue(result, index, 1);
                const dataType = this.getCellDisplayValue(result, index, 2);
                const ordinal = this.getPositiveOrdinalCellValue(result, index, 3);
                const isPrimaryKey = this.getBooleanCellValue(result, index, 4);
                if (!id || !name || !dataType || ordinal === undefined) {
                    return undefined;
                }
                return { id, name, dataType, ordinal, isPrimaryKey };
            })
            .filter((column): column is Dab.DabViewColumnMetadata => !!column);
    }

    private parseDabViewColumnsByObject(
        result: SimpleExecuteResult,
    ): Map<string, Dab.DabViewColumnMetadata[]> {
        const columnsByObject = new Map<string, Dab.DabViewColumnMetadata[]>();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const id = this.getCellDisplayValue(result, index, 1);
            const name = this.getCellDisplayValue(result, index, 2);
            const dataType = this.getCellDisplayValue(result, index, 3);
            const ordinal = this.getPositiveOrdinalCellValue(result, index, 4);
            const isPrimaryKey = this.getBooleanCellValue(result, index, 5);
            if (!objectId || !id || !name || !dataType || ordinal === undefined) {
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
    ): Dab.DabStoredProcedureParameterMetadata[] {
        return (result?.rows ?? [])
            .map((_, index) => {
                const name = this.getCellDisplayValue(result, index, 0);
                const dataType = this.getCellDisplayValue(result, index, 1);
                const ordinal = this.getPositiveOrdinalCellValue(result, index, 2);
                if (!name || !dataType || ordinal === undefined) {
                    return undefined;
                }
                const parameter: Dab.DabStoredProcedureParameterMetadata = {
                    name,
                    dataType,
                    ordinal,
                };
                return parameter;
            })
            .filter(
                (parameter): parameter is Dab.DabStoredProcedureParameterMetadata => !!parameter,
            );
    }

    private parseDabStoredProcedureParametersByObject(
        result: SimpleExecuteResult,
    ): Map<string, Dab.DabStoredProcedureParameterMetadata[]> {
        const parametersByObject = new Map<string, Dab.DabStoredProcedureParameterMetadata[]>();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const name = this.getCellDisplayValue(result, index, 1);
            const dataType = this.getCellDisplayValue(result, index, 2);
            const ordinal = this.getPositiveOrdinalCellValue(result, index, 3);
            if (!objectId || !name || !dataType || ordinal === undefined) {
                continue;
            }

            const parameters = parametersByObject.get(objectId) ?? [];
            parameters.push({ name, dataType, ordinal });
            parametersByObject.set(objectId, parameters);
        }

        return parametersByObject;
    }

    /**
     * A base table counts only when the view shows every column of its key. When
     * no key column is hidden, the visible key columns identify each row. When some
     * are hidden, the fully shown keys are the closest match the view has.
     */
    private parseDabViewSourceKeysByObject(result: SimpleExecuteResult): Map<string, string[]> {
        const keyColumnsByObject = new Map<
            string,
            { name: string; isHidden: boolean; sourceTable: string }[]
        >();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const name = this.getCellDisplayValue(result, index, 1);
            const isHidden = this.getBooleanCellValue(result, index, 2);
            const sourceTable = this.getCellDisplayValue(result, index, 3);
            if (!objectId || !name || !sourceTable) {
                continue;
            }

            const keyColumns = keyColumnsByObject.get(objectId) ?? [];
            keyColumns.push({ name, isHidden, sourceTable: sourceTable.toLowerCase() });
            keyColumnsByObject.set(objectId, keyColumns);
        }

        const keysByObject = new Map<string, string[]>();
        for (const [objectId, keyColumns] of keyColumnsByObject) {
            const partlyHiddenTables = new Set(
                keyColumns.filter((column) => column.isHidden).map((column) => column.sourceTable),
            );
            const keyNames = [
                ...new Set(
                    keyColumns
                        .filter(
                            (column) =>
                                !column.isHidden && !partlyHiddenTables.has(column.sourceTable),
                        )
                        .map((column) => column.name),
                ),
            ];
            if (keyNames.length > 0) {
                keysByObject.set(objectId, keyNames);
            }
        }

        return keysByObject;
    }

    private parseDabStoredProcedureResultColumnsByObject(
        result: SimpleExecuteResult,
    ): Map<string, Dab.DabStoredProcedureResultColumnMetadata[]> {
        const columnsByObject = new Map<string, Dab.DabStoredProcedureResultColumnMetadata[]>();
        for (let index = 0; index < (result?.rows ?? []).length; index++) {
            const objectId = this.getCellDisplayValue(result, index, 0);
            const name = this.getCellDisplayValue(result, index, 1);
            const dataType = this.getCellDisplayValue(result, index, 2) ?? "";
            const ordinal = this.getPositiveOrdinalCellValue(result, index, 3);
            if (!objectId || ordinal === undefined) {
                continue;
            }

            const columns = columnsByObject.get(objectId) ?? [];
            columns.push({ ...(name ? { name } : {}), dataType, ordinal });
            columnsByObject.set(objectId, columns);
        }

        return columnsByObject;
    }
}
