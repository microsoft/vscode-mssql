/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { rowsAsObjects } = require("./tediousTestClient.js");

class SqlServerCatalogLoader {
    constructor() {
        this.queries = [];
    }

    async refresh(executor, publisher, signal) {
        const environment = await this.query(
            executor,
            `SELECT
    DB_NAME() AS database_name,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS server_version,
    d.compatibility_level
FROM sys.databases AS d WITH (NOLOCK)
WHERE d.name = DB_NAME();`,
            signal,
        );
        const databases = await this.query(
            executor,
            `SELECT d.name AS database_name
FROM sys.databases AS d WITH (NOLOCK)
WHERE d.state = 0;`,
            signal,
        );
        const schemas = await this.query(
            executor,
            `SELECT DB_NAME() AS database_name, s.name AS schema_name
FROM sys.schemas AS s WITH (NOLOCK);`,
            signal,
        );
        const objects = await this.query(
            executor,
            `SELECT
    DB_NAME() AS database_name,
    s.name AS schema_name,
    o.object_id,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM sys.all_objects AS o WITH (NOLOCK)
INNER JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = o.schema_id
WHERE o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'SN');`,
            signal,
        );
        const types = await this.query(
            executor,
            `SELECT
    DB_NAME() AS database_name,
    s.name AS schema_name,
    t.user_type_id,
    t.name AS type_name,
    CASE WHEN t.is_table_type = 1 THEN N'table'
         WHEN t.is_assembly_type = 1 THEN N'clr'
         ELSE N'alias' END AS type_category
FROM sys.types AS t WITH (NOLOCK)
INNER JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = t.schema_id
WHERE t.is_user_defined = 1 OR t.is_table_type = 1;`,
            signal,
        );
        const current = environment[0];
        if (!current) throw new Error("The server did not return the current database.");
        const currentDatabase = String(current.database_name);
        publisher.replace({
            environment: {
                currentDatabase,
                defaultSchema: "dbo",
                serverVersion: String(current.server_version),
                compatibilityLevel: Number(current.compatibility_level),
            },
            databases: databases.map((row) => ({ name: String(row.database_name) })),
            schemas: schemas.map((row) => ({
                database: String(row.database_name),
                name: String(row.schema_name),
            })),
            objects: [...mapObjects(objects), ...mapTypes(types)],
            completeness: {
                databases: "ready",
                schemas: "ready",
                objects: "ready",
                columns: "partial",
                parameters: "partial",
                principals: "unknown",
                definitions: "unknown",
            },
            databaseCatalogCompleteness: new Map(
                databases.map((row) => [
                    String(row.database_name),
                    String(row.database_name).toLocaleLowerCase() ===
                    currentDatabase.toLocaleLowerCase()
                        ? { schemas: "ready", objects: "ready" }
                        : { schemas: "unknown", objects: "unknown" },
                ]),
            ),
        });
    }

    async hydrate(executor, request, publisher, signal) {
        if (request.database && request.section === "schemas") {
            const catalog = quoteIdentifier(request.database);
            const rows = await this.query(
                executor,
                `SELECT ${sqlString(request.database)} AS database_name, s.name AS schema_name
FROM ${catalog}.sys.schemas AS s WITH (NOLOCK);`,
                signal,
            );
            publisher.merge({
                schemas: rows.map((row) => ({
                    database: String(row.database_name),
                    name: String(row.schema_name),
                })),
                databaseCatalogCompleteness: new Map([
                    [request.database, { schemas: "ready" }],
                ]),
            });
            return;
        }
        if (request.database && request.section === "objects") {
            const catalog = quoteIdentifier(request.database);
            const rows = await this.query(
                executor,
                `SELECT
    ${sqlString(request.database)} AS database_name,
    s.name AS schema_name,
    o.object_id,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM ${catalog}.sys.all_objects AS o WITH (NOLOCK)
INNER JOIN ${catalog}.sys.schemas AS s WITH (NOLOCK) ON s.schema_id = o.schema_id
WHERE o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'SN');`,
                signal,
            );
            const types = await this.query(
                executor,
                `SELECT
    ${sqlString(request.database)} AS database_name,
    s.name AS schema_name,
    t.user_type_id,
    t.name AS type_name,
    CASE WHEN t.is_table_type = 1 THEN N'table'
         WHEN t.is_assembly_type = 1 THEN N'clr'
         ELSE N'alias' END AS type_category
FROM ${catalog}.sys.types AS t WITH (NOLOCK)
INNER JOIN ${catalog}.sys.schemas AS s WITH (NOLOCK) ON s.schema_id = t.schema_id
WHERE t.is_user_defined = 1 OR t.is_table_type = 1;`,
                signal,
            );
            publisher.merge({
                objects: [...mapObjects(rows), ...mapTypes(types)],
                databaseCatalogCompleteness: new Map([
                    [request.database, { objects: "ready" }],
                ]),
            });
            return;
        }
        if (request.section === "columns" && request.object) {
            const objectId = numericObjectId(request.object.id);
            const rows = await this.query(
                executor,
                `SELECT
    c.name AS column_name,
    t.name AS type_name,
    c.max_length,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    pkc.key_ordinal AS primary_key_ordinal
FROM sys.all_columns AS c WITH (NOLOCK)
INNER JOIN sys.types AS t WITH (NOLOCK) ON t.user_type_id = c.user_type_id
LEFT JOIN sys.indexes AS pki WITH (NOLOCK)
    ON pki.object_id = c.object_id AND pki.is_primary_key = 1
LEFT JOIN sys.index_columns AS pkc WITH (NOLOCK)
    ON pkc.object_id = pki.object_id
    AND pkc.index_id = pki.index_id
    AND pkc.column_id = c.column_id
WHERE c.object_id = ${objectId}
ORDER BY c.column_id;`,
                signal,
            );
            publisher.merge({
                columnStates: new Map([
                    [
                        request.object.id,
                        {
                            kind: "loaded",
                            value: rows.map((row) => ({
                                name: String(row.column_name),
                                typeDisplay: formatType(row),
                                nullable: Boolean(row.is_nullable),
                                identity: Boolean(row.is_identity),
                                computed: Boolean(row.is_computed),
                                primaryKeyOrdinal:
                                    row.primary_key_ordinal === null ||
                                    row.primary_key_ordinal === undefined
                                        ? undefined
                                        : Number(row.primary_key_ordinal),
                            })),
                        },
                    ],
                ]),
            });
            return;
        }
        if (request.section === "parameters" && request.object) {
            publisher.merge({
                parameterStates: new Map([
                    [request.object.id, { kind: "loaded", value: [] }],
                ]),
            });
        }
    }

    async query(executor, sql, signal) {
        this.queries.push(sql);
        return rowsAsObjects(await executor.execute(sql, signal));
    }
}

function quoteIdentifier(value) {
    return `[${value.replaceAll("]", "]]")}]`;
}

function sqlString(value) {
    return `N'${value.replaceAll("'", "''")}'`;
}

function numericObjectId(id) {
    const value = /:(-?\d+)$/u.exec(id)?.[1];
    if (!value) throw new Error(`Invalid integration-test object reference: ${id}`);
    return Number.parseInt(value, 10);
}

function objectKind(type) {
    if (type === "U") return "table";
    if (type === "V") return "view";
    if (type === "P" || type === "PC") return "procedure";
    if (type === "FN" || type === "FS") return "scalarFunction";
    if (["IF", "TF", "FT"].includes(type)) return "tableFunction";
    if (type === "SN") return "synonym";
    return undefined;
}

function mapObjects(rows) {
    return rows.flatMap((row) => {
        const kind = objectKind(String(row.object_type).trim());
        if (!kind) return [];
        const database = String(row.database_name);
        return [
            {
                ref: { id: `${database}:${row.object_id}`, database },
                database,
                schema: String(row.schema_name),
                name: String(row.object_name),
                kind,
                system: Boolean(row.is_ms_shipped),
            },
        ];
    });
}

function mapTypes(rows) {
    return rows.map((row) => {
        const database = String(row.database_name);
        return {
            ref: { id: `${database}:type:${row.user_type_id}`, database },
            database,
            schema: String(row.schema_name),
            name: String(row.type_name),
            kind: "type",
            typeCategory: String(row.type_category),
        };
    });
}

function formatType(row) {
    const name = String(row.type_name);
    const lower = name.toLocaleLowerCase();
    if (["varchar", "char", "varbinary", "binary"].includes(lower)) {
        return `${name}(${Number(row.max_length) < 0 ? "max" : row.max_length})`;
    }
    if (["nvarchar", "nchar"].includes(lower)) {
        return `${name}(${Number(row.max_length) < 0 ? "max" : Number(row.max_length) / 2})`;
    }
    if (["decimal", "numeric"].includes(lower)) {
        return `${name}(${row.precision},${row.scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(lower)) {
        return `${name}(${row.scale})`;
    }
    return name;
}

module.exports = { SqlServerCatalogLoader };
