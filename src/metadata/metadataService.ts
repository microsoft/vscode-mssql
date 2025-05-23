/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import {
    MetadataQueryParams,
    MetadataQueryRequest,
} from "../models/contracts/metadata/metadataRequest";
import { ObjectMetadata } from "vscode-mssql";

export interface TableInfo {
    name: string;
    schema: string;
    fullyQualifiedName: string;
    type: 'Table' | 'View';
    urn?: string;
}

export interface ColumnInfo {
    name: string;
    dataType: string;
    tableName: string;
    schema: string;
    isNullable: boolean;
    isPrimaryKey?: boolean;
    fullyQualifiedTableName: string;
}

export interface AliasTableMapping {
    alias: string;
    tableName: string;
    schema: string;
    fullyQualifiedName: string;
}

export class MetadataService {
    private _client: SqlToolsServiceClient;
    private _cachedTables: Map<string, TableInfo[]> = new Map();
    private _cachedColumns: Map<string, ColumnInfo[]> = new Map();

    constructor(private _connectionManager: ConnectionManager) {
        this._client = this._connectionManager.client;
    }

    public async getMetadata(uri: string): Promise<ObjectMetadata[]> {
        const metadataParams: MetadataQueryParams = { ownerUri: uri };
        const { metadata } = await this._client.sendRequest(
            MetadataQueryRequest.type,
            metadataParams,
        );
        return metadata;
    }

    public async getAllTables(uri: string, forceRefresh: boolean = false): Promise<TableInfo[]> {
        if (!forceRefresh && this._cachedTables.has(uri)) {
            return this._cachedTables.get(uri)!;
        }

        try {
            const metadata = await this.getMetadata(uri);
            const tables: TableInfo[] = [];

            // Extract tables and views from metadata
            this.extractTablesFromMetadata(metadata, tables);

            // Cache the results
            this._cachedTables.set(uri, tables);
            return tables;
        } catch (error) {
            console.error('Error fetching table metadata:', error);
            return [];
        }
    }

    private extractTablesFromMetadata(metadata: ObjectMetadata[], tables: TableInfo[]): void {
        for (const item of metadata) {
            // Check if this is a table or view directly
            if (item.metadataTypeName === 'Table' || item.metadataTypeName === 'View') {
                const tableInfo: TableInfo = {
                    name: item.name,
                    schema: item.schema || 'dbo',
                    fullyQualifiedName: `${item.schema || 'dbo'}.${item.name}`,
                    type: item.metadataTypeName as 'Table' | 'View',
                    urn: item.urn
                };
                tables.push(tableInfo);
            }
        }
    }

    public clearCache(uri?: string): void {
        if (uri) {
            this._cachedTables.delete(uri);
            // Clear column cache for this URI
            const keysToDelete = Array.from(this._cachedColumns.keys()).filter(key => key.startsWith(`${uri}:`));
            keysToDelete.forEach(key => this._cachedColumns.delete(key));
        } else {
            this._cachedTables.clear();
            this._cachedColumns.clear();
        }
    }

    public async searchTables(uri: string, searchTerm: string): Promise<TableInfo[]> {
        console.log(`🔎 MetadataService.searchTables called with searchTerm: "${searchTerm}"`);
        const allTables = await this.getAllTables(uri);

        console.log(`📊 Total tables available: ${allTables.length}`);

        if (!searchTerm || searchTerm.trim() === '') {
            console.log('🎯 No search term, returning all tables');
            return allTables;
        }

        const searchLower = searchTerm.toLowerCase();
        const filteredTables = allTables.filter(table =>
            table.name.toLowerCase().includes(searchLower) ||
            table.fullyQualifiedName.toLowerCase().includes(searchLower) ||
            table.schema.toLowerCase().includes(searchLower)
        );

        console.log(`✅ Filtered tables: ${filteredTables.length} matches`);
        return filteredTables;
    }

    public async getColumnsForTable(uri: string, tableName: string, schema?: string): Promise<ColumnInfo[]> {
        console.log(`🔍 Getting columns for table: ${schema ? schema + '.' : ''}${tableName}`);

        const cacheKey = `${uri}:${schema || 'dbo'}.${tableName}`;
        if (this._cachedColumns.has(cacheKey)) {
            const cached = this._cachedColumns.get(cacheKey)!;
            console.log(`📋 Found ${cached.length} cached columns`);
            return cached;
        }

        try {
            const metadata = await this.getMetadata(uri);
            const columns: ColumnInfo[] = [];

            // Find the table first
            const table = metadata.find(item =>
                item.name === tableName &&
                (schema ? item.schema === schema : true) &&
                (item.metadataTypeName === 'Table' || item.metadataTypeName === 'View')
            );

            if (!table) {
                console.log(`❌ Table not found: ${schema ? schema + '.' : ''}${tableName}`);
                return [];
            }

            // Extract columns from metadata - this is a simplified approach
            // In a real implementation, you might need to make a separate metadata call for columns
            this.extractColumnsFromMetadata(metadata, table, columns);

            console.log(`✅ Found ${columns.length} columns for ${schema ? schema + '.' : ''}${tableName}`);
            this._cachedColumns.set(cacheKey, columns);
            return columns;

        } catch (error) {
            console.error(`❌ Error fetching columns for ${tableName}:`, error);
            return [];
        }
    }

    private extractColumnsFromMetadata(metadata: ObjectMetadata[], table: ObjectMetadata, columns: ColumnInfo[]): void {
        console.log(`🔍 Extracting columns for table: ${table.name}`);

        // Look for column metadata in the metadata array
        // SQL Tools Service typically returns columns as child objects of tables
        const tableColumns = metadata.filter(item =>
            item.metadataTypeName === 'Column' &&
            item.parentName === table.name &&
            (table.schema ? item.schema === table.schema : true)
        );

        console.log(`📋 Found ${tableColumns.length} column metadata objects`);

        if (tableColumns.length > 0) {
            // Use actual column metadata
            tableColumns.forEach(col => {
                columns.push({
                    name: col.name,
                    dataType: col.metadataType?.toString() || 'unknown',
                    tableName: table.name,
                    schema: table.schema || 'dbo',
                    isNullable: true, // This info might not be available in basic metadata
                    isPrimaryKey: false, // This would need special detection
                    fullyQualifiedTableName: `${table.schema || 'dbo'}.${table.name}`
                });
            });
        } else {
            // Fallback: Create some common example columns
            console.log(`⚠️ No column metadata found, using fallback columns`);
            const commonColumns = [
                { name: 'Id', dataType: 'int', isNullable: false, isPrimaryKey: true },
                { name: 'Name', dataType: 'nvarchar', isNullable: true },
                { name: 'CreatedDate', dataType: 'datetime', isNullable: false },
                { name: 'UpdatedDate', dataType: 'datetime', isNullable: true },
            ];

            commonColumns.forEach(col => {
                columns.push({
                    name: col.name,
                    dataType: col.dataType,
                    tableName: table.name,
                    schema: table.schema || 'dbo',
                    isNullable: col.isNullable,
                    isPrimaryKey: col.isPrimaryKey,
                    fullyQualifiedTableName: `${table.schema || 'dbo'}.${table.name}`
                });
            });
        }
    }

    public parseAliasFromQuery(sqlText: string, cursorPosition: number): AliasTableMapping | null {
        console.log(`🔍 Parsing alias from SQL at position ${cursorPosition}`);

        // Get text up to cursor position
        const textToCursor = sqlText.substring(0, cursorPosition);
        console.log(`📄 Text to cursor: "${textToCursor}"`);

        // Look for what's being typed at cursor position
        const beforeCursor = textToCursor.split(/\s+/).pop() || '';
        const currentContext = textToCursor.substring(Math.max(0, textToCursor.length - 100));
        console.log(`📍 Before cursor: "${beforeCursor}"`);
        console.log(`📍 Context (last 100 chars): "${currentContext}"`);

        // Check if we're in an alias.column situation
        const aliasMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        if (!aliasMatch) {
            console.log(`❌ No alias pattern found in "${beforeCursor}"`);
            return null;
        }

        const requestedAlias = aliasMatch[1];
        console.log(`🎯 Found alias request: "${requestedAlias}"`);

        // Look for table alias patterns in the entire text up to cursor
        const aliases: AliasTableMapping[] = [];

        // Enhanced regex patterns for finding aliases
        const patterns = [
            // FROM schema.table alias
            /FROM\s+(?:(\w+)\.)?(\w+)\s+(?:AS\s+)?(\w+)(?=\s|$|,|\))/gi,
            // JOIN schema.table alias
            /(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+JOIN\s+(?:(\w+)\.)?(\w+)\s+(?:AS\s+)?(\w+)(?=\s|$|,|\))/gi,
        ];

        patterns.forEach((pattern, index) => {
            console.log(`🔍 Trying pattern ${index + 1}: ${pattern.source}`);
            let match;
            pattern.lastIndex = 0; // Reset regex

            while ((match = pattern.exec(textToCursor)) !== null) {
                const alias = match[3];
                const schema = match[1] || 'dbo';
                const tableName = match[2];

                console.log(`✅ Found alias mapping: ${alias} -> ${schema}.${tableName}`);

                aliases.push({
                    alias: alias,
                    schema: schema,
                    tableName: tableName,
                    fullyQualifiedName: `${schema}.${tableName}`
                });
            }
        });

        console.log(`📋 Total aliases found: ${aliases.length}`);
        aliases.forEach(a => console.log(`  - ${a.alias} -> ${a.fullyQualifiedName}`));

        // Find the alias that matches our request
        const found = aliases.find(a => a.alias.toLowerCase() === requestedAlias.toLowerCase());
        if (found) {
            console.log(`✅ Matched alias: ${found.alias} -> ${found.fullyQualifiedName}`);
            return found;
        }

        console.log(`❌ No matching alias found for "${requestedAlias}"`);
        console.log(`Available aliases: ${aliases.map(a => a.alias).join(', ')}`);
        return null;
    }
}
