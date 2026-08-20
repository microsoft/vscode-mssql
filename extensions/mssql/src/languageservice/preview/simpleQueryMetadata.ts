/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    decodeObjectTypeCategory,
    decodePrincipalKind,
    decodeSqlBit,
    decodeSqlInt32,
    decodeSqlObjectKind,
    resolveEngineProfile,
    resolveMetadataRuntimeOptions,
    sqlObjectTypeCodes,
    ColumnMetadata,
    MetadataHydrationRequest,
    MetadataRuntimeOptions,
    ObjectMetadata,
    ParameterMetadata,
    PrincipalMetadata,
    SimpleQueryExecutor,
    SimpleQueryMetadataLoader,
    SimpleQueryMetadataPublisher,
    SimpleQueryResult,
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
    private _queryVariant: CatalogQueryVariant = "readUncommitted";
    private readonly _options: MetadataRuntimeOptions;

    public constructor(options: Partial<MetadataRuntimeOptions> = {}) {
        this._options = resolveMetadataRuntimeOptions(options);
    }

    public async refresh(
        executor: SimpleQueryExecutor,
        publisher: SimpleQueryMetadataPublisher,
        signal?: AbortSignal,
    ): Promise<void> {
        // Engine discovery deliberately uses the portable query variant: the result decides
        // whether the remaining catalog reads may use SQL Server's NOLOCK table hint.
        const environmentRows = rows(await executor.execute(environmentQuery, signal));
        const environment = environmentRows[0] ?? new Map<string, string | undefined>();
        const currentDatabase = environment.get("current_database");

        const mappedEnvironment = mapEnvironment(
            environment,
            publisher,
            this._options.defaultSchema,
        );
        const profile = resolveEngineProfile(mappedEnvironment);
        this._queryVariant =
            profile.profile !== "fabric-warehouse" && profile.source !== "outOfScope"
                ? "readUncommitted"
                : "portable";
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

        // Nothing below depends on anything else below it, and the SQL Tools Service opens a
        // dedicated connection for every `query/simpleexecute`, so these overlap for real rather
        // than queueing on one session. That is what the sequential chain was costing: on a
        // throttled server a single-row catalog read still pays a full connect, and the old code
        // paid that toll once per query, in series.
        const databasesTask = (async () => {
            const databaseRows = rows(
                await catalogExecutor.execute(databasesQuery(this._queryVariant), signal),
            );
            const databases = databaseRows.flatMap((row) => {
                const name = row.get("database_name");
                return name ? [{ name }] : [];
            });
            publisher.merge({
                completeness: { databases: "ready" },
                databases,
            });
            return databases;
        })();

        const identityTask = (async () => {
            const identityRows = rows(
                await catalogExecutor.execute(
                    schemasAndPrincipalsQuery(this._queryVariant),
                    signal,
                ),
            );
            const schemaRows = identityRows.filter((row) => row.get("entry_kind") === "schema");
            const schemas = schemaRows.flatMap((row) => {
                const name = row.get("schema_name");
                return name ? [{ database: currentDatabase, name }] : [];
            });
            const principals = mapPrincipals(
                identityRows.filter((row) => row.get("entry_kind") === "principal"),
                publisher,
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
            return { schemas, principals };
        })();

        const userTypesTask = (async () => {
            const typeRows = rows(
                await catalogExecutor.execute(
                    userTypesQuery(undefined, this._queryVariant),
                    signal,
                ),
            );
            return mapUserTypes(typeRows, currentDatabase, publisher);
        })();

        // A user's own objects are what completion needs first, and `sys.objects` is far cheaper
        // to read than `sys.all_objects`, which unions the resource database in -- on a throttled
        // server that difference was several seconds. Publishing the cheap set as `partial` makes
        // the editor usable while the system catalog is still arriving. The full pass is a
        // superset and objects merge by id, so the early set is absorbed rather than duplicated.
        const userObjectsTask = (async () => {
            const userObjects = await this.loadObjectPages(
                catalogExecutor,
                (lastObjectId) =>
                    userObjectsQuery(
                        lastObjectId,
                        this._queryVariant,
                        this._options.objectPageSize,
                    ),
                currentDatabase,
                publisher,
                signal,
            );
            publisher.merge({
                completeness: { objects: "partial" },
                objects: userObjects,
                ...(currentDatabase
                    ? {
                          databaseCatalogCompleteness: new Map([
                              [currentDatabase, { objects: "partial" }],
                          ]),
                      }
                    : {}),
            });
        })();

        const allObjectsTask = this.loadObjectPages(
            catalogExecutor,
            (lastObjectId) =>
                objectsQuery(lastObjectId, this._queryVariant, this._options.objectPageSize),
            currentDatabase,
            publisher,
            signal,
            (page) =>
                publisher.merge({
                    completeness: { objects: "partial" },
                    objects: page,
                    ...(currentDatabase
                        ? {
                              databaseCatalogCompleteness: new Map([
                                  [currentDatabase, { objects: "partial" }],
                              ]),
                          }
                        : {}),
                }),
        );

        const [databases, identity, userTypes, , allObjects] = await Promise.all([
            databasesTask,
            identityTask,
            userTypesTask,
            userObjectsTask,
            allObjectsTask,
        ]);

        // Commit one coherent identity snapshot and invalidate details belonging to the prior
        // generation. Consumers hydrate only the objects they subsequently need.
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
            schemas: identity.schemas,
            objects: [...userTypes, ...allObjects],
            principals: identity.principals,
            ...(currentDatabase
                ? {
                      databaseCatalogCompleteness: new Map([
                          [currentDatabase, { schemas: "ready", objects: "ready" }],
                      ]),
                  }
                : {}),
        });
    }

    /**
     * Reads one object catalog by keyset pagination.
     *
     * `onFirstPage` lets a large catalog show something before it has been read in full; later
     * pages accumulate privately, because rebuilding the immutable indexes for every page is
     * quadratic on 50k-plus object catalogs.
     */
    private async loadObjectPages(
        executor: SimpleQueryExecutor,
        query: (lastObjectId: number) => string,
        database: string | undefined,
        publisher: SimpleQueryMetadataPublisher,
        signal: AbortSignal | undefined,
        onFirstPage?: (objects: readonly ObjectMetadata[]) => void,
    ): Promise<ObjectMetadata[]> {
        const objects: ObjectMetadata[] = [];
        // SQL Server assigns negative IDs to many system catalog objects. Start below the
        // SQL `int` range so system and user objects share the same stable keyset pagination.
        let lastObjectId = -2_147_483_649;
        let announcedFirstPage = false;
        while (true) {
            const objectRows = rows(await executor.execute(query(lastObjectId), signal));
            objects.push(...mapObjects(objectRows, database, publisher));
            const completePage = objectRows.length < this._options.objectPageSize;
            if (
                objects.length > this._options.objectResultLimit ||
                (!completePage && objects.length === this._options.objectResultLimit)
            ) {
                objects.length = this._options.objectResultLimit;
                publisher.reportDataQuality({
                    kind: "truncated",
                    section: "objects",
                    limit: this._options.objectResultLimit,
                });
                return objects;
            }
            if (completePage) return objects;
            if (!announcedFirstPage) {
                announcedFirstPage = true;
                onFirstPage?.(objects);
            }
            const nextObjectId = decodeSqlInt32(objectRows.at(-1)?.get("object_id"));
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
                await catalogExecutor.execute(
                    schemasAndPrincipalsQuery(this._queryVariant),
                    signal,
                ),
            );
            const principals = mapPrincipals(
                identityRows.filter((row) => row.get("entry_kind") === "principal"),
                publisher,
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
                await catalogExecutor.execute(
                    databaseSchemasQuery(request.database, this._queryVariant),
                    signal,
                ),
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
            const database = request.database;
            // The type list and the object pages are independent reads, and each simple execute
            // gets its own connection, so overlapping them costs one connect instead of two.
            const [userTypes, objects] = await Promise.all([
                (async () =>
                    mapUserTypes(
                        rows(
                            await catalogExecutor.execute(
                                userTypesQuery(database, this._queryVariant),
                                signal,
                            ),
                        ),
                        database,
                        publisher,
                    ))(),
                this.loadObjectPages(
                    catalogExecutor,
                    (lastObjectId) =>
                        databaseObjectsQuery(
                            database,
                            lastObjectId,
                            this._queryVariant,
                            this._options.objectPageSize,
                        ),
                    database,
                    publisher,
                    signal,
                    (page) =>
                        publisher.merge({
                            objects: page,
                            databaseCatalogCompleteness: new Map([
                                [database, { objects: "partial" }],
                            ]),
                        }),
                ),
            ]);
            publisher.merge({
                objects: [...userTypes, ...objects],
                databaseCatalogCompleteness: new Map([[database, { objects: "ready" }]]),
            });
            return;
        }
        if (!request.object) return;
        const objectId = numericObjectId(request.object.id);
        if (request.section === "columns") {
            const columnRows = rows(
                await catalogExecutor.execute(
                    columnsQuery(
                        objectId,
                        request.object.database,
                        this._queryVariant,
                        this._options.detailResultLimit + 1,
                    ),
                    signal,
                ),
            );
            const columns = mapColumns(
                limitedDetailRows(
                    columnRows,
                    "columns",
                    this._options.detailResultLimit,
                    publisher,
                ),
                publisher,
            );
            publisher.merge({
                columns: new Map([[request.object.id, columns]]),
                columnStates: new Map([[request.object.id, { kind: "loaded", value: columns }]]),
            });
            return;
        }
        if (request.section === "parameters") {
            const parameterRows = rows(
                await catalogExecutor.execute(
                    parametersQuery(
                        objectId,
                        request.object.database,
                        this._queryVariant,
                        this._options.detailResultLimit + 1,
                    ),
                    signal,
                ),
            );
            const parameters = mapParameters(
                limitedDetailRows(
                    parameterRows,
                    "parameters",
                    this._options.detailResultLimit,
                    publisher,
                ),
                publisher,
            );
            publisher.merge({
                parameters: new Map([[request.object.id, parameters]]),
                parameterStates: new Map([
                    [request.object.id, { kind: "loaded", value: parameters }],
                ]),
            });
        }
    }

    private catalogExecutor(executor: SimpleQueryExecutor): SimpleQueryExecutor {
        return executor;
    }
}

function mapObjects(
    objectRows: readonly ReadonlyMap<string, string | undefined>[],
    currentDatabase: string | undefined,
    publisher: SimpleQueryMetadataPublisher,
): readonly ObjectMetadata[] {
    return objectRows.flatMap((row) => {
        const objectId = row.get("object_id");
        const schema = row.get("schema_name");
        const name = row.get("object_name");
        const kind = decodeSqlObjectKind(row.get("object_type"));
        reportUnknownValue(publisher, "object_type", row.get("object_type"), kind);
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
                system: decodeSqlBit(row.get("is_ms_shipped")) || undefined,
            },
        ];
    });
}

function mapUserTypes(
    typeRows: readonly ReadonlyMap<string, string | undefined>[],
    currentDatabase: string | undefined,
    publisher: SimpleQueryMetadataPublisher,
): readonly ObjectMetadata[] {
    return typeRows.flatMap((row) => {
        const userTypeId = row.get("user_type_id");
        const schema = row.get("schema_name");
        const name = row.get("type_name");
        const typeCategory = decodeObjectTypeCategory(row.get("type_category"));
        reportUnknownValue(publisher, "type_category", row.get("type_category"), typeCategory);
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

function mapEnvironment(
    environment: ReadonlyMap<string, string | undefined>,
    publisher: SimpleQueryMetadataPublisher,
    defaultSchema: string,
) {
    const caseSensitive = decodeSqlBit(environment.get("case_sensitive"));
    const engineEdition = decodeSqlInt32(environment.get("engine_edition"));
    const compatibilityLevel = decodeSqlInt32(environment.get("compatibility_level"));
    reportUnknownValue(publisher, "bit", environment.get("case_sensitive"), caseSensitive);
    reportUnknownValue(publisher, "sql_int", environment.get("engine_edition"), engineEdition);
    reportUnknownValue(
        publisher,
        "sql_int",
        environment.get("compatibility_level"),
        compatibilityLevel,
    );
    return {
        currentDatabase: environment.get("current_database"),
        defaultSchema: environment.get("default_schema") ?? defaultSchema,
        caseSensitive: caseSensitive ?? false,
        engineEdition,
        serverVersion: environment.get("server_version"),
        compatibilityLevel,
        serverName: environment.get("server_name"),
    };
}

function mapColumns(
    columnRows: readonly ReadonlyMap<string, string | undefined>[],
    publisher: SimpleQueryMetadataPublisher,
): readonly ColumnMetadata[] {
    return columnRows.flatMap((row) => {
        const name = row.get("column_name");
        if (!name) return [];
        const nullable = decodeSqlBit(row.get("is_nullable"));
        const identity = decodeSqlBit(row.get("is_identity"));
        const computed = decodeSqlBit(row.get("is_computed"));
        const primaryKeyOrdinal = decodeSqlInt32(row.get("primary_key_ordinal"));
        reportUnknownValue(publisher, "bit", row.get("is_nullable"), nullable);
        reportUnknownValue(publisher, "bit", row.get("is_identity"), identity);
        reportUnknownValue(publisher, "bit", row.get("is_computed"), computed);
        reportUnknownValue(publisher, "sql_int", row.get("primary_key_ordinal"), primaryKeyOrdinal);
        return [
            {
                name,
                typeDisplay: displayType(row, publisher),
                nullable,
                identity: identity || undefined,
                computed: computed || undefined,
                primaryKeyOrdinal,
            },
        ];
    });
}

function mapParameters(
    parameterRows: readonly ReadonlyMap<string, string | undefined>[],
    publisher: SimpleQueryMetadataPublisher,
): readonly ParameterMetadata[] {
    return parameterRows.flatMap((row) => {
        const ordinal = decodeSqlInt32(row.get("parameter_id"));
        reportUnknownValue(publisher, "sql_int", row.get("parameter_id"), ordinal);
        if (ordinal === undefined) return [];
        const output = decodeSqlBit(row.get("is_output"));
        reportUnknownValue(publisher, "bit", row.get("is_output"), output);
        return [
            {
                ordinal,
                name: row.get("parameter_name") ?? "",
                typeDisplay: displayType(row, publisher),
                output,
            },
        ];
    });
}

function mapPrincipals(
    principalRows: readonly ReadonlyMap<string, string | undefined>[],
    publisher: SimpleQueryMetadataPublisher,
): readonly PrincipalMetadata[] {
    return principalRows.flatMap((row) => {
        const id = row.get("metadata_id");
        const name = row.get("principal_name");
        const kind = decodePrincipalKind(row.get("principal_kind"));
        reportUnknownValue(publisher, "principal_kind", row.get("principal_kind"), kind);
        if (!id || !name || !kind) return [];
        return [
            {
                id,
                database: row.get("database_name"),
                name,
                kind,
                system: decodeSqlBit(row.get("is_system")) || undefined,
            },
        ];
    });
}

function numericObjectId(metadataId: string): number {
    const objectId = metadataId.slice(metadataId.lastIndexOf(":") + 1);
    const decoded = decodeSqlInt32(objectId);
    if (decoded === undefined) {
        throw new Error(`Invalid metadata object id: ${metadataId}`);
    }
    return decoded;
}

function rows(result: SimpleQueryResult): readonly ReadonlyMap<string, string | undefined>[] {
    return result.rows.map((values) => {
        const row = new Map<string, string | undefined>();
        for (let index = 0; index < result.columns.length; index++) {
            const value = values[index];
            row.set(
                result.columns[index]!.name.toLowerCase(),
                value === undefined ? undefined : String(value),
            );
        }
        return row;
    });
}

function metadataObjectId(database: string | undefined, objectId: string): string {
    return `${database ?? ""}:${objectId}`;
}

function displayType(
    row: ReadonlyMap<string, string | undefined>,
    publisher: SimpleQueryMetadataPublisher,
): string | undefined {
    const name = row.get("type_name");
    if (!name) return undefined;
    const lower = name.toLowerCase();
    const maxLength = decodeSqlInt32(row.get("max_length"));
    reportUnknownValue(publisher, "sql_int", row.get("max_length"), maxLength);
    if (["varchar", "char", "varbinary", "binary"].includes(lower) && maxLength !== undefined) {
        return `${name}(${maxLength === -1 ? "max" : maxLength})`;
    }
    if (["nvarchar", "nchar"].includes(lower) && maxLength !== undefined) {
        return `${name}(${maxLength === -1 ? "max" : maxLength / 2})`;
    }
    const precision = decodeSqlInt32(row.get("precision"));
    const scale = decodeSqlInt32(row.get("scale"));
    reportUnknownValue(publisher, "sql_int", row.get("precision"), precision);
    reportUnknownValue(publisher, "sql_int", row.get("scale"), scale);
    if (["decimal", "numeric"].includes(lower) && precision !== undefined && scale !== undefined) {
        return `${name}(${precision},${scale})`;
    }
    if (["datetime2", "datetimeoffset", "time"].includes(lower) && scale !== undefined) {
        return `${name}(${scale})`;
    }
    return name;
}

function reportUnknownValue(
    publisher: SimpleQueryMetadataPublisher,
    field: "object_type" | "type_category" | "principal_kind" | "bit" | "sql_int",
    raw: string | undefined,
    decoded: unknown,
): void {
    if (raw !== undefined && raw.trim().length > 0 && decoded === undefined) {
        publisher.reportDataQuality({ kind: "unknownValue", field });
    }
}

function limitedDetailRows(
    input: readonly ReadonlyMap<string, string | undefined>[],
    section: "columns" | "parameters",
    limit: number,
    publisher: SimpleQueryMetadataPublisher,
): readonly ReadonlyMap<string, string | undefined>[] {
    if (input.length <= limit) return input;
    publisher.reportDataQuality({ kind: "truncated", section, limit });
    return input.slice(0, limit);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
}

type CatalogQueryVariant = "readUncommitted" | "portable";

/** SQL Server permits NOLOCK on catalog views; Fabric Warehouse does not. */
function catalogReadHint(variant: CatalogQueryVariant): string {
    return variant === "readUncommitted" ? " WITH (NOLOCK)" : "";
}

function objectTypeFilter(capability?: "columns" | "parameters"): string {
    return sqlObjectTypeCodes(capability)
        .map((code) => `'${code}'`)
        .join(", ");
}

const environmentQuery = `
SELECT
    DB_NAME() AS current_database,
    COALESCE(
        (SELECT default_schema_name FROM sys.database_principals WHERE name = USER_NAME()),
        N'dbo'
    ) AS default_schema,
    CASE WHEN CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) LIKE N'%[_]CS[_]%'
         THEN 1 ELSE 0 END AS case_sensitive,
    CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engine_edition,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS server_version,
    CONVERT(nvarchar(256), SERVERPROPERTY('ServerName')) AS server_name,
    compatibility_level
FROM sys.databases
WHERE name = DB_NAME();`;

const databasesQuery = (variant: CatalogQueryVariant) => `
SELECT name AS database_name
FROM sys.databases${catalogReadHint(variant)}
WHERE state = 0 AND HAS_DBACCESS(name) = 1
ORDER BY name;`;

/**
 * Every character column carries `COLLATE DATABASE_DEFAULT` because the branches disagree.
 *
 * `sys.database_principals` and `sys.schemas` are database-scoped and carry the database
 * collation; `sys.server_principals` is server-scoped and carries the server's. On Fabric Data
 * Warehouse those genuinely differ -- a warehouse is `Latin1_General_100_BIN2_UTF8` while the
 * shared metadata layer stays `SQL_Latin1_General_CP1_CI_AS` -- so `principal_name` arrives at the
 * UNION ALL with two collations and the statement fails with Msg 451, taking the whole catalog
 * load down with it. Fabric rejects the union at the SELECT, not only at the ORDER BY, so dropping
 * the sort does not avoid it; the collation has to be stated. Boxed SQL Server and Azure SQL never
 * hit this, which is why it went unnoticed until a Fabric endpoint was used.
 */
const schemasAndPrincipalsQuery = (variant: CatalogQueryVariant) => `
SELECT
    N'schema' COLLATE DATABASE_DEFAULT AS entry_kind,
    DB_NAME() AS database_name,
    CONCAT(N'schema:', DB_ID(), N':', schema_id) AS metadata_id,
    name COLLATE DATABASE_DEFAULT AS schema_name,
    CAST(NULL AS nvarchar(128)) COLLATE DATABASE_DEFAULT AS principal_name,
    CAST(NULL AS nvarchar(32)) COLLATE DATABASE_DEFAULT AS principal_kind,
    CAST(0 AS bit) AS is_system
FROM sys.schemas${catalogReadHint(variant)}
WHERE principal_id <> 16384
UNION ALL
SELECT
    N'principal' COLLATE DATABASE_DEFAULT,
    NULL,
    CONCAT(N'server-principal:', principal_id),
    NULL,
    name COLLATE DATABASE_DEFAULT,
    CASE WHEN type = 'R' THEN N'serverRole' ELSE N'login' END COLLATE DATABASE_DEFAULT,
    CASE WHEN is_fixed_role = 1 OR name LIKE N'##%' THEN 1 ELSE 0 END
FROM sys.server_principals${catalogReadHint(variant)}
WHERE type IN ('S', 'U', 'G', 'E', 'X', 'R')
UNION ALL
SELECT
    N'principal' COLLATE DATABASE_DEFAULT,
    DB_NAME(),
    CONCAT(N'database-principal:', DB_ID(), N':', principal_id),
    NULL,
    name COLLATE DATABASE_DEFAULT,
    CASE WHEN type = 'R' THEN N'databaseRole'
         WHEN type = 'A' THEN N'applicationRole'
         ELSE N'user' END COLLATE DATABASE_DEFAULT,
    CASE WHEN is_fixed_role = 1 OR principal_id <= 4 THEN 1 ELSE 0 END
FROM sys.database_principals${catalogReadHint(variant)}
WHERE type IN ('S', 'U', 'G', 'E', 'X', 'R', 'A')
  AND name NOT IN (N'public', N'guest')
ORDER BY entry_kind, principal_name, schema_name;`;

const databaseSchemasQuery = (database: string, variant: CatalogQueryVariant) => `
SELECT name AS schema_name
FROM ${quoteIdentifier(database)}.sys.schemas${catalogReadHint(variant)}
WHERE principal_id <> 16384
ORDER BY name;`;

const userTypesQuery = (database: string | undefined, variant: CatalogQueryVariant) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT
    t.user_type_id,
    s.name AS schema_name,
    t.name AS type_name,
    CASE WHEN t.is_table_type = 1 THEN N'table'
         WHEN t.is_assembly_type = 1 THEN N'clr'
         ELSE N'alias' END AS type_category
FROM ${catalog}sys.types AS t${catalogReadHint(variant)}
JOIN ${catalog}sys.schemas AS s${catalogReadHint(variant)} ON s.schema_id = t.schema_id
WHERE t.is_user_defined = 1 OR t.is_table_type = 1
ORDER BY s.name, t.name;`;
};

/**
 * The user's own objects, without the resource database `sys.all_objects` unions in.
 *
 * Same shape and same keyset cursor as {@link objectsQuery}, so the two are interchangeable to
 * the pager and the full pass is a strict superset of this one.
 */
const userObjectsQuery = (lastObjectId: number, variant: CatalogQueryVariant, pageSize: number) => `
SELECT TOP (${pageSize})
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM sys.objects AS o${catalogReadHint(variant)}
JOIN sys.schemas AS s${catalogReadHint(variant)} ON s.schema_id = o.schema_id
WHERE o.object_id > ${lastObjectId}
  AND o.type IN (${objectTypeFilter()})
ORDER BY o.object_id;`;

const objectsQuery = (lastObjectId: number, variant: CatalogQueryVariant, pageSize: number) => `
SELECT TOP (${pageSize})
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM sys.all_objects AS o${catalogReadHint(variant)}
JOIN sys.schemas AS s${catalogReadHint(variant)} ON s.schema_id = o.schema_id
WHERE o.object_id > ${lastObjectId}
  AND o.type IN (${objectTypeFilter()})
ORDER BY o.object_id;`;

const databaseObjectsQuery = (
    database: string,
    lastObjectId: number,
    variant: CatalogQueryVariant,
    pageSize: number,
) => {
    const catalog = quoteIdentifier(database);
    return `
SELECT TOP (${pageSize})
    o.object_id,
    s.name AS schema_name,
    o.name AS object_name,
    o.type AS object_type,
    o.is_ms_shipped
FROM ${catalog}.sys.all_objects AS o${catalogReadHint(variant)}
JOIN ${catalog}.sys.schemas AS s${catalogReadHint(variant)} ON s.schema_id = o.schema_id
WHERE o.object_id > ${lastObjectId}
  AND o.type IN (${objectTypeFilter()})
ORDER BY o.object_id;`;
};

const columnsQuery = (
    objectId: number,
    database: string | undefined,
    variant: CatalogQueryVariant,
    resultLimit: number,
) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT TOP (${resultLimit})
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
FROM ${catalog}sys.all_columns AS c${catalogReadHint(variant)}
JOIN ${catalog}sys.all_objects AS o${catalogReadHint(variant)} ON o.object_id = c.object_id
JOIN ${catalog}sys.types AS ty${catalogReadHint(variant)} ON ty.user_type_id = c.user_type_id
LEFT JOIN ${catalog}sys.indexes AS pki${catalogReadHint(variant)}
    ON pki.object_id = c.object_id AND pki.is_primary_key = 1
LEFT JOIN ${catalog}sys.index_columns AS pkc${catalogReadHint(variant)}
    ON pkc.object_id = pki.object_id
    AND pkc.index_id = pki.index_id
    AND pkc.column_id = c.column_id
WHERE o.type IN (${objectTypeFilter("columns")})
  AND c.object_id = ${objectId}
ORDER BY c.column_id;`;
};

const parametersQuery = (
    objectId: number,
    database: string | undefined,
    variant: CatalogQueryVariant,
    resultLimit: number,
) => {
    const catalog = database ? `${quoteIdentifier(database)}.` : "";
    return `
SELECT TOP (${resultLimit})
    p.parameter_id,
    p.name AS parameter_name,
    ty.name AS type_name,
    p.max_length,
    p.precision,
    p.scale,
    p.is_output
FROM ${catalog}sys.all_parameters AS p${catalogReadHint(variant)}
JOIN ${catalog}sys.all_objects AS o${catalogReadHint(variant)} ON o.object_id = p.object_id
JOIN ${catalog}sys.types AS ty${catalogReadHint(variant)} ON ty.user_type_id = p.user_type_id
WHERE o.type IN (${objectTypeFilter("parameters")})
  AND p.object_id = ${objectId}
ORDER BY p.parameter_id;`;
};

function quoteIdentifier(value: string): string {
    return `[${value.replaceAll("]", "]]")}]`;
}
