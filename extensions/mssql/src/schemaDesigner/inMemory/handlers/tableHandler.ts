/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { CommandPhase } from "../commandGraph";
import { SchemaCommandContext, SchemaObjectHandler } from "../schemaObjectHandler";

export class TableHandler implements SchemaObjectHandler {
    buildCommands(context: SchemaCommandContext): void {
        const originalMap = new Map(
            context.originalSchema.tables.map((table) => [this.getTableIdentifier(table), table]),
        );
        const updatedMap = new Map(
            context.updatedSchema.tables.map((table) => [this.getTableIdentifier(table), table]),
        );

        for (const [tableId, originalTable] of originalMap) {
            if (!updatedMap.has(tableId)) {
                this.enqueueDropTableCommands(context, originalTable);
            }
        }

        for (const [tableId, updatedTable] of updatedMap) {
            const originalTable = originalMap.get(tableId);
            if (!originalTable) {
                this.enqueueCreateTableCommands(context, updatedTable);
            } else {
                this.enqueueTableDiffCommands(context, originalTable, updatedTable);
            }
        }
    }

    private enqueueDropTableCommands(context: SchemaCommandContext, table: SchemaDesigner.Table) {
        const dropDependencies: string[] = [];
        for (const otherTable of context.originalSchema.tables) {
            if (otherTable.id === table.id) {
                continue;
            }
            for (const fk of otherTable.foreignKeys) {
                if (
                    fk.referencedSchemaName === table.schema &&
                    fk.referencedTableName === table.name
                ) {
                    const dropFkId = context.createCommandId(
                        "drop_fk",
                        otherTable.schema,
                        otherTable.name,
                        fk.name,
                    );
                    const description = `Drop foreign key ${context.sqlBuilder.qualifiedName(otherTable.schema, otherTable.name)}.${context.sqlBuilder.wrapIdentifier(fk.name)}`;
                    const added = context.addCommand(
                        dropFkId,
                        CommandPhase.Drop,
                        [context.sqlBuilder.generateDropForeignKeyStatement(otherTable, fk)],
                        [],
                        description,
                    );
                    if (added) {
                        dropDependencies.push(dropFkId);
                    }
                }
            }
        }

        const dropTableId = context.createCommandId("drop_table", table.schema, table.name);
        context.addCommand(
            dropTableId,
            CommandPhase.Drop,
            [`DROP TABLE ${context.sqlBuilder.qualifiedName(table.schema, table.name)};`],
            dropDependencies,
            `Drop table ${context.sqlBuilder.qualifiedName(table.schema, table.name)}`,
        );
    }

    private enqueueCreateTableCommands(context: SchemaCommandContext, table: SchemaDesigner.Table) {
        const createTableId = context.createCommandId("create_table", table.schema, table.name);
        context.addCommand(
            createTableId,
            CommandPhase.Create,
            [context.sqlBuilder.generateTableScript(table)],
            [],
            `Create table ${context.sqlBuilder.qualifiedName(table.schema, table.name)}`,
        );

        for (const fk of table.foreignKeys) {
            const fkId = context.createCommandId("create_fk", table.schema, table.name, fk.name);
            const dependencies = [createTableId];
            dependencies.push(
                context.createCommandId(
                    "create_table",
                    fk.referencedSchemaName,
                    fk.referencedTableName,
                ),
            );
            context.addCommand(
                fkId,
                CommandPhase.Create,
                [context.sqlBuilder.generateCreateForeignKeyStatement(table, fk)],
                dependencies,
                `Create foreign key ${context.sqlBuilder.qualifiedName(table.schema, table.name)}.${context.sqlBuilder.wrapIdentifier(fk.name)}`,
            );
        }
    }

    private enqueueTableDiffCommands(
        context: SchemaCommandContext,
        originalTable: SchemaDesigner.Table,
        updatedTable: SchemaDesigner.Table,
    ) {
        const tableName = context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name);
        const originalTableName = context.sqlBuilder.qualifiedName(
            originalTable.schema,
            originalTable.name,
        );
        const originalColumns = new Map(
            originalTable.columns.map((column) => [this.getColumnIdentifier(column), column]),
        );
        const updatedColumns = new Map(
            updatedTable.columns.map((column) => [this.getColumnIdentifier(column), column]),
        );
        const originalForeignKeys = new Map(
            originalTable.foreignKeys.map((fk) => [this.getForeignKeyIdentifier(fk), fk]),
        );
        const updatedForeignKeys = new Map(
            updatedTable.foreignKeys.map((fk) => [this.getForeignKeyIdentifier(fk), fk]),
        );

        const columnCommandIds: string[] = [];
        const dropForeignKeyIds = new Map<string, string>();
        const tableCommandDependencies: string[] = [];
        const columnRenameCommands = new Map<string, string>();

        for (const [fkId, originalFk] of originalForeignKeys) {
            const matchingFk = updatedForeignKeys.get(fkId);
            if (!matchingFk || this.isForeignKeyDifferent(originalFk, matchingFk)) {
                const dropId = context.createCommandId(
                    "drop_fk",
                    originalTable.schema,
                    originalTable.name,
                    originalFk.name,
                );
                const description = `Drop foreign key ${context.sqlBuilder.qualifiedName(originalTable.schema, originalTable.name)}.${context.sqlBuilder.wrapIdentifier(originalFk.name)}`;
                const added = context.addCommand(
                    dropId,
                    CommandPhase.Drop,
                    [context.sqlBuilder.generateDropForeignKeyStatement(originalTable, originalFk)],
                    [],
                    description,
                );
                if (added) {
                    dropForeignKeyIds.set(fkId, dropId);
                }
            }
        }

        if (originalTable.schema !== updatedTable.schema) {
            const transferId = context.createCommandId(
                "transfer_table_schema",
                originalTable.schema,
                originalTable.name,
                updatedTable.schema,
            );
            const description = `Move table ${originalTableName} to schema ${context.sqlBuilder.wrapIdentifier(updatedTable.schema)}`;
            const added = context.addCommand(
                transferId,
                CommandPhase.Alter,
                [
                    `ALTER SCHEMA ${context.sqlBuilder.wrapIdentifier(updatedTable.schema)} TRANSFER ${originalTableName};`,
                ],
                [],
                description,
            );
            if (added) {
                tableCommandDependencies.push(transferId);
            }
        }

        if (originalTable.name !== updatedTable.name) {
            const renameId = context.createCommandId(
                "rename_table",
                originalTable.schema,
                originalTable.name,
                updatedTable.name,
            );
            const renameDependencies = [...tableCommandDependencies];
            const renameSchema = updatedTable.schema;
            const description = `Rename table ${context.sqlBuilder.qualifiedName(renameSchema, originalTable.name)} to ${tableName}`;
            const added = context.addCommand(
                renameId,
                CommandPhase.Alter,
                [
                    `EXEC sp_rename ${context.sqlBuilder.quoteString(
                        context.sqlBuilder.qualifiedName(renameSchema, originalTable.name),
                    )}, ${context.sqlBuilder.quoteString(updatedTable.name)};`,
                ],
                renameDependencies,
                description,
            );
            if (added) {
                tableCommandDependencies.push(renameId);
            }
        }

        for (const [fkIdentifier, updatedFk] of updatedForeignKeys) {
            const originalFk = originalForeignKeys.get(fkIdentifier);
            if (
                originalFk &&
                originalFk.name !== updatedFk.name &&
                !this.isForeignKeyDifferent(originalFk, updatedFk)
            ) {
                const renameId = context.createCommandId(
                    "rename_fk",
                    updatedTable.schema,
                    updatedTable.name,
                    originalFk.name,
                );
                const description = `Rename foreign key ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(originalFk.name)} to ${context.sqlBuilder.wrapIdentifier(updatedFk.name)}`;
                context.addCommand(
                    renameId,
                    CommandPhase.Alter,
                    [
                        `EXEC sp_rename ${context.sqlBuilder.quoteString(
                            `${context.sqlBuilder.wrapIdentifier(updatedTable.schema)}.${context.sqlBuilder.wrapIdentifier(originalFk.name)}`,
                        )}, ${context.sqlBuilder.quoteString(updatedFk.name)}, 'OBJECT';`,
                    ],
                    [...tableCommandDependencies],
                    description,
                );
            }
        }

        const buildColumnDependencies = (columnId: string, extra: string[] = []) => {
            const dependencies = [...tableCommandDependencies];
            const renameCommand = columnRenameCommands.get(columnId);
            if (renameCommand) {
                dependencies.push(renameCommand);
            }
            dependencies.push(...extra);
            return dependencies;
        };

        for (const [columnId, originalColumn] of originalColumns) {
            if (!updatedColumns.has(columnId)) {
                const cmdId = context.createCommandId(
                    "drop_column",
                    originalTable.schema,
                    originalTable.name,
                    originalColumn.name,
                );
                const added = context.addCommand(
                    cmdId,
                    CommandPhase.Alter,
                    context.sqlBuilder.generateRemoveColumnStatements(
                        tableName,
                        originalTable,
                        originalColumn,
                    ),
                    buildColumnDependencies(columnId),
                    `Drop column ${context.sqlBuilder.qualifiedName(originalTable.schema, originalTable.name)}.${context.sqlBuilder.wrapIdentifier(originalColumn.name)}`,
                );
                if (added) {
                    columnCommandIds.push(cmdId);
                }
            }
        }

        for (const [columnId, updatedColumn] of updatedColumns) {
            const originalColumn = originalColumns.get(columnId);
            if (!originalColumn) {
                const cmdId = context.createCommandId(
                    "add_column",
                    updatedTable.schema,
                    updatedTable.name,
                    updatedColumn.name,
                );
                const added = context.addCommand(
                    cmdId,
                    CommandPhase.Alter,
                    context.sqlBuilder.generateAddColumnStatements(
                        tableName,
                        updatedTable,
                        updatedColumn,
                    ),
                    buildColumnDependencies(columnId),
                    `Add column ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(updatedColumn.name)}`,
                );
                if (added) {
                    columnCommandIds.push(cmdId);
                }
            } else {
                if (originalColumn.name !== updatedColumn.name) {
                    const renameId = context.createCommandId(
                        "rename_column",
                        updatedTable.schema,
                        updatedTable.name,
                        originalColumn.name,
                    );
                    const description = `Rename column ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(originalColumn.name)} to ${context.sqlBuilder.wrapIdentifier(updatedColumn.name)}`;
                    const renameAdded = context.addCommand(
                        renameId,
                        CommandPhase.Alter,
                        [
                            context.sqlBuilder.generateRenameColumnStatement(
                                updatedTable,
                                originalColumn.name,
                                updatedColumn.name,
                            ),
                        ],
                        [...tableCommandDependencies],
                        description,
                    );
                    if (renameAdded) {
                        columnRenameCommands.set(columnId, renameId);
                        columnCommandIds.push(renameId);
                    }
                }

                if (this.columnRequiresRecreation(originalColumn, updatedColumn)) {
                    const dropId = context.createCommandId(
                        "recreate_drop_column",
                        updatedTable.schema,
                        updatedTable.name,
                        originalColumn.name,
                    );
                    const dropAdded = context.addCommand(
                        dropId,
                        CommandPhase.Alter,
                        context.sqlBuilder.generateRemoveColumnStatements(
                            tableName,
                            originalTable,
                            originalColumn,
                        ),
                        buildColumnDependencies(columnId),
                        `Drop column ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(originalColumn.name)} for recreation`,
                    );
                    const addId = context.createCommandId(
                        "recreate_add_column",
                        updatedTable.schema,
                        updatedTable.name,
                        updatedColumn.name,
                    );
                    const addDependencies = buildColumnDependencies(columnId);
                    if (dropAdded) {
                        addDependencies.push(dropId);
                    }
                    const addAdded = context.addCommand(
                        addId,
                        CommandPhase.Alter,
                        context.sqlBuilder.generateAddColumnStatements(
                            tableName,
                            updatedTable,
                            updatedColumn,
                        ),
                        addDependencies,
                        `Recreate column ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(updatedColumn.name)}`,
                    );
                    if (dropAdded) {
                        columnCommandIds.push(dropId);
                    }
                    if (addAdded) {
                        columnCommandIds.push(addId);
                    }
                } else {
                    const cmdId = context.createCommandId(
                        "alter_column",
                        updatedTable.schema,
                        updatedTable.name,
                        updatedColumn.name,
                    );
                    const statements = context.sqlBuilder.generateAlterColumnStatements(
                        tableName,
                        updatedTable,
                        originalColumn,
                        updatedColumn,
                    );
                    const added = context.addCommand(
                        cmdId,
                        CommandPhase.Alter,
                        statements,
                        buildColumnDependencies(columnId),
                        `Alter column ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(updatedColumn.name)}`,
                    );
                    if (added) {
                        columnCommandIds.push(cmdId);
                    }
                }
            }
        }

        let dropPkDependency: string | undefined;
        if (this.isPrimaryKeyDifferent(originalTable, updatedTable)) {
            const dropPkId = context.createCommandId(
                "drop_pk",
                originalTable.schema,
                originalTable.name,
            );
            const dropAdded = context.addCommand(
                dropPkId,
                CommandPhase.Drop,
                originalTable.columns.some((c) => c.isPrimaryKey)
                    ? [
                          `ALTER TABLE ${originalTableName} DROP CONSTRAINT ${context.sqlBuilder.wrapIdentifier(context.sqlBuilder.getPrimaryKeyName(originalTable))};`,
                      ]
                    : [],
                [],
                `Drop primary key on ${context.sqlBuilder.qualifiedName(originalTable.schema, originalTable.name)}`,
            );
            if (dropAdded) {
                dropPkDependency = dropPkId;
            }

            const updatedPkColumns = updatedTable.columns.filter((c) => c.isPrimaryKey);
            if (updatedPkColumns.length > 0) {
                const addPkId = context.createCommandId(
                    "add_pk",
                    updatedTable.schema,
                    updatedTable.name,
                );
                const dependencies = [...columnCommandIds];
                if (dropPkDependency) {
                    dependencies.push(dropPkDependency);
                }
                context.addCommand(
                    addPkId,
                    CommandPhase.Create,
                    [
                        `ALTER TABLE ${tableName} ADD CONSTRAINT ${context.sqlBuilder.wrapIdentifier(context.sqlBuilder.getPrimaryKeyName(updatedTable))} PRIMARY KEY (${updatedPkColumns
                            .map((c) => context.sqlBuilder.wrapIdentifier(c.name))
                            .join(", ")});`,
                    ],
                    dependencies,
                    `Create primary key on ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}`,
                );
            }
        }

        for (const [fkIdentifier, fk] of updatedForeignKeys) {
            const originalFk = originalForeignKeys.get(fkIdentifier);
            if (!originalFk || this.isForeignKeyDifferent(originalFk, fk)) {
                const createFkId = context.createCommandId(
                    "create_fk",
                    updatedTable.schema,
                    updatedTable.name,
                    fk.name,
                );
                const dependencies = [...columnCommandIds];
                const dropId = dropForeignKeyIds.get(fkIdentifier);
                if (dropId) {
                    dependencies.push(dropId);
                }
                dependencies.push(
                    context.createCommandId(
                        "create_table",
                        fk.referencedSchemaName,
                        fk.referencedTableName,
                    ),
                );
                context.addCommand(
                    createFkId,
                    CommandPhase.Create,
                    [context.sqlBuilder.generateCreateForeignKeyStatement(updatedTable, fk)],
                    dependencies,
                    `Create foreign key ${context.sqlBuilder.qualifiedName(updatedTable.schema, updatedTable.name)}.${context.sqlBuilder.wrapIdentifier(fk.name)}`,
                );
            }
        }
    }

    private columnRequiresRecreation(
        original: SchemaDesigner.Column,
        updated: SchemaDesigner.Column,
    ): boolean {
        if (original.isComputed !== updated.isComputed) {
            return true;
        }
        if (
            original.isComputed &&
            updated.isComputed &&
            (original.computedFormula !== updated.computedFormula ||
                original.computedPersisted !== updated.computedPersisted)
        ) {
            return true;
        }
        if (original.isIdentity !== updated.isIdentity) {
            return true;
        }
        if (
            original.isIdentity &&
            updated.isIdentity &&
            (original.identitySeed !== updated.identitySeed ||
                original.identityIncrement !== updated.identityIncrement)
        ) {
            return true;
        }
        return false;
    }

    private isPrimaryKeyDifferent(
        original: SchemaDesigner.Table,
        updated: SchemaDesigner.Table,
    ): boolean {
        const originalPk = original.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
        const updatedPk = updated.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
        if (originalPk.length !== updatedPk.length) {
            return true;
        }
        for (let i = 0; i < originalPk.length; i++) {
            if (originalPk[i] !== updatedPk[i]) {
                return true;
            }
        }
        return false;
    }

    private isForeignKeyDifferent(
        original: SchemaDesigner.ForeignKey,
        updated: SchemaDesigner.ForeignKey,
    ): boolean {
        const basePropsChanged =
            original.referencedSchemaName !== updated.referencedSchemaName ||
            original.referencedTableName !== updated.referencedTableName ||
            original.onDeleteAction !== updated.onDeleteAction ||
            original.onUpdateAction !== updated.onUpdateAction;
        if (basePropsChanged) {
            return true;
        }
        if (original.columns.length !== updated.columns.length) {
            return true;
        }
        for (let i = 0; i < original.columns.length; i++) {
            if (
                original.columns[i] !== updated.columns[i] ||
                original.referencedColumns[i] !== updated.referencedColumns[i]
            ) {
                return true;
            }
        }
        return false;
    }

    private getTableIdentifier(table: SchemaDesigner.Table): string {
        return table.id ?? `${table.schema}.${table.name}`.toLowerCase();
    }

    private getColumnIdentifier(column: SchemaDesigner.Column): string {
        return column.id ?? column.name;
    }

    private getForeignKeyIdentifier(fk: SchemaDesigner.ForeignKey): string {
        return fk.id ?? fk.name;
    }
}
