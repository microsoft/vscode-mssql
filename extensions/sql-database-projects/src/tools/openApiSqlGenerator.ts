/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates SQL DDL files directly from an OpenAPI v2/v3 specification.
 *
 * Replaces the legacy AutoRest + autorest-sql-testing pipeline with a pure TypeScript
 * implementation — no external process, no Node.js installation required on the user's machine.
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

export interface SchemaProperty {
    type?: string;
    format?: string;
    $ref?: string;
    items?: SchemaProperty;
    enum?: unknown[];
}

export interface SchemaObject {
    type?: string;
    properties?: Record<string, SchemaProperty>;
    enum?: unknown[];
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
        const sqlType = mapOpenApiTypeToSql(prop.type, prop.format);
        columns.push(`    [${toSqlIdentifier(propName)}] ${sqlType}`);
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
    const sqlType = mapOpenApiTypeToSql(itemType, itemFormat);
    return (
        `CREATE TABLE [${toSqlIdentifier(schemaName)}].[${toSqlIdentifier(tableName)}]\n` +
        `(\n    [Value] ${sqlType}\n);\n`
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

    let filesWritten = 0;
    const enumInsertLines: string[] = [];

    for (const [name, schemaDef] of Object.entries(schemas)) {
        if (!schemaDef.properties) {
            continue; // skip non-object schemas (scalars, arrays, etc.)
        }

        // Main table: scalar columns only (enum/array/$ref handled as derived tables below)
        const tableSql = buildCreateTableSql(name, "dbo", schemaDef.properties);
        if (tableSql) {
            const sqlFile = path.join(tablesFolder, `${toSafeFileName(name)}.sql`);
            await fs.writeFile(sqlFile, tableSql, "utf-8");
            filesWritten++;
            log(`[sql-generator] Wrote Tables${path.sep}${toSafeFileName(name)}.sql`);
        } else {
            log(`[sql-generator] Skipped '${name}': no mappable scalar columns`);
        }

        // Derived tables for array and enum properties
        for (const [propName, prop] of Object.entries(schemaDef.properties)) {
            const derivedName = `${name}${capitalize(propName)}`;

            if (prop.type === "array") {
                if (prop.items?.$ref) {
                    // Array of $ref → junction table  e.g. Pet.tags: Tag[] → PetToTags
                    const refName = extractRefName(prop.items.$ref);
                    const junctionName = `${name}To${capitalize(propName)}`;
                    const junctionSql = buildJunctionTableSql(junctionName, "dbo", name, refName);
                    const sqlFile = path.join(tablesFolder, `${toSafeFileName(junctionName)}.sql`);
                    await fs.writeFile(sqlFile, junctionSql, "utf-8");
                    filesWritten++;
                    log(
                        `[sql-generator] Wrote Tables${path.sep}${toSafeFileName(junctionName)}.sql`,
                    );
                } else if (prop.items?.type) {
                    // Array of scalars → list table  e.g. Pet.photoUrls: string[] → PetPhotoUrls
                    const listSql = buildListTableSql(
                        derivedName,
                        "dbo",
                        prop.items.type,
                        prop.items.format,
                    );
                    const sqlFile = path.join(tablesFolder, `${toSafeFileName(derivedName)}.sql`);
                    await fs.writeFile(sqlFile, listSql, "utf-8");
                    filesWritten++;
                    log(
                        `[sql-generator] Wrote Tables${path.sep}${toSafeFileName(derivedName)}.sql`,
                    );
                }
                continue;
            }

            if (Array.isArray(prop.enum) && prop.enum.length > 0) {
                // Enum property → lookup table  e.g. Pet.status enum → PetStatus table
                const enumSql = buildEnumTableSql(derivedName, "dbo");
                const sqlFile = path.join(tablesFolder, `${toSafeFileName(derivedName)}.sql`);
                await fs.writeFile(sqlFile, enumSql, "utf-8");
                filesWritten++;
                log(`[sql-generator] Wrote Tables${path.sep}${toSafeFileName(derivedName)}.sql`);

                const valueList = prop.enum
                    .map((v) => `('${String(v).replace(/'/g, "''")}')`)
                    .join(", ");
                enumInsertLines.push(
                    `INSERT INTO [dbo].[${toSqlIdentifier(derivedName)}] ([Value]) VALUES ${valueList};`,
                );
            }
        }
    }

    if (enumInsertLines.length > 0) {
        const postDeployFile = path.join(outputFolder, constants.postDeploymentScriptName);
        await fs.writeFile(postDeployFile, enumInsertLines.join("\n") + "\n", "utf-8");
        filesWritten++;
        log(`[sql-generator] Wrote ${constants.postDeploymentScriptName}`);
    }

    const elapsedMs = Date.now() - startMs;
    log(`[sql-generator] Done: ${filesWritten} file(s) written in ${elapsedMs}ms`);

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

/** Capitalizes the first character of a string (used to form derived table names). */
function capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Extracts the plain name from a $ref string.  '#/definitions/Tag' → 'Tag' */
function extractRefName(ref: string): string {
    return ref.split("/").pop() ?? ref;
}
