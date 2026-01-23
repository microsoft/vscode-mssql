/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { createHash } from "crypto";
import { ToolBase } from "./toolBase";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { SchemaDesignerWebviewManager } from "../../schemaDesigner/schemaDesignerWebviewManager";
import ConnectionManager from "../../controllers/connectionManager";
import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";

export interface SchemaDesignerToolParams {
    /**
     * The operation to perform on the schema designer.
     * Supported operations: "show", "add_table", "update_table", "delete_table", "replace_schema", "get_schema"
     */
    operation:
        | "show"
        | "add_table"
        | "update_table"
        | "delete_table"
        | "replace_schema"
        | "get_schema";
    /**
     * Connection ID to use when opening a schema designer (show operation only).
     */
    connectionId?: string;
    /**
     * Operation-specific payload.
     * - add_table: { tableName?, schemaName? } or { table }
     * - update_table: { table }
     * - delete_table: { tableId? } or { tableName, schemaName }
     * - replace_schema: { schema }
     * - get_schema: omit
     */
    payload?: {
        /**
         * Optional name for the new table (add_table) or delete target (delete_table).
         */
        tableName?: string;
        /**
         * Optional schema name for the new table (add_table) or delete target (delete_table).
         */
        schemaName?: string;
        /**
         * Full schema state to replace the current designer model (replace_schema only).
         */
        schema?: SchemaDesigner.Schema;
        /**
         * Full table state to add or update a table (add_table or update_table).
         */
        table?: SchemaDesigner.Table;
        /**
         * Table id to delete (delete_table only).
         */
        tableId?: string;
    };
    /**
     * Options that influence how the UI applies the operation.
     * - keepPositions: preserve existing table positions when replacing schema
     * - focusTableId: center on a table after applying the operation
     */
    options?: {
        keepPositions?: boolean;
        focusTableId?: string;
    };
}

export interface SchemaDesignerToolResult {
    success: boolean;
    message?: string;
    schema?: SchemaDesigner.Schema;
    reason?: "stale_state";
    server?: string;
    database?: string;
}

export class SchemaDesignerTool extends ToolBase<SchemaDesignerToolParams> {
    public readonly toolName = Constants.copilotSchemaDesignerToolName;

    constructor(
        private _connectionManager: ConnectionManager,
        private _showSchema: (connectionUri: string, database: string) => Promise<void>,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { operation, payload, options: uiOptions, connectionId } = options.input;
        const { tableName, schemaName, schema, table, tableId } = payload ?? {};
        const { keepPositions, focusTableId } = uiOptions ?? {};

        try {
            const schemaDesignerManager = SchemaDesignerWebviewManager.getInstance();
            if (operation === "show") {
                if (!connectionId) {
                    return JSON.stringify({
                        success: false,
                        message: loc.schemaDesignerMissingConnectionId,
                    });
                }
                const connInfo = this._connectionManager.getConnectionInfo(connectionId);
                const connCreds = connInfo?.credentials;
                if (!connCreds) {
                    return JSON.stringify({
                        success: false,
                        message: loc.noConnectionError(connectionId),
                    });
                }
                await this._showSchema(connectionId, connCreds.database);
                return JSON.stringify({
                    success: true,
                    message: loc.showSchemaToolSuccessMessage,
                });
            }

            // Get the active schema designer
            const activeDesigner = schemaDesignerManager.getActiveDesigner();

            if (!activeDesigner) {
                return JSON.stringify({
                    success: false,
                    message: loc.schemaDesignerNoActiveDesigner,
                });
            }

            if (operation === "get_schema") {
                activeDesigner.revealToForeground();
                const currentSchema = await activeDesigner.getSchemaState();
                const schemaHash = this.computeSchemaHash(currentSchema);
                schemaDesignerManager.setSchemaHash(activeDesigner.designerKey, schemaHash);
                return JSON.stringify({
                    success: true,
                    message: loc.schemaDesignerGetSchemaSuccess,
                    schema: currentSchema,
                    server: activeDesigner.server,
                    database: activeDesigner.database,
                });
            }

            const currentSchema = await activeDesigner.getSchemaState();
            const currentSchemaHash = this.computeSchemaHash(currentSchema);
            const cacheKey = activeDesigner.designerKey;
            const previousSchemaHash = schemaDesignerManager.getSchemaHash(cacheKey);
            if (!previousSchemaHash || previousSchemaHash !== currentSchemaHash) {
                schemaDesignerManager.setSchemaHash(cacheKey, currentSchemaHash);
                return JSON.stringify({
                    success: false,
                    reason: "stale_state",
                    message: loc.schemaDesignerStaleState,
                    schema: currentSchema,
                    server: activeDesigner.server,
                    database: activeDesigner.database,
                });
            }

            // Handle the operation
            switch (operation) {
                case "add_table":
                    // Bring the designer to foreground and directly add the table
                    activeDesigner.revealToForeground();
                    {
                        const result = await activeDesigner.addTable(tableName, schemaName, table);
                        if (!result.success) {
                            return JSON.stringify({
                                success: false,
                                message: result.message ?? loc.schemaDesignerAddTableFailed,
                            });
                        }
                        this.updateSchemaHash(cacheKey, result.schema ?? currentSchema);
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerAddTableSuccess,
                            schema: result.schema,
                            server: activeDesigner.server,
                            database: activeDesigner.database,
                        });
                    }
                case "update_table":
                    if (!table) {
                        return JSON.stringify({
                            success: false,
                            message: loc.schemaDesignerMissingTable,
                        });
                    }
                    activeDesigner.revealToForeground();
                    {
                        const result = await activeDesigner.updateTable(table);
                        if (!result.success) {
                            return JSON.stringify({
                                success: false,
                                message: result.message ?? loc.schemaDesignerUpdateTableFailed,
                            });
                        }
                        this.updateSchemaHash(cacheKey, result.schema ?? currentSchema);
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerUpdateTableSuccess,
                            schema: result.schema,
                            server: activeDesigner.server,
                            database: activeDesigner.database,
                        });
                    }
                case "delete_table":
                    if (!tableId && !(tableName && schemaName)) {
                        return JSON.stringify({
                            success: false,
                            message: loc.schemaDesignerMissingDeleteTableTarget,
                        });
                    }
                    activeDesigner.revealToForeground();
                    {
                        const result = await activeDesigner.deleteTable({
                            tableId,
                            tableName,
                            schemaName,
                        });
                        if (!result.success) {
                            return JSON.stringify({
                                success: false,
                                message: result.message ?? loc.schemaDesignerDeleteTableFailed,
                            });
                        }
                        this.updateSchemaHash(cacheKey, result.schema ?? currentSchema);
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerDeleteTableSuccess,
                            schema: result.schema,
                            server: activeDesigner.server,
                            database: activeDesigner.database,
                        });
                    }
                case "replace_schema":
                    if (!schema) {
                        return JSON.stringify({
                            success: false,
                            message: loc.schemaDesignerMissingSchema,
                        });
                    }
                    activeDesigner.revealToForeground();
                    {
                        const result = await activeDesigner.replaceSchemaState(
                            schema,
                            keepPositions,
                            focusTableId,
                        );
                        if (!result.success) {
                            return JSON.stringify({
                                success: false,
                                message: result.message ?? loc.schemaDesignerReplaceSchemaFailed,
                            });
                        }
                        this.updateSchemaHash(cacheKey, result.schema ?? schema);
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerReplaceSchemaSuccess,
                            schema: result.schema ?? schema,
                            server: activeDesigner.server,
                            database: activeDesigner.database,
                        });
                    }

                default:
                    return JSON.stringify({
                        success: false,
                        message: loc.schemaDesignerUnknownOperation(operation),
                    });
            }
        } catch (err) {
            return JSON.stringify({
                success: false,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SchemaDesignerToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { operation } = options.input;

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.schemaDesignerToolConfirmationTitle}`,
            message: new vscode.MarkdownString(
                loc.schemaDesignerToolConfirmationMessage(operation),
            ),
        };
        const invocationMessage = loc.schemaDesignerToolInvocationMessage(operation);
        return { invocationMessage, confirmationMessages };
    }

    private computeSchemaHash(schema: SchemaDesigner.Schema): string {
        const normalizedSchema = this.normalizeSchemaForHash(schema);
        return createHash("sha256").update(JSON.stringify(normalizedSchema)).digest("hex");
    }

    private updateSchemaHash(cacheKey: string, schema: SchemaDesigner.Schema): void {
        const schemaHash = this.computeSchemaHash(schema);
        SchemaDesignerWebviewManager.getInstance().setSchemaHash(cacheKey, schemaHash);
    }

    private normalizeSchemaForHash(schema: SchemaDesigner.Schema): SchemaDesigner.Schema {
        const tables = [...(schema.tables ?? [])].sort((a, b) =>
            this.compareKeys(this.tableSortKey(a), this.tableSortKey(b)),
        );
        return {
            tables: tables.map((table) => ({
                id: table.id,
                name: table.name,
                schema: table.schema,
                columns: [...(table.columns ?? [])]
                    .sort((a, b) => this.compareKeys(this.columnSortKey(a), this.columnSortKey(b)))
                    .map((column) => ({
                        id: column.id,
                        name: column.name,
                        dataType: column.dataType,
                        maxLength: column.maxLength,
                        precision: column.precision,
                        scale: column.scale,
                        isPrimaryKey: column.isPrimaryKey,
                        isIdentity: column.isIdentity,
                        identitySeed: column.identitySeed,
                        identityIncrement: column.identityIncrement,
                        isNullable: column.isNullable,
                        defaultValue: column.defaultValue,
                        isComputed: column.isComputed,
                        computedFormula: column.computedFormula,
                        computedPersisted: column.computedPersisted,
                    })),
                foreignKeys: [...(table.foreignKeys ?? [])]
                    .sort((a, b) =>
                        this.compareKeys(this.foreignKeySortKey(a), this.foreignKeySortKey(b)),
                    )
                    .map((foreignKey) => ({
                        id: foreignKey.id,
                        name: foreignKey.name,
                        columns: [...(foreignKey.columns ?? [])],
                        referencedSchemaName: foreignKey.referencedSchemaName,
                        referencedTableName: foreignKey.referencedTableName,
                        referencedColumns: [...(foreignKey.referencedColumns ?? [])],
                        onDeleteAction: foreignKey.onDeleteAction,
                        onUpdateAction: foreignKey.onUpdateAction,
                    })),
            })),
        };
    }

    private tableSortKey(table: SchemaDesigner.Table): string {
        return `${table.schema ?? ""}.${table.name ?? ""}.${table.id ?? ""}`;
    }

    private columnSortKey(column: SchemaDesigner.Column): string {
        return `${column.id ?? ""}.${column.name ?? ""}.${column.dataType ?? ""}`;
    }

    private foreignKeySortKey(foreignKey: SchemaDesigner.ForeignKey): string {
        return `${foreignKey.id ?? ""}.${foreignKey.name ?? ""}.${foreignKey.referencedSchemaName ?? ""}.${foreignKey.referencedTableName ?? ""}`;
    }

    private compareKeys(left: string, right: string): number {
        return left.localeCompare(right);
    }
}
