/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "./schemaDesigner";

export const SchemaDesignerDefinitionKind = SchemaDesigner.DefinitionKind;
export type SchemaDesignerDefinitionKind = SchemaDesigner.DefinitionKind;

export interface SchemaDesignerDefinitionOutput {
    text: string;
    language: string;
}

interface EnrichedForeignKey {
    foreignKey: SchemaDesigner.ForeignKey;
    sourceTable: SchemaDesigner.Table;
    targetTable: SchemaDesigner.Table;
    sourceColumns: SchemaDesigner.Column[];
    targetColumns: SchemaDesigner.Column[];
}

type IdentifierStyle = "camel" | "pascal" | "snake";

const SQL_TO_TYPESCRIPT: Record<string, string> = {
    bigint: "bigint",
    binary: "Buffer",
    bit: "boolean",
    char: "string",
    date: "Date",
    datetime: "Date",
    datetime2: "Date",
    datetimeoffset: "Date",
    decimal: "string",
    float: "number",
    image: "Buffer",
    int: "number",
    money: "string",
    nchar: "string",
    ntext: "string",
    numeric: "string",
    nvarchar: "string",
    real: "number",
    smalldatetime: "Date",
    smallint: "number",
    smallmoney: "string",
    text: "string",
    time: "string",
    tinyint: "number",
    uniqueidentifier: "string",
    varbinary: "Buffer",
    varchar: "string",
    xml: "string",
};

const SQL_TO_CSHARP: Record<string, string> = {
    bigint: "long",
    binary: "byte[]",
    bit: "bool",
    char: "string",
    date: "DateTime",
    datetime: "DateTime",
    datetime2: "DateTime",
    datetimeoffset: "DateTimeOffset",
    decimal: "decimal",
    float: "double",
    image: "byte[]",
    int: "int",
    money: "decimal",
    nchar: "string",
    ntext: "string",
    numeric: "decimal",
    nvarchar: "string",
    real: "float",
    smalldatetime: "DateTime",
    smallint: "short",
    smallmoney: "decimal",
    text: "string",
    time: "TimeSpan",
    tinyint: "byte",
    uniqueidentifier: "Guid",
    varbinary: "byte[]",
    varchar: "string",
    xml: "string",
};

const SQL_TO_PYTHON: Record<string, string> = {
    bigint: "int",
    binary: "bytes",
    bit: "bool",
    char: "str",
    date: "date",
    datetime: "datetime",
    datetime2: "datetime",
    datetimeoffset: "datetime",
    decimal: "Decimal",
    float: "float",
    image: "bytes",
    int: "int",
    money: "Decimal",
    nchar: "str",
    ntext: "str",
    numeric: "Decimal",
    nvarchar: "str",
    real: "float",
    smalldatetime: "datetime",
    smallint: "int",
    smallmoney: "Decimal",
    text: "str",
    time: "time",
    tinyint: "int",
    uniqueidentifier: "str",
    varbinary: "bytes",
    varchar: "str",
    xml: "str",
};

const TYPEORM_IMPORT_ORDER = [
    "Column",
    "Entity",
    "JoinColumn",
    "ManyToOne",
    "OneToMany",
    "PrimaryColumn",
    "PrimaryGeneratedColumn",
];

const SQLALCHEMY_IMPORT_ORDER = [
    "BigInteger",
    "Boolean",
    "Date",
    "DateTime",
    "Float",
    "ForeignKey",
    "ForeignKeyConstraint",
    "Integer",
    "LargeBinary",
    "Numeric",
    "String",
    "Text",
    "Unicode",
    "UnicodeText",
];

const SQLALCHEMY_ORM_IMPORT_ORDER = ["DeclarativeBase", "Mapped", "mapped_column", "relationship"];

const DATETIME_IMPORT_ORDER = ["date", "datetime", "time"];

function splitWords(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function toPascalCase(value: string): string {
    const words = splitWords(value);
    if (words.length === 0) {
        return "Item";
    }

    return words
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
        .join("");
}

function toCamelCase(value: string): string {
    const pascal = toPascalCase(value);
    return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

function toSnakeCase(value: string): string {
    const words = splitWords(value);
    if (words.length === 0) {
        return "item";
    }

    return words.map((word) => word.toLowerCase()).join("_");
}

function formatIdentifier(value: string, style: IdentifierStyle): string {
    switch (style) {
        case "pascal":
            return sanitizeIdentifier(toPascalCase(value));
        case "snake":
            return sanitizeIdentifier(toSnakeCase(value));
        case "camel":
        default:
            return sanitizeIdentifier(toCamelCase(value));
    }
}

function sanitizeIdentifier(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
    if (sanitized.length === 0) {
        return "field";
    }
    return /^\d/.test(sanitized) ? `_${sanitized}` : sanitized;
}

function quoteString(value: string): string {
    return JSON.stringify(value);
}

function quotePythonString(value: string): string {
    return quoteString(value);
}

function getUniqueIdentifier(value: string, style: IdentifierStyle, used: Set<string>): string {
    const base = formatIdentifier(value, style);
    let candidate = base;
    let suffix = 2;

    while (used.has(candidate)) {
        candidate = style === "snake" ? `${base}_${suffix}` : `${base}${suffix}`;
        suffix++;
    }

    used.add(candidate);
    return candidate;
}

function getTableNameMap(
    schema: SchemaDesigner.Schema,
    style: IdentifierStyle,
): Map<string, string> {
    const tableNameCounts = new Map<string, number>();
    const used = new Set<string>();
    const tableNames = new Map<string, string>();

    for (const table of schema.tables) {
        tableNameCounts.set(table.name, (tableNameCounts.get(table.name) ?? 0) + 1);
    }

    for (const table of schema.tables) {
        const baseName =
            (tableNameCounts.get(table.name) ?? 0) > 1
                ? `${table.schema} ${table.name}`
                : table.name;
        tableNames.set(table.id, getUniqueIdentifier(baseName, style, used));
    }

    return tableNames;
}

function getColumnNameMap(
    table: SchemaDesigner.Table,
    style: IdentifierStyle,
): Map<string, string> {
    const used = new Set<string>();
    const columnNames = new Map<string, string>();

    for (const column of table.columns) {
        columnNames.set(column.id, getUniqueIdentifier(column.name, style, used));
    }

    return columnNames;
}

function getSchemaColumnNameMaps(
    schema: SchemaDesigner.Schema,
    style: IdentifierStyle,
): Map<string, Map<string, string>> {
    return new Map(schema.tables.map((table) => [table.id, getColumnNameMap(table, style)]));
}

function getPrimaryKeyColumns(table: SchemaDesigner.Table): SchemaDesigner.Column[] {
    return table.columns.filter((column) => column.isPrimaryKey);
}

function pluralize(value: string): string {
    if (/s$/i.test(value)) {
        return value;
    }
    if (/[^aeiou]y$/i.test(value)) {
        return `${value.slice(0, -1)}ies`;
    }
    if (/(s|x|z|ch|sh)$/i.test(value)) {
        return `${value}es`;
    }
    return `${value}s`;
}

function findTable(
    schema: SchemaDesigner.Schema,
    tableId: string,
): SchemaDesigner.Table | undefined {
    return schema.tables.find((table) => table.id === tableId);
}

function findColumn(
    table: SchemaDesigner.Table,
    columnId: string,
): SchemaDesigner.Column | undefined {
    return table.columns.find((column) => column.id === columnId);
}

function getOutgoingForeignKeys(
    schema: SchemaDesigner.Schema,
    table: SchemaDesigner.Table,
): EnrichedForeignKey[] {
    return table.foreignKeys
        .map((foreignKey) => {
            const targetTable = findTable(schema, foreignKey.referencedTableId);
            if (!targetTable) {
                return undefined;
            }

            const sourceColumns = foreignKey.columnsIds
                .map((columnId) => findColumn(table, columnId))
                .filter((column): column is SchemaDesigner.Column => !!column);
            const targetColumns = foreignKey.referencedColumnsIds
                .map((columnId) => findColumn(targetTable, columnId))
                .filter((column): column is SchemaDesigner.Column => !!column);

            if (sourceColumns.length === 0 || targetColumns.length === 0) {
                return undefined;
            }

            return {
                foreignKey,
                sourceTable: table,
                targetTable,
                sourceColumns,
                targetColumns,
            };
        })
        .filter((foreignKey): foreignKey is EnrichedForeignKey => !!foreignKey);
}

function getIncomingForeignKeys(
    schema: SchemaDesigner.Schema,
    table: SchemaDesigner.Table,
): EnrichedForeignKey[] {
    return schema.tables.flatMap((candidate) =>
        getOutgoingForeignKeys(schema, candidate).filter(
            (foreignKey) => foreignKey.targetTable.id === table.id,
        ),
    );
}

function getForeignKeyKey(foreignKey: EnrichedForeignKey): string {
    return `${foreignKey.sourceTable.id}:${foreignKey.foreignKey.id}`;
}

function stripIdSuffix(value: string): string {
    return value.replace(/Id$/i, "");
}

function getOutgoingRelationBaseName(foreignKey: EnrichedForeignKey): string {
    const sourceColumnNames = foreignKey.sourceColumns
        .map((column) => stripIdSuffix(column.name))
        .filter((name) => name.length > 0);

    if (sourceColumnNames.length > 0) {
        return sourceColumnNames.join(" ");
    }

    return foreignKey.targetTable.name;
}

function hasAmbiguousInverseRelation(
    foreignKey: EnrichedForeignKey,
    incomingForeignKeys: EnrichedForeignKey[],
): boolean {
    return (
        incomingForeignKeys.filter(
            (candidate) => candidate.sourceTable.id === foreignKey.sourceTable.id,
        ).length > 1
    );
}

function getInverseRelationBaseName(
    foreignKey: EnrichedForeignKey,
    incomingForeignKeys: EnrichedForeignKey[],
): string {
    if (hasAmbiguousInverseRelation(foreignKey, incomingForeignKeys)) {
        return `${foreignKey.sourceTable.name} ${getOutgoingRelationBaseName(foreignKey)}`;
    }

    return foreignKey.sourceTable.name;
}

function getRelationNameMaps(
    schema: SchemaDesigner.Schema,
    style: IdentifierStyle,
    columnNamesByTable: Map<string, Map<string, string>>,
): {
    outgoing: Map<string, string>;
    incoming: Map<string, string>;
} {
    const outgoing = new Map<string, string>();
    const incoming = new Map<string, string>();
    const usedNamesByTable = new Map<string, Set<string>>();

    for (const table of schema.tables) {
        usedNamesByTable.set(table.id, new Set(columnNamesByTable.get(table.id)?.values() ?? []));
    }

    for (const table of schema.tables) {
        const usedNames = usedNamesByTable.get(table.id) ?? new Set<string>();

        for (const foreignKey of getOutgoingForeignKeys(schema, table)) {
            outgoing.set(
                getForeignKeyKey(foreignKey),
                getUniqueIdentifier(getOutgoingRelationBaseName(foreignKey), style, usedNames),
            );
        }
    }

    for (const table of schema.tables) {
        const usedNames = usedNamesByTable.get(table.id) ?? new Set<string>();
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);

        for (const foreignKey of incomingForeignKeys) {
            incoming.set(
                getForeignKeyKey(foreignKey),
                getUniqueIdentifier(
                    getInverseRelationBaseName(foreignKey, incomingForeignKeys),
                    style,
                    usedNames,
                ),
            );
        }
    }

    return { outgoing, incoming };
}

function getRelationName(
    foreignKey: EnrichedForeignKey,
    relationNames: Map<string, string>,
    style: IdentifierStyle,
): string {
    return (
        relationNames.get(getForeignKeyKey(foreignKey)) ??
        formatIdentifier(getOutgoingRelationBaseName(foreignKey), style)
    );
}

function getPrismaRelationName(foreignKey: EnrichedForeignKey): string {
    return (
        foreignKey.foreignKey.name ||
        `${foreignKey.sourceTable.name}_${foreignKey.targetTable.name}_${foreignKey.sourceColumns
            .map((column) => column.name)
            .join("_")}`
    );
}

function isCompositeForeignKey(foreignKey: EnrichedForeignKey): boolean {
    return foreignKey.sourceColumns.length > 1 || foreignKey.targetColumns.length > 1;
}

function hasCompleteForeignKeyMapping(foreignKey: EnrichedForeignKey): boolean {
    return (
        foreignKey.sourceColumns.length === foreignKey.foreignKey.columnsIds.length &&
        foreignKey.targetColumns.length === foreignKey.foreignKey.referencedColumnsIds.length &&
        foreignKey.sourceColumns.length === foreignKey.targetColumns.length
    );
}

function isNullableForeignKey(foreignKey: EnrichedForeignKey): boolean {
    return foreignKey.sourceColumns.some((column) => column.isNullable);
}

function getSqlType(column: SchemaDesigner.Column): string {
    const dataType = typeof column.dataType === "string" ? column.dataType.trim() : "";
    return dataType.length > 0 ? dataType.toLowerCase() : "nvarchar";
}

function getSqlLength(column: SchemaDesigner.Column, fallback: string): string {
    const length = typeof column.maxLength === "string" ? column.maxLength.trim() : "";
    return length.length > 0 ? length : fallback;
}

function requiresSystemNamespaceForCSharpType(typeName: string): boolean {
    switch (typeName) {
        case "DateTime":
        case "DateTimeOffset":
        case "Guid":
        case "TimeSpan":
            return true;
        default:
            return false;
    }
}

function isMaxLength(column: SchemaDesigner.Column): boolean {
    return getSqlLength(column, "").toUpperCase() === "MAX";
}

function getColumnName(
    table: SchemaDesigner.Table,
    column: SchemaDesigner.Column,
    columnNamesByTable: Map<string, Map<string, string>>,
    style: IdentifierStyle,
): string {
    return columnNamesByTable.get(table.id)?.get(column.id) ?? formatIdentifier(column.name, style);
}

function getTableName(
    table: SchemaDesigner.Table,
    tableNames: Map<string, string>,
    style: IdentifierStyle,
): string {
    return tableNames.get(table.id) ?? formatIdentifier(table.name, style);
}

function getPrismaDbType(column: SchemaDesigner.Column): string | undefined {
    const sqlType = getSqlType(column);
    switch (sqlType) {
        case "nvarchar":
            return `@db.NVarChar(${getSqlLength(column, "MAX")})`;
        case "varchar":
            return `@db.VarChar(${getSqlLength(column, "MAX")})`;
        case "nchar":
            return `@db.NChar(${getSqlLength(column, "1")})`;
        case "char":
            return `@db.Char(${getSqlLength(column, "1")})`;
        case "decimal":
        case "numeric":
            return `@db.Decimal(${column.precision || 18}, ${column.scale || 0})`;
        case "datetime2":
            return "@db.DateTime2";
        case "datetimeoffset":
            return "@db.DateTimeOffset";
        case "datetime":
            return "@db.DateTime";
        case "date":
            return "@db.Date";
        case "time":
            return "@db.Time";
        case "uniqueidentifier":
            return "@db.UniqueIdentifier";
        case "varbinary":
            return `@db.VarBinary(${getSqlLength(column, "MAX")})`;
        default:
            return undefined;
    }
}

function getPrismaScalarType(column: SchemaDesigner.Column): string {
    const sqlType = getSqlType(column);
    switch (sqlType) {
        case "bigint":
            return "BigInt";
        case "bit":
            return "Boolean";
        case "decimal":
        case "numeric":
        case "money":
        case "smallmoney":
            return "Decimal";
        case "float":
        case "real":
            return "Float";
        case "binary":
        case "varbinary":
        case "image":
            return "Bytes";
        case "date":
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "DateTime";
        case "tinyint":
        case "smallint":
        case "int":
            return "Int";
        default:
            return "String";
    }
}

function renderHeader(kind: SchemaDesignerDefinitionKind): string {
    const commentPrefix = kind === SchemaDesignerDefinitionKind.SqlAlchemy ? "#" : "//";
    const lines = [
        `${commentPrefix} Generated from SQL Server schema by the VS Code MSSQL extension.`,
        `${commentPrefix} Review names, defaults, relationships, and provider-specific options before applying this model.`,
    ];

    return `${lines.join("\n")}\n\n`;
}

function renderPrisma(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "pascal");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "camel");
    const relationNames = getRelationNameMaps(schema, "camel", columnNamesByTable);
    const schemas = [...new Set(schema.tables.map((table) => table.schema).filter(Boolean))];
    const lines: string[] = [
        "generator client {",
        '  provider = "prisma-client-js"',
        "}",
        "",
        "datasource db {",
        '  provider = "sqlserver"',
        '  url      = env("DATABASE_URL")',
        ...(schemas.length > 0
            ? [`  schemas  = [${schemas.map((schemaName) => quoteString(schemaName)).join(", ")}]`]
            : []),
        "}",
        "",
    ];

    for (const table of schema.tables) {
        const modelName = getTableName(table, tableNames, "pascal");
        const primaryKeys = getPrimaryKeyColumns(table);
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);

        lines.push(`model ${modelName} {`);

        for (const column of table.columns) {
            const fieldName = getColumnName(table, column, columnNamesByTable, "camel");
            const scalarType = getPrismaScalarType(column);
            const attributes: string[] = [];

            if (primaryKeys.length === 1 && column.isPrimaryKey) {
                attributes.push("@id");
            }

            if (column.isIdentity) {
                attributes.push("@default(autoincrement())");
            }

            const dbType = getPrismaDbType(column);
            if (dbType) {
                attributes.push(dbType);
            }

            if (fieldName !== column.name) {
                attributes.push(`@map(${quoteString(column.name)})`);
            }

            lines.push(
                `  ${fieldName} ${scalarType}${column.isNullable ? "?" : ""}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}`,
            );
        }

        for (const foreignKey of outgoingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.outgoing, "camel");
            const targetModel = getTableName(foreignKey.targetTable, tableNames, "pascal");
            const fieldNames = foreignKey.sourceColumns
                .map((column) => getColumnName(table, column, columnNamesByTable, "camel"))
                .join(", ");
            const referenceNames = foreignKey.targetColumns
                .map((column) =>
                    getColumnName(foreignKey.targetTable, column, columnNamesByTable, "camel"),
                )
                .join(", ");
            lines.push(
                `  ${relationName} ${targetModel}${isNullableForeignKey(foreignKey) ? "?" : ""} @relation(${quoteString(getPrismaRelationName(foreignKey))}, fields: [${fieldNames}], references: [${referenceNames}])`,
            );
        }

        for (const foreignKey of incomingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.incoming, "camel");
            const sourceModel = getTableName(foreignKey.sourceTable, tableNames, "pascal");
            lines.push(
                `  ${relationName} ${sourceModel}[] @relation(${quoteString(getPrismaRelationName(foreignKey))})`,
            );
        }

        if (primaryKeys.length > 1) {
            const keyFields = primaryKeys
                .map((column) => getColumnName(table, column, columnNamesByTable, "camel"))
                .join(", ");
            lines.push(`  @@id([${keyFields}])`);
        }

        lines.push(`  @@map(${quoteString(table.name)})`);
        if (table.schema) {
            lines.push(`  @@schema(${quoteString(table.schema)})`);
        }
        lines.push("}", "");
    }

    return renderHeader(SchemaDesignerDefinitionKind.Prisma) + lines.join("\n");
}

function getSequelizeDataType(column: SchemaDesigner.Column): string {
    const sqlType = getSqlType(column);
    switch (sqlType) {
        case "bigint":
            return "DataTypes.BIGINT";
        case "bit":
            return "DataTypes.BOOLEAN";
        case "char":
            return `DataTypes.CHAR(${getSqlLength(column, "1")})`;
        case "date":
            return "DataTypes.DATEONLY";
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "DataTypes.DATE";
        case "decimal":
        case "numeric":
            return `DataTypes.DECIMAL(${column.precision || 18}, ${column.scale || 0})`;
        case "float":
        case "real":
            return "DataTypes.FLOAT";
        case "int":
        case "smallint":
        case "tinyint":
            return "DataTypes.INTEGER";
        case "nchar":
            return `DataTypes.CHAR(${getSqlLength(column, "1")})`;
        case "nvarchar":
            return isMaxLength(column)
                ? "DataTypes.TEXT"
                : `DataTypes.STRING(${getSqlLength(column, "255")})`;
        case "varchar":
            return isMaxLength(column)
                ? "DataTypes.TEXT"
                : `DataTypes.STRING(${getSqlLength(column, "255")})`;
        case "text":
        case "ntext":
        case "xml":
            return "DataTypes.TEXT";
        case "uniqueidentifier":
            return "DataTypes.UUID";
        case "varbinary":
        case "binary":
        case "image":
            return "DataTypes.BLOB";
        default:
            return "DataTypes.STRING";
    }
}

function renderSequelize(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "pascal");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "camel");
    const relationNames = getRelationNameMaps(schema, "camel", columnNamesByTable);
    const lines: string[] = [
        'import { DataTypes, type Model, type ModelStatic, type Sequelize } from "sequelize";',
        "",
        "export function initModels(sequelize: Sequelize) {",
        "  const models: Record<string, ModelStatic<Model>> = {};",
        "",
    ];

    for (const table of schema.tables) {
        const modelName = getTableName(table, tableNames, "pascal");
        lines.push(`  models.${modelName} = sequelize.define(`);
        lines.push(`    ${quoteString(modelName)},`);
        lines.push("    {");
        for (const column of table.columns) {
            const fieldName = getColumnName(table, column, columnNamesByTable, "camel");
            lines.push(`      ${fieldName}: {`);
            lines.push(`        type: ${getSequelizeDataType(column)},`);
            lines.push(`        allowNull: ${column.isNullable ? "true" : "false"},`);
            lines.push(`        field: ${quoteString(column.name)},`);
            if (column.isPrimaryKey) {
                lines.push("        primaryKey: true,");
            }
            if (column.isIdentity) {
                lines.push("        autoIncrement: true,");
            }
            lines.push("      },");
        }
        lines.push("    },");
        lines.push("    {");
        lines.push(`      tableName: ${quoteString(table.name)},`);
        lines.push(`      schema: ${quoteString(table.schema)},`);
        lines.push("      timestamps: false,");
        lines.push("    },");
        lines.push("  );", "");
    }

    lines.push(
        "  return models;",
        "}",
        "",
        "export function associateModels(models: Record<string, ModelStatic<Model>>) {",
    );
    for (const table of schema.tables) {
        for (const foreignKey of getOutgoingForeignKeys(schema, table)) {
            if (!hasCompleteForeignKeyMapping(foreignKey) || isCompositeForeignKey(foreignKey)) {
                continue;
            }

            const sourceModel = getTableName(table, tableNames, "pascal");
            const targetModel = getTableName(foreignKey.targetTable, tableNames, "pascal");
            const relationName = getRelationName(foreignKey, relationNames.outgoing, "camel");
            const inverseName = getRelationName(foreignKey, relationNames.incoming, "camel");
            const foreignKeyField = getColumnName(
                table,
                foreignKey.sourceColumns[0],
                columnNamesByTable,
                "camel",
            );
            lines.push(
                `  models.${sourceModel}.belongsTo(models.${targetModel}, { as: ${quoteString(relationName)}, foreignKey: ${quoteString(foreignKeyField)} });`,
            );
            lines.push(
                `  models.${targetModel}.hasMany(models.${sourceModel}, { as: ${quoteString(inverseName)}, foreignKey: ${quoteString(foreignKeyField)} });`,
            );
        }
    }
    lines.push("}");

    return renderHeader(SchemaDesignerDefinitionKind.Sequelize) + lines.join("\n");
}

function renderTypeOrm(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "pascal");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "camel");
    const relationNames = getRelationNameMaps(schema, "camel", columnNamesByTable);
    const typeOrmImports = new Set<string>();

    if (schema.tables.length > 0) {
        typeOrmImports.add("Entity");
    }

    for (const table of schema.tables) {
        for (const column of table.columns) {
            if (column.isIdentity) {
                typeOrmImports.add("PrimaryGeneratedColumn");
            } else if (column.isPrimaryKey) {
                typeOrmImports.add("PrimaryColumn");
            } else {
                typeOrmImports.add("Column");
            }
        }

        for (const foreignKey of getOutgoingForeignKeys(schema, table)) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            typeOrmImports.add("ManyToOne");
            typeOrmImports.add("JoinColumn");
        }

        if (getIncomingForeignKeys(schema, table).some(hasCompleteForeignKeyMapping)) {
            typeOrmImports.add("OneToMany");
        }
    }

    const orderedTypeOrmImports = TYPEORM_IMPORT_ORDER.filter((item) => typeOrmImports.has(item));
    const lines: string[] =
        orderedTypeOrmImports.length > 0
            ? [`import { ${orderedTypeOrmImports.join(", ")} } from "typeorm";`, ""]
            : [];

    for (const table of schema.tables) {
        const className = getTableName(table, tableNames, "pascal");
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);
        lines.push(
            `@Entity({ name: ${quoteString(table.name)}, schema: ${quoteString(table.schema)} })`,
        );
        lines.push(`export class ${className} {`);

        for (const column of table.columns) {
            const propertyName = getColumnName(table, column, columnNamesByTable, "camel");
            const decorator = column.isIdentity
                ? "@PrimaryGeneratedColumn"
                : column.isPrimaryKey
                  ? "@PrimaryColumn"
                  : "@Column";
            const tsType = SQL_TO_TYPESCRIPT[getSqlType(column)] ?? "string";
            lines.push(
                `  ${decorator}({ name: ${quoteString(column.name)}, type: ${quoteString(getSqlType(column))}, nullable: ${column.isNullable ? "true" : "false"} })`,
            );
            lines.push(`  ${propertyName}${column.isNullable ? "?" : "!"}: ${tsType};`, "");
        }

        for (const foreignKey of outgoingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.outgoing, "camel");
            const targetClass = getTableName(foreignKey.targetTable, tableNames, "pascal");
            const inverseName = getRelationName(foreignKey, relationNames.incoming, "camel");
            const targetParameter = toCamelCase(targetClass);
            const joinColumns = foreignKey.sourceColumns
                .map((sourceColumn, index) => {
                    const targetColumn = foreignKey.targetColumns[index];
                    return `{ name: ${quoteString(sourceColumn.name)}, referencedColumnName: ${quoteString(
                        getColumnName(
                            foreignKey.targetTable,
                            targetColumn,
                            columnNamesByTable,
                            "camel",
                        ),
                    )} }`;
                })
                .join(", ");
            lines.push(
                `  @ManyToOne(() => ${targetClass}, (${targetParameter}) => ${targetParameter}.${inverseName})`,
            );
            lines.push(`  @JoinColumn([${joinColumns}])`);
            lines.push(
                `  ${relationName}${isNullableForeignKey(foreignKey) ? "?" : "!"}: ${targetClass};`,
                "",
            );
        }

        for (const foreignKey of incomingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.incoming, "camel");
            const sourceClass = getTableName(foreignKey.sourceTable, tableNames, "pascal");
            const sourceProperty = getRelationName(foreignKey, relationNames.outgoing, "camel");
            const sourceParameter = toCamelCase(sourceClass);
            lines.push(
                `  @OneToMany(() => ${sourceClass}, (${sourceParameter}) => ${sourceParameter}.${sourceProperty})`,
            );
            lines.push(`  ${relationName}!: ${sourceClass}[];`, "");
        }

        lines.push("}", "");
    }

    return renderHeader(SchemaDesignerDefinitionKind.TypeOrm) + lines.join("\n");
}

function getDrizzleLengthConfig(column: SchemaDesigner.Column): string {
    const length = getSqlLength(column, "");
    if (!length) {
        return "";
    }

    const formattedLength = length.toUpperCase() === "MAX" ? quoteString("max") : length;
    return `{ length: ${formattedLength} }`;
}

function getDrizzleColumnFunction(column: SchemaDesigner.Column): string {
    switch (getSqlType(column)) {
        case "bigint":
            return "bigint";
        case "binary":
            return "binary";
        case "bit":
            return "bit";
        case "char":
            return "char";
        case "date":
            return "date";
        case "datetime":
        case "datetime2":
        case "datetimeoffset":
        case "smalldatetime":
            return "datetime2";
        case "decimal":
        case "money":
        case "numeric":
        case "smallmoney":
            return "decimal";
        case "float":
            return "float";
        case "nchar":
            return "nchar";
        case "ntext":
        case "text":
        case "xml":
            return "text";
        case "real":
            return "real";
        case "smallint":
            return "smallint";
        case "time":
            return "time";
        case "tinyint":
            return "tinyint";
        case "uniqueidentifier":
            return "uniqueidentifier";
        case "varbinary":
        case "image":
            return "varbinary";
        case "varchar":
            return "varchar";
        case "int":
            return "int";
        case "nvarchar":
        default:
            return "nvarchar";
    }
}

function getDrizzleColumnBuilder(column: SchemaDesigner.Column): string {
    const name = quoteString(column.name);
    const lengthConfig = getDrizzleLengthConfig(column);
    const columnFunction = getDrizzleColumnFunction(column);

    if (columnFunction === "decimal") {
        return `decimal(${name}, { precision: ${column.precision || 18}, scale: ${
            column.scale || 0
        } })`;
    }

    return lengthConfig
        ? `${columnFunction}(${name}, ${lengthConfig})`
        : `${columnFunction}(${name})`;
}

function renderDrizzle(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "camel");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "camel");
    const schemaNames = new Map<string, string>();
    const usedSchemaNames = new Set<string>();
    const schemas = [...new Set(schema.tables.map((table) => table.schema).filter(Boolean))];
    const drizzleImports = new Set<string>();

    for (const schemaName of schemas) {
        schemaNames.set(
            schemaName,
            getUniqueIdentifier(`${schemaName}Schema`, "camel", usedSchemaNames),
        );
    }

    if (schemaNames.size > 0) {
        drizzleImports.add("mssqlSchema");
    }

    if (schema.tables.some((table) => !schemaNames.has(table.schema))) {
        drizzleImports.add("mssqlTable");
    }

    if (schema.tables.some((table) => getPrimaryKeyColumns(table).length > 1)) {
        drizzleImports.add("primaryKey");
    }

    for (const table of schema.tables) {
        for (const column of table.columns) {
            drizzleImports.add(getDrizzleColumnFunction(column));
        }
    }

    const lines: string[] =
        drizzleImports.size > 0
            ? [
                  `import { ${[...drizzleImports].sort().join(", ")} } from "drizzle-orm/mssql-core";`,
                  "",
              ]
            : [];

    for (const [schemaName, schemaVariableName] of schemaNames) {
        lines.push(`export const ${schemaVariableName} = mssqlSchema(${quoteString(schemaName)});`);
    }

    if (schemaNames.size > 0) {
        lines.push("");
    }

    for (const table of schema.tables) {
        const tableName = getTableName(table, tableNames, "camel");
        const primaryKeys = getPrimaryKeyColumns(table);
        const schemaVariableName = schemaNames.get(table.schema);
        const tableFactory = schemaVariableName ? `${schemaVariableName}.table` : "mssqlTable";
        lines.push(`export const ${tableName} = ${tableFactory}(${quoteString(table.name)}, {`);
        for (const column of table.columns) {
            const columnName = getColumnName(table, column, columnNamesByTable, "camel");
            const modifiers: string[] = [];
            if (!column.isNullable) {
                modifiers.push(".notNull()");
            }
            if (column.isPrimaryKey && primaryKeys.length === 1) {
                modifiers.push(".primaryKey()");
            }
            if (column.isIdentity) {
                modifiers.push(".identity()");
            }

            lines.push(`  ${columnName}: ${getDrizzleColumnBuilder(column)}${modifiers.join("")},`);
        }

        if (primaryKeys.length > 1) {
            const keyColumns = primaryKeys
                .map(
                    (column) =>
                        `table.${getColumnName(table, column, columnNamesByTable, "camel")}`,
                )
                .join(", ");
            lines.push(`}, (table) => [`);
            lines.push(`  primaryKey({ columns: [${keyColumns}] }),`);
            lines.push("]);", "");
        } else {
            lines.push("});", "");
        }
    }

    return renderHeader(SchemaDesignerDefinitionKind.Drizzle) + lines.join("\n");
}

function getSqlAlchemyType(column: SchemaDesigner.Column): string {
    const sqlType = getSqlType(column);
    switch (sqlType) {
        case "bigint":
            return "BigInteger";
        case "bit":
            return "Boolean";
        case "char":
        case "varchar":
            return isMaxLength(column) ? "Text" : `String(${getSqlLength(column, "255")})`;
        case "nchar":
        case "nvarchar":
            return isMaxLength(column) ? "UnicodeText" : `Unicode(${getSqlLength(column, "255")})`;
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
            return `Numeric(${column.precision || 18}, ${column.scale || 0})`;
        case "float":
        case "real":
            return "Float";
        case "int":
        case "smallint":
        case "tinyint":
            return "Integer";
        case "uniqueidentifier":
            return "String(36)";
        case "varbinary":
        case "binary":
        case "image":
            return "LargeBinary";
        default:
            return "Text";
    }
}

function renderSqlAlchemy(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "pascal");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "snake");
    const relationNames = getRelationNameMaps(schema, "snake", columnNamesByTable);
    const sqlalchemyImports = new Set<string>();
    const sqlalchemyOrmImports = new Set<string>(["DeclarativeBase", "Mapped", "mapped_column"]);
    const datetimeImports = new Set<string>();
    let usesDecimalImport = false;

    for (const table of schema.tables) {
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);

        for (const column of table.columns) {
            switch (getSqlType(column)) {
                case "bigint":
                    sqlalchemyImports.add("BigInteger");
                    break;
                case "bit":
                    sqlalchemyImports.add("Boolean");
                    break;
                case "char":
                case "varchar":
                    sqlalchemyImports.add(isMaxLength(column) ? "Text" : "String");
                    break;
                case "nchar":
                case "nvarchar":
                    sqlalchemyImports.add(isMaxLength(column) ? "UnicodeText" : "Unicode");
                    break;
                case "date":
                    sqlalchemyImports.add("Date");
                    datetimeImports.add("date");
                    break;
                case "datetime":
                case "datetime2":
                case "datetimeoffset":
                case "smalldatetime":
                    sqlalchemyImports.add("DateTime");
                    datetimeImports.add("datetime");
                    break;
                case "decimal":
                case "numeric":
                case "money":
                case "smallmoney":
                    sqlalchemyImports.add("Numeric");
                    usesDecimalImport = true;
                    break;
                case "float":
                case "real":
                    sqlalchemyImports.add("Float");
                    break;
                case "int":
                case "smallint":
                case "tinyint":
                    sqlalchemyImports.add("Integer");
                    break;
                case "time":
                    sqlalchemyImports.add("Text");
                    datetimeImports.add("time");
                    break;
                case "uniqueidentifier":
                    sqlalchemyImports.add("String");
                    break;
                case "varbinary":
                case "binary":
                case "image":
                    sqlalchemyImports.add("LargeBinary");
                    break;
                default:
                    sqlalchemyImports.add("Text");
                    break;
            }
        }

        if (
            outgoingForeignKeys.some(
                (foreignKey) =>
                    hasCompleteForeignKeyMapping(foreignKey) && !isCompositeForeignKey(foreignKey),
            )
        ) {
            sqlalchemyImports.add("ForeignKey");
        }

        if (
            outgoingForeignKeys.some(
                (foreignKey) =>
                    hasCompleteForeignKeyMapping(foreignKey) && isCompositeForeignKey(foreignKey),
            )
        ) {
            sqlalchemyImports.add("ForeignKeyConstraint");
        }

        if (
            outgoingForeignKeys.some(hasCompleteForeignKeyMapping) ||
            incomingForeignKeys.some(hasCompleteForeignKeyMapping)
        ) {
            sqlalchemyOrmImports.add("relationship");
        }
    }

    const lines: string[] = ["from __future__ import annotations", ""];
    const orderedDatetimeImports = DATETIME_IMPORT_ORDER.filter((item) =>
        datetimeImports.has(item),
    );
    if (orderedDatetimeImports.length > 0) {
        lines.push(`from datetime import ${orderedDatetimeImports.join(", ")}`, "");
    }
    if (usesDecimalImport) {
        lines.push("from decimal import Decimal", "");
    }

    const orderedSqlalchemyImports = SQLALCHEMY_IMPORT_ORDER.filter((item) =>
        sqlalchemyImports.has(item),
    );
    if (orderedSqlalchemyImports.length > 0) {
        lines.push(`from sqlalchemy import ${orderedSqlalchemyImports.join(", ")}`);
    }

    const orderedSqlalchemyOrmImports = SQLALCHEMY_ORM_IMPORT_ORDER.filter((item) =>
        sqlalchemyOrmImports.has(item),
    );
    lines.push(
        `from sqlalchemy.orm import ${orderedSqlalchemyOrmImports.join(", ")}`,
        "",
        "class Base(DeclarativeBase):",
        "    pass",
        "",
    );

    for (const table of schema.tables) {
        const className = getTableName(table, tableNames, "pascal");
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);
        const compositeForeignKeys = outgoingForeignKeys.filter(
            (foreignKey) =>
                hasCompleteForeignKeyMapping(foreignKey) && isCompositeForeignKey(foreignKey),
        );
        lines.push(`class ${className}(Base):`);
        lines.push(`    __tablename__ = ${quotePythonString(table.name)}`);
        if (compositeForeignKeys.length > 0) {
            lines.push("    __table_args__ = (");
            for (const foreignKey of compositeForeignKeys) {
                const sourceColumns = foreignKey.sourceColumns
                    .map((column) => quotePythonString(column.name))
                    .join(", ");
                const targetColumns = foreignKey.targetColumns
                    .map((column) =>
                        quotePythonString(
                            `${foreignKey.targetTable.schema}.${foreignKey.targetTable.name}.${column.name}`,
                        ),
                    )
                    .join(", ");
                lines.push(`        ForeignKeyConstraint([${sourceColumns}], [${targetColumns}]),`);
            }
            lines.push(`        {"schema": ${quotePythonString(table.schema)}},`);
            lines.push("    )");
        } else {
            lines.push(`    __table_args__ = {"schema": ${quotePythonString(table.schema)}}`);
        }
        lines.push("");

        for (const column of table.columns) {
            const propertyName = getColumnName(table, column, columnNamesByTable, "snake");
            const fk = outgoingForeignKeys.find(
                (candidate) =>
                    hasCompleteForeignKeyMapping(candidate) &&
                    !isCompositeForeignKey(candidate) &&
                    candidate.sourceColumns.some((sourceColumn) => sourceColumn.id === column.id),
            );
            const fkClause = fk
                ? `, ForeignKey(${quotePythonString(`${fk.targetTable.schema}.${fk.targetTable.name}.${fk.targetColumns[0].name}`)})`
                : "";
            const pkClause = column.isPrimaryKey ? ", primary_key=True" : "";
            const nullableClause = column.isNullable ? "" : ", nullable=False";
            const identityClause = column.isIdentity ? ", autoincrement=True" : "";
            const basePythonType = SQL_TO_PYTHON[getSqlType(column)] ?? "str";
            const pythonType = column.isNullable ? `${basePythonType} | None` : basePythonType;
            lines.push(
                `    ${propertyName}: Mapped[${pythonType}] = mapped_column(${getSqlAlchemyType(column)}${fkClause}${pkClause}${nullableClause}${identityClause})`,
            );
        }

        if (table.columns.length > 0) {
            lines.push("");
        }

        for (const foreignKey of outgoingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.outgoing, "snake");
            const targetClass = getTableName(foreignKey.targetTable, tableNames, "pascal");
            const inverseName = getRelationName(foreignKey, relationNames.incoming, "snake");
            lines.push(
                `    ${relationName}: Mapped[${targetClass}${isNullableForeignKey(foreignKey) ? " | None" : ""}] = relationship(back_populates=${quoteString(inverseName)})`,
            );
        }

        for (const foreignKey of incomingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.incoming, "snake");
            const sourceClass = getTableName(foreignKey.sourceTable, tableNames, "pascal");
            const sourceRelation = getRelationName(foreignKey, relationNames.outgoing, "snake");
            lines.push(
                `    ${relationName}: Mapped[list[${sourceClass}]] = relationship(back_populates=${quoteString(sourceRelation)})`,
            );
        }

        lines.push("", "");
    }

    return renderHeader(SchemaDesignerDefinitionKind.SqlAlchemy) + lines.join("\n");
}

function renderEfCore(schema: SchemaDesigner.Schema): string {
    const tableNames = getTableNameMap(schema, "pascal");
    const columnNamesByTable = getSchemaColumnNameMaps(schema, "pascal");
    const relationNames = getRelationNameMaps(schema, "pascal", columnNamesByTable);
    const dbSetNames = new Map<string, string>();
    const usedDbSetNames = new Set<string>();
    const needsSystemNamespace = schema.tables.some((table) =>
        table.columns.some((column) => {
            const csharpType = SQL_TO_CSHARP[getSqlType(column)] ?? "string";
            return requiresSystemNamespaceForCSharpType(csharpType);
        }),
    );
    const needsCollectionsNamespace = schema.tables.some((table) =>
        getIncomingForeignKeys(schema, table).some(hasCompleteForeignKeyMapping),
    );

    for (const table of schema.tables) {
        dbSetNames.set(
            table.id,
            getUniqueIdentifier(pluralize(table.name), "pascal", usedDbSetNames),
        );
    }

    const lines: string[] = ["using Microsoft.EntityFrameworkCore;"];

    if (needsSystemNamespace) {
        lines.push("using System;");
    }

    if (needsCollectionsNamespace) {
        lines.push("using System.Collections.Generic;");
    }

    lines.push("");

    for (const table of schema.tables) {
        const className = getTableName(table, tableNames, "pascal");
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        const incomingForeignKeys = getIncomingForeignKeys(schema, table);
        lines.push(`public partial class ${className}`);
        lines.push("{");

        for (const column of table.columns) {
            const propertyName = getColumnName(table, column, columnNamesByTable, "pascal");
            const csharpType = SQL_TO_CSHARP[getSqlType(column)] ?? "string";
            const nullableSuffix =
                column.isNullable && csharpType !== "string" && csharpType !== "byte[]" ? "?" : "";
            const requiredInitializer =
                csharpType === "string" || csharpType === "byte[]" ? " = null!;" : "";
            lines.push(
                `    public ${csharpType}${nullableSuffix} ${propertyName} { get; set; }${requiredInitializer}`,
            );
        }

        if (table.columns.length > 0) {
            lines.push("");
        }

        for (const foreignKey of outgoingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.outgoing, "pascal");
            const targetClass = getTableName(foreignKey.targetTable, tableNames, "pascal");
            const relationInitializer = isNullableForeignKey(foreignKey) ? "" : " = null!;";
            lines.push(
                `    public virtual ${targetClass}${isNullableForeignKey(foreignKey) ? "?" : ""} ${relationName} { get; set; }${relationInitializer}`,
            );
        }

        for (const foreignKey of incomingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.incoming, "pascal");
            const sourceClass = getTableName(foreignKey.sourceTable, tableNames, "pascal");
            lines.push(
                `    public virtual ICollection<${sourceClass}> ${relationName} { get; set; } = new List<${sourceClass}>();`,
            );
        }

        lines.push("}", "");
    }

    lines.push("public partial class AppDbContext : DbContext");
    lines.push("{");
    for (const table of schema.tables) {
        const className = getTableName(table, tableNames, "pascal");
        const setName =
            dbSetNames.get(table.id) ??
            getUniqueIdentifier(pluralize(table.name), "pascal", new Set());
        lines.push(`    public virtual DbSet<${className}> ${setName} => Set<${className}>();`);
    }
    lines.push(
        "",
        "    protected override void OnModelCreating(ModelBuilder modelBuilder)",
        "    {",
    );
    for (const table of schema.tables) {
        const className = getTableName(table, tableNames, "pascal");
        const primaryKeys = getPrimaryKeyColumns(table);
        const outgoingForeignKeys = getOutgoingForeignKeys(schema, table);
        lines.push(`        modelBuilder.Entity<${className}>(entity =>`);
        lines.push("        {");
        lines.push(
            `            entity.ToTable(${quoteString(table.name)}, ${quoteString(table.schema)});`,
        );
        if (primaryKeys.length > 0) {
            const pkProperties = primaryKeys
                .map((column) => `e.${getColumnName(table, column, columnNamesByTable, "pascal")}`)
                .join(", ");
            lines.push(`            entity.HasKey(e => new { ${pkProperties} });`);
        }

        for (const column of table.columns) {
            const propertyName = getColumnName(table, column, columnNamesByTable, "pascal");
            lines.push(
                `            entity.Property(e => e.${propertyName}).HasColumnName(${quoteString(column.name)});`,
            );
        }

        for (const foreignKey of outgoingForeignKeys) {
            if (!hasCompleteForeignKeyMapping(foreignKey)) {
                continue;
            }

            const relationName = getRelationName(foreignKey, relationNames.outgoing, "pascal");
            const inverseName = getRelationName(foreignKey, relationNames.incoming, "pascal");
            const sourceProperties =
                foreignKey.sourceColumns.length === 1
                    ? `d.${getColumnName(table, foreignKey.sourceColumns[0], columnNamesByTable, "pascal")}`
                    : `new { ${foreignKey.sourceColumns
                          .map(
                              (column) =>
                                  `d.${getColumnName(table, column, columnNamesByTable, "pascal")}`,
                          )
                          .join(", ")} }`;
            lines.push(`            entity.HasOne(d => d.${relationName})`);
            lines.push(`                .WithMany(p => p.${inverseName})`);
            lines.push(`                .HasForeignKey(d => ${sourceProperties});`);
        }

        lines.push("        });", "");
    }
    lines.push("    }", "}");

    return renderHeader(SchemaDesignerDefinitionKind.EfCore) + lines.join("\n");
}

export function getSchemaDesignerDefinitionOutput(
    schema: SchemaDesigner.Schema,
    kind: SchemaDesignerDefinitionKind,
): SchemaDesignerDefinitionOutput {
    switch (kind) {
        case SchemaDesignerDefinitionKind.Prisma:
            return { text: renderPrisma(schema), language: "prisma" };
        case SchemaDesignerDefinitionKind.Sequelize:
            return { text: renderSequelize(schema), language: "typescript" };
        case SchemaDesignerDefinitionKind.TypeOrm:
            return { text: renderTypeOrm(schema), language: "typescript" };
        case SchemaDesignerDefinitionKind.Drizzle:
            return { text: renderDrizzle(schema), language: "typescript" };
        case SchemaDesignerDefinitionKind.SqlAlchemy:
            return { text: renderSqlAlchemy(schema), language: "python" };
        case SchemaDesignerDefinitionKind.EfCore:
            return { text: renderEfCore(schema), language: "csharp" };
        case SchemaDesignerDefinitionKind.Sql:
        default:
            return { text: "", language: "sql" };
    }
}
