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
import { SchemaDesignerWebviewController } from "../../schemaDesigner/schemaDesignerWebviewController";
import { sendActionEvent } from "../../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";

type IncludeOverviewColumns = "none" | "names" | "namesAndTypes";
type IncludeTableColumns = IncludeOverviewColumns | "full";

interface TargetHint {
    server: string;
    database: string;
}

export type SchemaDesignerToolParams =
    | { operation: "show"; connectionId: string }
    | { operation: "get_overview"; options?: { includeColumns?: IncludeOverviewColumns } }
    | {
          operation: "get_table";
          payload: { table: SchemaDesigner.TableRef };
          options?: { includeColumns?: IncludeTableColumns; includeForeignKeys?: boolean };
      }
    | {
          operation: "apply_edits";
          payload: {
              expectedVersion: string;
              targetHint?: TargetHint;
              edits: SchemaDesigner.SchemaDesignerEdit[];
          };
      };

type ToolErrorReason =
    | "no_active_designer"
    | "stale_state"
    | "target_mismatch"
    | "not_found"
    | "ambiguous_identifier"
    | "validation_error"
    | "invalid_request"
    | "internal_error";

interface ToolTarget {
    server?: string;
    database?: string;
}

interface OverviewColumnView {
    name: string;
    dataType?: string;
}

interface OverviewTableView {
    schema: string;
    name: string;
    columns?: OverviewColumnView[];
}

interface SchemaDesignerOverview {
    tables: OverviewTableView[];
    columnsOmitted: boolean;
}

interface TableColumnView {
    id?: string;
    name: string;
    dataType?: string;
    maxLength?: string;
    precision?: number;
    scale?: number;
    isPrimaryKey?: boolean;
    isIdentity?: boolean;
    identitySeed?: number;
    identityIncrement?: number;
    isNullable?: boolean;
    defaultValue?: string;
    isComputed?: boolean;
    computedFormula?: string;
    computedPersisted?: boolean;
}

interface TableForeignKeyView {
    id?: string;
    name: string;
    referencedTable: { schema: string; name: string };
    mappings: { column: string; referencedColumn: string }[];
    onDeleteAction: number;
    onUpdateAction: number;
}

interface SchemaDesignerTableView {
    id?: string;
    schema: string;
    name: string;
    columns?: TableColumnView[];
    foreignKeys?: TableForeignKeyView[];
}

interface ApplyEditsReceipt {
    appliedEdits: number;
    changes: Record<string, unknown>;
    warnings: string[];
}

interface SchemaDesignerToolError {
    success: false;
    reason: ToolErrorReason;
    message: string;
    server?: string;
    database?: string;
    activeTarget?: ToolTarget;
    targetHint?: TargetHint;
    currentVersion?: string;
    currentOverview?: SchemaDesignerOverview;
    suggestedNextCall?: {
        operation: "get_overview";
        options: { includeColumns: IncludeOverviewColumns };
    };
    failedEditIndex?: number;
    appliedEdits?: number;
}

type NormalizedSchemaVersion = {
    tables: {
        schema: string;
        name: string;
        columns: {
            name: string;
            dataType: string;
            maxLength: string;
            precision: number;
            scale: number;
            isPrimaryKey: boolean;
            isIdentity: boolean;
            identitySeed: number;
            identityIncrement: number;
            isNullable: boolean;
            defaultValue: string;
            isComputed: boolean;
            computedFormula: string;
            computedPersisted: boolean;
        }[];
        foreignKeys: {
            name: string;
            columns: string[];
            referencedSchemaName: string;
            referencedTableName: string;
            referencedColumns: string[];
            onDeleteAction: number;
            onUpdateAction: number;
        }[];
    }[];
};

export class SchemaDesignerTool extends ToolBase<SchemaDesignerToolParams> {
    public readonly toolName = Constants.copilotSchemaDesignerToolName;

    constructor(
        private _connectionManager: ConnectionManager,
        private _showSchema: (
            connectionUri: string,
            database: string,
        ) => Promise<SchemaDesignerWebviewController>,
    ) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<SchemaDesignerToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const json = (obj: unknown) => JSON.stringify(obj);

        const sendToolTelemetry = (params: {
            operation: SchemaDesignerToolParams["operation"];
            success: boolean;
            reason?: ToolErrorReason;
            measurements?: { [key: string]: number };
        }) => {
            const { operation, success, reason, measurements } = params;
            try {
                sendActionEvent(
                    TelemetryViews.MssqlCopilot,
                    TelemetryActions.SchemaDesignerTool,
                    {
                        operation,
                        success: String(success),
                        ...(reason ? { reason } : {}),
                    },
                    measurements ?? {},
                );
            } catch {
                // Telemetry must never block tool execution.
            }
        };

        const withTarget = (obj: any, designer: SchemaDesignerWebviewController | undefined) => {
            if (!designer) return obj;
            return {
                ...obj,
                server: designer.server,
                database: designer.database,
            };
        };

        const schemaDesignerManager = SchemaDesignerWebviewManager.getInstance();
        const { operation } = options.input;

        const countEditOps = (edits: SchemaDesigner.SchemaDesignerEdit[]) => {
            const counts: { [key: string]: number } = {
                add_table_count: 0,
                drop_table_count: 0,
                set_table_count: 0,
                add_column_count: 0,
                drop_column_count: 0,
                set_column_count: 0,
                add_foreign_key_count: 0,
                drop_foreign_key_count: 0,
                set_foreign_key_count: 0,
            };

            for (const edit of edits) {
                switch (edit.op) {
                    case "add_table":
                        counts.add_table_count++;
                        break;
                    case "drop_table":
                        counts.drop_table_count++;
                        break;
                    case "set_table":
                        counts.set_table_count++;
                        break;
                    case "add_column":
                        counts.add_column_count++;
                        break;
                    case "drop_column":
                        counts.drop_column_count++;
                        break;
                    case "set_column":
                        counts.set_column_count++;
                        break;
                    case "add_foreign_key":
                        counts.add_foreign_key_count++;
                        break;
                    case "drop_foreign_key":
                        counts.drop_foreign_key_count++;
                        break;
                    case "set_foreign_key":
                        counts.set_foreign_key_count++;
                        break;
                }
            }

            return counts;
        };

        try {
            if (operation === "show") {
                const { connectionId } = options.input;
                if (!connectionId) {
                    const err: SchemaDesignerToolError = {
                        success: false,
                        reason: "invalid_request",
                        message: loc.schemaDesignerMissingConnectionId,
                    };
                    sendToolTelemetry({ operation, success: false, reason: err.reason });
                    return json(err);
                }

                const connInfo = this._connectionManager.getConnectionInfo(connectionId);
                const connCreds = connInfo?.credentials;
                if (!connCreds) {
                    const err: SchemaDesignerToolError = {
                        success: false,
                        reason: "invalid_request",
                        message: loc.noConnectionError(connectionId),
                    };
                    sendToolTelemetry({ operation, success: false, reason: err.reason });
                    return json(err);
                }

                const designer = await this._showSchema(connectionId, connCreds.database);
                const schema = await designer.getSchemaState();
                const version = this.computeSchemaVersion(schema);
                sendToolTelemetry({ operation, success: true });
                return json(
                    withTarget(
                        {
                            success: true,
                            message: loc.showSchemaToolSuccessMessage,
                            version,
                        },
                        designer,
                    ),
                );
            }

            const activeDesigner = schemaDesignerManager.getActiveDesigner();
            if (!activeDesigner) {
                const err: SchemaDesignerToolError = {
                    success: false,
                    reason: "no_active_designer",
                    message: loc.schemaDesignerNoActiveDesigner,
                };
                sendToolTelemetry({ operation, success: false, reason: err.reason });
                return json(err);
            }

            if (operation === "get_overview") {
                const includeColumns = options.input.options?.includeColumns ?? "namesAndTypes";
                const schema = await activeDesigner.getSchemaState();
                const version = this.computeSchemaVersion(schema);
                const overview = this.buildOverview(schema, includeColumns);

                const tables = schema.tables ?? [];
                const totalColumns = tables.reduce((sum, t) => sum + (t.columns?.length ?? 0), 0);
                sendToolTelemetry({
                    operation,
                    success: true,
                    measurements: {
                        tableCount: tables.length,
                        totalColumns,
                        columnsOmitted: overview.columnsOmitted ? 1 : 0,
                    },
                });
                return json(withTarget({ success: true, version, overview }, activeDesigner));
            }

            if (operation === "get_table") {
                const tableRef = options.input.payload?.table;
                const hasId = Boolean(tableRef?.id);
                const hasSchemaAndName = Boolean(tableRef?.schema && tableRef?.name);
                if (!hasId && !hasSchemaAndName) {
                    const err: SchemaDesignerToolError = withTarget(
                        {
                            success: false,
                            reason: "invalid_request",
                            message: "Missing payload.table (id OR schema + name).",
                        },
                        activeDesigner,
                    );
                    sendToolTelemetry({ operation, success: false, reason: err.reason });
                    return json(err);
                }

                const includeColumns = options.input.options?.includeColumns ?? "namesAndTypes";
                const includeForeignKeys = options.input.options?.includeForeignKeys ?? false;

                const schema = await activeDesigner.getSchemaState();
                const version = this.computeSchemaVersion(schema);
                const resolved = this.resolveTable(schema, tableRef);
                if (resolved.success === false) {
                    sendToolTelemetry({ operation, success: false, reason: resolved.error.reason });
                    return json(withTarget(resolved.error, activeDesigner));
                }

                const table = this.buildTableView(
                    resolved.table,
                    includeColumns,
                    includeForeignKeys,
                );

                sendToolTelemetry({
                    operation,
                    success: true,
                    measurements: {
                        columnCount: resolved.table.columns?.length ?? 0,
                        ...(includeForeignKeys
                            ? { foreignKeyCount: resolved.table.foreignKeys?.length ?? 0 }
                            : {}),
                    },
                });
                return json(withTarget({ success: true, version, table }, activeDesigner));
            }

            if (operation === "apply_edits") {
                const expectedVersion = options.input.payload?.expectedVersion;
                if (!expectedVersion) {
                    const err: SchemaDesignerToolError = withTarget(
                        {
                            success: false,
                            reason: "invalid_request",
                            message: "Missing payload.expectedVersion.",
                        },
                        activeDesigner,
                    );
                    sendToolTelemetry({ operation, success: false, reason: err.reason });
                    return json(err);
                }

                const edits = options.input.payload?.edits;
                if (!Array.isArray(edits) || edits.length === 0) {
                    const err: SchemaDesignerToolError = withTarget(
                        {
                            success: false,
                            reason: "invalid_request",
                            message: "Missing payload.edits (non-empty array).",
                        },
                        activeDesigner,
                    );
                    sendToolTelemetry({ operation, success: false, reason: err.reason });
                    return json(err);
                }

                const targetHint = options.input.payload?.targetHint;
                if (targetHint && !this.matchesTarget(activeDesigner, targetHint)) {
                    const err: SchemaDesignerToolError = {
                        success: false,
                        reason: "target_mismatch",
                        message: "Active schema designer does not match targetHint",
                        activeTarget: {
                            server: activeDesigner.server,
                            database: activeDesigner.database,
                        },
                        targetHint,
                        server: activeDesigner.server,
                        database: activeDesigner.database,
                    };
                    sendToolTelemetry({
                        operation,
                        success: false,
                        reason: err.reason,
                        measurements: {
                            editsCount: edits.length,
                            appliedEdits: 0,
                            failedEditIndex: -1,
                            ...countEditOps(edits),
                        },
                    });
                    return json(err);
                }

                const currentSchema = await activeDesigner.getSchemaState();
                const currentVersion = this.computeSchemaVersion(currentSchema);
                if (currentVersion !== expectedVersion) {
                    const err: SchemaDesignerToolError = withTarget(
                        {
                            success: false,
                            reason: "stale_state",
                            message: loc.schemaDesignerStaleState,
                            currentVersion,
                            currentOverview: this.buildOverview(currentSchema, "namesAndTypes"),
                            suggestedNextCall: {
                                operation: "get_overview",
                                options: { includeColumns: "namesAndTypes" },
                            },
                        },
                        activeDesigner,
                    );
                    sendToolTelemetry({
                        operation,
                        success: false,
                        reason: err.reason,
                        measurements: {
                            editsCount: edits.length,
                            appliedEdits: 0,
                            failedEditIndex: -1,
                            ...countEditOps(edits),
                        },
                    });
                    return json(err);
                }

                activeDesigner.revealToForeground();
                const applyResult = await activeDesigner.applyEdits({ edits });
                const postSchema = applyResult.schema ?? (await activeDesigner.getSchemaState());
                const postVersion = this.computeSchemaVersion(postSchema);

                if (!applyResult.success) {
                    const err: SchemaDesignerToolError = withTarget(
                        {
                            success: false,
                            reason: applyResult.reason ?? "internal_error",
                            message: applyResult.message ?? "Failed to apply edits.",
                            failedEditIndex: applyResult.failedEditIndex,
                            appliedEdits: applyResult.appliedEdits,
                            currentVersion: postVersion,
                        },
                        activeDesigner,
                    );
                    sendToolTelemetry({
                        operation,
                        success: false,
                        reason: err.reason,
                        measurements: {
                            editsCount: edits.length,
                            appliedEdits: applyResult.appliedEdits ?? 0,
                            failedEditIndex: applyResult.failedEditIndex ?? -1,
                            ...countEditOps(edits),
                        },
                    });
                    return json(err);
                }

                const appliedEdits = applyResult.appliedEdits ?? edits.length;
                const receipt: ApplyEditsReceipt = {
                    appliedEdits,
                    changes: this.summarizeEdits(edits.slice(0, appliedEdits)),
                    warnings: [],
                };

                sendToolTelemetry({
                    operation,
                    success: true,
                    measurements: {
                        editsCount: edits.length,
                        appliedEdits,
                        failedEditIndex: -1,
                        ...countEditOps(edits),
                    },
                });
                return json(
                    withTarget(
                        {
                            success: true,
                            version: postVersion,
                            receipt,
                        },
                        activeDesigner,
                    ),
                );
            }

            const err: SchemaDesignerToolError = withTarget(
                {
                    success: false,
                    reason: "invalid_request",
                    message: `Unknown operation: ${String(operation)}`,
                },
                schemaDesignerManager.getActiveDesigner(),
            );
            sendToolTelemetry({ operation, success: false, reason: err.reason });
            return json(err);
        } catch (error) {
            const payload: SchemaDesignerToolError = {
                success: false,
                reason: "internal_error",
                message: error instanceof Error ? error.message : String(error),
            };
            sendToolTelemetry({ operation, success: false, reason: payload.reason });
            return json(withTarget(payload, schemaDesignerManager.getActiveDesigner()));
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

    private computeSchemaVersion(schema: SchemaDesigner.Schema): string {
        const normalizedSchema = this.normalizeSchemaForVersion(schema);
        return createHash("sha256").update(JSON.stringify(normalizedSchema)).digest("hex");
    }

    private normalizeSchemaForVersion(schema: SchemaDesigner.Schema): NormalizedSchemaVersion {
        const tables = [...(schema.tables ?? [])].sort((a, b) =>
            this.compareKeys(this.tableSortKey(a), this.tableSortKey(b)),
        );
        return {
            tables: tables.map((table) => ({
                name: (table.name ?? "").toLowerCase(),
                schema: (table.schema ?? "").toLowerCase(),
                columns: [...(table.columns ?? [])]
                    .sort((a, b) => this.compareKeys(this.columnSortKey(a), this.columnSortKey(b)))
                    .map((column) => ({
                        name: (column.name ?? "").toLowerCase(),
                        dataType: (column.dataType ?? "").toLowerCase(),
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
                    .map((foreignKey) => {
                        const refs = foreignKey.referencedColumns ?? [];
                        const pairs = (foreignKey.columns ?? []).map((column, i) => ({
                            column,
                            referencedColumn: refs[i] ?? "",
                        }));
                        pairs.sort((a, b) =>
                            `${a.column}.${a.referencedColumn}`
                                .toLowerCase()
                                .localeCompare(`${b.column}.${b.referencedColumn}`.toLowerCase()),
                        );

                        return {
                            name: (foreignKey.name ?? "").toLowerCase(),
                            columns: pairs.map((p) => p.column.toLowerCase()),
                            referencedSchemaName: (
                                foreignKey.referencedSchemaName ?? ""
                            ).toLowerCase(),
                            referencedTableName: (
                                foreignKey.referencedTableName ?? ""
                            ).toLowerCase(),
                            referencedColumns: pairs.map((p) => p.referencedColumn.toLowerCase()),
                            onDeleteAction: foreignKey.onDeleteAction,
                            onUpdateAction: foreignKey.onUpdateAction,
                        };
                    }),
            })),
        };
    }

    private tableSortKey(table: SchemaDesigner.Table): string {
        return `${(table.schema ?? "").toLowerCase()}.${(table.name ?? "").toLowerCase()}`;
    }

    private columnSortKey(column: SchemaDesigner.Column): string {
        return `${(column.name ?? "").toLowerCase()}.${(column.dataType ?? "").toLowerCase()}`;
    }

    private foreignKeySortKey(foreignKey: SchemaDesigner.ForeignKey): string {
        return `${(foreignKey.name ?? "").toLowerCase()}.${(foreignKey.referencedSchemaName ?? "").toLowerCase()}.${(foreignKey.referencedTableName ?? "").toLowerCase()}`;
    }

    private compareKeys(left: string, right: string): number {
        return left.localeCompare(right);
    }

    private buildOverview(
        schema: SchemaDesigner.Schema,
        includeColumns: IncludeOverviewColumns,
    ): SchemaDesignerOverview {
        const tables = schema.tables ?? [];
        const totalColumns = tables.reduce((sum, t) => sum + (t.columns?.length ?? 0), 0);
        const sizeOmission = tables.length > 40 || totalColumns > 400;
        const includeColumnDetails = includeColumns !== "none" && !sizeOmission;

        const tableViews: OverviewTableView[] = tables.map((t) => {
            const base: OverviewTableView = { schema: t.schema, name: t.name };
            if (!includeColumnDetails) {
                return base;
            }

            if (includeColumns === "names") {
                return { ...base, columns: (t.columns ?? []).map((c) => ({ name: c.name })) };
            }

            return {
                ...base,
                columns: (t.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType })),
            };
        });

        return {
            tables: tableViews,
            columnsOmitted: sizeOmission,
        };
    }

    private resolveTable(
        schema: SchemaDesigner.Schema,
        ref: SchemaDesigner.TableRef,
    ):
        | { success: true; table: SchemaDesigner.Table }
        | { success: false; error: SchemaDesignerToolError } {
        const tables = schema.tables ?? [];
        if (ref.id) {
            const byId = tables.filter((t) => t.id === ref.id);
            if (byId.length === 1) return { success: true, table: byId[0] };
            return {
                success: false,
                error: {
                    success: false,
                    reason: "not_found",
                    message: `Table id '${ref.id}' not found.`,
                },
            };
        }

        const matches = tables.filter(
            (t) =>
                (t.schema ?? "").toLowerCase() === (ref.schema ?? "").toLowerCase() &&
                (t.name ?? "").toLowerCase() === (ref.name ?? "").toLowerCase(),
        );

        if (matches.length === 1) return { success: true, table: matches[0] };
        if (matches.length === 0) {
            return {
                success: false,
                error: {
                    success: false,
                    reason: "not_found",
                    message: `Table '${ref.schema}.${ref.name}' not found.`,
                },
            };
        }

        return {
            success: false,
            error: {
                success: false,
                reason: "ambiguous_identifier",
                message: `Table reference '${ref.schema}.${ref.name}' matched more than one table.`,
            },
        };
    }

    private buildTableView(
        table: SchemaDesigner.Table,
        includeColumns: IncludeTableColumns,
        includeForeignKeys: boolean,
    ): SchemaDesignerTableView {
        const view: SchemaDesignerTableView = { schema: table.schema, name: table.name };
        if (includeColumns === "full") {
            view.id = table.id;
        }

        if (includeColumns !== "none") {
            const cols = table.columns ?? [];
            if (includeColumns === "names") {
                view.columns = cols.map((c) => ({ name: c.name }));
            } else if (includeColumns === "namesAndTypes") {
                view.columns = cols.map((c) => ({
                    name: c.name,
                    dataType: c.dataType,
                    isPrimaryKey: c.isPrimaryKey,
                    isNullable: c.isNullable,
                }));
            } else {
                view.columns = cols.map((c) => ({
                    id: c.id,
                    name: c.name,
                    dataType: c.dataType,
                    maxLength: c.maxLength,
                    precision: c.precision,
                    scale: c.scale,
                    isPrimaryKey: c.isPrimaryKey,
                    isIdentity: c.isIdentity,
                    identitySeed: c.identitySeed,
                    identityIncrement: c.identityIncrement,
                    isNullable: c.isNullable,
                    defaultValue: c.defaultValue,
                    isComputed: c.isComputed,
                    computedFormula: c.computedFormula,
                    computedPersisted: c.computedPersisted,
                }));
            }
        }

        if (includeForeignKeys) {
            view.foreignKeys = (table.foreignKeys ?? []).map((fk) => ({
                id: includeColumns === "full" ? fk.id : undefined,
                name: fk.name,
                referencedTable: { schema: fk.referencedSchemaName, name: fk.referencedTableName },
                mappings: (fk.columns ?? []).map((col, idx) => ({
                    column: col,
                    referencedColumn: (fk.referencedColumns ?? [])[idx],
                })),
                onDeleteAction: fk.onDeleteAction,
                onUpdateAction: fk.onUpdateAction,
            }));
        }

        return view;
    }

    private matchesTarget(designer: SchemaDesignerWebviewController, hint: TargetHint): boolean {
        const activeServer = (designer.server ?? "").toLowerCase();
        const activeDb = (designer.database ?? "").toLowerCase();
        return (
            activeServer === (hint.server ?? "").toLowerCase() &&
            activeDb === (hint.database ?? "").toLowerCase()
        );
    }

    private summarizeEdits(edits: SchemaDesigner.SchemaDesignerEdit[]): Record<string, unknown> {
        const changes: Record<string, unknown> = {};
        const push = <T>(key: string, value: T) => {
            const arr = (changes[key] as T[] | undefined) ?? [];
            arr.push(value);
            changes[key] = arr;
        };

        for (const edit of edits) {
            switch (edit.op) {
                case "add_table":
                    push("tablesAdded", { schema: edit.table.schema, name: edit.table.name });
                    break;
                case "drop_table":
                    push("tablesDropped", { schema: edit.table.schema, name: edit.table.name });
                    break;
                case "set_table":
                    push("tablesUpdated", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        set: edit.set,
                    });
                    break;
                case "add_column":
                    push("columnsAdded", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        column: { name: edit.column.name },
                    });
                    break;
                case "drop_column":
                    push("columnsDropped", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        column: { name: edit.column.name },
                    });
                    break;
                case "set_column":
                    push("columnsUpdated", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        column: { name: edit.column.name },
                        set: edit.set,
                    });
                    break;
                case "add_foreign_key":
                    push("foreignKeysAdded", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        foreignKey: { name: edit.foreignKey.name },
                    });
                    break;
                case "drop_foreign_key":
                    push("foreignKeysDropped", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        foreignKey: { name: edit.foreignKey.name },
                    });
                    break;
                case "set_foreign_key":
                    push("foreignKeysUpdated", {
                        table: { schema: edit.table.schema, name: edit.table.name },
                        foreignKey: { name: edit.foreignKey.name },
                        set: edit.set,
                    });
                    break;
            }
        }

        return changes;
    }
}
