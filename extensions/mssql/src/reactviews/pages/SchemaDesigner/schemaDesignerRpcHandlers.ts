/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../sharedInterfaces/dab";
import { WebviewRpc } from "../../common/rpc";
import { locConstants } from "../../common/locConstants";
import { v4 as uuidv4 } from "uuid";
import { tableUtils } from "./schemaDesignerUtils";

export interface SchemaDesignerApplyEditsHandlerParams {
    isInitialized: boolean;
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    schemaNames: string[];
    datatypes: string[];
    waitForNextFrame: () => Promise<void>;
    extractSchema: () => SchemaDesigner.Schema;
    onMaybeAutoArrange: (
        preTableCount: number,
        postTableCount: number,
        preForeignKeyCount: number,
        postForeignKeyCount: number,
    ) => Promise<void> | void;
    addTable: (table: SchemaDesigner.Table) => Promise<boolean>;
    updateTable: (table: SchemaDesigner.Table) => Promise<boolean>;
    deleteTable: (table: SchemaDesigner.Table, skipConfirmation?: boolean) => Promise<boolean>;
    normalizeColumn: (column: SchemaDesigner.Column) => SchemaDesigner.Column;
    normalizeTable: (table: SchemaDesigner.Table) => SchemaDesigner.Table | undefined;
    validateTable: (
        schema: SchemaDesigner.Schema,
        table: SchemaDesigner.Table,
        schemaNames: string[],
    ) => string | undefined;
    onPushUndoState: () => void;
    onRequestScriptRefresh: () => void;
}

export function createSchemaDesignerApplyEditsHandler(
    params: SchemaDesignerApplyEditsHandlerParams,
) {
    const {
        isInitialized,
        schemaNames,
        datatypes,
        waitForNextFrame,
        extractSchema,
        onMaybeAutoArrange,
        addTable,
        updateTable,
        deleteTable,
        normalizeColumn,
        normalizeTable,
        validateTable,
        onPushUndoState,
        onRequestScriptRefresh,
    } = params;

    const normalizeIdentifier = (value: string | undefined): string => (value ?? "").toLowerCase();

    const ensureDataTypeValid = (dataType: string | undefined): string | undefined => {
        if (!dataType) {
            return "Missing column.dataType.";
        }
        if (
            datatypes.length > 0 &&
            !datatypes.some((dt) => normalizeIdentifier(dt) === normalizeIdentifier(dataType))
        ) {
            return `Data type '${dataType}' is invalid.`;
        }
        return undefined;
    };

    const validateOnAction = (value: unknown): string | undefined => {
        if (typeof value !== "number") {
            return "Foreign key action must be a number (0=CASCADE, 1=NO_ACTION, 2=SET_NULL, 3=SET_DEFAULT).";
        }
        if (
            value !== SchemaDesigner.OnAction.CASCADE &&
            value !== SchemaDesigner.OnAction.NO_ACTION &&
            value !== SchemaDesigner.OnAction.SET_NULL &&
            value !== SchemaDesigner.OnAction.SET_DEFAULT
        ) {
            return "Foreign key action must be one of: 0=CASCADE, 1=NO_ACTION, 2=SET_NULL, 3=SET_DEFAULT.";
        }
        return undefined;
    };

    const resolveTable = (
        schema: SchemaDesigner.Schema,
        ref: SchemaDesigner.TableRef,
    ):
        | { success: true; table: SchemaDesigner.Table }
        | {
              success: false;
              reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"];
              message: string;
          } => {
        const tables = schema.tables ?? [];
        if (ref.id) {
            const byId = tables.filter((t) => t.id === ref.id);
            if (byId.length === 1) {
                return { success: true, table: byId[0] };
            }
            return {
                success: false,
                reason: "not_found",
                message: locConstants.schemaDesigner.tableNotFound(ref.id),
            };
        }

        if (!ref.schema || !ref.name) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing table reference (schema + name) or id.",
            };
        }

        const matches = tables.filter(
            (t) =>
                normalizeIdentifier(t.schema) === normalizeIdentifier(ref.schema) &&
                normalizeIdentifier(t.name) === normalizeIdentifier(ref.name),
        );

        if (matches.length === 1) {
            return { success: true, table: matches[0] };
        }
        if (matches.length === 0) {
            return {
                success: false,
                reason: "not_found",
                message: locConstants.schemaDesigner.tableNotFound(`${ref.schema}.${ref.name}`),
            };
        }
        return {
            success: false,
            reason: "ambiguous_identifier",
            message: `Table reference '${ref.schema}.${ref.name}' matched more than one table.`,
        };
    };

    const resolveColumn = (
        table: SchemaDesigner.Table,
        ref: SchemaDesigner.ColumnRef,
    ):
        | { success: true; column: SchemaDesigner.Column }
        | {
              success: false;
              reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"];
              message: string;
          } => {
        const columns = table.columns ?? [];
        if (ref.id) {
            const byId = columns.filter((c) => c.id === ref.id);
            if (byId.length === 1) {
                return { success: true, column: byId[0] };
            }
            return {
                success: false,
                reason: "not_found",
                message: locConstants.schemaDesigner.columnNotFound(ref.id),
            };
        }

        if (!ref.name) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing column reference name or id.",
            };
        }

        const matches = columns.filter(
            (c) => normalizeIdentifier(c.name) === normalizeIdentifier(ref.name),
        );
        if (matches.length === 1) {
            return { success: true, column: matches[0] };
        }
        if (matches.length === 0) {
            return {
                success: false,
                reason: "not_found",
                message: locConstants.schemaDesigner.columnNotFound(ref.name),
            };
        }
        return {
            success: false,
            reason: "ambiguous_identifier",
            message: `Column reference '${ref.name}' matched more than one column.`,
        };
    };

    const resolveForeignKey = (
        table: SchemaDesigner.Table,
        ref: SchemaDesigner.ForeignKeyRef,
    ):
        | { success: true; foreignKey: SchemaDesigner.ForeignKey }
        | {
              success: false;
              reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"];
              message: string;
          } => {
        const foreignKeys = table.foreignKeys ?? [];
        if (ref.id) {
            const byId = foreignKeys.filter((fk) => fk.id === ref.id);
            if (byId.length === 1) {
                return { success: true, foreignKey: byId[0] };
            }
            return {
                success: false,
                reason: "not_found",
                message: `Foreign key '${ref.id}' not found.`,
            };
        }

        if (!ref.name) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing foreignKey reference name or id.",
            };
        }

        const matches = foreignKeys.filter(
            (fk) => normalizeIdentifier(fk.name) === normalizeIdentifier(ref.name),
        );
        if (matches.length === 1) {
            return { success: true, foreignKey: matches[0] };
        }
        if (matches.length === 0) {
            return {
                success: false,
                reason: "not_found",
                message: `Foreign key '${ref.name}' not found.`,
            };
        }
        return {
            success: false,
            reason: "ambiguous_identifier",
            message: `Foreign key reference '${ref.name}' matched more than one foreign key.`,
        };
    };

    const resolveColumnNameByName = (
        table: SchemaDesigner.Table,
        columnName: unknown,
    ):
        | { success: true; name: string }
        | {
              success: false;
              reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"];
              message: string;
          } => {
        if (typeof columnName !== "string" || columnName.length === 0) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Invalid column name in foreign key mapping.",
            };
        }

        const matches = (table.columns ?? []).filter(
            (c) => normalizeIdentifier(c.name) === normalizeIdentifier(columnName),
        );
        if (matches.length === 1) {
            return { success: true, name: matches[0].name };
        }
        if (matches.length === 0) {
            return {
                success: false,
                reason: "not_found",
                message: locConstants.schemaDesigner.columnNotFound(columnName),
            };
        }

        return {
            success: false,
            reason: "ambiguous_identifier",
            message: `Column reference '${columnName}' matched more than one column.`,
        };
    };

    const resolveForeignKeyMappings = (
        sourceTable: SchemaDesigner.Table,
        referencedTable: SchemaDesigner.Table,
        mappings: unknown,
    ):
        | { success: true; columns: string[]; referencedColumns: string[] }
        | {
              success: false;
              reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"];
              message: string;
          } => {
        if (!Array.isArray(mappings) || mappings.length === 0) {
            return {
                success: false,
                reason: "validation_error",
                message:
                    `${locConstants.schemaDesigner.foreignKeyMappingRequired} ` +
                    "Provide foreignKey.mappings.",
            };
        }

        const columns: string[] = [];
        const referencedColumns: string[] = [];

        for (const m of mappings) {
            const col = (m as any)?.column;
            const refCol = (m as any)?.referencedColumn;
            if (typeof col !== "string" || typeof refCol !== "string" || !col || !refCol) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message:
                        "Invalid foreignKey.mappings item. Expected { column: string, referencedColumn: string }.",
                };
            }

            const src = resolveColumnNameByName(sourceTable, col);
            if (src.success === false) {
                return {
                    success: false,
                    reason: src.reason,
                    message: src.message,
                };
            }
            const tgt = resolveColumnNameByName(referencedTable, refCol);
            if (tgt.success === false) {
                return {
                    success: false,
                    reason: tgt.reason,
                    message: locConstants.schemaDesigner.referencedColumnNotFound(refCol),
                };
            }

            columns.push(src.name);
            referencedColumns.push(tgt.name);
        }

        return { success: true, columns, referencedColumns };
    };

    const handleApplyEdits = async (
        params: SchemaDesigner.ApplyEditsWebviewParams,
    ): Promise<SchemaDesigner.ApplyEditsWebviewResponse> => {
        if (!isInitialized) {
            return {
                success: false,
                reason: "internal_error",
                message: locConstants.schemaDesigner.schemaDesignerNotInitialized,
            };
        }

        if (!params || !Array.isArray(params.edits) || params.edits.length === 0) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing edits (non-empty array).",
            };
        }

        let appliedEdits = 0;
        let needsScriptRefresh = false;
        let workingSchema = extractSchema();
        const preTableCount = workingSchema.tables.length;
        const preForeignKeyCount = workingSchema.tables.reduce(
            (sum, table) => sum + (table.foreignKeys?.length ?? 0),
            0,
        );

        try {
            for (let i = 0; i < params.edits.length; i++) {
                const edit = params.edits[i];
                const schema = workingSchema;
                let didMutateThisEdit = false;

                const fail = (
                    reason: SchemaDesigner.ApplyEditsWebviewResponse["reason"],
                    message: string,
                ): SchemaDesigner.ApplyEditsWebviewResponse => ({
                    success: false,
                    reason,
                    message,
                    failedEditIndex: i,
                    appliedEdits,
                    schema: workingSchema,
                });

                switch (edit.op) {
                    case "add_table": {
                        if (!edit.table?.schema || !edit.table?.name) {
                            return fail("invalid_request", "Missing edit.table (schema + name).");
                        }

                        const baseTable = tableUtils.createNewTable(schema, schemaNames);
                        const newTable: SchemaDesigner.Table = {
                            ...baseTable,
                            schema: edit.table.schema,
                            name: edit.table.name,
                            columns: Array.isArray(edit.initialColumns)
                                ? edit.initialColumns.map((c) =>
                                      normalizeColumn({
                                          ...c,
                                          dataType: c.dataType ?? "int",
                                          name: c.name ?? "",
                                      } as SchemaDesigner.Column),
                                  )
                                : baseTable.columns,
                            foreignKeys: [],
                        };

                        const dataTypeError = newTable.columns
                            .map((c) => ensureDataTypeValid(c.dataType))
                            .find((e) => e);
                        if (dataTypeError) {
                            return fail("validation_error", dataTypeError);
                        }

                        const validationError = validateTable(schema, newTable, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await addTable(newTable);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToAddTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = { tables: [...workingSchema.tables, newTable] };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "drop_table": {
                        const resolved = resolveTable(schema, edit.table);
                        if (resolved.success === false) {
                            return fail(resolved.reason, resolved.message);
                        }

                        const success = await deleteTable(resolved.table, true);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToDeleteTable,
                            );
                        }

                        const deletedSchemaName = resolved.table.schema;
                        const deletedTableName = resolved.table.name;
                        workingSchema = {
                            tables: workingSchema.tables
                                .filter((t) => t.id !== resolved.table.id)
                                .map((t) => ({
                                    ...t,
                                    foreignKeys: (t.foreignKeys ?? []).filter(
                                        (fk) =>
                                            normalizeIdentifier(fk.referencedSchemaName) !==
                                                normalizeIdentifier(deletedSchemaName) ||
                                            normalizeIdentifier(fk.referencedTableName) !==
                                                normalizeIdentifier(deletedTableName),
                                    ),
                                })),
                        };

                        needsScriptRefresh = true;
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "set_table": {
                        const resolved = resolveTable(schema, edit.table);
                        if (resolved.success === false) {
                            return fail(resolved.reason, resolved.message);
                        }
                        const previousSchemaName = resolved.table.schema;
                        const previousTableName = resolved.table.name;
                        const updated: SchemaDesigner.Table = {
                            ...resolved.table,
                            name: edit.set?.name ?? resolved.table.name,
                            schema: edit.set?.schema ?? resolved.table.schema,
                        };

                        const validationError = validateTable(schema, updated, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(updated);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) => {
                                if (t.id === updated.id) {
                                    return updated;
                                }

                                const foreignKeys = (t.foreignKeys ?? []).map((fk) => {
                                    if (
                                        normalizeIdentifier(fk.referencedSchemaName) ===
                                            normalizeIdentifier(previousSchemaName) &&
                                        normalizeIdentifier(fk.referencedTableName) ===
                                            normalizeIdentifier(previousTableName)
                                    ) {
                                        return {
                                            ...fk,
                                            referencedSchemaName: updated.schema,
                                            referencedTableName: updated.name,
                                        };
                                    }
                                    return fk;
                                });

                                return { ...t, foreignKeys };
                            }),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "add_column": {
                        const resolved = resolveTable(schema, edit.table);
                        if (resolved.success === false) {
                            return fail(resolved.reason, resolved.message);
                        }

                        if (!edit.column) {
                            return fail("invalid_request", "Missing edit.column.");
                        }

                        const dataTypeError = ensureDataTypeValid(edit.column?.dataType);
                        if (dataTypeError) {
                            return fail("validation_error", dataTypeError);
                        }

                        const newColumn = normalizeColumn({
                            ...edit.column,
                            name: edit.column?.name ?? "",
                            dataType: edit.column?.dataType ?? "int",
                        } as SchemaDesigner.Column);

                        const updated: SchemaDesigner.Table = {
                            ...resolved.table,
                            columns: [...(resolved.table.columns ?? []), newColumn],
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "drop_column": {
                        const resolvedTable = resolveTable(schema, edit.table);
                        if (resolvedTable.success === false) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.column) {
                            return fail("invalid_request", "Missing edit.column.");
                        }

                        const resolvedColumn = resolveColumn(resolvedTable.table, edit.column);
                        if (resolvedColumn.success === false) {
                            return fail(resolvedColumn.reason, resolvedColumn.message);
                        }

                        const updated: SchemaDesigner.Table = {
                            ...resolvedTable.table,
                            columns: (resolvedTable.table.columns ?? []).filter(
                                (c) => c.id !== resolvedColumn.column.id,
                            ),
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "set_column": {
                        const resolvedTable = resolveTable(schema, edit.table);
                        if (resolvedTable.success === false) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.column) {
                            return fail("invalid_request", "Missing edit.column.");
                        }

                        const resolvedColumn = resolveColumn(resolvedTable.table, edit.column);
                        if (resolvedColumn.success === false) {
                            return fail(resolvedColumn.reason, resolvedColumn.message);
                        }

                        const nextDataType =
                            edit.set?.dataType ?? resolvedColumn.column.dataType ?? "int";
                        const dataTypeError = ensureDataTypeValid(nextDataType);
                        if (dataTypeError) {
                            return fail("validation_error", dataTypeError);
                        }

                        const updatedColumn = normalizeColumn({
                            ...resolvedColumn.column,
                            ...(edit.set ?? {}),
                            name: edit.set?.name ?? resolvedColumn.column.name,
                            dataType: nextDataType,
                        } as SchemaDesigner.Column);

                        const updated: SchemaDesigner.Table = {
                            ...resolvedTable.table,
                            columns: (resolvedTable.table.columns ?? []).map((c) =>
                                c.id === updatedColumn.id ? updatedColumn : c,
                            ),
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "add_foreign_key": {
                        const resolvedTable = resolveTable(schema, edit.table);
                        if (resolvedTable.success === false) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.foreignKey?.name) {
                            return fail("invalid_request", "Missing foreignKey.name.");
                        }
                        if (!edit.foreignKey?.referencedTable) {
                            return fail("invalid_request", "Missing foreignKey.referencedTable.");
                        }
                        const onDeleteError = validateOnAction(edit.foreignKey.onDeleteAction);
                        if (onDeleteError) {
                            return fail("validation_error", onDeleteError);
                        }
                        const onUpdateError = validateOnAction(edit.foreignKey.onUpdateAction);
                        if (onUpdateError) {
                            return fail("validation_error", onUpdateError);
                        }

                        const referenced = resolveTable(schema, edit.foreignKey.referencedTable);
                        if (referenced.success === false) {
                            return fail(referenced.reason, referenced.message);
                        }

                        const mappingsResult = resolveForeignKeyMappings(
                            resolvedTable.table,
                            referenced.table,
                            edit.foreignKey.mappings,
                        );
                        if (mappingsResult.success === false) {
                            return fail(mappingsResult.reason, mappingsResult.message);
                        }

                        const newForeignKey: SchemaDesigner.ForeignKey = {
                            id: uuidv4(),
                            name: edit.foreignKey.name,
                            columns: mappingsResult.columns,
                            referencedSchemaName: referenced.table.schema,
                            referencedTableName: referenced.table.name,
                            referencedColumns: mappingsResult.referencedColumns,
                            onDeleteAction: edit.foreignKey.onDeleteAction,
                            onUpdateAction: edit.foreignKey.onUpdateAction,
                        };

                        const updated: SchemaDesigner.Table = {
                            ...resolvedTable.table,
                            foreignKeys: [
                                ...(resolvedTable.table.foreignKeys ?? []),
                                newForeignKey,
                            ],
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "drop_foreign_key": {
                        const resolvedTable = resolveTable(schema, edit.table);
                        if (resolvedTable.success === false) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.foreignKey) {
                            return fail("invalid_request", "Missing edit.foreignKey.");
                        }

                        const resolvedForeignKey = resolveForeignKey(
                            resolvedTable.table,
                            edit.foreignKey,
                        );
                        if (resolvedForeignKey.success === false) {
                            return fail(resolvedForeignKey.reason, resolvedForeignKey.message);
                        }

                        const updated: SchemaDesigner.Table = {
                            ...resolvedTable.table,
                            foreignKeys: (resolvedTable.table.foreignKeys ?? []).filter(
                                (fk) => fk.id !== resolvedForeignKey.foreignKey.id,
                            ),
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    case "set_foreign_key": {
                        const resolvedTable = resolveTable(schema, edit.table);
                        if (resolvedTable.success === false) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.foreignKey) {
                            return fail("invalid_request", "Missing edit.foreignKey.");
                        }

                        const resolvedForeignKey = resolveForeignKey(
                            resolvedTable.table,
                            edit.foreignKey,
                        );
                        if (resolvedForeignKey.success === false) {
                            return fail(resolvedForeignKey.reason, resolvedForeignKey.message);
                        }

                        let referencedSchemaName =
                            resolvedForeignKey.foreignKey.referencedSchemaName;
                        let referencedTableName = resolvedForeignKey.foreignKey.referencedTableName;
                        if (edit.set?.referencedTable) {
                            const referenced = resolveTable(schema, edit.set.referencedTable);
                            if (referenced.success === false) {
                                return fail(referenced.reason, referenced.message);
                            }
                            referencedSchemaName = referenced.table.schema;
                            referencedTableName = referenced.table.name;
                        }

                        let nextColumns = resolvedForeignKey.foreignKey.columns;
                        let nextReferencedColumns = resolvedForeignKey.foreignKey.referencedColumns;
                        const referencedTableForMappings = resolveTable(schema, {
                            schema: referencedSchemaName,
                            name: referencedTableName,
                        });
                        if (referencedTableForMappings.success === false) {
                            return fail(
                                referencedTableForMappings.reason,
                                referencedTableForMappings.message,
                            );
                        }

                        if (edit.set && Array.isArray(edit.set.mappings)) {
                            const mappingsResult = resolveForeignKeyMappings(
                                resolvedTable.table,
                                referencedTableForMappings.table,
                                edit.set.mappings,
                            );
                            if (mappingsResult.success === false) {
                                return fail(mappingsResult.reason, mappingsResult.message);
                            }

                            nextColumns = mappingsResult.columns;
                            nextReferencedColumns = mappingsResult.referencedColumns;
                        }

                        if (edit.set?.onDeleteAction !== undefined) {
                            const err = validateOnAction(edit.set.onDeleteAction);
                            if (err) {
                                return fail("validation_error", err);
                            }
                        }
                        if (edit.set?.onUpdateAction !== undefined) {
                            const err = validateOnAction(edit.set.onUpdateAction);
                            if (err) {
                                return fail("validation_error", err);
                            }
                        }

                        const updatedForeignKey: SchemaDesigner.ForeignKey = {
                            ...resolvedForeignKey.foreignKey,
                            name: edit.set?.name ?? resolvedForeignKey.foreignKey.name,
                            columns: nextColumns,
                            referencedSchemaName,
                            referencedTableName,
                            referencedColumns: nextReferencedColumns,
                            onDeleteAction:
                                edit.set?.onDeleteAction ??
                                resolvedForeignKey.foreignKey.onDeleteAction,
                            onUpdateAction:
                                edit.set?.onUpdateAction ??
                                resolvedForeignKey.foreignKey.onUpdateAction,
                        };

                        const updated: SchemaDesigner.Table = {
                            ...resolvedTable.table,
                            foreignKeys: (resolvedTable.table.foreignKeys ?? []).map((fk) =>
                                fk.id === updatedForeignKey.id ? updatedForeignKey : fk,
                            ),
                        };

                        const normalized = normalizeTable(updated);
                        if (!normalized) {
                            return fail(
                                "validation_error",
                                locConstants.schemaDesigner.invalidTablePayload,
                            );
                        }

                        const validationError = validateTable(schema, normalized, schemaNames);
                        if (validationError) {
                            return fail("validation_error", validationError);
                        }

                        const success = await updateTable(normalized);
                        if (!success) {
                            return fail(
                                "internal_error",
                                locConstants.schemaDesigner.failedToUpdateTable,
                            );
                        }

                        needsScriptRefresh = true;
                        workingSchema = {
                            tables: workingSchema.tables.map((t) =>
                                t.id === normalized.id ? normalized : t,
                            ),
                        };
                        appliedEdits++;
                        didMutateThisEdit = true;
                        break;
                    }

                    default:
                        return fail("invalid_request", `Unknown edit op: ${(edit as any)?.op}`);
                }

                if (didMutateThisEdit) {
                    await waitForNextFrame();
                    workingSchema = extractSchema();
                    onPushUndoState();
                }
            }

            const postTableCount = workingSchema.tables.length;
            const postForeignKeyCount = workingSchema.tables.reduce(
                (sum, table) => sum + (table.foreignKeys?.length ?? 0),
                0,
            );
            try {
                await onMaybeAutoArrange(
                    preTableCount,
                    postTableCount,
                    preForeignKeyCount,
                    postForeignKeyCount,
                );
            } catch (error) {
                console.warn("Schema Designer tool auto-arrange failed", error);
            }

            return {
                success: true,
                appliedEdits,
                schema: workingSchema,
            };
        } finally {
            if (needsScriptRefresh) {
                onRequestScriptRefresh();
            }
        }
    };

    return handleApplyEdits;
}

export function registerSchemaDesignerApplyEditsHandler(
    params: SchemaDesignerApplyEditsHandlerParams,
) {
    const handleApplyEdits = createSchemaDesignerApplyEditsHandler(params);
    params.extensionRpc.onRequest(SchemaDesigner.ApplyEditsWebviewRequest.type, handleApplyEdits);
}

export function registerSchemaDesignerGetSchemaStateHandler(params: {
    isInitialized: boolean;
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    extractSchema: () => SchemaDesigner.Schema;
}) {
    const { isInitialized, extensionRpc, extractSchema } = params;

    const handleGetSchemaState = async () => {
        if (!isInitialized) {
            throw new Error(locConstants.schemaDesigner.schemaDesignerNotInitialized);
        }
        return {
            schema: extractSchema(),
        };
    };

    extensionRpc.onRequest(SchemaDesigner.GetSchemaStateRequest.type, handleGetSchemaState);
}

type DabApplyFailureReason = Extract<Dab.ApplyDabToolChangesResponse, { success: false }>["reason"];
type ApplyReturnState = "full" | "summary" | "none";

const GET_STATE_ENTITY_THRESHOLD = 150;
const APPLY_CHANGES_ENTITY_THRESHOLD = 100;

function cloneDabConfig(config: Dab.DabConfig): Dab.DabConfig {
    return {
        apiTypes: [...config.apiTypes],
        entities: config.entities.map((entity) => ({
            ...entity,
            enabledActions: [...entity.enabledActions],
            advancedSettings: { ...entity.advancedSettings },
        })),
    };
}

function normalizeIdentifier(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

function buildDabSummary(config: Dab.DabConfig): Dab.DabToolSummary {
    return {
        entityCount: config.entities.length,
        enabledEntityCount: config.entities.filter((entity) => entity.isEnabled).length,
        apiTypes: [...config.apiTypes],
    };
}

function isApplyReturnState(value: unknown): value is ApplyReturnState {
    return value === "full" || value === "summary" || value === "none";
}

async function buildApplyStatePayload(
    config: Dab.DabConfig,
    requestedReturnState: ApplyReturnState,
    precomputedVersion?: string,
): Promise<
    Pick<
        Extract<Dab.ApplyDabToolChangesResponse, { success: true }>,
        "returnState" | "stateOmittedReason" | "version" | "summary" | "config"
    >
> {
    const summary = buildDabSummary(config);
    const version = precomputedVersion ?? (await computeDabVersion(config));

    if (requestedReturnState === "none") {
        return {
            returnState: "none",
            stateOmittedReason: "caller_requested_none",
            version,
            summary,
        };
    }

    if (requestedReturnState === "summary") {
        return {
            returnState: "summary",
            stateOmittedReason: "caller_requested_summary",
            version,
            summary,
        };
    }

    if (summary.entityCount > APPLY_CHANGES_ENTITY_THRESHOLD) {
        return {
            returnState: "summary",
            stateOmittedReason: "entity_count_over_threshold",
            version,
            summary,
        };
    }

    return {
        returnState: "full",
        version,
        summary,
        config,
    };
}

function normalizeDabConfigForVersion(config: Dab.DabConfig) {
    return {
        apiTypes: [...config.apiTypes].map(normalizeIdentifier).sort((a, b) => a.localeCompare(b)),
        entities: [...config.entities]
            .map((entity) => ({
                id: normalizeIdentifier(entity.id),
                tableName: normalizeIdentifier(entity.tableName),
                schemaName: normalizeIdentifier(entity.schemaName),
                isEnabled: entity.isEnabled,
                enabledActions: [...entity.enabledActions]
                    .map(normalizeIdentifier)
                    .sort((a, b) => a.localeCompare(b)),
                advancedSettings: {
                    entityName: normalizeIdentifier(entity.advancedSettings.entityName),
                    authorizationRole: normalizeIdentifier(
                        entity.advancedSettings.authorizationRole,
                    ),
                    customRestPath:
                        entity.advancedSettings.customRestPath !== undefined
                            ? entity.advancedSettings.customRestPath
                            : null,
                    customGraphQLType:
                        entity.advancedSettings.customGraphQLType !== undefined
                            ? entity.advancedSettings.customGraphQLType
                            : null,
                },
            }))
            .sort((a, b) => {
                const bySchema = a.schemaName.localeCompare(b.schemaName);
                if (bySchema !== 0) {
                    return bySchema;
                }
                const byTable = a.tableName.localeCompare(b.tableName);
                if (byTable !== 0) {
                    return byTable;
                }
                return a.id.localeCompare(b.id);
            }),
    };
}

async function computeDabVersion(config: Dab.DabConfig): Promise<string> {
    const payload = JSON.stringify(normalizeDabConfigForVersion(config));
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase();
    return `dabcfg_${hash}`;
}

function ensureInitializedAndSyncedDabConfig(
    currentConfig: Dab.DabConfig | null,
    schemaTables: SchemaDesigner.Table[],
): { config: Dab.DabConfig; changed: boolean } {
    let changed = false;
    const normalizedConfig = currentConfig
        ? cloneDabConfig(currentConfig)
        : Dab.createDefaultConfig(schemaTables);
    if (!currentConfig) {
        changed = true;
    }

    const tablesById = new Map(schemaTables.map((table) => [table.id, table]));
    const syncedEntities: Dab.DabEntityConfig[] = [];

    for (const entity of normalizedConfig.entities) {
        const table = tablesById.get(entity.id);
        if (!table) {
            changed = true;
            continue;
        }

        if (entity.tableName !== table.name || entity.schemaName !== table.schema) {
            changed = true;
        }

        syncedEntities.push({
            ...entity,
            tableName: table.name,
            schemaName: table.schema,
        });
        tablesById.delete(entity.id);
    }

    for (const table of schemaTables) {
        if (!tablesById.has(table.id)) {
            continue;
        }
        syncedEntities.push(Dab.createDefaultEntityConfig(table));
        changed = true;
    }

    return {
        config: {
            ...normalizedConfig,
            entities: syncedEntities,
        },
        changed,
    };
}

function getDuplicateEntityName(config: Dab.DabConfig): string | undefined {
    const seen = new Set<string>();
    for (const entity of config.entities) {
        const normalizedEntityName = normalizeIdentifier(entity.advancedSettings.entityName);
        if (!normalizedEntityName) {
            continue;
        }
        if (seen.has(normalizedEntityName)) {
            return entity.advancedSettings.entityName;
        }
        seen.add(normalizedEntityName);
    }
    return undefined;
}

function resolveEntityRef(
    config: Dab.DabConfig,
    entityRef: Dab.DabEntityRef,
):
    | { success: true; entity: Dab.DabEntityConfig; index: number }
    | { success: false; reason: DabApplyFailureReason; message: string } {
    const hasId = typeof (entityRef as { id?: unknown }).id === "string";
    const hasSchemaTable =
        typeof (entityRef as { schemaName?: unknown }).schemaName === "string" &&
        typeof (entityRef as { tableName?: unknown }).tableName === "string";

    if (hasId === hasSchemaTable) {
        return {
            success: false,
            reason: "invalid_request",
            message: "Invalid entity reference. Use either id OR schemaName+tableName.",
        };
    }

    if (hasId) {
        const id = (entityRef as { id: string }).id;
        const index = config.entities.findIndex((entity) => entity.id === id);
        if (index < 0) {
            return {
                success: false,
                reason: "not_found",
                message: `Entity not found: ${id}`,
            };
        }
        return { success: true, entity: config.entities[index], index };
    }

    const schemaName = normalizeIdentifier((entityRef as { schemaName: string }).schemaName);
    const tableName = normalizeIdentifier((entityRef as { tableName: string }).tableName);
    const matches = config.entities
        .map((entity, index) => ({ entity, index }))
        .filter(
            ({ entity }) =>
                normalizeIdentifier(entity.schemaName) === schemaName &&
                normalizeIdentifier(entity.tableName) === tableName,
        );

    if (matches.length === 0) {
        return {
            success: false,
            reason: "not_found",
            message: `Entity not found: ${(entityRef as { schemaName: string }).schemaName}.${(entityRef as { tableName: string }).tableName}`,
        };
    }

    if (matches.length > 1) {
        return {
            success: false,
            reason: "validation_error",
            message: `Entity reference resolved to more than one entity: ${(entityRef as { schemaName: string }).schemaName}.${(entityRef as { tableName: string }).tableName}`,
        };
    }

    return {
        success: true,
        entity: matches[0].entity,
        index: matches[0].index,
    };
}

function applyDabToolChange(
    config: Dab.DabConfig,
    change: Dab.DabToolChange,
): { success: true } | { success: false; reason: DabApplyFailureReason; message: string } {
    const allowedApiTypes = new Set<Dab.ApiType>(Object.values(Dab.ApiType));
    const allowedActions = new Set<Dab.EntityAction>(Object.values(Dab.EntityAction));

    switch (change.type) {
        case "set_api_types": {
            if (!Array.isArray(change.apiTypes) || change.apiTypes.length === 0) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "apiTypes must be a non-empty array.",
                };
            }
            const uniqueApiTypes = new Set(change.apiTypes);
            if (uniqueApiTypes.size !== change.apiTypes.length) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "apiTypes must be unique.",
                };
            }
            if (change.apiTypes.some((apiType) => !allowedApiTypes.has(apiType))) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "apiTypes contains unsupported values.",
                };
            }
            config.apiTypes = [...change.apiTypes];
            return { success: true };
        }

        case "set_entity_enabled": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }
            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                isEnabled: change.isEnabled,
            };
            return { success: true };
        }

        case "set_entity_actions": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }

            if (!Array.isArray(change.actions) || change.actions.length === 0) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "actions must be a non-empty array.",
                };
            }
            const uniqueActions = new Set(change.actions);
            if (uniqueActions.size !== change.actions.length) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "actions must be unique.",
                };
            }
            if (change.actions.some((action) => !allowedActions.has(action))) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: "actions contains unsupported values.",
                };
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                enabledActions: [...change.actions],
            };
            return { success: true };
        }

        case "patch_entity_settings": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }

            const patch = change.set ?? {};
            const patchKeys = Object.keys(patch);
            if (patchKeys.length === 0) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "patch_entity_settings.set must include at least one property.",
                };
            }

            const updatedSettings: Dab.EntityAdvancedSettings = {
                ...resolvedEntity.entity.advancedSettings,
            };

            for (const key of patchKeys) {
                const value = (patch as Record<string, unknown>)[key];
                switch (key) {
                    case "entityName":
                        if (typeof value !== "string" || value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "entityName must be a non-empty string.",
                            };
                        }
                        updatedSettings.entityName = value.trim();
                        break;
                    case "authorizationRole":
                        if (
                            value !== Dab.AuthorizationRole.Anonymous &&
                            value !== Dab.AuthorizationRole.Authenticated
                        ) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message:
                                    "authorizationRole must be 'anonymous' or 'authenticated'.",
                            };
                        }
                        updatedSettings.authorizationRole = value;
                        break;
                    case "customRestPath":
                        if (value === null) {
                            delete updatedSettings.customRestPath;
                            break;
                        }
                        if (typeof value !== "string") {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customRestPath must be a string or null.",
                            };
                        }
                        if (value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customRestPath cannot be an empty string.",
                            };
                        }
                        updatedSettings.customRestPath = value.trim();
                        break;
                    case "customGraphQLType":
                        if (value === null) {
                            delete updatedSettings.customGraphQLType;
                            break;
                        }
                        if (typeof value !== "string") {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customGraphQLType must be a string or null.",
                            };
                        }
                        if (value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customGraphQLType cannot be an empty string.",
                            };
                        }
                        updatedSettings.customGraphQLType = value.trim();
                        break;
                    default:
                        return {
                            success: false,
                            reason: "invalid_request",
                            message: `Unsupported patch property: ${key}.`,
                        };
                }
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                advancedSettings: updatedSettings,
            };

            const duplicateEntityName = getDuplicateEntityName(config);
            if (duplicateEntityName) {
                return {
                    success: false,
                    reason: "validation_error",
                    message: `entityName must be unique across entities. Duplicate: ${duplicateEntityName}`,
                };
            }

            return { success: true };
        }

        case "set_only_enabled_entities": {
            if (!Array.isArray(change.entities) || change.entities.length === 0) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "set_only_enabled_entities.entities must be a non-empty array.",
                };
            }

            const selectedEntityIds = new Set<string>();
            for (const entityRef of change.entities) {
                const resolvedEntity = resolveEntityRef(config, entityRef);
                if (resolvedEntity.success === false) {
                    return resolvedEntity;
                }
                selectedEntityIds.add(resolvedEntity.entity.id);
            }

            config.entities = config.entities.map((entity) => ({
                ...entity,
                isEnabled: selectedEntityIds.has(entity.id),
            }));
            return { success: true };
        }

        case "set_all_entities_enabled": {
            config.entities = config.entities.map((entity) => ({
                ...entity,
                isEnabled: change.isEnabled,
            }));
            return { success: true };
        }

        default:
            return {
                success: false,
                reason: "invalid_request",
                message: `Unknown change type: ${(change as { type?: string }).type ?? "unknown"}`,
            };
    }
}

export function registerSchemaDesignerDabToolHandlers(params: {
    extensionRpc: WebviewRpc<SchemaDesigner.SchemaDesignerReducers>;
    isInitializedRef: { current: boolean };
    getCurrentDabConfig: () => Dab.DabConfig | null;
    getCurrentSchemaTables: () => SchemaDesigner.Table[];
    commitDabConfig: (config: Dab.DabConfig) => void;
}) {
    const {
        extensionRpc,
        isInitializedRef,
        getCurrentDabConfig,
        getCurrentSchemaTables,
        commitDabConfig,
    } = params;

    const handleGetState = async (): Promise<Dab.GetDabToolStateResponse> => {
        if (!isInitializedRef.current) {
            throw new Error(locConstants.schemaDesigner.schemaDesignerNotInitialized);
        }

        const baseSnapshot = getCurrentDabConfig();
        const schemaTables = getCurrentSchemaTables();
        const syncedSnapshot = ensureInitializedAndSyncedDabConfig(baseSnapshot, schemaTables);

        if (syncedSnapshot.changed) {
            commitDabConfig(syncedSnapshot.config);
        }

        const summary = buildDabSummary(syncedSnapshot.config);
        const version = await computeDabVersion(syncedSnapshot.config);
        const returnState =
            summary.entityCount > GET_STATE_ENTITY_THRESHOLD
                ? ("summary" as const)
                : ("full" as const);

        if (returnState === "full") {
            return {
                returnState,
                version,
                summary,
                config: syncedSnapshot.config,
            };
        }

        return {
            returnState,
            stateOmittedReason: "entity_count_over_threshold",
            version,
            summary,
        };
    };

    const handleApplyChanges = async (
        request: Dab.ApplyDabToolChangesParams,
    ): Promise<Dab.ApplyDabToolChangesResponse> => {
        if (!isInitializedRef.current) {
            return {
                success: false,
                reason: "internal_error",
                message: locConstants.schemaDesigner.schemaDesignerNotInitialized,
            };
        }

        if (!request?.expectedVersion) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing expectedVersion.",
            };
        }

        if (!Array.isArray(request.changes) || request.changes.length === 0) {
            return {
                success: false,
                reason: "invalid_request",
                message: "Missing changes (non-empty array).",
            };
        }

        const requestedReturnState = request.options?.returnState ?? "full";
        if (!isApplyReturnState(requestedReturnState)) {
            return {
                success: false,
                reason: "invalid_request",
                message: `Unsupported returnState: ${String(requestedReturnState)}`,
            };
        }

        const baseSnapshot = ensureInitializedAndSyncedDabConfig(
            getCurrentDabConfig(),
            getCurrentSchemaTables(),
        ).config;
        const version = await computeDabVersion(baseSnapshot);

        if (request.expectedVersion !== version) {
            const staleState = await buildApplyStatePayload(
                baseSnapshot,
                requestedReturnState,
                version,
            );
            return {
                success: false,
                reason: "stale_state",
                message: "DAB configuration changed since last read.",
                version: staleState.version,
                summary: staleState.summary,
                returnState: staleState.returnState,
                ...(staleState.stateOmittedReason
                    ? { stateOmittedReason: staleState.stateOmittedReason }
                    : {}),
                ...(staleState.config ? { config: staleState.config } : {}),
            };
        }

        const workingSnapshot = cloneDabConfig(baseSnapshot);
        let appliedChanges = 0;

        for (let i = 0; i < request.changes.length; i++) {
            const applyResult = applyDabToolChange(workingSnapshot, request.changes[i]);
            if (applyResult.success === false) {
                commitDabConfig(workingSnapshot);
                return {
                    success: false,
                    reason: applyResult.reason,
                    message: applyResult.message,
                    failedChangeIndex: i,
                    appliedChanges,
                    version: await computeDabVersion(workingSnapshot),
                    summary: buildDabSummary(workingSnapshot),
                };
            }
            appliedChanges++;
        }

        commitDabConfig(workingSnapshot);
        const successState = await buildApplyStatePayload(workingSnapshot, requestedReturnState);

        return {
            success: true,
            appliedChanges,
            ...successState,
        };
    };

    extensionRpc.onRequest(Dab.GetDabToolStateRequest.type, handleGetState);
    extensionRpc.onRequest(Dab.ApplyDabToolChangesRequest.type, handleApplyChanges);
}
