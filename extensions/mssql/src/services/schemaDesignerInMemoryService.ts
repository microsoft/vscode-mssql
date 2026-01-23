/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "crypto";
import { RequestType } from "vscode-languageclient";
import * as mssql from "vscode-mssql";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import { SimpleExecuteResult } from "vscode-mssql";
import { SchemaCommandBuilder } from "../schemaDesigner/inMemory/schemaCommandBuilder";
import { CommandGraph, CommandPhase } from "../schemaDesigner/inMemory/commandGraph";
import { SchemaSqlBuilder } from "../schemaDesigner/inMemory/schemaSqlBuilder";
import ConnectionManager from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";

interface SimpleExecuteParams {
    ownerUri: string;
    queryString: string;
}

const SIMPLE_EXECUTE_REQUEST = new RequestType<
    SimpleExecuteParams,
    mssql.SimpleExecuteResult,
    void,
    void
>("query/simpleexecute");

interface SessionState {
    sessionId: string;
    ownerUri: string;
    schema: SchemaDesigner.Schema;
    originalSchema: SchemaDesigner.Schema;
    dataTypes: string[];
    schemaNames: string[];
    connectionProfile?: IConnectionProfile;
}

interface ColumnQueryRow {
    tableObjectId: number;
    columnId: number;
    columnName: string;
    dataType: string;
    maxLength: string | null;
    precision: string | null;
    scale: string | null;
    isNullable: string | null;
    isPrimaryKey: string | null;
    isIdentity: string | null;
    identitySeed: string | null;
    identityIncrement: string | null;
    defaultValue: string | null;
    defaultConstraintName: string | null;
    isComputed: string | null;
    computedFormula: string | null;
    computedPersisted: string | null;
    primaryKeyName?: string | null;
}

interface ForeignKeyQueryRow {
    fkName: string;
    parentObjectId: number;
    referencedSchema: string;
    referencedTable: string;
    parentColumn: string;
    referencedColumn: string;
    deleteAction: string;
    updateAction: string;
}

/**
 * Schema designer service that keeps all metadata and diffing inside VS Code.
 * This mirrors the DBeaver approach by reading system catalogs directly and
 * creating the publish scripts in-memory.
 */
export class SchemaDesignerInMemoryService implements SchemaDesigner.ISchemaDesignerService {
    private readonly _sessions = new Map<string, SessionState>();
    private readonly _sqlBuilder = new SchemaSqlBuilder();
    private static readonly _maxQueryRetries = 3;
    private static readonly _baseRetryDelayMs = 250;

    constructor(
        private readonly _sqlToolsClient: SqlToolsServiceClient,
        private readonly _connectionManager: ConnectionManager,
    ) {}

    async createSession(
        request: SchemaDesigner.CreateSessionRequest,
    ): Promise<SchemaDesigner.CreateSessionResponse> {
        if (!request.ownerUri) {
            throw new Error("Schema designer in-memory engine requires an owner URI");
        }
        const sessionId = randomUUID();
        const [schema, dataTypes, schemaNames] = await Promise.all([
            this.loadSchema(request.ownerUri, request.connectionProfile as any),
            this.fetchDataTypes(request.ownerUri, request.connectionProfile as any),
            this.fetchSchemaNames(request.ownerUri, request.connectionProfile as any),
        ]);

        const normalizedSchema = this.normalizeSchema(schema);

        const sessionState: SessionState = {
            sessionId,
            ownerUri: request.ownerUri,
            schema: this.cloneSchema(normalizedSchema),
            originalSchema: this.cloneSchema(normalizedSchema),
            dataTypes,
            schemaNames,
            connectionProfile: request.connectionProfile as any,
        };

        this._sessions.set(sessionId, sessionState);
        return {
            schema: normalizedSchema,
            dataTypes,
            schemaNames,
            sessionId,
        };
    }

    async disposeSession(request: SchemaDesigner.DisposeSessionRequest): Promise<void> {
        this._sessions.delete(request.sessionId);
    }

    async publishSession(request: SchemaDesigner.PublishSessionRequest): Promise<void> {
        const session = this.getSession(request.sessionId);
        if (!request.updatedSchema) {
            throw new Error("Updated schema is required when using the in-memory engine");
        }
        const normalizedSchema = this.normalizeSchema(request.updatedSchema);
        const graph = this.buildCommandGraph(session.originalSchema, normalizedSchema);
        const script = this.generateScriptFromGraph(graph);
        if (!script.trim()) {
            return;
        }

        await this.simpleExecute(session.ownerUri, script, session.connectionProfile);
        session.originalSchema = this.cloneSchema(normalizedSchema);
        session.schema = this.cloneSchema(normalizedSchema);
    }

    async getDefinition(
        request: SchemaDesigner.GetDefinitionRequest,
    ): Promise<SchemaDesigner.GetDefinitionResponse> {
        const session = this.getSession(request.sessionId);
        const normalizedSchema = this.normalizeSchema(request.updatedSchema);
        session.schema = this.cloneSchema(normalizedSchema);
        return {
            script: this._sqlBuilder.generateSchemaScript(normalizedSchema),
        };
    }

    async generateScript(
        request: SchemaDesigner.GenerateScriptRequest,
    ): Promise<SchemaDesigner.GenerateScriptResponse> {
        const session = this.getSession(request.sessionId);
        const graph = this.buildCommandGraph(session.originalSchema, session.schema);
        return {
            script: this.generateScriptFromGraph(graph),
        };
    }

    async getReport(
        request: SchemaDesigner.GetReportRequest,
    ): Promise<SchemaDesigner.GetReportResponse> {
        const session = this.getSession(request.sessionId);
        const normalizedSchema = this.normalizeSchema(request.updatedSchema);
        session.schema = this.cloneSchema(normalizedSchema);
        const graph = this.buildCommandGraph(session.originalSchema, normalizedSchema);
        const script = this.generateScriptFromGraph(graph);
        const hasChanges = script.trim().length > 0;
        return {
            hasSchemaChanged: hasChanges,
            dacReport: {
                report: this.buildReadableReport(graph),
                hasWarnings: false,
                possibleDataLoss: false,
                requireTableRecreation: false,
            },
        };
    }

    onSchemaReady(_listener: (model: SchemaDesigner.SchemaDesignerSession) => void): void {
        // No-op for the in-memory engine.
    }

    private getSession(sessionId: string): SessionState {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error("Schema designer session was not found");
        }
        return session;
    }

    private async loadSchema(
        ownerUri: string,
        connectionProfile?: IConnectionProfile,
    ): Promise<SchemaDesigner.Schema> {
        const tables = await this.fetchTables(ownerUri, connectionProfile);
        if (tables.length === 0) {
            return { tables: [] };
        }
        const objectIds = tables.map((t) => t.objectId);
        const columns = await this.fetchColumns(ownerUri, objectIds, connectionProfile);
        const foreignKeys = await this.fetchForeignKeys(ownerUri, objectIds, connectionProfile);

        const tableMap = new Map<number, SchemaDesigner.Table>();
        tables.forEach((table) => {
            tableMap.set(table.objectId, {
                id: table.objectId.toString(),
                name: table.name,
                schema: table.schema,
                columns: [],
                foreignKeys: [],
            });
        });

        columns.forEach((column) => {
            const table = tableMap.get(column.tableObjectId);
            if (!table) {
                return;
            }
            table.columns.push({
                id: `${column.tableObjectId}_${column.columnId}`,
                name: column.columnName,
                dataType: column.dataType,
                maxLength: this.formatMaxLength(column.maxLength, column.dataType),
                precision: this.parseNumber(column.precision),
                scale: this.parseNumber(column.scale),
                isPrimaryKey: this.parseBoolean(column.isPrimaryKey),
                isIdentity: this.parseBoolean(column.isIdentity),
                identitySeed: this.parseNumber(column.identitySeed),
                identityIncrement: this.parseNumber(column.identityIncrement),
                isNullable: this.parseBoolean(column.isNullable),
                defaultValue: column.defaultValue ?? "",
                defaultConstraintName: column.defaultConstraintName ?? undefined,
                isComputed: this.parseBoolean(column.isComputed),
                computedFormula: column.computedFormula ?? "",
                computedPersisted: this.parseBoolean(column.computedPersisted),
            });
            if (column.primaryKeyName) {
                table.primaryKeyName = column.primaryKeyName;
            }
        });

        foreignKeys.forEach((fk) => {
            const table = tableMap.get(fk.parentObjectId);
            if (!table) {
                return;
            }
            let existing = table.foreignKeys.find((f) => f.name === fk.fkName);
            if (!existing) {
                existing = {
                    id: `${fk.parentObjectId}_${fk.fkName}`,
                    name: fk.fkName,
                    columns: [],
                    referencedSchemaName: fk.referencedSchema,
                    referencedTableName: fk.referencedTable,
                    referencedColumns: [],
                    onDeleteAction: this.mapForeignKeyAction(fk.deleteAction),
                    onUpdateAction: this.mapForeignKeyAction(fk.updateAction),
                };
                table.foreignKeys.push(existing);
            }
            existing.columns.push(fk.parentColumn);
            existing.referencedColumns.push(fk.referencedColumn);
        });

        return { tables: Array.from(tableMap.values()) };
    }

    private async fetchTables(
        ownerUri: string,
        connectionProfile?: IConnectionProfile,
    ): Promise<{ objectId: number; name: string; schema: string }[]> {
        const query = `SELECT t.object_id AS objectId, t.name AS name, s.name AS schemaName
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            WHERE t.is_ms_shipped = 0
            ORDER BY s.name, t.name`;
        const rows = this.mapRows(await this.simpleExecute(ownerUri, query, connectionProfile));
        return rows.map((row) => ({
            objectId: Number(row.objectId),
            name: row.name ?? "",
            schema: row.schemaName ?? "dbo",
        }));
    }

    private async fetchColumns(
        ownerUri: string,
        objectIds: number[],
        connectionProfile?: IConnectionProfile,
    ): Promise<ColumnQueryRow[]> {
        const idList = objectIds.join(",");
        const query = `SELECT
            c.object_id AS tableObjectId,
            c.column_id AS columnId,
            c.name AS columnName,
            tp.name AS dataType,
            c.max_length AS maxLength,
            c.precision AS precision,
            c.scale AS scale,
            c.is_nullable AS isNullable,
            ISNULL(pk.index_column_id, 0) AS isPrimaryKey,
            pk.primaryKeyName,
            c.is_identity AS isIdentity,
            ic.seed_value AS identitySeed,
            ic.increment_value AS identityIncrement,
            dc.definition AS defaultValue,
            c.is_computed AS isComputed,
            cc.definition AS computedFormula,
            cc.is_persisted AS computedPersisted
        FROM sys.columns c
        JOIN sys.types tp ON tp.user_type_id = c.user_type_id AND tp.is_user_defined = 0
        LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
        LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        OUTER APPLY (
            SELECT i.index_column_id, kc.name AS primaryKeyName
            FROM sys.index_columns i
            JOIN sys.key_constraints kc ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id AND kc.type = 'PK'
            WHERE i.object_id = c.object_id AND i.column_id = c.column_id
        ) pk
        WHERE c.object_id IN (${idList})
        ORDER BY c.object_id, c.column_id`;
        const rows = this.mapRows(await this.simpleExecute(ownerUri, query, connectionProfile));
        return rows.map((row) => ({
            tableObjectId: Number(row.tableObjectId),
            columnId: Number(row.columnId),
            columnName: row.columnName ?? "",
            dataType: row.dataType ?? "",
            maxLength: row.maxLength,
            precision: row.precision,
            scale: row.scale,
            isNullable: row.isNullable,
            isPrimaryKey: row.isPrimaryKey,
            primaryKeyName: row.primaryKeyName,
            isIdentity: row.isIdentity,
            identitySeed: row.identitySeed,
            identityIncrement: row.identityIncrement,
            defaultValue: row.defaultValue,
            defaultConstraintName: row.defaultConstraintName,
            isComputed: row.isComputed,
            computedFormula: row.computedFormula,
            computedPersisted: row.computedPersisted,
        }));
    }

    private async fetchForeignKeys(
        ownerUri: string,
        objectIds: number[],
        connectionProfile?: IConnectionProfile,
    ): Promise<ForeignKeyQueryRow[]> {
        const idList = objectIds.join(",");
        const query = `SELECT
            fk.name AS fkName,
            fk.parent_object_id AS parentObjectId,
            s.name AS referencedSchema,
            t.name AS referencedTable,
            cpa.name AS parentColumn,
            cref.name AS referencedColumn,
            fk.delete_referential_action_desc AS deleteAction,
            fk.update_referential_action_desc AS updateAction
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        JOIN sys.tables t ON t.object_id = fk.referenced_object_id
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        JOIN sys.columns cpa ON cpa.object_id = fk.parent_object_id AND cpa.column_id = fkc.parent_column_id
        JOIN sys.columns cref ON cref.object_id = fk.referenced_object_id AND cref.column_id = fkc.referenced_column_id
        WHERE fk.parent_object_id IN (${idList})
        ORDER BY fk.parent_object_id, fk.name, fkc.constraint_column_id`;
        const rows = this.mapRows(await this.simpleExecute(ownerUri, query, connectionProfile));
        return rows.map((row) => ({
            fkName: row.fkName ?? "",
            parentObjectId: Number(row.parentObjectId),
            referencedSchema: row.referencedSchema ?? "",
            referencedTable: row.referencedTable ?? "",
            parentColumn: row.parentColumn ?? "",
            referencedColumn: row.referencedColumn ?? "",
            deleteAction: row.deleteAction ?? "NO_ACTION",
            updateAction: row.updateAction ?? "NO_ACTION",
        }));
    }

    private async fetchDataTypes(
        ownerUri: string,
        connectionProfile?: IConnectionProfile,
    ): Promise<string[]> {
        const query = `SELECT name FROM sys.types WHERE is_user_defined = 0 AND name <> 'sysname' ORDER BY name`;
        return this.mapRows(await this.simpleExecute(ownerUri, query, connectionProfile)).map(
            (row) => row.name ?? "",
        );
    }

    private async fetchSchemaNames(
        ownerUri: string,
        connectionProfile?: IConnectionProfile,
    ): Promise<string[]> {
        const query = `SELECT name FROM sys.schemas ORDER BY name`;
        return this.mapRows(await this.simpleExecute(ownerUri, query, connectionProfile)).map(
            (row) => row.name ?? "",
        );
    }

    private mapRows(result: SimpleExecuteResult): Record<string, string | null>[] {
        if (!result?.rows?.length) {
            return [];
        }
        return result.rows.map((row) => {
            const record: Record<string, string | null> = {};
            row.forEach((cell, idx) => {
                const columnName = result.columnInfo[idx]?.columnName ?? `column${idx}`;
                record[columnName] = cell.isNull ? null : cell.displayValue;
            });
            return record;
        });
    }

    private parseNumber(value: string | null): number {
        if (value === null || value === undefined) {
            return 0;
        }
        const parsed = Number(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    private parseBoolean(value: string | null): boolean {
        if (!value) {
            return false;
        }
        const normalized = value.toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "yes";
    }

    private formatMaxLength(value: string | null, dataType: string): string {
        if (!value) {
            return "";
        }
        const parsed = Number(value);
        if (parsed === -1) {
            return "MAX";
        }
        const lowered = dataType.toLowerCase();
        if (["nchar", "nvarchar"].includes(lowered) && parsed > 0) {
            return (parsed / 2).toString();
        }
        return isNaN(parsed) ? value : parsed.toString();
    }

    private mapForeignKeyAction(action: string): SchemaDesigner.OnAction {
        switch (action?.toUpperCase()) {
            case "CASCADE":
                return SchemaDesigner.OnAction.CASCADE;
            case "SET_NULL":
                return SchemaDesigner.OnAction.SET_NULL;
            case "SET_DEFAULT":
                return SchemaDesigner.OnAction.SET_DEFAULT;
            default:
                return SchemaDesigner.OnAction.NO_ACTION;
        }
    }

    private cloneSchema(schema: SchemaDesigner.Schema): SchemaDesigner.Schema {
        return JSON.parse(JSON.stringify(schema));
    }

    private normalizeSchema(schema: SchemaDesigner.Schema): SchemaDesigner.Schema {
        const normalized = this.cloneSchema(schema);
        for (const table of normalized.tables) {
            table.primaryKeyName = table.primaryKeyName ?? `${table.name}_PK`;
            for (const column of table.columns) {
                if (column.defaultValue && !column.defaultConstraintName) {
                    const sanitizedTable = `${table.schema}_${table.name}`.replace(/[^\w]/g, "_");
                    column.defaultConstraintName = `DF_${sanitizedTable}_${column.name}`;
                }
            }
        }
        return normalized;
    }

    private buildCommandGraph(
        originalSchema: SchemaDesigner.Schema,
        updatedSchema: SchemaDesigner.Schema,
    ): CommandGraph {
        const builder = new SchemaCommandBuilder({
            original: this.cloneSchema(originalSchema),
            updated: this.cloneSchema(updatedSchema),
            sqlBuilder: this._sqlBuilder,
        });
        return builder.build();
    }

    private generateScriptFromGraph(graph: CommandGraph): string {
        const statements = graph.toStatements();
        if (statements.length === 0) {
            return "";
        }
        return this.wrapInTransaction(statements);
    }

    private buildReadableReport(graph: CommandGraph): string {
        const lines: string[] = ["Schema changes:"];
        const phaseTitles: Record<CommandPhase, string> = {
            [CommandPhase.Drop]: "Drop phase",
            [CommandPhase.Alter]: "Alter phase",
            [CommandPhase.Create]: "Create phase",
        } as const;

        for (const phase of [CommandPhase.Drop, CommandPhase.Alter, CommandPhase.Create]) {
            const commands = graph.getOrderedCommands(phase);
            if (!commands.length) {
                continue;
            }
            lines.push("", `${phaseTitles[phase]}:`);
            for (const command of commands) {
                const description = command.description ?? command.statements.join(" ");
                lines.push(` - ${description}`);
            }
        }

        if (lines.length === 1) {
            return "No changes detected.";
        }

        return lines.join("\n");
    }

    private wrapInTransaction(statements: string[]): string {
        const trimmed = statements.filter((stmt) => stmt && stmt.trim().length > 0);
        if (trimmed.length === 0) {
            return "";
        }
        const indentedStatements = trimmed.map((stmt) => `    ${stmt}`);
        return [
            "BEGIN TRY",
            "    BEGIN TRANSACTION",
            ...indentedStatements,
            "    COMMIT TRANSACTION",
            "END TRY",
            "BEGIN CATCH",
            "    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;",
            "    THROW;",
            "END CATCH;",
        ].join("\n");
    }

    private async simpleExecute(
        ownerUri: string,
        query: string,
        connectionProfile?: IConnectionProfile,
    ): Promise<mssql.SimpleExecuteResult> {
        const trimmedQuery = query.trim();
        let lastError: unknown;
        for (
            let attempt = 1;
            attempt <= SchemaDesignerInMemoryService._maxQueryRetries;
            attempt++
        ) {
            try {
                await this.ensureConnection(ownerUri, connectionProfile);
                console.log(
                    `[SchemaDesigner Live Engine] Executing query (attempt ${attempt}/${SchemaDesignerInMemoryService._maxQueryRetries}) on ${ownerUri}:`,
                );
                console.log(trimmedQuery);
                const result = await this._sqlToolsClient.sendRequest(SIMPLE_EXECUTE_REQUEST, {
                    ownerUri,
                    queryString: query,
                });
                console.log(
                    `[SchemaDesigner Live Engine] Query execution completed in attempt ${attempt}. ${result.rowCount ?? result.rows?.length ?? 0} rows returned`,
                );
                return result;
            } catch (error) {
                lastError = error;
                const message = (error as Error)?.message ?? "";
                console.error(
                    `[SchemaDesigner Live Engine] Query attempt ${attempt} failed: ${message || error}`,
                );
                if (connectionProfile && this.isInvalidOwnerUriError(error)) {
                    try {
                        await this.ensureConnection(ownerUri, connectionProfile, true);
                        continue;
                    } catch (reconnectError) {
                        console.error(
                            `[SchemaDesigner Live Engine] Reconnection failed: ${(reconnectError as Error)?.message ?? reconnectError}`,
                        );
                        lastError = reconnectError;
                    }
                }
                if (attempt === SchemaDesignerInMemoryService._maxQueryRetries) {
                    break;
                }
                const delay =
                    SchemaDesignerInMemoryService._baseRetryDelayMs * Math.pow(2, attempt - 1);
                await this.delay(delay);
            }
        }
        throw lastError ?? new Error("Query execution failed");
    }

    private async ensureConnection(
        ownerUri: string,
        profile?: IConnectionProfile,
        forceReconnect: boolean = false,
    ): Promise<void> {
        if (!ownerUri) {
            throw new Error("Owner URI is required for schema designer queries");
        }
        if (!forceReconnect && this._connectionManager.isConnected(ownerUri)) {
            return;
        }
        if (!profile) {
            throw new Error(
                "The schema designer connection was closed and no profile is available to reconnect.",
            );
        }
        if (forceReconnect && this._connectionManager.isConnected(ownerUri)) {
            await this._connectionManager.disconnect(ownerUri);
        }
        const reconnected = await this._connectionManager.connect(ownerUri, profile, {
            shouldHandleErrors: true,
            connectionSource: "schemaDesigner",
        });
        if (!reconnected) {
            throw new Error("Failed to re-establish schema designer connection");
        }
    }

    private isInvalidOwnerUriError(error: unknown): boolean {
        const message = typeof error === "string" ? error : ((error as Error)?.message ?? "");
        return message.toLowerCase().includes("invalid owneruri");
    }

    private async delay(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
}
