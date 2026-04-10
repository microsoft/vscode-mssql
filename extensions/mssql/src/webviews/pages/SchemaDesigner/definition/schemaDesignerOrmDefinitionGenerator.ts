/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerDefinitionFormat } from "./schemaDesignerDefinitionFormats";

interface TableInfo {
    table: SchemaDesigner.Table;
    entityName: string;
    constantName: string;
    schemaConstantName: string;
    columnNamesById: Map<string, string>;
}

interface IncomingRelation {
    sourceInfo: TableInfo;
    foreignKey: SchemaDesigner.ForeignKey;
}

interface CodeModel {
    tableInfos: TableInfo[];
    tableInfoById: Map<string, TableInfo>;
    incomingByTableId: Map<string, IncomingRelation[]>;
    sourceRelationNameByForeignKeyId: Map<string, string>;
    targetCollectionNameByForeignKeyId: Map<string, string>;
}

type SchemaDesignerDefinitionGenerator = (codeModel: CodeModel) => string;

const schemaDesignerDefinitionGenerators: Partial<
    Record<SchemaDesignerDefinitionFormat, SchemaDesignerDefinitionGenerator>
> = {
    [SchemaDesignerDefinitionFormat.Prisma]: generatePrismaDefinition,
    [SchemaDesignerDefinitionFormat.Sequelize]: generateSequelizeDefinition,
    [SchemaDesignerDefinitionFormat.TypeOrm]: generateTypeOrmDefinition,
    [SchemaDesignerDefinitionFormat.DrizzleOrm]: generateDrizzleDefinition,
    [SchemaDesignerDefinitionFormat.SqlAlchemy]: generateSqlAlchemyDefinition,
    [SchemaDesignerDefinitionFormat.EfCore]: generateEfCoreDefinition,
};

export function generateSchemaDesignerDefinition(
    format: SchemaDesignerDefinitionFormat,
    schema: SchemaDesigner.Schema,
): string {
    if (!schema.tables.length) {
        return "";
    }

    const generator = schemaDesignerDefinitionGenerators[format];
    return generator ? generator(buildCodeModel(schema)) : "";
}

export function getSchemaDesignerScriptValue(
    format: SchemaDesignerDefinitionFormat,
    currentTsqlDefinition: string,
    schema: SchemaDesigner.Schema,
): string {
    if (format === SchemaDesignerDefinitionFormat.TSql) {
        return currentTsqlDefinition;
    }

    return generateSchemaDesignerDefinition(format, schema);
}

function buildCodeModel(schema: SchemaDesigner.Schema): CodeModel {
    const tableInfoById = new Map<string, TableInfo>();
    const usedEntityNames = new Set<string>();
    const usedConstantNames = new Set<string>();
    const usedSchemaConstantNames = new Map<string, string>();

    for (const table of schema.tables) {
        const baseEntityName =
            table.schema === "dbo"
                ? toPascalIdentifier(table.name)
                : `${toPascalIdentifier(table.schema)}${toPascalIdentifier(table.name)}`;
        const entityName = createUniqueName(baseEntityName, usedEntityNames, "Entity");
        const constantName = createUniqueName(
            toCamelIdentifier(entityName),
            usedConstantNames,
            "entity",
        );
        const schemaConstantName = ensureSchemaConstantName(
            table.schema,
            usedSchemaConstantNames,
            usedConstantNames,
        );
        const usedColumnNames = new Set<string>();
        const columnNamesById = new Map<string, string>();

        for (const column of table.columns) {
            columnNamesById.set(
                column.id,
                createUniqueName(toCamelIdentifier(column.name), usedColumnNames, "column"),
            );
        }

        tableInfoById.set(table.id, {
            table,
            entityName,
            constantName,
            schemaConstantName,
            columnNamesById,
        });
    }

    const tableInfos = schema.tables
        .map((table) => tableInfoById.get(table.id))
        .filter((tableInfo): tableInfo is TableInfo => !!tableInfo);
    const incomingByTableId = new Map<string, IncomingRelation[]>();
    const sourceRelationNameByForeignKeyId = new Map<string, string>();
    const targetCollectionNameByForeignKeyId = new Map<string, string>();
    const relationNamesByTableId = new Map<string, Set<string>>();

    for (const tableInfo of tableInfos) {
        relationNamesByTableId.set(tableInfo.table.id, new Set(tableInfo.columnNamesById.values()));
    }

    for (const tableInfo of tableInfos) {
        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const sourceUsedNames = relationNamesByTableId.get(tableInfo.table.id)!;
            const targetUsedNames = relationNamesByTableId.get(targetInfo.table.id)!;
            const sourceRelationName = createUniqueName(
                toSingularCamelIdentifier(targetInfo.entityName),
                sourceUsedNames,
                "related",
            );
            const targetCollectionName = createUniqueName(
                `${toCamelIdentifier(tableInfo.entityName)}Collection`,
                targetUsedNames,
                "relatedCollection",
            );

            sourceRelationNameByForeignKeyId.set(foreignKey.id, sourceRelationName);
            targetCollectionNameByForeignKeyId.set(foreignKey.id, targetCollectionName);

            const incomingRelations = incomingByTableId.get(targetInfo.table.id) ?? [];
            incomingRelations.push({
                sourceInfo: tableInfo,
                foreignKey,
            });
            incomingByTableId.set(targetInfo.table.id, incomingRelations);
        }
    }

    return {
        tableInfos,
        tableInfoById,
        incomingByTableId,
        sourceRelationNameByForeignKeyId,
        targetCollectionNameByForeignKeyId,
    };
}

function ensureSchemaConstantName(
    schemaName: string,
    usedSchemaConstantNames: Map<string, string>,
    usedConstantNames: Set<string>,
): string {
    const existing = usedSchemaConstantNames.get(schemaName);
    if (existing) {
        return existing;
    }

    const schemaConstantName = createUniqueName(
        `${toCamelIdentifier(schemaName)}Schema`,
        usedConstantNames,
        "schemaRef",
    );
    usedSchemaConstantNames.set(schemaName, schemaConstantName);
    return schemaConstantName;
}

function generatePrismaDefinition(codeModel: CodeModel): string {
    const lines = [
        "generator client {",
        '  provider = "prisma-client-js"',
        "}",
        "",
        "datasource db {",
        '  provider = "sqlserver"',
        '  url      = env("DATABASE_URL")',
        "}",
        "",
    ];

    for (const tableInfo of codeModel.tableInfos) {
        const primaryKeyColumns = tableInfo.table.columns.filter((column) => column.isPrimaryKey);

        lines.push(`model ${tableInfo.entityName} {`);
        for (const column of tableInfo.table.columns) {
            const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";
            const columnAttributes = buildPrismaColumnAttributes(
                tableInfo,
                column,
                primaryKeyColumns.length,
            );
            const typeName = mapToPrismaType(column);
            const optionalSuffix = column.isNullable && !column.isPrimaryKey ? "?" : "";
            lines.push(
                `  ${propertyName} ${typeName}${optionalSuffix}${columnAttributes ? ` ${columnAttributes}` : ""}`,
            );
        }

        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const sourceColumnNames = foreignKey.columnsIds
                .map((columnId) => tableInfo.columnNamesById.get(columnId))
                .filter((name): name is string => !!name);
            const targetColumnNames = foreignKey.referencedColumnsIds
                .map((columnId) => targetInfo.columnNamesById.get(columnId))
                .filter((name): name is string => !!name);

            if (
                !sourceColumnNames.length ||
                sourceColumnNames.length !== targetColumnNames.length
            ) {
                continue;
            }

            const relationName =
                foreignKey.name || `${tableInfo.entityName}${targetInfo.entityName}Relation`;
            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related";
            const isOptional = foreignKey.columnsIds.some((columnId) => {
                const column = tableInfo.table.columns.find(
                    (candidate) => candidate.id === columnId,
                );
                return column?.isNullable;
            });

            lines.push(
                `  ${relationPropertyName} ${targetInfo.entityName}${isOptional ? "?" : ""} @relation(${quoteString(
                    relationName,
                )}, fields: [${sourceColumnNames.join(", ")}], references: [${targetColumnNames.join(
                    ", ",
                )}], onDelete: ${mapOnActionToPrisma(
                    foreignKey.onDeleteAction,
                )}, onUpdate: ${mapOnActionToPrisma(foreignKey.onUpdateAction)})`,
            );
        }

        for (const incomingRelation of codeModel.incomingByTableId.get(tableInfo.table.id) ?? []) {
            const relationName =
                incomingRelation.foreignKey.name ||
                `${incomingRelation.sourceInfo.entityName}${tableInfo.entityName}Relation`;
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "relatedCollection";
            lines.push(
                `  ${collectionPropertyName} ${incomingRelation.sourceInfo.entityName}[] @relation(${quoteString(
                    relationName,
                )})`,
            );
        }

        if (primaryKeyColumns.length > 1) {
            const primaryKeyFieldNames = primaryKeyColumns
                .map((column) => tableInfo.columnNamesById.get(column.id))
                .filter((name): name is string => !!name);
            lines.push(`  @@id([${primaryKeyFieldNames.join(", ")}])`);
        }

        lines.push(`  @@map(${quoteString(tableInfo.table.name)})`);
        lines.push(`  @@schema(${quoteString(tableInfo.table.schema)})`);
        lines.push("}");
        lines.push("");
    }

    return lines.join("\n").trim();
}

function buildPrismaColumnAttributes(
    tableInfo: TableInfo,
    column: SchemaDesigner.Column,
    primaryKeyCount: number,
): string {
    const attributes: string[] = [];
    const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";

    if (column.isPrimaryKey && primaryKeyCount === 1) {
        attributes.push("@id");
    }
    if (column.isIdentity && isPrismaAutoincrementCompatible(column)) {
        attributes.push("@default(autoincrement())");
    } else if (column.defaultValue) {
        attributes.push(`@default(dbgenerated(${quoteString(column.defaultValue)}))`);
    }
    if (propertyName !== column.name) {
        attributes.push(`@map(${quoteString(column.name)})`);
    }

    return attributes.join(" ");
}

function generateSequelizeDefinition(codeModel: CodeModel): string {
    const lines = [
        'import { DataTypes, Sequelize } from "sequelize";',
        "",
        "export function initializeModels(sequelize: Sequelize) {",
    ];

    for (const tableInfo of codeModel.tableInfos) {
        lines.push(
            `  const ${tableInfo.entityName} = sequelize.define(${quoteString(tableInfo.entityName)}, {`,
        );
        for (const column of tableInfo.table.columns) {
            const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";
            lines.push(`    ${propertyName}: {`);
            lines.push(`      type: ${mapToSequelizeDataType(column)},`);
            lines.push(`      allowNull: ${column.isNullable.toString()},`);
            if (column.isPrimaryKey) {
                lines.push("      primaryKey: true,");
            }
            if (column.isIdentity) {
                lines.push("      autoIncrement: true,");
            }
            lines.push(`      field: ${quoteString(column.name)},`);
            lines.push("    },");
        }
        lines.push(
            `  }, { tableName: ${quoteString(tableInfo.table.name)}, schema: ${quoteString(tableInfo.table.schema)}, timestamps: false });`,
        );
        lines.push("");
    }

    for (const tableInfo of codeModel.tableInfos) {
        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const sourcePropertyName =
                tableInfo.columnNamesById.get(foreignKey.columnsIds[0] ?? "") ?? "foreignKey";
            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related";
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(foreignKey.id) ??
                "relatedCollection";

            lines.push(
                `  ${tableInfo.entityName}.belongsTo(${targetInfo.entityName}, { foreignKey: ${quoteString(
                    sourcePropertyName,
                )}, as: ${quoteString(relationPropertyName)} });`,
            );
            lines.push(
                `  ${targetInfo.entityName}.hasMany(${tableInfo.entityName}, { foreignKey: ${quoteString(
                    sourcePropertyName,
                )}, as: ${quoteString(collectionPropertyName)} });`,
            );
        }
    }

    lines.push("");
    lines.push("  return {");
    for (const tableInfo of codeModel.tableInfos) {
        lines.push(`    ${tableInfo.entityName},`);
    }
    lines.push("  };");
    lines.push("}");

    return lines.join("\n");
}

function generateTypeOrmDefinition(codeModel: CodeModel): string {
    const lines = [
        'import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";',
        "",
    ];

    for (const tableInfo of codeModel.tableInfos) {
        const primaryKeyCount = tableInfo.table.columns.filter(
            (column) => column.isPrimaryKey,
        ).length;
        lines.push(
            `@Entity({ name: ${quoteString(tableInfo.table.name)}, schema: ${quoteString(tableInfo.table.schema)} })`,
        );
        lines.push(`export class ${tableInfo.entityName} {`);

        for (const column of tableInfo.table.columns) {
            const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";
            const columnType = buildTypeOrmColumnOptions(column);
            const propertyType = mapToTypeScriptType(column, true);

            if (column.isPrimaryKey && column.isIdentity && primaryKeyCount === 1) {
                lines.push(`  @PrimaryGeneratedColumn(${columnType})`);
            } else if (column.isPrimaryKey) {
                lines.push(`  @PrimaryColumn(${columnType})`);
            } else {
                lines.push(`  @Column(${columnType})`);
            }

            if (column.isNullable) {
                lines.push(`  ${propertyName}?: ${propertyType};`);
            } else {
                lines.push(`  ${propertyName}!: ${propertyType};`);
            }
            lines.push("");
        }

        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related";
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(foreignKey.id) ??
                "relatedCollection";
            const isNullable = foreignKey.columnsIds.some((columnId) => {
                const column = tableInfo.table.columns.find(
                    (candidate) => candidate.id === columnId,
                );
                return column?.isNullable;
            });
            const joinColumns = foreignKey.columnsIds
                .map((columnId, index) => {
                    const sourceName = tableInfo.columnNamesById.get(columnId);
                    const referencedName = targetInfo.columnNamesById.get(
                        foreignKey.referencedColumnsIds[index] ?? "",
                    );
                    const sourceColumn = tableInfo.table.columns.find(
                        (candidate) => candidate.id === columnId,
                    );
                    return sourceName && referencedName && sourceColumn
                        ? `{ name: ${quoteString(sourceColumn.name)}, referencedColumnName: ${quoteString(
                              referencedName,
                          )} }`
                        : undefined;
                })
                .filter((value): value is string => !!value);

            lines.push(
                `  @ManyToOne(() => ${targetInfo.entityName}, (${toCamelIdentifier(
                    targetInfo.entityName,
                )}) => ${toCamelIdentifier(targetInfo.entityName)}.${collectionPropertyName}, { nullable: ${isNullable.toString()}, onDelete: ${quoteString(
                    mapOnActionToTypeOrm(foreignKey.onDeleteAction),
                )}, onUpdate: ${quoteString(mapOnActionToTypeOrm(foreignKey.onUpdateAction))} })`,
            );
            lines.push(`  @JoinColumn([${joinColumns.join(", ")}])`);
            lines.push(
                `  ${relationPropertyName}${isNullable ? "?" : "!"}: ${targetInfo.entityName}${
                    isNullable ? " | null" : ""
                };`,
            );
            lines.push("");
        }

        for (const incomingRelation of codeModel.incomingByTableId.get(tableInfo.table.id) ?? []) {
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "relatedCollection";
            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "related";
            lines.push(
                `  @OneToMany(() => ${incomingRelation.sourceInfo.entityName}, (${incomingRelation.sourceInfo.constantName}) => ${incomingRelation.sourceInfo.constantName}.${relationPropertyName})`,
            );
            lines.push(
                `  ${collectionPropertyName}!: ${incomingRelation.sourceInfo.entityName}[];`,
            );
            lines.push("");
        }

        lines.push("}");
        lines.push("");
    }

    return lines.join("\n").trim();
}

function generateDrizzleDefinition(codeModel: CodeModel): string {
    const lines = [
        "// Drizzle ORM does not currently offer first-class SQL Server support. This scaffold uses pg-core syntax as a starting point.",
        'import { relations } from "drizzle-orm";',
        'import { bigint, boolean, bytea, date, decimal, doublePrecision, integer, jsonb, pgSchema, real, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";',
        "",
    ];

    for (const schemaName of new Set(
        codeModel.tableInfos.map((tableInfo) => tableInfo.table.schema),
    )) {
        const schemaConstantName = codeModel.tableInfos.find(
            (tableInfo) => tableInfo.table.schema === schemaName,
        )?.schemaConstantName;
        if (schemaConstantName) {
            lines.push(`const ${schemaConstantName} = pgSchema(${quoteString(schemaName)});`);
        }
    }

    lines.push("");

    for (const tableInfo of codeModel.tableInfos) {
        lines.push(
            `export const ${tableInfo.constantName} = ${tableInfo.schemaConstantName}.table(${quoteString(tableInfo.table.name)}, {`,
        );
        for (const column of tableInfo.table.columns) {
            const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";
            lines.push(`  ${propertyName}: ${buildDrizzleColumnDefinition(column)},`);
        }
        lines.push("});");
        lines.push("");
    }

    for (const tableInfo of codeModel.tableInfos) {
        lines.push(
            `export const ${tableInfo.constantName}Relations = relations(${tableInfo.constantName}, ({ one, many }) => ({`,
        );
        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related";
            const sourceColumns = foreignKey.columnsIds
                .map((columnId) => tableInfo.columnNamesById.get(columnId))
                .filter((name): name is string => !!name)
                .map((name) => `${tableInfo.constantName}.${name}`);
            const targetColumns = foreignKey.referencedColumnsIds
                .map((columnId) => targetInfo.columnNamesById.get(columnId))
                .filter((name): name is string => !!name)
                .map((name) => `${targetInfo.constantName}.${name}`);
            lines.push(
                `  ${relationPropertyName}: one(${targetInfo.constantName}, { fields: [${sourceColumns.join(", ")}], references: [${targetColumns.join(
                    ", ",
                )}] }),`,
            );
        }
        for (const incomingRelation of codeModel.incomingByTableId.get(tableInfo.table.id) ?? []) {
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "relatedCollection";
            lines.push(
                `  ${collectionPropertyName}: many(${incomingRelation.sourceInfo.constantName}),`,
            );
        }
        lines.push("}));");
        lines.push("");
    }

    return lines.join("\n").trim();
}

function generateSqlAlchemyDefinition(codeModel: CodeModel): string {
    const lines = [
        "from __future__ import annotations",
        "",
        "from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, Time, Uuid",
        "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship",
        "",
        "",
        "class Base(DeclarativeBase):",
        "    pass",
        "",
    ];

    for (const tableInfo of codeModel.tableInfos) {
        lines.push(`class ${tableInfo.entityName}(Base):`);
        lines.push(`    __tablename__ = ${quoteString(tableInfo.table.name)}`);
        lines.push(`    __table_args__ = {"schema": ${quoteString(tableInfo.table.schema)}}`);
        lines.push("");

        for (const column of tableInfo.table.columns) {
            const propertyName = tableInfo.columnNamesById.get(column.id) ?? "column";
            lines.push(
                `    ${propertyName}: Mapped[${mapToPythonType(column)}] = mapped_column(${buildSqlAlchemyColumnDefinition(
                    column,
                )})`,
            );
        }

        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related";
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(foreignKey.id) ??
                "relatedCollection";
            const isNullable = foreignKey.columnsIds.some((columnId) => {
                const column = tableInfo.table.columns.find(
                    (candidate) => candidate.id === columnId,
                );
                return column?.isNullable;
            });
            lines.push(
                `    ${relationPropertyName}: Mapped["${targetInfo.entityName}${
                    isNullable ? " | None" : ""
                }"] = relationship(back_populates=${quoteString(collectionPropertyName)})`,
            );
        }

        for (const incomingRelation of codeModel.incomingByTableId.get(tableInfo.table.id) ?? []) {
            const collectionPropertyName =
                codeModel.targetCollectionNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "relatedCollection";
            const relationPropertyName =
                codeModel.sourceRelationNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                "related";
            lines.push(
                `    ${collectionPropertyName}: Mapped[list["${incomingRelation.sourceInfo.entityName}"]] = relationship(back_populates=${quoteString(
                    relationPropertyName,
                )})`,
            );
        }

        lines.push("");
    }

    return lines.join("\n").trim();
}

function generateEfCoreDefinition(codeModel: CodeModel): string {
    const lines = [
        "#nullable enable",
        "",
        "using System.Collections.Generic;",
        "using System.ComponentModel.DataAnnotations;",
        "using System.ComponentModel.DataAnnotations.Schema;",
        "",
        "namespace SchemaDesigner.Models;",
        "",
    ];

    for (const tableInfo of codeModel.tableInfos) {
        lines.push(
            `[Table(${quoteString(tableInfo.table.name)}, Schema = ${quoteString(tableInfo.table.schema)})]`,
        );
        lines.push(`public partial class ${tableInfo.entityName}`);
        lines.push("{");

        for (const column of tableInfo.table.columns) {
            const propertyName = toPascalIdentifier(
                tableInfo.columnNamesById.get(column.id) ?? column.name,
            );
            if (column.isPrimaryKey) {
                lines.push("    [Key]");
            }
            if (column.isIdentity) {
                lines.push("    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]");
            }
            lines.push(
                `    [Column(${quoteString(column.name)}, TypeName = ${quoteString(
                    getSqlTypeDisplay(column),
                )})]`,
            );
            lines.push(
                `    public ${mapToCSharpType(column)} ${propertyName} { get; set; }${getCSharpInitializer(column)}`,
            );
            lines.push("");
        }

        for (const foreignKey of tableInfo.table.foreignKeys) {
            const targetInfo = codeModel.tableInfoById.get(foreignKey.referencedTableId);
            if (!targetInfo) {
                continue;
            }

            const relationPropertyName = toPascalIdentifier(
                codeModel.sourceRelationNameByForeignKeyId.get(foreignKey.id) ?? "related",
            );
            const collectionPropertyName = toPascalIdentifier(
                codeModel.targetCollectionNameByForeignKeyId.get(foreignKey.id) ??
                    "relatedCollection",
            );
            const foreignKeyProperty = toPascalIdentifier(
                tableInfo.columnNamesById.get(foreignKey.columnsIds[0] ?? "") ?? "foreignKey",
            );
            const isNullable = foreignKey.columnsIds.some((columnId) => {
                const column = tableInfo.table.columns.find(
                    (candidate) => candidate.id === columnId,
                );
                return column?.isNullable;
            });

            lines.push(`    [ForeignKey(nameof(${foreignKeyProperty}))]`);
            lines.push(
                `    [InverseProperty(nameof(${targetInfo.entityName}.${collectionPropertyName}))]`,
            );
            lines.push(
                `    public virtual ${targetInfo.entityName}${isNullable ? "?" : ""} ${relationPropertyName} { get; set; }${
                    isNullable ? "" : " = null!;"
                }`,
            );
            lines.push("");
        }

        for (const incomingRelation of codeModel.incomingByTableId.get(tableInfo.table.id) ?? []) {
            const collectionPropertyName = toPascalIdentifier(
                codeModel.targetCollectionNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                    "relatedCollection",
            );
            const relationPropertyName = toPascalIdentifier(
                codeModel.sourceRelationNameByForeignKeyId.get(incomingRelation.foreignKey.id) ??
                    "related",
            );
            lines.push(
                `    [InverseProperty(nameof(${incomingRelation.sourceInfo.entityName}.${relationPropertyName}))]`,
            );
            lines.push(
                `    public virtual ICollection<${incomingRelation.sourceInfo.entityName}> ${collectionPropertyName} { get; set; } = new List<${incomingRelation.sourceInfo.entityName}>();`,
            );
            lines.push("");
        }

        lines.push("}");
        lines.push("");
    }

    return lines.join("\n").trim();
}

function buildTypeOrmColumnOptions(column: SchemaDesigner.Column): string {
    const options = [
        `type: ${quoteString(normalizeDataType(column.dataType))}`,
        `name: ${quoteString(column.name)}`,
    ];

    if (column.maxLength) {
        options.push(`length: ${quoteString(column.maxLength)}`);
    }
    if (column.precision > 0) {
        options.push(`precision: ${column.precision}`);
    }
    if (column.scale > 0) {
        options.push(`scale: ${column.scale}`);
    }
    if (column.isNullable) {
        options.push("nullable: true");
    }
    if (column.defaultValue) {
        options.push(`default: () => ${quoteString(column.defaultValue)}`);
    }

    return `{ ${options.join(", ")} }`;
}

function buildDrizzleColumnDefinition(column: SchemaDesigner.Column): string {
    const baseType = normalizeDataType(column.dataType);
    let columnDefinition: string;

    switch (baseType) {
        case "bigint":
            columnDefinition = `bigint(${quoteString(column.name)}, { mode: "number" })`;
            break;
        case "bit":
            columnDefinition = `boolean(${quoteString(column.name)})`;
            break;
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            columnDefinition = `bytea(${quoteString(column.name)})`;
            break;
        case "date":
            columnDefinition = `date(${quoteString(column.name)})`;
            break;
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            columnDefinition = `timestamp(${quoteString(column.name)})`;
            break;
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            columnDefinition = `decimal(${quoteString(column.name)}, { precision: ${Math.max(
                column.precision || 18,
                1,
            )}, scale: ${Math.max(column.scale, 0)} })`;
            break;
        case "float":
            columnDefinition = `doublePrecision(${quoteString(column.name)})`;
            break;
        case "real":
            columnDefinition = `real(${quoteString(column.name)})`;
            break;
        case "json":
            columnDefinition = `jsonb(${quoteString(column.name)})`;
            break;
        case "uniqueidentifier":
            columnDefinition = `uuid(${quoteString(column.name)})`;
            break;
        case "char":
        case "nchar":
        case "varchar":
        case "nvarchar":
        case "sysname":
            columnDefinition = `varchar(${quoteString(column.name)}, { length: ${quoteString(
                column.maxLength || "255",
            )} })`;
            break;
        case "int":
        case "smallint":
        case "tinyint":
            columnDefinition = `integer(${quoteString(column.name)})`;
            break;
        case "xml":
        case "ntext":
        case "text":
        case "time":
        default:
            columnDefinition = `text(${quoteString(column.name)})`;
            break;
    }

    if (!column.isNullable) {
        columnDefinition += ".notNull()";
    }
    if (column.isPrimaryKey) {
        columnDefinition += ".primaryKey()";
    }
    if (column.isIdentity) {
        columnDefinition += ".generatedByDefaultAsIdentity()";
    }

    return columnDefinition;
}

function buildSqlAlchemyColumnDefinition(column: SchemaDesigner.Column): string {
    const pieces = [quoteString(column.name), mapToSqlAlchemySqlType(column)];

    if (column.isPrimaryKey) {
        pieces.push("primary_key=True");
    }
    if (column.isIdentity) {
        pieces.push("autoincrement=True");
    }
    if (column.isNullable) {
        pieces.push("nullable=True");
    }

    return pieces.join(", ");
}

function mapToPrismaType(column: SchemaDesigner.Column): string {
    switch (normalizeDataType(column.dataType)) {
        case "int":
        case "smallint":
        case "tinyint":
            return "Int";
        case "bigint":
            return "BigInt";
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            return "Decimal";
        case "float":
        case "real":
            return "Float";
        case "bit":
            return "Boolean";
        case "date":
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "DateTime";
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            return "Bytes";
        case "json":
            return "Json";
        default:
            return "String";
    }
}

function mapToSequelizeDataType(column: SchemaDesigner.Column): string {
    switch (normalizeDataType(column.dataType)) {
        case "bigint":
            return "DataTypes.BIGINT";
        case "bit":
            return "DataTypes.BOOLEAN";
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            return "DataTypes.BLOB";
        case "date":
            return "DataTypes.DATEONLY";
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "DataTypes.DATE";
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            return `DataTypes.DECIMAL(${Math.max(column.precision || 18, 1)}, ${Math.max(
                column.scale,
                0,
            )})`;
        case "float":
            return "DataTypes.DOUBLE";
        case "real":
            return "DataTypes.FLOAT";
        case "json":
            return "DataTypes.JSON";
        case "int":
        case "smallint":
        case "tinyint":
            return "DataTypes.INTEGER";
        case "char":
        case "nchar":
        case "varchar":
        case "nvarchar":
        case "sysname":
            return column.maxLength
                ? `DataTypes.STRING(${quoteString(column.maxLength)})`
                : "DataTypes.STRING";
        case "ntext":
        case "text":
        case "xml":
            return "DataTypes.TEXT";
        case "uniqueidentifier":
            return "DataTypes.UUID";
        default:
            return "DataTypes.STRING";
    }
}

function mapToSqlAlchemySqlType(column: SchemaDesigner.Column): string {
    switch (normalizeDataType(column.dataType)) {
        case "bigint":
        case "int":
        case "smallint":
        case "tinyint":
            return "Integer";
        case "bit":
            return "Boolean";
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            return "LargeBinary";
        case "date":
            return "Date";
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "DateTime";
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            return `Numeric(${Math.max(column.precision || 18, 1)}, ${Math.max(column.scale, 0)})`;
        case "time":
            return "Time";
        case "uniqueidentifier":
            return "Uuid";
        case "char":
        case "nchar":
        case "varchar":
        case "nvarchar":
        case "sysname":
            return column.maxLength ? `String(${column.maxLength})` : "String";
        case "ntext":
        case "text":
        case "xml":
            return "Text";
        default:
            return "String";
    }
}

function mapToTypeScriptType(column: SchemaDesigner.Column, includeNull: boolean): string {
    let baseType: string;

    switch (normalizeDataType(column.dataType)) {
        case "int":
        case "smallint":
        case "tinyint":
        case "bigint":
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
        case "float":
        case "real":
            baseType = "number";
            break;
        case "bit":
            baseType = "boolean";
            break;
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            baseType = "Buffer";
            break;
        case "date":
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            baseType = "Date";
            break;
        default:
            baseType = "string";
            break;
    }

    return includeNull && column.isNullable ? `${baseType} | null` : baseType;
}

function mapToPythonType(column: SchemaDesigner.Column): string {
    let baseType: string;

    switch (normalizeDataType(column.dataType)) {
        case "int":
        case "smallint":
        case "tinyint":
        case "bigint":
            baseType = "int";
            break;
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
        case "float":
        case "real":
            baseType = "float";
            break;
        case "bit":
            baseType = "bool";
            break;
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            baseType = "bytes";
            break;
        default:
            baseType = "str";
            break;
    }

    return column.isNullable ? `${baseType} | None` : baseType;
}

function mapToCSharpType(column: SchemaDesigner.Column): string {
    const typeName = normalizeDataType(column.dataType);

    switch (typeName) {
        case "int":
            return column.isNullable ? "int?" : "int";
        case "smallint":
            return column.isNullable ? "short?" : "short";
        case "tinyint":
            return column.isNullable ? "byte?" : "byte";
        case "bigint":
            return column.isNullable ? "long?" : "long";
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            return column.isNullable ? "decimal?" : "decimal";
        case "float":
            return column.isNullable ? "double?" : "double";
        case "real":
            return column.isNullable ? "float?" : "float";
        case "bit":
            return column.isNullable ? "bool?" : "bool";
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            return "byte[]";
        case "date":
        case "datetime":
        case "datetime2":
        case "smalldatetime":
            return column.isNullable ? "DateTime?" : "DateTime";
        case "datetimeoffset":
            return column.isNullable ? "DateTimeOffset?" : "DateTimeOffset";
        case "time":
            return column.isNullable ? "TimeSpan?" : "TimeSpan";
        case "uniqueidentifier":
            return column.isNullable ? "Guid?" : "Guid";
        default:
            return column.isNullable ? "string?" : "string";
    }
}

function getCSharpInitializer(column: SchemaDesigner.Column): string {
    const typeName = normalizeDataType(column.dataType);
    if (column.isNullable) {
        return "";
    }

    switch (typeName) {
        case "char":
        case "nchar":
        case "varchar":
        case "nvarchar":
        case "ntext":
        case "text":
        case "xml":
        case "sysname":
            return " = null!;";
        case "binary":
        case "varbinary":
        case "image":
        case "rowversion":
        case "timestamp":
            return " = null!;";
        default:
            return "";
    }
}

function getSqlTypeDisplay(column: SchemaDesigner.Column): string {
    const typeName = normalizeDataType(column.dataType);
    if (column.maxLength) {
        return `${typeName}(${column.maxLength})`;
    }
    if (column.precision > 0) {
        return `${typeName}(${column.precision},${Math.max(column.scale, 0)})`;
    }

    return typeName;
}

function mapOnActionToPrisma(action: SchemaDesigner.OnAction): string {
    switch (action) {
        case SchemaDesigner.OnAction.CASCADE:
            return "Cascade";
        case SchemaDesigner.OnAction.SET_NULL:
            return "SetNull";
        case SchemaDesigner.OnAction.SET_DEFAULT:
            return "SetDefault";
        case SchemaDesigner.OnAction.NO_ACTION:
        default:
            return "NoAction";
    }
}

function mapOnActionToTypeOrm(action: SchemaDesigner.OnAction): string {
    switch (action) {
        case SchemaDesigner.OnAction.CASCADE:
            return "CASCADE";
        case SchemaDesigner.OnAction.SET_NULL:
            return "SET NULL";
        case SchemaDesigner.OnAction.SET_DEFAULT:
            return "SET DEFAULT";
        case SchemaDesigner.OnAction.NO_ACTION:
        default:
            return "NO ACTION";
    }
}

function isPrismaAutoincrementCompatible(column: SchemaDesigner.Column): boolean {
    switch (normalizeDataType(column.dataType)) {
        case "int":
        case "bigint":
            return true;
        default:
            return false;
    }
}

function normalizeDataType(dataType: string | null | undefined): string {
    const normalizedType = dataType?.trim().toLowerCase();
    return normalizedType || "nvarchar";
}

function createUniqueName(baseName: string, usedNames: Set<string>, fallback: string): string {
    let normalizedName = sanitizeIdentifier(baseName) || fallback;
    if (!normalizedName) {
        normalizedName = fallback;
    }

    let candidate = normalizedName;
    let suffix = 2;
    while (usedNames.has(candidate)) {
        candidate = `${normalizedName}${suffix++}`;
    }

    usedNames.add(candidate);
    return candidate;
}

function toPascalIdentifier(value: string): string {
    const parts = value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^a-zA-Z0-9]+/)
        .filter((part) => part.length > 0);

    return (
        parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("") ||
        "Generated"
    );
}

function toCamelIdentifier(value: string): string {
    const pascalIdentifier = toPascalIdentifier(value);
    return `${pascalIdentifier.charAt(0).toLowerCase()}${pascalIdentifier.slice(1)}`;
}

function toSingularCamelIdentifier(value: string): string {
    const camelIdentifier = toCamelIdentifier(value);
    if (camelIdentifier.endsWith("ies") && camelIdentifier.length > 3) {
        return `${camelIdentifier.slice(0, -3)}y`;
    }
    if (
        camelIdentifier.endsWith("s") &&
        !camelIdentifier.endsWith("ss") &&
        camelIdentifier.length > 1
    ) {
        return camelIdentifier.slice(0, -1);
    }

    return camelIdentifier;
}

function sanitizeIdentifier(value: string): string {
    const sanitizedValue = value.replace(/[^a-zA-Z0-9_]/g, "");
    if (!sanitizedValue) {
        return "";
    }

    return /^[0-9]/.test(sanitizedValue) ? `_${sanitizedValue}` : sanitizedValue;
}

function quoteString(value: string): string {
    return JSON.stringify(value);
}
