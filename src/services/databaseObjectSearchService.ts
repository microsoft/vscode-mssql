/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { SimpleExecuteResult, DbCellValue } from "vscode-mssql";
import { getErrorMessage } from "../utils/utils";

export interface DatabaseObject {
    name: string;
    type: string;
    schema: string;
    fullName: string;
}

export interface SearchResult {
    success: boolean;
    objects: DatabaseObject[];
    error?: string;
}

export class DatabaseObjectSearchService {
    private _client: SqlToolsServiceClient;

    constructor(client?: SqlToolsServiceClient) {
        this._client = client || SqlToolsServiceClient.instance;
    }

    /**
     * Search for database objects matching the given search term
     * @param connectionUri The URI of the active connection
     * @param searchTerm The search term to look for
     * @param database The name of the database to search in. If not provided, the search is performed on the default database for the connection.
     * @returns A promise that resolves to the search results
     */
    public async searchObjects(
        connectionUri: string,
        searchTerm: string,
        database?: string,
    ): Promise<SearchResult> {
        try {
            if (!searchTerm || searchTerm.trim().length === 0) {
                return {
                    success: false,
                    objects: [],
                    error: "Search term cannot be empty",
                };
            }

            const query = this.buildSearchQuery(searchTerm.trim(), database);
            const result = await this._client.sendRequest(
                new RequestType<
                    { ownerUri: string; queryString: string },
                    SimpleExecuteResult,
                    void,
                    void
                >(`query/simpleexecute`),
                {
                    ownerUri: connectionUri,
                    queryString: query,
                },
            );

            const objects = this.parseSearchResults(result);
            return {
                success: true,
                objects: objects,
            };
        } catch (error) {
            return {
                success: false,
                objects: [],
                error: getErrorMessage(error),
            };
        }
    }

    /**
     * Build the SQL query to search for database objects
     * @param searchTerm The term to search for
     * @param _database The name of the database to search in (unused, connection context determines database)
     * @returns The SQL query string
     */
    private buildSearchQuery(searchTerm: string, _database?: string): string {
        // Escape single quotes in the search term
        const escapedSearchTerm = searchTerm.replace(/'/g, "''");
        return `
            SELECT TOP 100
                s.name AS [schema],
                o.name AS [object_name],
                CASE o.type
                    WHEN 'U' THEN 'Table'
                    WHEN 'V' THEN 'View'
                    WHEN 'P' THEN 'Stored Procedure'
                    WHEN 'FN' THEN 'Scalar Function'
                    WHEN 'IF' THEN 'Table-valued Function'
                    WHEN 'TF' THEN 'Table-valued Function'
                    ELSE o.type_desc
                END AS [object_type],
                QUOTENAME(s.name) + '.' + QUOTENAME(o.name) AS [full_name]
            FROM
                sys.all_objects o
            JOIN
                sys.schemas s ON o.schema_id = s.schema_id
            WHERE
                (o.name LIKE '%${escapedSearchTerm}%' OR s.name LIKE '%${escapedSearchTerm}%')
                AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF')
                AND s.name NOT IN ('information_schema')
                AND o.is_ms_shipped = 0
            ORDER BY
                CASE WHEN s.name = 'dbo' THEN 0 ELSE 1 END,
                o.type, s.name, o.name;
        `;
    }

    /**
     * Parse the SQL query results into DatabaseObject array
     * @param result The result from the SQL query
     * @returns Array of DatabaseObject
     */
    private parseSearchResults(result: SimpleExecuteResult): DatabaseObject[] {
        if (!result || !result.rows || result.rows.length === 0) {
            return [];
        }

        const objects: DatabaseObject[] = [];

        for (const row of result.rows) {
            if (row && row.length >= 4) {
                const schema = this.getCellValue(row[0]);
                const name = this.getCellValue(row[1]);
                const type = this.getCellValue(row[2]);
                const fullName = this.getCellValue(row[3]);

                if (schema && name && type && fullName) {
                    objects.push({
                        schema: schema,
                        name: name,
                        type: type,
                        fullName: fullName,
                    });
                }
            }
        }

        return objects;
    }

    /**
     * Helper to safely extract cell value
     * @param cell The database cell value
     * @returns The string value or empty string if null
     */
    private getCellValue(cell: DbCellValue): string {
        return cell && !cell.isNull ? cell.displayValue.trim() : "";
    }

    /**
     * Generate SQL script for the selected object
     * @param obj The database object to generate script for
     * @returns The SQL script
     */
    public generateScript(obj: DatabaseObject): string {
        switch (obj.type) {
            case "Table":
            case "View":
                return `SELECT TOP (100) * FROM ${obj.fullName};`;
            case "Stored Procedure":
                return `EXEC ${obj.fullName};`;
            case "Scalar Function":
            case "Table-valued Function":
                return `-- Function definition\nSELECT OBJECT_DEFINITION(OBJECT_ID('${obj.fullName}'));\n\n-- Example usage (modify as needed)\n-- SELECT ${obj.fullName}();`;
            default:
                return `-- Selected object: ${obj.fullName}\n-- Type: ${obj.type}\n-- Schema: ${obj.schema}\n-- Name: ${obj.name}`;
        }
    }
}
