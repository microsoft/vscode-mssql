/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    resolveEngineProfile,
    ColumnMetadata,
    MetadataHydrationRequest,
    ObjectMetadata,
    ParameterMetadata,
    PrincipalMetadata,
    SimpleQueryExecutor,
    SimpleQueryMetadataLoader,
    SimpleQueryMetadataPublisher,
    SimpleQueryResult,
    SqlObjectKind,
} from "@vscode-mssql/tsql-language-service";
import { sendSimpleQuery, type SimpleQuerySender } from "./previewSimpleQuery";

export class ExtensionSimpleQueryExecutor implements SimpleQueryExecutor {
    public constructor(
        private readonly _connectionUri: string,
        private readonly _send: SimpleQuerySender = sendSimpleQuery,
    ) {}

    public async execute(query: string, signal?: AbortSignal): Promise<SimpleQueryResult> {
        throwIfAborted(signal);
        const result = await this._send(this._connectionUri, query);
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
    private _useNoLock = true;

    public async refresh(
        executor: SimpleQueryExecutor,
        publisher: SimpleQueryMetadataPublisher,
        signal?: AbortSignal,
    ): Promise<void> {
        const environmentRows = rows(
            await executor.execute(withoutNoLock(environmentQuery), signal),
        );
        const environment = environmentRows[0] ?? new Map<string, string | undefined>();
        const currentDatabase = environment.get("current_database");

        const mappedEnvironment = mapEnvironment(environment);
        const profile = resolveEngineProfile(mappedEnvironment);
        this._useNoLock = profile.profile !== "fabric-warehouse" && profile.source !== "outOfScope";
        const catalogExecutor = this.catalogExecutor(executor);
        publisher.merge({
            environment: mappedEnvironment,
            completeness: {
                databases: "loading",
                schemas: "loading",
                objects: "loading",
                columns: "partial",
                parameters: "partial",
                principals: "loading",
                definitions: "unknown",
            },
            ...(currentDatabase
                ? {
                      databaseCatalogCompleteness: new Map([
                          [currentDatabase, { schemas: "loading", objects: "loading" }],
                      ]),
                  }
                : {}),
        });

        const databaseRows = rows(await catalogExecutor.execute(databasesQuery, signal));
        const databases = databaseRows.flatMap((row) => {
            const name = row.get("database_name");
            return name ? [{ name }] : [];
        });
        publisher.merge({
            completeness: { databases: "ready" },
            databases,
        });

        const identityRows = rows(await catalogExecutor.execute(schemasAndPrincipalsQuery, signal));
        const schemaRows = identityRows.filter((row) => row.get("entry_kind") === "schema");
        const schemas = schemaRows.flatMap((row) => {
            const name = row.get("schema_name");
            return name ? [{ database: currentDatabase, name }] : [];
        });
        const principals = mapPrincipals(
            identityRows.filter((row) => row.get("entry_kind") === "principal"),
        );
        publisher.merge({
            completeness: { schemas: "ready", principals: "ready" },
            schemas,
            principals,
            ...(currentDatabase
                ? {
                      databaseCatalogCompleteness: new Map([
                          [currentDatabase, { schemas: "ready" }],
                      ]),
                  }
                : {}),
        });

        const typeRows = rows(await catalogExecutor.execute(userTypesQuery(), signal));
        const objects: ObjectMetadata[] = [...mapUserTypes(typeRows, currentDatabase)];
        let publishedFirstObjectPage = false;
        // SQL Server assigns negative IDs to many system catalog objects. Start below the
        // SQL `int` range so system and user objects share the same stable keyset pagination.
        let lastObjectId = -2_147_483_649;
        while (true) {
            const objectRows = rows(
                await catalogExecutor.execute(objectsQuery(lastObjectId), signal),
            );
            objects.push(...mapObjects(objectRows, currentDatabase));
            const complete = objectRows.length < objectPageSize;
            if (complete) {
                // Commit one coherent identity snapshot and invalidate details belonging to the
                // prior generation. Consumers hydrate only the objects they subsequently need.
                publisher.replace({
                    environment: mappedEnvironment,
                    completeness: {
                        databases: "ready",
                        schemas: "ready",
                        objects: "ready",
                        columns: "partial",
                        parameters: "partial",
                        principals: "ready",
                        definitions: "unknown",
                    },
                    databases,
                    schemas,
                    objects,
                    principals,
                    ...(currentDatabase
                        ? {
                              databaseCatalogCompleteness: new Map([
                                  [currentDatabase, { schemas: "ready", objects: "ready" }],
                              ]),
                          }
                        : {}),
                });
                break;
            }
            // Publish the first page for early completion, then accumulate privately. Rebuilding
            // immutable indexes for every page is quadratic on 50k-plus object catalogs.
            if (!publishedFirstObjectPage) {
                publishedFirstObjectPage = true;
                publisher.merge({
                    completeness: { objects: "partial" },
                    objects,
                    ...(currentDatabase
                        ? {
                              databaseCatalogCompleteness: new Map([
                                  [currentDatabase, { objects: "partial" }],
                              ]),
                          }
                        : {}),
                });
            }
            const nextObjectId = numberValue(objectRows.at(-1)?.get("object_id"));
            if (nextObjectId === undefined || nextObjectId <= lastObjectId) {
                throw new Error("Object metadata page did not advance its object_id cursor");
            }
            lastObjectId = nextObjectId;
        }
    }

    public async hydrate(
        executor: SimpleQueryExecutor,
        request: MetadataHydrationRequest,
        publisher: SimpleQueryMetadataPublisher,
        signal?: AbortSignal,
    ): Promise<void> {
        const catalogExecutor = this.catalogExecutor(executor);
        if (request.section === "principals") {
            const identityRows = rows(
                await catalogExecutor.execute(schemasAndPrincipalsQuery, signal),
            );
            const principals = mapPrincipals(
                identityRows.filter((row) => row.get("entry_kind") === "principal"),
            );
            // This is an authoritative replacement, not a merge: a successful DROP must remove
            // the deleted login/user/role from the pinned view.
            publisher.replaceSection("principals", {
                completeness: { principals: "ready" },
                principals,
            });
            return;
        }
        if (request.database && request.section === "schemas") {
            const schemaRows = rows(
                await catalogExecutor.execute(databaseSchemasQuery(request.database), signal),
            );
            const schemas = schemaRows.flatMap((row) => {
                const name = row.get("schema_name");
                return name ? [{ database: request.database, name }] : [];
            });
            publisher.merge({
                schemas,
                databaseCatalogCompleteness: new Map([[request.database, { schemas: "ready" }]]),
            });
            return;
        }
        if (request.database && request.section === "objects") {
            let lastObjectId = -2_147_483_649;
            const typeRows = rows(
                await catalogExecutor.execute(userTypesQuery(request.database), signal),
            );
            const objects: ObjectMetadata[] = [...mapUserTypes(typeRows, request.database)];
            let publishedFirstObjectPage = false;
            while (true) {
                const objectRows = rows(
                    await catalogExecutor.execute(
                        databaseObjectsQuery(request.database, lastObjectId),
                        signal,
                    ),
                );
                objects.push(...mapObjects(objectRows, request.database));
                const complete = objectRows.length < objectPageSize;
                if (complete || !publishedFirstObjectPage) {
                    publishedFirstObjectPage = true;
                    publisher.merge({
                        objects,
                        databaseCatalogCompleteness: new Map([
                            [request.database, { objects: complete ? "ready" : "partial" }],
                        ]),
                    });
                }
                if (complete) break;
                const nextObjectId = numberValue(objectRows.at(-1)?.get("object_id"));
                if (nextObjectId === undefined || nextObjectId <= lastObjectId) {
                    throw new Error("Object metadata page did not advance its object_id cursor");
                }
                lastObjectId = nextObjectId;
            }
            return;
        }
        if (!request.object) return;
        const objectId = numericObjectId(request.object.id);
        if (request.section === "columns") {
            const columnRows = rows(
                await catalogExecutor.execute(
                    columnsQuery(objectId, request.object.database),
                    signal,
                ),
            );
            const columns = mapColumns(columnRows);
            publisher.merge({
                columns: new Map([[request.object.id, columns]]),
                columnStates: new Map([[request.object.id, { kind: "loaded", value: columns }]]),
            });
            return;
        }
        if (request.section === "parameters") {
            const parameterRows = rows(
                await catalogExecutor.execute(
                    parametersQuery(objectId, request.object.database),
                    signal,
                ),
            );
            const parameters = mapParameters(parameterRows);
            publisher.merge({
                parameters: new Map([[request.object.id, parameters]]),
                parameterStates: new Map([
                    [request.object.id, { kind: "loaded", value: parameters }],
                ]),
            });
        }
    }

    private catalogExecutor(executor: SimpleQueryExecutor): SimpleQueryExecutor {
        if (this._useNoLock) return executor;
        return {
            execute: (query, signal) => executor.execute(withoutNoLock(query), signal),
        };
    }
}

function mapObjects(
    objectRows: readonly ReadonlyMap<string, string | undefined>[],
    currentDatabase: string | undefined,
): readonly ObjectMetadata[] {
    return objectRows.flatMap((row) => {
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
                system: booleanValue(row.get("is_ms_shipped")) || undefined,
            },
        ];
    });
}

function mapUserTypes(
    typeRows: readonly ReadonlyMap<string, string | undefined>[],
    currentDatabase: string | undefined,
): readonly ObjectMetadata[] {
    return typeRows.flatMap((row) => {
        const userTypeId = row.get("user_type_id");
        const schema = row.get("schema_name");
        const name = row.get("type_name");
        const typeCategory = row.get("type_category") as ObjectMetadata["typeCategory"];
        if (!userTypeId || !schema || !name || !typeCategory) return [];
        return [
            {
                ref: {
                    id: `${currentDatabase ?? ""}:type:${userTypeId}`,
                    database: currentDatabase,
                },
                database: currentDatabase,
                schema,
                name,
                kind: "type" as const,
                typeCategory,
            },
        ];
    });
}

function mapEnvironment(environment: ReadonlyMap<string, string | undefined>) {
    return {
        currentDatabase: environment.get("current_database"),
        defaultSchema: environment.get("default_schema") ?? "dbo",
        caseSensitive: booleanValue(environment.get("case_sensitive")),
        engineEdition: numberValue(environment.get("engine_edition")),
        serverVersion: environment.get("server_version"),
        compatibilityLevel: numberValue(environment.get("compatibility_level")),
        serverName: environment.get("server_name"),
    };
}

function mapColumns(
    columnRows: readonly ReadonlyMap<string, string | undefined>[],
): readonly ColumnMetadata[] {
    return columnRows.flatMap((row) => {
        const name = row.get("column_name");
        if (!name) return [];
        return [
            {
                name,
                typeDisplay: displayType(row),
                nullable: booleanValue(row.get("is_nullable")),
                identity: booleanValue(row.get("is_identity")) || undefined,
                computed: booleanValue(row.get("is_computed")) || undefined,
                primaryKeyOrdinal: numberValue(row.get("primary_key_ordinal")),
            },
        ];
    });
}

function mapParameters(
    parameterRows: readonly ReadonlyMap<string, string | undefined>[],
): readonly ParameterMetadata[] {
    return parameterRows.flatMap((row) => {
        const ordinal = numberValue(row.get("parameter_id"));
        if (ordinal === undefined) return [];
        return [
            {
                ordinal,
                name: row.get("parameter_name") ?? "",
                typeDisplay: displayType(row),
                output: booleanValue(row.get("is_output")),
            },
        ];
    });
}

function mapPrincipals(
    principalRows: readonly ReadonlyMap<string, string | undefined>[],
): readonly PrincipalMetadata[] {
    return principalRows.flatMap((row) => {
        const id = row.get("metadata_id");
        const name = row.get("principal_name");
        const kind = row.get("principal_kind") as PrincipalMetadata["kind"] | undefined;
        if (!id || !name || !kind) return [];
        return [
            {
                id,
                database: row.get("database_name"),
                name,
                kind,
                system: booleanValue(row.get("is_system")) || undefined,
            },
        ];
    });
}

function numericObjectId(metadataId: string): number {
    const objectId = metadataId.slice(metadataId.lastIndexOf(":") + 1);
    if (!/^-?\d+$/.test(objectId)) {
        throw new Error(`Invalid metadata object id: ${metadataId}`);
    }
    return Number(objectId);
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
    switch (type?.trim().toLocaleUpperCase()) {
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

function withoutNoLock(query: string): string {
    return query.replaceAll(" WITH (NOLOCK)", "");
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
    CONVERT(nvarchar(256), SERVERPROPERTY('ServerName')) AS server_name,
    compatibility_level
FROM sys.databases WITH (NOLOCK)
WHERE name = DB_NAME();`;

const databasesQuery = `
SELECT name AS database_name
FROM sys.databases WITH (NOLOCK)
WHERE state = 0 AND HAS_DBACCESS(name) = 1
ORDER BY name;`;

const schemasAndPrincipalsQuery = `
SELECT
    N'schema' AS entry_kind,
    DB_NAME() AS database_name,
    CONCAT(N'schema:', DB_ID(), N':', schema_id) AS metadata_id,
    name AS schema_name,
    CAST(NULL AS nvarchar(128)) AS principal_name,
    CAST(NULL AS nvarchar(32)) AS principal_kind,
    CAST(0 AS bit) AS is_system
FROM sys.schemas WITH (NOLOCK)
WHERE principal_id <> 16384
UNION ALL
SELECT
    N'principal',
    NULL,
    CONCAT(N'server-principal:', principal_id),
    NULL,
    name,
    CASE WHEN type = 'R' THEN N'serverRole' ELSE N'login' END,
    CASE WHEN is_fixed_role = 1 OR name LIKE N'##%' THEN 1 ELSE 0 END
FROM sys.server_principals WITH (NOLOCK)
WHERE type IN ('S', 'U', 'G', 'E', 'X', 'R')
UNION ALL
SELECT
    N'principal',
    DB_NAME(),
    CONCAT(N'database-principal:', DB_ID(), N':', principal_id),
    NULL,
    name,
    CASE WHEN type = 'R' THEN N'databaseRole'
         WHEN type = 'A' THEN N'applicationRole'
         ELSE N'user' END,
    CASE WHEN is_fixed_role = 1 OR principal_id <= 4 THEN 1 ELSE 0 END
FROM sys.database_principals WITH (NOLOCK)
WHERE type IN ('S', 'U', 'G', 'E', 'X', 'R', 'A')
  AND name NOT IN (N'public', N'guest')
ORDER BY entry_kind, principal_name, schema_name;`;

const databaseSchemasQuery = (database: string) => `
SELECT name AS schema_name
FROM ${quoteIdentifier(database)}.sys.schemas WITH (NOLOCK)
WHERE principal_id <> 16384
ORDER BY name;`;

const userTypesQuery = (database?: string) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT
    t.user_type_id,
    s.name AS schema_name,
    t.name AS type_name,
    CASE WHEN t.is_table_type = 1 THEN N'table'
         WHEN t.is_assembly_type = 1 THEN N'clr'
         ELSE N'alias' END AS type_category
FROM ${catalog}sys.types AS t WITH (NOLOCK)
JOIN ${catalog}sys.schemas AS s WITH (NOLOCK) ON s.schema_id = t.schema_id
WHERE t.is_user_defined = 1 OR t.is_table_type = 1
ORDER BY s.name, t.name;`;
};

// Large enough to avoid excessive SQL Tools Service round trips, while keeping each simple-query
// response comfortably below the payload size of the reported 58k-object customer catalog.
const objectPageSize = 20_000;
const objectsQuery = (lastObjectId: number) => `
SELECT TOP (${objectPageSize})
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM sys.all_objects AS o WITH (NOLOCK)
JOIN sys.schemas AS s WITH (NOLOCK) ON s.schema_id = o.schema_id
WHERE o.object_id > ${lastObjectId}
  AND o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'SN')
ORDER BY o.object_id;`;

const databaseObjectsQuery = (database: string, lastObjectId: number) => {
    const catalog = quoteIdentifier(database);
    return `
SELECT TOP (${objectPageSize})
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM ${catalog}.sys.all_objects AS o WITH (NOLOCK)
JOIN ${catalog}.sys.schemas AS s WITH (NOLOCK) ON s.schema_id = o.schema_id
WHERE o.object_id > ${lastObjectId}
  AND o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT', 'SN')
ORDER BY o.object_id;`;
};

const columnsQuery = (objectId: number, database?: string) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT
    c.column_id,
    c.name AS column_name,
    ty.name AS type_name,
    c.max_length,
    c.precision,
    c.scale,
    c.is_nullable,
    c.is_identity,
    c.is_computed,
    pkc.key_ordinal AS primary_key_ordinal
FROM ${catalog}sys.all_columns AS c WITH (NOLOCK)
JOIN ${catalog}sys.all_objects AS o WITH (NOLOCK) ON o.object_id = c.object_id
JOIN ${catalog}sys.types AS ty WITH (NOLOCK) ON ty.user_type_id = c.user_type_id
LEFT JOIN ${catalog}sys.indexes AS pki WITH (NOLOCK)
    ON pki.object_id = c.object_id AND pki.is_primary_key = 1
LEFT JOIN ${catalog}sys.index_columns AS pkc WITH (NOLOCK)
    ON pkc.object_id = pki.object_id
    AND pkc.index_id = pki.index_id
    AND pkc.column_id = c.column_id
WHERE o.type IN ('U', 'V', 'IF', 'TF', 'FT')
  AND c.object_id = ${objectId}
ORDER BY c.column_id;`;
};

const parametersQuery = (objectId: number, database?: string) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT
    p.parameter_id,
    p.name AS parameter_name,
    ty.name AS type_name,
    p.max_length,
    p.precision,
    p.scale,
    p.is_output
FROM ${catalog}sys.all_parameters AS p WITH (NOLOCK)
JOIN ${catalog}sys.all_objects AS o WITH (NOLOCK) ON o.object_id = p.object_id
JOIN ${catalog}sys.types AS ty WITH (NOLOCK) ON ty.user_type_id = p.user_type_id
WHERE o.type IN ('P', 'PC', 'FN', 'FS', 'IF', 'TF', 'FT')
  AND p.object_id = ${objectId}
ORDER BY p.parameter_id;`;
};

function quoteIdentifier(value: string): string {
    return `[${value.replaceAll("]", "]]")}]`;
}
