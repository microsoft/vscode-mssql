/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
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
            const activeDesigner = SchemaDesignerWebviewManager.getInstance().getActiveDesigner();

            if (!activeDesigner) {
                return JSON.stringify({
                    success: false,
                    message: loc.schemaDesignerNoActiveDesigner,
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
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerAddTableSuccess,
                            schema: result.schema,
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
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerUpdateTableSuccess,
                            schema: result.schema,
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
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerDeleteTableSuccess,
                            schema: result.schema,
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
                        return JSON.stringify({
                            success: true,
                            message: loc.schemaDesignerReplaceSchemaSuccess,
                            schema: result.schema ?? schema,
                        });
                    }
                case "get_schema": {
                    activeDesigner.revealToForeground();
                    const currentSchema = await activeDesigner.getSchemaState();
                    return JSON.stringify({
                        success: true,
                        message: loc.schemaDesignerGetSchemaSuccess,
                        schema: currentSchema,
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
}
