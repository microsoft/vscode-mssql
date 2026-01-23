/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";

const LENGTH_TYPES = new Set(["char", "nchar", "varchar", "nvarchar", "binary", "varbinary"]);
const PRECISION_SCALE_TYPES = new Set(["decimal", "numeric"]);

export class SchemaSqlBuilder {
    wrapIdentifier(name: string): string {
        return `[${name.replace(/]/g, "]]")}]`;
    }

    qualifiedName(schema: string, name: string): string {
        return `${this.wrapIdentifier(schema)}.${this.wrapIdentifier(name)}`;
    }

    quoteString(value: string): string {
        return `N'${value.replace(/'/g, "''")}'`;
    }

    generateSchemaScript(schema: SchemaDesigner.Schema): string {
        return schema.tables.map((table) => this.generateTableScript(table)).join("\n\n");
    }

    generateTableScript(table: SchemaDesigner.Table): string {
        const columnLines = table.columns.map((column) => {
            if (column.isComputed && column.computedFormula) {
                return `    ${this.wrapIdentifier(column.name)} AS ${column.computedFormula}${column.computedPersisted ? " PERSISTED" : ""}`;
            }
            const parts = [this.wrapIdentifier(column.name), this.formatDataType(column)];
            if (!column.isNullable) {
                parts.push("NOT NULL");
            }
            if (column.isIdentity) {
                parts.push(`IDENTITY(${column.identitySeed}, ${column.identityIncrement})`);
            }
            if (column.defaultValue) {
                parts.push(`DEFAULT ${column.defaultValue}`);
            }
            return `    ${parts.join(" ")}`;
        });
        const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
        if (pkColumns.length > 0) {
            const pkLine =
                `    CONSTRAINT ${this.wrapIdentifier(this.getPrimaryKeyName(table))} PRIMARY KEY (` +
                pkColumns.map((c) => this.wrapIdentifier(c.name)).join(", ") +
                ")";
            columnLines.push(pkLine);
        }
        const body = columnLines.join(",\n");
        return `CREATE TABLE ${this.qualifiedName(table.schema, table.name)}\n(${body}\n);`;
    }

    generateAddColumnStatements(
        tableName: string,
        table: SchemaDesigner.Table,
        column: SchemaDesigner.Column,
    ): string[] {
        const statements: string[] = [];
        if (column.isComputed && column.computedFormula) {
            statements.push(
                `ALTER TABLE ${tableName} ADD ${this.wrapIdentifier(column.name)} AS ${column.computedFormula}${column.computedPersisted ? " PERSISTED" : ""};`,
            );
        } else {
            statements.push(`ALTER TABLE ${tableName} ADD ${this.buildColumnDefinition(column)};`);
            if (column.defaultValue) {
                statements.push(this.generateAddDefaultConstraintStatement(tableName, column));
            }
        }
        return statements;
    }

    generateRemoveColumnStatements(
        tableName: string,
        table: SchemaDesigner.Table,
        column: SchemaDesigner.Column,
    ): string[] {
        const statements: string[] = [];
        if (column.defaultConstraintName) {
            statements.push(
                this.generateDropDefaultConstraintStatement(tableName, column.defaultConstraintName),
            );
        }
        statements.push(
            `ALTER TABLE ${tableName} DROP COLUMN ${this.wrapIdentifier(column.name)};`,
        );
        return statements;
    }

    generateAlterColumnStatements(
        tableName: string,
        table: SchemaDesigner.Table,
        originalColumn: SchemaDesigner.Column,
        updatedColumn: SchemaDesigner.Column,
    ): string[] {
        const statements: string[] = [];
        if (this.isColumnDefinitionDifferent(originalColumn, updatedColumn)) {
            statements.push(
                `ALTER TABLE ${tableName} ALTER COLUMN ${this.buildColumnDefinition(updatedColumn)};`,
            );
        }

        if (originalColumn.defaultValue !== updatedColumn.defaultValue) {
            if (originalColumn.defaultConstraintName) {
                statements.push(
                    this.generateDropDefaultConstraintStatement(
                        tableName,
                        originalColumn.defaultConstraintName,
                    ),
                );
            }
            if (updatedColumn.defaultValue) {
                statements.push(
                    this.generateAddDefaultConstraintStatement(tableName, updatedColumn),
                );
            }
        }

        return statements;
    }

    generateDropForeignKeyStatement(
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): string {
        return `ALTER TABLE ${this.qualifiedName(table.schema, table.name)} DROP CONSTRAINT ${this.wrapIdentifier(fk.name)};`;
    }

    generateCreateForeignKeyStatement(
        table: SchemaDesigner.Table,
        fk: SchemaDesigner.ForeignKey,
    ): string {
        return (
            `ALTER TABLE ${this.qualifiedName(table.schema, table.name)} ` +
            `ADD CONSTRAINT ${this.wrapIdentifier(fk.name)} FOREIGN KEY (${fk.columns
                .map((c) => this.wrapIdentifier(c))
                .join(", ")}) REFERENCES ${this.qualifiedName(
                fk.referencedSchemaName,
                fk.referencedTableName,
            )} (${fk.referencedColumns.map((c) => this.wrapIdentifier(c)).join(", ")}) ` +
            `ON DELETE ${this.mapForeignKeyActionToSql(fk.onDeleteAction)} ` +
            `ON UPDATE ${this.mapForeignKeyActionToSql(fk.onUpdateAction)};`
        );
    }

    generateDropDefaultConstraintStatement(tableName: string, constraintName: string): string {
        return `ALTER TABLE ${tableName} DROP CONSTRAINT ${this.wrapIdentifier(constraintName)};`;
    }

    generateAddDefaultConstraintStatement(
        tableName: string,
        column: SchemaDesigner.Column,
    ): string {
        const sanitizedTableName = tableName.replace(/[^\w]/g, "_");
        const constraintName = column.defaultConstraintName ?? `DF_${sanitizedTableName}_${column.name}`;
        return `ALTER TABLE ${tableName} ADD CONSTRAINT ${this.wrapIdentifier(constraintName)} DEFAULT ${column.defaultValue} FOR ${this.wrapIdentifier(column.name)};`;
    }

    generateRenameColumnStatement(
        table: SchemaDesigner.Table,
        originalName: string,
        updatedName: string,
    ): string {
        const columnIdentifier = `${this.qualifiedName(table.schema, table.name)}.${this.wrapIdentifier(originalName)}`;
        return `EXEC sp_rename ${this.quoteString(columnIdentifier)}, ${this.quoteString(updatedName)}, 'COLUMN';`;
    }

    getPrimaryKeyName(table: SchemaDesigner.Table): string {
        return table.primaryKeyName ?? `${table.name}_PK`;
    }

    private isColumnDefinitionDifferent(
        original: SchemaDesigner.Column,
        updated: SchemaDesigner.Column,
    ): boolean {
        if (this.formatDataType(original) !== this.formatDataType(updated)) {
            return true;
        }
        if (original.isNullable !== updated.isNullable) {
            return true;
        }
        return false;
    }

    private buildColumnDefinition(column: SchemaDesigner.Column): string {
        const parts = [this.wrapIdentifier(column.name), this.formatDataType(column)];
        if (!column.isNullable) {
            parts.push("NOT NULL");
        } else {
            parts.push("NULL");
        }
        if (column.isIdentity) {
            parts.push(`IDENTITY(${column.identitySeed}, ${column.identityIncrement})`);
        }
        return parts.join(" ");
    }

    private formatDataType(column: SchemaDesigner.Column): string {
        const baseType = column.dataType;
        if (LENGTH_TYPES.has(baseType)) {
            return `${baseType}(${column.maxLength})`;
        }
        if (PRECISION_SCALE_TYPES.has(baseType)) {
            return `${baseType}(${column.precision}, ${column.scale})`;
        }
        if (baseType === "datetime2" || baseType === "datetimeoffset" || baseType === "time") {
            return `${baseType}(${column.scale})`;
        }
        return baseType;
    }

    private mapForeignKeyActionToSql(action: SchemaDesigner.OnAction | undefined): string {
        switch (action) {
            case SchemaDesigner.OnAction.CASCADE:
                return "CASCADE";
            case SchemaDesigner.OnAction.SET_NULL:
                return "SET NULL";
            case SchemaDesigner.OnAction.SET_DEFAULT:
                return "SET DEFAULT";
            default:
                return "NO ACTION";
        }
    }
}
