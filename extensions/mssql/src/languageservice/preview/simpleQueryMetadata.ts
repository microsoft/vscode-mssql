/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColumnMetadata,
    InMemoryMetadataInput,
    ObjectMetadata,
    ParameterMetadata,
    SchemaMetadata,
    SimpleQueryExecutor,
    SimpleQueryMetadataLoader,
    SimpleQueryResult,
    SqlObjectKind,
} from "@vscode-mssql/tsql-language-service";
import type { ConnectionSharingService } from "../../connectionSharing/connectionSharingService";

export class ExtensionSimpleQueryExecutor implements SimpleQueryExecutor {
    public constructor(
        private readonly _connectionSharing: ConnectionSharingService,
        private readonly _connectionUri: string,
    ) {}

    public async execute(query: string, signal?: AbortSignal): Promise<SimpleQueryResult> {
        throwIfAborted(signal);
        const result = await this._connectionSharing.executeSimpleQuery(this._connectionUri, query);
        throwIfAborted(signal);
        return {
            columns: result.columnInfo.map((column) => ({
                name: column.columnName,
                type: column.dataTypeName || column.dataType,
            })),
            rows: result.rows.map((row) =>
                row.map((cell) => (cell.isNull ? undefined : cell.displayValue)),
            ),
            messages: result.messages?.map((message) => ({
                error: message.isError,
                message: message.message,
            })),
        };
    }
}

/** Set-based fallback loader used while the dev/query metadata repository is unavailable. */
export class VscodeMssqlSimpleQueryMetadataLoader implements SimpleQueryMetadataLoader {
    public async load(
        executor: SimpleQueryExecutor,
        signal?: AbortSignal,
    ): Promise<InMemoryMetadataInput> {
        const environmentRows = rows(await executor.execute(environmentQuery, signal));
        const environment = environmentRows[0] ?? new Map<string, string | undefined>();
        const currentDatabase = environment.get("current_database");

        const databaseRows = rows(await executor.execute(databasesQuery, signal));
        const schemaRows = rows(await executor.execute(schemasQuery, signal));
        const objectRows = rows(await executor.execute(objectsQuery, signal));
        const columnRows = rows(await executor.execute(columnsQuery, signal));
        const parameterRows = rows(await executor.execute(parametersQuery, signal));

        const objects = objectRows.flatMap<ObjectMetadata>((row) => {
            const objectId = row.get("object_id");
            const schema = row.get("schema_name");
            const name = row.get("object_name");
            const kind = objectKind(row.get("object_type"));
            if (!objectId || !schema || !name || !kind) return [];
            return [
                {
                    ref: {
                        id: metadataObjectId(currentDatabase, objectId),
                        database: currentDatabase,
                    },
                    database: currentDatabase,
                    schema,
                    name,
                    kind,
                },
            ];
        });

        const columns = new Map<string, ColumnMetadata[]>();
        for (const row of columnRows) {
            const objectId = row.get("object_id");
            const name = row.get("column_name");
            if (!objectId || !name) continue;
            const key = metadataObjectId(currentDatabase, objectId);
            const values = columns.get(key) ?? [];
            values.push({
                name,
                typeDisplay: displayType(row),
                nullable: booleanValue(row.get("is_nullable")),
                identity: booleanValue(row.get("is_identity")) || undefined,
                computed: booleanValue(row.get("is_computed")) || undefined,
            });
            columns.set(key, values);
        }

        const parameters = new Map<string, ParameterMetadata[]>();
        for (const row of parameterRows) {
            const objectId = row.get("object_id");
            const ordinal = numberValue(row.get("parameter_id"));
            if (!objectId || ordinal === undefined) continue;
            const key = metadataObjectId(currentDatabase, objectId);
            const values = parameters.get(key) ?? [];
            values.push({
                ordinal,
                name: row.get("parameter_name") ?? "",
                typeDisplay: displayType(row),
                output: booleanValue(row.get("is_output")),
            });
            parameters.set(key, values);
        }

        const schemas: SchemaMetadata[] = schemaRows.flatMap((row) => {
            const name = row.get("schema_name");
            return name ? [{ database: currentDatabase, name }] : [];
        });

        return {
            environment: {
                currentDatabase,
                defaultSchema: environment.get("default_schema") ?? "dbo",
                caseSensitive: booleanValue(environment.get("case_sensitive")),
                engineEdition: numberValue(environment.get("engine_edition")),
                serverVersion: environment.get("server_version"),
                compatibilityLevel: numberValue(environment.get("compatibility_level")),
            },
            completeness: {
                databases: "ready",
                schemas: "ready",
                objects: "ready",
                columns: "ready",
                parameters: "ready",
                definitions: "unknown",
            },
            databases: databaseRows.flatMap((row) => {
                const name = row.get("database_name");
                return name ? [{ name }] : [];
            }),
            schemas,
            objects,
            columns,
            parameters,
        };
    }
}

function rows(result: SimpleQueryResult): readonly ReadonlyMap<string, string | undefined>[] {
    return result.rows.map((values) => {
        const row = new Map<string, string | undefined>();
        for (let index = 0; index < result.columns.length; index++) {
            const value = values[index];
            row.set(
                result.columns[index]!.name.toLocaleLowerCase(),
                value === undefined ? undefined : String(value),
            );
        }
        return row;
    });
}

function metadataObjectId(database: string | undefined, objectId: string): string {
    return `${database ?? ""}:${objectId}`;
}

function objectKind(type: string | undefined): SqlObjectKind | undefined {
    switch (type) {
        case "U":
            return "table";
        case "V":
            return "view";
        case "P":
        case "PC":
            return "procedure";
        case "FN":
        case "FS":
            return "scalarFunction";
        case "IF":
        case "TF":
        case "FT":
            return "tableFunction";
        case "SN":
            return "synonym";
        default:
            return undefined;
    }
}

function displayType(row: ReadonlyMap<string, string | undefined>): string | undefined {
    const name = row.get("type_name");
    if (!name) return undefined;
    const lower = name.toLocaleLowerCase();
    const maxLength = numberValue(row.get("max_length"));
    if (["varchar", "char", "varbinary", "binary"].includes(lower) && maxLength !== undefined) {
        return `${name}(${maxLength === -1 ? "max" : maxLength})`;
    }
    if (["nvarchar", "nchar"].includes(lower) && maxLength !== undefined) {
        return `${name}(${maxLength === -1 ? "max" : maxLength / 2})`;
    }
    const precision = numberValue(row.get("precision"));
    const scale = numberValue(row.get("scale"));
    if (["decimal", "numeric"].includes(lower) && precision !== undefined && scale !== undefined) {
        return `${name}(${precision},${scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(lower) && scale !== undefined) {
        return `${name}(${scale})`;
    }
    return name;
}

function booleanValue(value: string | undefined): boolean {
    return value === "1" || value?.toLocaleLowerCase() === "true";
}

function numberValue(value: string | undefined): number | undefined {
    if (value === undefined || value.length === 0) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
}

const environmentQuery = `
SELECT
    DB_NAME() AS current_database,
    COALESCE(
        (SELECT default_schema_name FROM sys.database_principals WITH (NOLOCK) WHERE name = USER_NAME()),
        N'dbo'
    ) AS default_schema,
    CASE WHEN CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) LIKE N'%[_]CS[_]%'
         THEN 1 ELSE 0 END AS case_sensitive,
    CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engine_edition,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS server_version,
    compatibility_level
FROM sys.databases WITH (NOLOCK)
WHERE name = DB_NAME();`;

const databasesQuery = `
SELECT name AS database_name
FROM sys.databases WITH (NOLOCK)
WHERE state = 0 AND HAS_DBACCESS(name) = 1
ORDER BY name;`;

const schemasQuery = `
SELECT name AS schema_name
FROM sys.schemas WITH (NOLOCK)
WHERE principal_id <> 16384
ORDER BY name;`;

const objectsQuery = `
SELECT
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type
FROM sys.objects AS o WITH (NOLOCK)
JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = o.schema_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'SN')
ORDER BY s.name, o.name;`;

const columnsQuery = `
SELECT
    c.object_id,
    c.column_id,
    c.name AS column_name,
    ty.name AS type_name,
    c.max_length,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed
FROM sys.columns AS c WITH (NOLOCK)
JOIN sys.objects AS o WITH (NOLOCK) ON o.object_id = c.object_id
JOIN sys.types AS ty WITH (NOLOCK) ON ty.user_type_id = c.user_type_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('U', 'V', 'IF', 'TF', 'FT')
ORDER BY c.object_id, c.column_id;`;

const parametersQuery = `
SELECT
    p.object_id,
    p.parameter_id,
    p.name AS parameter_name,
    ty.name AS type_name,
    p.max_length,
    p.precision,
    p.scale,
    p.is_output
FROM sys.parameters AS p WITH (NOLOCK)
JOIN sys.objects AS o WITH (NOLOCK) ON o.object_id = p.object_id
JOIN sys.types AS ty WITH (NOLOCK) ON ty.user_type_id = p.user_type_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT')
ORDER BY p.object_id, p.parameter_id;`;
