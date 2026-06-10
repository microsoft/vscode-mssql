/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates SQL DDL files directly from an OpenAPI v2/v3 specification.
 *
 * Pipeline:
 *   OpenAPI spec (JSON/YAML)
 *     → parse schema definitions
 *     → emit one CREATE TABLE .sql file per object schema  (Tables/<Name>.sql)
 *     → emit PostDeploymentScript.sql when enum properties are present
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";
import * as vscode from "vscode";
import * as constants from "../common/constants";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Primitive values that OpenAPI enum entries may contain. */
export type OpenApiEnumValue = string | number | boolean;

export interface SchemaProperty {
    type?: string;
    format?: string;
    $ref?: string;
    items?: SchemaProperty;
    enum?: OpenApiEnumValue[];
}

export interface SchemaObject {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    enum?: OpenApiEnumValue[];
}

export interface OpenApiSpec {
    /** OpenAPI 2 document version field ("2.0") */
    swagger?: string;
    /** OpenAPI 3 document version field ("3.0.x", "3.1.x") */
    openapi?: string;
    /** OpenAPI 2 schema definitions */
    definitions?: Record<string, SchemaObject>;
    /** OpenAPI 3 component schemas */
    components?: { schemas?: Record<string, SchemaObject> };
}

export interface SqlGenerationResult {
    filesWritten: number;
    logs: string[];
}

// ---------------------------------------------------------------------------
// OpenAPI type → T-SQL type mapping
// ---------------------------------------------------------------------------

/**
 * Maps an OpenAPI primitive type and optional format string to a T-SQL column type.
 * Falls back to NVARCHAR(MAX) for unknown or unsupported types.
 */
export function mapOpenApiTypeToSql(type: string, format?: string): string {
    switch (type) {
        case "string":
            switch (format) {
                case "date-time":
                    return "DATETIME2";
                case "date":
                    return "DATE";
                case "uuid":
                    return "UNIQUEIDENTIFIER";
                case "byte":
                case "binary":
                    return "VARBINARY(MAX)";
                default:
                    return "NVARCHAR(MAX)";
            }
        case "integer":
            return format === "int64" ? "BIGINT" : "INT";
        case "number":
            return "FLOAT";
        case "boolean":
            return "BIT";
        default:
            return "NVARCHAR(MAX)";
    }
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/**
 * Returns the top-level schema definitions from an OpenAPI v2 or v3 document.
 * v2 uses `definitions`; v3 uses `components.schemas`.
 */
export function getSchemaDefinitions(spec: OpenApiSpec): Record<string, SchemaObject> {
    return spec.definitions ?? spec.components?.schemas ?? {};
}

/**
 * Builds a `CREATE TABLE` SQL statement for the scalar columns of one OpenAPI schema object.
 *
 * Properties whose type is `array`, `object`, or a `$ref` are skipped — they are handled
 * as derived tables (list tables, junction tables) by `generateSqlFilesFromSpec`.
 *
 * @returns The SQL string, or an empty string when no columns can be mapped.
 */
export function buildCreateTableSql(
    tableName: string,
    schemaName: string,
    properties: Record<string, SchemaProperty>,
): string {
    const columns: string[] = [];

    for (const [propName, prop] of Object.entries(properties)) {
        if (!prop.type || prop.type === "object" || prop.type === "array" || prop.$ref) {
            continue; // no scalar SQL equivalent
        }
        columns.push(
            `    [${toSqlIdentifier(propName)}] ${mapOpenApiTypeToSql(prop.type, prop.format)}`,
        );
    }

    if (columns.length === 0) {
        return "";
    }

    return (
        `CREATE TABLE [${toSqlIdentifier(schemaName)}].[${toSqlIdentifier(tableName)}]\n` +
        `(\n` +
        columns.join(",\n") +
        `\n);\n`
    );
}

/**
 * Builds a single-column `CREATE TABLE` for an enum lookup table.
 * e.g. `Pet.status` enum → `PetStatus` table with a `[Value]` column.
 */
export function buildEnumTableSql(tableName: string, schemaName: string): string {
    return (
        `CREATE TABLE [${toSqlIdentifier(schemaName)}].[${toSqlIdentifier(tableName)}]\n` +
        `(\n    [Value] NVARCHAR(MAX)\n);\n`
    );
}

/**
 * Builds a single-column `CREATE TABLE` for an array-of-scalars list table.
 * e.g. `Pet.photoUrls: string[]` → `PetPhotoUrls` table with a `[Value]` column.
 */
export function buildListTableSql(
    tableName: string,
    schemaName: string,
    itemType: string,
    itemFormat?: string,
): string {
    return (
        `CREATE TABLE [${toSqlIdentifier(schemaName)}].[${toSqlIdentifier(tableName)}]\n` +
        `(\n    [Value] ${mapOpenApiTypeToSql(itemType, itemFormat)}\n);\n`
    );
}

/**
 * Builds a two-column `CREATE TABLE` for an array-of-$ref junction table.
 * e.g. `Pet.tags: Tag[]` → `PetToTags` table with `[PetId]` and `[TagId]` columns.
 */
export function buildJunctionTableSql(
    tableName: string,
    schemaName: string,
    parentName: string,
    referencedName: string,
): string {
    return (
        `CREATE TABLE [${toSqlIdentifier(schemaName)}].[${toSqlIdentifier(tableName)}]\n` +
        `(\n` +
        `    [${toSqlIdentifier(parentName)}Id] INT,\n` +
        `    [${toSqlIdentifier(referencedName)}Id] INT\n` +
        `);\n`
    );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

interface PendingWrite {
    filePath: string;
    content: string;
    logLabel: string;
}

/**
 * Reads an OpenAPI v2/v3 spec file (JSON or YAML) and writes one `.sql` file
 * per top-level object schema into `<outputFolder>/Tables/<Name>.sql`.
 *
 * If any property carries an `enum` constraint, a `PostDeploymentScript.sql`
 * is also written at the root of `outputFolder` containing the INSERT statements.
 *
 * @param specPath      Absolute path to the OpenAPI JSON or YAML spec file.
 * @param outputFolder  Directory in which to write the generated SQL files.
 * @param outputChannel VS Code output channel for progress logging.
 * @returns             Result containing the count of files written and a log transcript.
 */
export async function generateSqlFilesFromSpec(
    specPath: string,
    outputFolder: string,
    outputChannel: vscode.OutputChannel,
): Promise<SqlGenerationResult> {
    const logs: string[] = [];
    const log = (msg: string): void => {
        logs.push(msg);
        outputChannel.appendLine(msg);
    };

    log(`[sql-generator] Starting: ${path.basename(specPath)}`);
    const startMs = Date.now();

    const spec = await parseSpecFile(specPath);
    const schemas = getSchemaDefinitions(spec);
    const schemaCount = Object.keys(schemas).length;
    log(`[sql-generator] Found ${schemaCount} schema definition(s)`);

    const tablesFolder = path.join(outputFolder, "Tables");
    await fs.mkdir(tablesFolder, { recursive: true });

    const pendingWrites: PendingWrite[] = [];
    const enumInsertLines: string[] = [];
    let mainTableCount = 0;
    let enumTableCount = 0;
    let listTableCount = 0;
    let junctionTableCount = 0;

    for (const [name, schemaDef] of Object.entries(schemas)) {
        if (!schemaDef.properties) {
            continue; // skip non-object schemas (scalars, plain arrays, etc.)
        }

        // Main table: scalar columns only (array/$ref/enum handled as derived tables below)
        const tableSql = buildCreateTableSql(name, "dbo", schemaDef.properties);
        if (tableSql) {
            const fileName = `${toSafeFileName(name)}.sql`;
            pendingWrites.push({
                filePath: path.join(tablesFolder, fileName),
                content: tableSql,
                logLabel: `Tables${path.sep}${fileName}`,
            });
            mainTableCount++;
        } else {
            log(`[sql-generator] Skipped '${name}': no mappable scalar columns`);
        }

        // Derived tables for array and enum properties
        for (const [propName, prop] of Object.entries(schemaDef.properties)) {
            if (prop.type === "array") {
                if (prop.items?.$ref) {
                    // Array of $ref → junction table  e.g. Pet.tags: Tag[] → PetToTags
                    const refName = extractRefName(prop.items.$ref);
                    if (!refName) {
                        log(
                            `[sql-generator] Skipped junction for '${name}.${propName}': invalid $ref '${prop.items.$ref}'`,
                        );
                        continue;
                    }
                    const junctionName = toJunctionTableName(name, propName);
                    const fileName = `${toSafeFileName(junctionName)}.sql`;
                    pendingWrites.push({
                        filePath: path.join(tablesFolder, fileName),
                        content: buildJunctionTableSql(junctionName, "dbo", name, refName),
                        logLabel: `Tables${path.sep}${fileName}`,
                    });
                    junctionTableCount++;
                } else if (prop.items?.type) {
                    // Array of scalars → list table  e.g. Pet.photoUrls: string[] → PetPhotoUrls
                    const listName = toDerivedTableName(name, propName);
                    const fileName = `${toSafeFileName(listName)}.sql`;
                    pendingWrites.push({
                        filePath: path.join(tablesFolder, fileName),
                        content: buildListTableSql(
                            listName,
                            "dbo",
                            prop.items.type,
                            prop.items.format,
                        ),
                        logLabel: `Tables${path.sep}${fileName}`,
                    });
                    listTableCount++;
                }
                continue;
            }

            if (Array.isArray(prop.enum) && prop.enum.length > 0) {
                // Enum property → lookup table  e.g. Pet.status enum → PetStatus table
                const enumName = toDerivedTableName(name, propName);
                const fileName = `${toSafeFileName(enumName)}.sql`;
                pendingWrites.push({
                    filePath: path.join(tablesFolder, fileName),
                    content: buildEnumTableSql(enumName, "dbo"),
                    logLabel: `Tables${path.sep}${fileName}`,
                });
                enumTableCount++;

                const valueList = prop.enum
                    .map((v) => `('${String(v).replace(/'/g, "''")}')`)
                    .join(", ");
                enumInsertLines.push(
                    `INSERT INTO [dbo].[${toSqlIdentifier(enumName)}] ([Value]) VALUES ${valueList};`,
                );
            }
        }
    }

    if (enumInsertLines.length > 0) {
        pendingWrites.push({
            filePath: path.join(outputFolder, constants.postDeploymentScriptName),
            content: enumInsertLines.join("\n") + "\n",
            logLabel: constants.postDeploymentScriptName,
        });
    }

    // Write all files in parallel
    await Promise.all(
        pendingWrites.map(({ filePath, content }) => fs.writeFile(filePath, content, "utf-8")),
    );

    for (const { logLabel } of pendingWrites) {
        log(`[sql-generator] Wrote ${logLabel}`);
    }

    const filesWritten = pendingWrites.length;
    const elapsedMs = Date.now() - startMs;
    log(
        `[sql-generator] Done: ${filesWritten} file(s) written in ${elapsedMs}ms` +
            ` (main: ${mainTableCount}, enum: ${enumTableCount}, list: ${listTableCount}, junction: ${junctionTableCount})`,
    );

    return { filesWritten, logs };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function parseSpecFile(specPath: string): Promise<OpenApiSpec> {
    const raw = await fs.readFile(specPath, "utf-8");
    const ext = path.extname(specPath).toLowerCase();
    if (ext === ".json") {
        return JSON.parse(raw) as OpenApiSpec;
    }
    // .yaml / .yml
    return yaml.load(raw) as OpenApiSpec;
}

/** Escapes a name for use inside SQL square brackets. Only `]` needs escaping (→ `]]`). */
function toSqlIdentifier(name: string): string {
    return name.replace(/]/g, "]]");
}

/** Produces a file-system-safe basename from a schema name (replaces non-alphanumeric chars). */
function toSafeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Capitalizes the first character of a string. */
function capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Derived table name for enum/list properties: `Pet` + `status` → `PetStatus`. */
function toDerivedTableName(parentName: string, propName: string): string {
    return `${parentName}${capitalize(propName)}`;
}

/** Junction table name for array-of-ref properties: `Pet` + `tags` → `PetToTags`. */
function toJunctionTableName(parentName: string, propName: string): string {
    return `${parentName}To${capitalize(propName)}`;
}

/** Extracts the plain name from a $ref string. Returns empty string for malformed refs. */
function extractRefName(ref: string): string {
    return ref.split("/").pop()?.trim() ?? "";
}
