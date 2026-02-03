/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { WebviewRpc } from "../../common/rpc";
import { locConstants } from "../../common/locConstants";
import { v4 as uuidv4 } from "uuid";
import { tableUtils } from "./schemaDesignerUtils";

export function registerSchemaDesignerApplyEditsHandler(params: {
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
}) {
    const {
        isInitialized,
        extensionRpc,
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
            if (!src.success) {
                return src;
            }
            const tgt = resolveColumnNameByName(referencedTable, refCol);
            if (!tgt.success) {
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
                        if (!resolved.success) {
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
                        if (!resolved.success) {
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
                        if (!resolved.success) {
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
                        if (!resolvedTable.success) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.column) {
                            return fail("invalid_request", "Missing edit.column.");
                        }

                        const resolvedColumn = resolveColumn(resolvedTable.table, edit.column);
                        if (!resolvedColumn.success) {
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
                        if (!resolvedTable.success) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.column) {
                            return fail("invalid_request", "Missing edit.column.");
                        }

                        const resolvedColumn = resolveColumn(resolvedTable.table, edit.column);
                        if (!resolvedColumn.success) {
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
                        if (!resolvedTable.success) {
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
                        if (!referenced.success) {
                            return fail(referenced.reason, referenced.message);
                        }

                        const mappingsResult = resolveForeignKeyMappings(
                            resolvedTable.table,
                            referenced.table,
                            edit.foreignKey.mappings,
                        );
                        if (!mappingsResult.success) {
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
                        if (!resolvedTable.success) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.foreignKey) {
                            return fail("invalid_request", "Missing edit.foreignKey.");
                        }

                        const resolvedForeignKey = resolveForeignKey(
                            resolvedTable.table,
                            edit.foreignKey,
                        );
                        if (!resolvedForeignKey.success) {
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
                        if (!resolvedTable.success) {
                            return fail(resolvedTable.reason, resolvedTable.message);
                        }

                        if (!edit.foreignKey) {
                            return fail("invalid_request", "Missing edit.foreignKey.");
                        }

                        const resolvedForeignKey = resolveForeignKey(
                            resolvedTable.table,
                            edit.foreignKey,
                        );
                        if (!resolvedForeignKey.success) {
                            return fail(resolvedForeignKey.reason, resolvedForeignKey.message);
                        }

                        let referencedSchemaName =
                            resolvedForeignKey.foreignKey.referencedSchemaName;
                        let referencedTableName = resolvedForeignKey.foreignKey.referencedTableName;
                        if (edit.set?.referencedTable) {
                            const referenced = resolveTable(schema, edit.set.referencedTable);
                            if (!referenced.success) {
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
                        if (!referencedTableForMappings.success) {
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
                            if (!mappingsResult.success) {
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

    extensionRpc.onRequest(SchemaDesigner.ApplyEditsWebviewRequest.type, handleApplyEdits);
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
