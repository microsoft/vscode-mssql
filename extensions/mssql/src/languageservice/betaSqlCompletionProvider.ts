/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    MappingCatalogProvider,
    SaralSqlAnalysisEngine,
    createCompletionResolveData,
    type SqlAnalysisSnapshot,
    type SqlCatalogColumn,
    type SqlCatalogMapping,
    type SqlCatalogMappingLeaf,
    type SqlCatalogProvider,
    type SqlCompletion,
    type SqlDiagnostic,
    type SqlSymbol,
    type SqlToken,
} from "@vscode-mssql/tsql-language-service";
import { RequestType } from "vscode-languageclient";
import type { SimpleExecuteResult } from "vscode-mssql";
import * as Constants from "../constants/constants";
import { BetaLanguageService as loc } from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import { getLogger } from "../models/logger";
import { getPreviewConfigKey, PreviewFeature } from "../previews/previewService";
import { ILogger } from "../sharedInterfaces/logger";
import { getUriKey } from "../utils/utils";
import { betaSqlOwnsDocument, forgetSqlDocumentOwnership } from "./betaSqlLanguageServiceOwnership";
import SqlToolsServiceClient from "./serviceclient";
import { tsqlReservedKeywords } from "./tsqlKeywords";
import {
    updateFromVsCodeDocument,
    type TsqlDocumentService,
    type TsqlLangiumDocument,
    type TsqlSqlLanguageServices,
    TsqlVsCodeFeatureProviders,
} from "./langium";
import { createTsqlSqlLanguageServices } from "./langium/sqlLanguageServices";
import {
    ScriptingDefinitionProvider,
    catalogObjectFromMultipart,
    type ScriptingDefinitionScriptingApi,
} from "./scriptingDefinitionProvider";

export interface DatabaseObject {
    server?: string;
    database?: string;
    schema: string;
    name: string;
    type: "table" | "view" | "scalarFunction" | "tableValuedFunction" | "storedProcedure";
    baseObject?: ObjectReference;
}

interface ObjectReference {
    server?: string;
    database?: string;
    schema?: string;
    name: string;
}

interface ObjectMember {
    name: string;
    type: string;
    nullable?: boolean;
    insertable?: boolean;
}

interface QualifiedPrefix {
    qualifiers: string[];
    prefix: string;
}

interface InsertColumnContext {
    target: ObjectReference;
    usedColumns: Set<string>;
    contentStartOffset: number;
    canExpand: boolean;
}

interface SelectStarExpansionContext {
    startOffset: number;
    endOffset: number;
}

interface ExecuteParameterContext {
    routine: ObjectReference;
    prefix: string;
    usedParameters: Set<string>;
}

interface RoutineCallContext {
    routine: ObjectReference;
    activeParameter: number;
    kind: "function" | "execute";
}

interface InsertValuesContext {
    target: ObjectReference;
    columns?: string[];
    activeParameter: number;
}

type CreateTableCompletionKind =
    | "tableName"
    | "columnName"
    | "definition"
    | "dataType"
    | "typeArgument"
    | "columnOption"
    | "nullKeyword"
    | "keyKeyword"
    | "constraintType"
    | "localColumn"
    | "referencesKeyword"
    | "referenceTable"
    | "referenceColumn"
    | "expression";

interface CreateTableCompletionContext {
    kind: CreateTableCompletionKind;
    table?: ObjectReference;
    columns: ObjectMember[];
    prefix: string;
    qualifiers?: string[];
    referencedTable?: ObjectReference;
    usedColumns?: Set<string>;
    typeName?: string;
}

type AnalysisDiagnostic = SqlDiagnostic;
type Column = SqlCatalogColumn;
type Completion = SqlCompletion;
type Sym = SqlSymbol;
type Token = SqlToken;
type SchemaMapping = SqlCatalogMapping;
type SchemaLeaf = SqlCatalogMappingLeaf;

interface SchemaProvider extends SqlCatalogProvider {
    columnsFor(parts: readonly string[], dialect?: string): readonly Column[] | undefined;
    tableCandidates?(parts: readonly string[], dialect?: string): readonly (readonly string[])[];
    childrenOf?(
        prefixParts: readonly string[],
        dialect?: string,
    ): readonly {
        name: string;
        kind: "namespace" | "table";
    }[];
    tables?(dialect?: string): readonly string[];
}

class Schema extends MappingCatalogProvider implements SchemaProvider {
    public constructor(mapping: SchemaMapping) {
        super(mapping);
    }
}

interface ConnectionMetadata {
    databases?: Promise<string[]>;
    schemas: Map<string, Promise<string[]>>;
    objectSearches: Map<string, Promise<DatabaseObject[]>>;
    objects: Map<string, Promise<DatabaseObject | undefined>>;
    members: Map<string, Promise<ObjectMember[]>>;
    referenceLoads: Map<string, Promise<void>>;
}

export interface ObjectSearch {
    server?: string;
    database?: string;
    schema?: string;
    prefix?: string;
    types?: DatabaseObject["type"][];
}

const simpleExecuteRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

const metadataFailureCooldownMs = 2_000;
const maximumObjectSuggestions = 200;
const maximumMetadataReferencesPerBatch = 128;
const supportedObjectTypes = "'U', 'V', 'FN', 'IF', 'TF', 'P', 'PC'";
const systemDatabaseNames = new Set(["master", "model", "msdb", "tempdb"]);
const systemSchemaNames = new Set([
    "db_accessadmin",
    "db_backupoperator",
    "db_datareader",
    "db_datawriter",
    "db_ddladmin",
    "db_denydatareader",
    "db_denydatawriter",
    "db_owner",
    "db_securityadmin",
    "dbmanager",
    "guest",
    "information_schema",
    "loginmanager",
    "sys",
]);
const completionAnalysisEngine = new SaralSqlAnalysisEngine();
const tsqlDataTypes = [
    "bigint",
    "binary",
    "bit",
    "char",
    "date",
    "datetime",
    "datetime2",
    "datetimeoffset",
    "decimal",
    "float",
    "geography",
    "geometry",
    "hierarchyid",
    "image",
    "int",
    "money",
    "nchar",
    "ntext",
    "numeric",
    "nvarchar",
    "real",
    "smalldatetime",
    "smallint",
    "smallmoney",
    "sql_variant",
    "text",
    "time",
    "timestamp",
    "tinyint",
    "uniqueidentifier",
    "varbinary",
    "varchar",
    "xml",
] as const;
const createTableDefinitionKeywords = [
    "CONSTRAINT",
    "PRIMARY KEY",
    "FOREIGN KEY",
    "UNIQUE",
    "CHECK",
    "PERIOD FOR SYSTEM_TIME",
] as const;
const createTableColumnOptions = [
    "NULL",
    "NOT NULL",
    "IDENTITY",
    "DEFAULT",
    "PRIMARY KEY",
    "UNIQUE",
    "REFERENCES",
    "CHECK",
    "COLLATE",
    "SPARSE",
    "ROWGUIDCOL",
    "GENERATED ALWAYS AS ROW START",
    "GENERATED ALWAYS AS ROW END",
    "MASKED WITH",
] as const;
type MetadataFetchType = "databases" | "schemas" | "objects" | "members";
type MetadataStatus = "idle" | "loading" | "ready" | "error";

export interface SessionResult {
    session: SqlAnalysisSnapshot;
    schema: SchemaProvider;
    metadataComplete: boolean;
    document: TsqlLangiumDocument;
}

interface SessionCacheEntry {
    connectionId?: string;
    documentVersion: number;
    generation: string;
    /** Remote metadata only; document DDL is applied by the offset-aware analysis adapter. */
    schema: BetaSqlDocumentSchema;
    /** Compatibility view for extension helpers that still consume local inferred columns. */
    featureSchema?: SchemaProvider;
    session: SqlAnalysisSnapshot;
    document: TsqlLangiumDocument;
    promise?: Promise<SessionResult | undefined>;
}

function requireAnalysisSnapshot(document: TsqlLangiumDocument): SqlAnalysisSnapshot {
    return document.analysis;
}

/**
 * A stable catalog-provider identity for one editor. The package can retain its cross-edit parse cache
 * while this provider bumps its version whenever connection or local-object metadata changes.
 */
class BetaSqlDocumentSchema implements SchemaProvider {
    private _schema = new Schema({});
    private _version = 0;
    private _world: "open" | "closed" = "open";
    private _fingerprint = "";

    public get version(): number {
        return this._version;
    }

    public get world(): "open" | "closed" {
        return this._world;
    }

    public update(mapping: SchemaMapping, complete: boolean): void {
        const fingerprint = JSON.stringify(mapping);
        const world = complete ? "closed" : "open";
        if (fingerprint === this._fingerprint && world === this._world) {
            return;
        }
        this._schema = new Schema(mapping);
        this._fingerprint = fingerprint;
        this._world = world;
        this._version++;
    }

    public columnsFor(parts: readonly string[], _dialect = "tsql"): readonly Column[] | undefined {
        return this._schema.columnsFor(parts);
    }

    public objectFor(parts: readonly string[]) {
        return this._schema.objectFor(parts);
    }

    public tableCandidates(
        parts: readonly string[],
        _dialect = "tsql",
    ): readonly (readonly string[])[] {
        return this._schema.tableCandidates(parts);
    }

    public childrenOf(
        prefixParts: readonly string[],
        _dialect = "tsql",
    ): readonly { name: string; kind: "namespace" | "table" }[] {
        return this._schema.childrenOf(prefixParts);
    }

    public tables(_dialect = "tsql"): readonly string[] {
        return this._schema.tables();
    }
}

class OverlaySchemaProvider implements SchemaProvider {
    public readonly version: string | number;
    public readonly world: "open" | "closed";

    constructor(
        private readonly _primary: SchemaProvider,
        private readonly _fallback?: SchemaProvider,
    ) {
        this.version = `${_primary.version}:${_fallback?.version ?? 0}`;
        this.world = _fallback?.world === "closed" ? "closed" : "open";
    }

    public columnsFor(parts: readonly string[], dialect = "tsql"): readonly Column[] | undefined {
        return (
            this._primary.columnsFor(parts, dialect) ?? this._fallback?.columnsFor(parts, dialect)
        );
    }

    public objectFor(parts: readonly string[]) {
        return this._primary.objectFor?.(parts) ?? this._fallback?.objectFor?.(parts);
    }

    public tableCandidates(
        parts: readonly string[],
        dialect = "tsql",
    ): readonly (readonly string[])[] {
        return deduplicatePaths([
            ...(this._primary.tableCandidates?.(parts, dialect) ?? []),
            ...(this._fallback?.tableCandidates?.(parts, dialect) ?? []),
        ]);
    }

    public childrenOf(
        prefixParts: readonly string[],
        dialect = "tsql",
    ): readonly { name: string; kind: "namespace" | "table" }[] {
        const children = [
            ...(this._primary.childrenOf?.(prefixParts, dialect) ?? []),
            ...(this._fallback?.childrenOf?.(prefixParts, dialect) ?? []),
        ];
        return children.filter(
            (child, index) =>
                children.findIndex(
                    (candidate) =>
                        candidate.kind === child.kind &&
                        candidate.name.toLowerCase() === child.name.toLowerCase(),
                ) === index,
        );
    }

    public tables(dialect = "tsql"): readonly string[] {
        return [
            ...new Set([
                ...this._primary.tables(dialect),
                ...(this._fallback?.tables(dialect) ?? []),
            ]),
        ];
    }
}

export class BetaSqlMetadataCatalog implements vscode.Disposable {
    private readonly _metadata = new Map<string, ConnectionMetadata>();
    private readonly _ownerUris = new Map<string, string>();
    private readonly _retryAfter = new Map<string, number>();
    private readonly _status = new Map<string, MetadataStatus>();
    private readonly _activeRequests = new Map<string, number>();
    private readonly _requestFailures = new Set<string>();
    private readonly _synonymTargets = new Map<string, string>();
    private readonly _statusChanged = new vscode.EventEmitter<string>();
    private _generation = 0;
    private readonly _connectionGenerations = new Map<string, number>();

    public readonly onDidChangeStatus = this._statusChanged.event;

    constructor(
        private readonly _client: SqlToolsServiceClient,
        private readonly _logger: ILogger = getLogger("BetaSqlMetadataCatalog"),
    ) {}

    public get generation(): number {
        return this._generation;
    }

    public generationFor(connectionId?: string): string {
        return `${this._generation}:${connectionId ? (this._connectionGenerations.get(connectionId) ?? 0) : 0}`;
    }

    public getStatus(connectionId: string): MetadataStatus {
        return this._status.get(connectionId) ?? "idle";
    }

    public setOwnerUri(connectionId: string, ownerUri: string): void {
        this._ownerUris.set(connectionId, ownerUri);
    }

    public getDatabases(connectionId: string): Promise<string[]> {
        const metadata = this.getConnectionMetadata(connectionId);
        metadata.databases ??= this.loadSingleColumn(
            connectionId,
            "databases",
            `SELECT name
FROM sys.databases WITH (NOLOCK)
WHERE state = 0
ORDER BY name`,
        ).catch((error) => {
            metadata.databases = undefined;
            throw error;
        });
        return metadata.databases;
    }

    public getSchemas(connectionId: string, database?: string): Promise<string[]> {
        const metadata = this.getConnectionMetadata(connectionId);
        const key = database?.toLocaleLowerCase() ?? "";
        return this.getOrCreate(metadata.schemas, key, () => {
            const catalog = database ? `${this.quoteIdentifier(database)}.` : "";
            return this.loadSingleColumn(
                connectionId,
                "schemas",
                `SELECT name
FROM ${catalog}sys.schemas WITH (NOLOCK)
WHERE name <> 'INFORMATION_SCHEMA'
ORDER BY name`,
            );
        });
    }

    public searchObjects(connectionId: string, search: ObjectSearch): Promise<DatabaseObject[]> {
        const metadata = this.getConnectionMetadata(connectionId);
        const key = [
            search.server,
            search.database,
            search.schema,
            search.prefix,
            [...(search.types ?? [])].sort().join(","),
        ]
            .map((value) => value?.toLowerCase() ?? "")
            .join("|");
        return this.getOrCreate(metadata.objectSearches, key, async () => {
            const objects = await this.loadObjects(connectionId, search, false);
            for (const object of objects) {
                metadata.objects.set(this.objectKey(object), Promise.resolve(object));
            }
            return objects;
        });
    }

    public getObject(
        connectionId: string,
        reference: ObjectReference,
    ): Promise<DatabaseObject | undefined> {
        const metadata = this.getConnectionMetadata(connectionId);
        const key = this.objectKey(reference);
        const existing = metadata.objects.get(key);
        if (existing && metadata.members.has(key)) {
            return existing;
        }
        return this.primeReferences(connectionId, [reference]).then(
            () => metadata.objects.get(key) ?? Promise.resolve(undefined),
        );
    }

    public async getMembers(connectionId: string, object: DatabaseObject): Promise<string[]> {
        return (await this.getMemberMetadata(connectionId, object)).map((member) => member.name);
    }

    public getMembersWithTypes(
        connectionId: string,
        object: DatabaseObject,
    ): Promise<ObjectMember[]> {
        return this.getMemberMetadata(connectionId, object);
    }

    private getMemberMetadata(
        connectionId: string,
        object: DatabaseObject,
    ): Promise<ObjectMember[]> {
        const metadata = this.getConnectionMetadata(connectionId);
        const key = this.objectKey(object);
        const existing = metadata.members.get(key);
        if (existing) {
            return existing;
        }
        return this.primeReferences(connectionId, [object]).then(
            () => metadata.members.get(key) ?? Promise.resolve([]),
        );
    }

    public async createSchema(
        connectionId: string,
        references: Iterable<ObjectReference>,
        additionalMapping: SchemaMapping = {},
    ): Promise<Schema> {
        return new Schema(
            await this.createSchemaMapping(connectionId, references, additionalMapping),
        );
    }

    public async createSchemaMapping(
        connectionId: string,
        references: Iterable<ObjectReference>,
        additionalMapping: SchemaMapping = {},
    ): Promise<SchemaMapping> {
        const mapping: SchemaMapping = { ...additionalMapping };
        const uniqueReferences = new Map<string, ObjectReference>();
        for (const reference of references) {
            uniqueReferences.set(this.objectKey(reference), reference);
        }
        await this.primeReferences(connectionId, [...uniqueReferences.values()]);
        const loadedObjects = await Promise.all(
            [...uniqueReferences.values()].map(async (reference) => {
                const object = await this.getObject(connectionId, reference);
                return object
                    ? { object, members: await this.getMemberMetadata(connectionId, object) }
                    : {};
            }),
        );
        for (const loadedObject of loadedObjects) {
            if (!loadedObject.object || !loadedObject.members) {
                continue;
            }
            const parts = [
                loadedObject.object.server,
                loadedObject.object.database,
                loadedObject.object.schema,
                loadedObject.object.name,
            ].filter((part): part is string => Boolean(part));
            let container = mapping;
            for (const part of parts.slice(0, -1)) {
                const child = container[part];
                if (!child || typeof child === "string" || "type" in child) {
                    container[part] = {};
                }
                container = container[part] as SchemaMapping;
            }
            container[parts.at(-1)!] = Object.fromEntries(
                loadedObject.members.map((member) => [
                    member.name,
                    { type: member.type, nullable: member.nullable },
                ]),
            );
        }
        return mapping;
    }

    private async primeReferences(
        connectionId: string,
        references: ObjectReference[],
    ): Promise<void> {
        const metadata = this.getConnectionMetadata(connectionId);
        const pending: Promise<void>[] = [];
        const fresh = new Map<string, ObjectReference>();
        for (const reference of references) {
            const key = this.objectKey(reference);
            const existing = metadata.referenceLoads.get(key);
            if (existing) {
                pending.push(existing);
            } else if (!metadata.objects.has(key) || !metadata.members.has(key)) {
                fresh.set(key, reference);
            }
        }
        const groups = new Map<string, ObjectReference[]>();
        for (const reference of fresh.values()) {
            const key = [
                reference.server?.toLowerCase() ?? "",
                reference.database?.toLowerCase() ?? "",
            ].join("|");
            const group = groups.get(key) ?? [];
            group.push(reference);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            // Keep metadata requests bounded for generated scripts that reference hundreds or
            // thousands of objects. Smaller batches also let independent catalog requests finish
            // and populate the shared cache without waiting behind one very large VALUES clause.
            for (let start = 0; start < group.length; start += maximumMetadataReferencesPerBatch) {
                const batch = group.slice(start, start + maximumMetadataReferencesPerBatch);
                const load = this.loadReferenceBatch(connectionId, batch).finally(() => {
                    for (const reference of batch) {
                        const key = this.objectKey(reference);
                        if (metadata.referenceLoads.get(key) === load) {
                            metadata.referenceLoads.delete(key);
                        }
                    }
                });
                for (const reference of batch) {
                    metadata.referenceLoads.set(this.objectKey(reference), load);
                }
                pending.push(load);
            }
        }
        await Promise.all(pending);
    }

    private async loadReferenceBatch(
        connectionId: string,
        references: ObjectReference[],
    ): Promise<void> {
        if (references.length === 0) {
            return;
        }
        const metadata = this.getConnectionMetadata(connectionId);
        const catalog = this.catalogPrefix(references[0]);
        const values = references
            .map(
                (reference) =>
                    `(N'${this.quoteLiteral(this.objectKey(reference))}', ${
                        reference.schema
                            ? `N'${this.quoteLiteral(reference.schema)}'`
                            : "CAST(NULL AS nvarchar(128))"
                    }, N'${this.quoteLiteral(reference.name)}')`,
            )
            .join(",\n        ");
        const result = await this.execute(
            connectionId,
            "members",
            `WITH Requested(RequestKey, RequestedSchema, RequestedName) AS (
    SELECT RequestKey, RequestedSchema, RequestedName
    FROM (VALUES
        ${values}
    ) requested(RequestKey, RequestedSchema, RequestedName)
), CatalogObjects AS (
    SELECT s.name AS SchemaName, o.name AS ObjectName, o.type AS SqlObjectType,
        o.object_id AS ResolvedObjectId, CAST(NULL AS nvarchar(1035)) AS BaseObjectName
    FROM ${catalog}sys.all_objects o WITH (NOLOCK)
    JOIN ${catalog}sys.schemas s WITH (NOLOCK) ON s.schema_id = o.schema_id
    WHERE o.type IN (${supportedObjectTypes})
    UNION ALL
    SELECT s.name, sn.name, target.type, target.object_id, sn.base_object_name
    FROM ${catalog}sys.synonyms sn WITH (NOLOCK)
    JOIN ${catalog}sys.schemas s WITH (NOLOCK) ON s.schema_id = sn.schema_id
    LEFT JOIN ${catalog}sys.all_objects target WITH (NOLOCK)
        ON target.object_id = OBJECT_ID(sn.base_object_name)
), Candidates AS (
    SELECT requested.RequestKey, objects.SchemaName, objects.ObjectName,
        objects.SqlObjectType, objects.ResolvedObjectId, objects.BaseObjectName,
        ROW_NUMBER() OVER (
            PARTITION BY requested.RequestKey
            ORDER BY CASE
                WHEN requested.RequestedSchema IS NOT NULL THEN 0
                WHEN objects.SchemaName = SCHEMA_NAME() THEN 0
                WHEN objects.SchemaName = N'dbo' THEN 1
                ELSE 2
            END,
            objects.SchemaName
        ) AS MatchOrder
    FROM Requested requested
    JOIN CatalogObjects objects
        ON objects.ObjectName = requested.RequestedName
        AND (requested.RequestedSchema IS NULL OR objects.SchemaName = requested.RequestedSchema)
), Members AS (
    SELECT m.object_id AS ObjectId, m.name AS MemberName,
        CASE
            WHEN ty.name IN ('nvarchar', 'nchar') AND m.max_length <> -1
                THEN CONCAT(ty.name, '(', m.max_length / 2, ')')
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary')
                THEN CONCAT(ty.name, '(', CASE WHEN m.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), m.max_length) END, ')')
            WHEN ty.name IN ('decimal', 'numeric')
                THEN CONCAT(ty.name, '(', m.precision, ',', m.scale, ')')
            WHEN ty.name IN ('datetime2', 'datetimeoffset', 'time')
                THEN CONCAT(ty.name, '(', m.scale, ')')
            ELSE ty.name
        END AS TypeName,
        m.column_id AS Ordinal, N'relation' AS MemberKind, m.is_nullable AS IsNullable,
        CONVERT(bit, CASE
            WHEN m.is_identity = 0 AND m.is_computed = 0
                AND m.generated_always_type = 0 AND m.is_hidden = 0
                AND ty.name NOT IN ('timestamp', 'rowversion')
                THEN 1
            ELSE 0
        END) AS IsInsertable
    FROM ${catalog}sys.all_columns m WITH (NOLOCK)
    JOIN ${catalog}sys.types ty WITH (NOLOCK) ON ty.user_type_id = m.user_type_id
    UNION ALL
    SELECT m.object_id, m.name,
        CASE
            WHEN ty.name IN ('nvarchar', 'nchar') AND m.max_length <> -1
                THEN CONCAT(ty.name, '(', m.max_length / 2, ')')
            WHEN ty.name IN ('varchar', 'char', 'varbinary', 'binary')
                THEN CONCAT(ty.name, '(', CASE WHEN m.max_length = -1 THEN 'max' ELSE CONVERT(varchar(10), m.max_length) END, ')')
            WHEN ty.name IN ('decimal', 'numeric')
                THEN CONCAT(ty.name, '(', m.precision, ',', m.scale, ')')
            WHEN ty.name IN ('datetime2', 'datetimeoffset', 'time')
                THEN CONCAT(ty.name, '(', m.scale, ')')
            ELSE ty.name
        END,
        m.parameter_id, N'routine', CAST(NULL AS bit), CAST(NULL AS bit)
    FROM ${catalog}sys.all_parameters m WITH (NOLOCK)
    JOIN ${catalog}sys.types ty WITH (NOLOCK) ON ty.user_type_id = m.user_type_id
)
SELECT candidates.RequestKey, candidates.SchemaName, candidates.ObjectName,
    CASE
        WHEN candidates.SqlObjectType = 'U' THEN 'table'
        WHEN candidates.SqlObjectType = 'V' THEN 'view'
        WHEN candidates.SqlObjectType = 'FN' THEN 'scalarFunction'
        WHEN candidates.SqlObjectType IN ('IF', 'TF') THEN 'tableValuedFunction'
        WHEN candidates.SqlObjectType IN ('P', 'PC') THEN 'storedProcedure'
    END AS ObjectType,
    candidates.BaseObjectName, members.MemberName, members.TypeName,
    members.IsNullable, members.IsInsertable
FROM Candidates candidates
LEFT JOIN Members members
    ON members.ObjectId = candidates.ResolvedObjectId
    AND ((candidates.SqlObjectType IN ('U', 'V', 'IF', 'TF') AND members.MemberKind = N'relation')
        OR (candidates.SqlObjectType IN ('FN', 'P', 'PC') AND members.MemberKind = N'routine'))
WHERE candidates.MatchOrder = 1
ORDER BY candidates.RequestKey, members.Ordinal`,
        );

        const loaded = new Map<string, { object: DatabaseObject; members: ObjectMember[] }>();
        const unresolvedSynonyms = new Map<
            string,
            { schema: string; name: string; target: ObjectReference }
        >();
        for (const row of result.rows) {
            const requestKey = this.cellValue(row, 0);
            const schema = this.cellValue(row, 1);
            const name = this.cellValue(row, 2);
            const type = this.cellValue(row, 3);
            const baseObject = parseObjectReference(this.cellValue(row, 4));
            if (
                requestKey &&
                schema &&
                name &&
                baseObject &&
                (!this.isObjectType(type) || baseObject.server || baseObject.database)
            ) {
                unresolvedSynonyms.set(requestKey, {
                    schema,
                    name,
                    target: this.inheritCatalog(baseObject, references[0]),
                });
                continue;
            }
            if (!requestKey || !schema || !name || !this.isObjectType(type)) {
                continue;
            }
            let item = loaded.get(requestKey);
            if (!item) {
                item = {
                    object: {
                        server: references[0].server,
                        database: references[0].database,
                        schema,
                        name,
                        type,
                        baseObject,
                    },
                    members: [],
                };
                loaded.set(requestKey, item);
            }
            const memberName = this.cellValue(row, 5);
            if (memberName) {
                const nullable = this.cellValue(row, 7);
                const insertable = this.cellValue(row, 8);
                item.members.push({
                    name: memberName,
                    type: this.cellValue(row, 6) ?? "unknown",
                    nullable:
                        nullable === undefined
                            ? undefined
                            : nullable === "1" || nullable.toLocaleLowerCase() === "true",
                    insertable:
                        insertable === undefined
                            ? undefined
                            : insertable === "1" || insertable.toLocaleLowerCase() === "true",
                });
            }
        }
        const resolveSynonym = async (
            requestKey: string,
            resolving = new Set<string>(),
        ): Promise<{ object: DatabaseObject; members: ObjectMember[] } | undefined> => {
            const existing = loaded.get(requestKey);
            if (existing) {
                return existing;
            }
            const synonym = unresolvedSynonyms.get(requestKey);
            if (!synonym || resolving.has(requestKey)) {
                return undefined;
            }
            const nextResolving = new Set(resolving).add(requestKey);
            const targetKey = this.objectKey(synonym.target);
            const batchedTarget = await resolveSynonym(targetKey, nextResolving);
            let target = batchedTarget?.object;
            if (!target) {
                const sourceResolutionKey = `${connectionId}|${requestKey}`;
                const targetResolutionKey = `${connectionId}|${targetKey}`;
                if (this.wouldCreateSynonymCycle(sourceResolutionKey, targetResolutionKey)) {
                    return undefined;
                }
                this._synonymTargets.set(sourceResolutionKey, targetResolutionKey);
                try {
                    target = await this.getObject(connectionId, synonym.target);
                } finally {
                    if (this._synonymTargets.get(sourceResolutionKey) === targetResolutionKey) {
                        this._synonymTargets.delete(sourceResolutionKey);
                    }
                }
            }
            if (!target) {
                return undefined;
            }
            const item = {
                object: {
                    server: references[0].server,
                    database: references[0].database,
                    schema: synonym.schema,
                    name: synonym.name,
                    type: target.type,
                    baseObject: synonym.target,
                },
                members:
                    batchedTarget?.members ?? (await this.getMemberMetadata(connectionId, target)),
            } satisfies { object: DatabaseObject; members: ObjectMember[] };
            loaded.set(requestKey, item);
            return item;
        };
        for (const requestKey of unresolvedSynonyms.keys()) {
            await resolveSynonym(requestKey);
        }
        for (const reference of references) {
            const requestKey = this.objectKey(reference);
            const item = loaded.get(requestKey);
            metadata.objects.set(requestKey, Promise.resolve(item?.object));
            metadata.members.set(requestKey, Promise.resolve(item?.members ?? []));
            if (item) {
                const fullKey = this.objectKey(item.object);
                metadata.objects.set(fullKey, Promise.resolve(item.object));
                metadata.members.set(fullKey, Promise.resolve(item.members));
            }
        }
    }

    public clear(connectionId?: string): void {
        if (connectionId) {
            this._connectionGenerations.set(
                connectionId,
                (this._connectionGenerations.get(connectionId) ?? 0) + 1,
            );
            this._metadata.delete(connectionId);
            this._status.delete(connectionId);
            this._requestFailures.delete(connectionId);
            this.deleteConnectionFailures(connectionId);
            this._statusChanged.fire(connectionId);
        } else {
            this._generation++;
            this._connectionGenerations.clear();
            this._metadata.clear();
            this._ownerUris.clear();
            this._retryAfter.clear();
            this._status.clear();
            this._requestFailures.clear();
            this._statusChanged.fire("");
        }
    }

    public retainConnections(connectionIds: ReadonlySet<string>): void {
        for (const connectionId of this._metadata.keys()) {
            if (!connectionIds.has(connectionId)) {
                this.clear(connectionId);
            }
        }
        for (const connectionId of this._ownerUris.keys()) {
            if (!connectionIds.has(connectionId)) {
                this._ownerUris.delete(connectionId);
            }
        }
    }

    public dispose(): void {
        this.clear();
        this._statusChanged.dispose();
    }

    private getConnectionMetadata(connectionId: string): ConnectionMetadata {
        let metadata = this._metadata.get(connectionId);
        if (!metadata) {
            metadata = {
                schemas: new Map(),
                objectSearches: new Map(),
                objects: new Map(),
                members: new Map(),
                referenceLoads: new Map(),
            };
            this._metadata.set(connectionId, metadata);
        }
        return metadata;
    }

    private async loadObjects(
        connectionId: string,
        search: ObjectSearch | ObjectReference,
        exact: boolean,
    ): Promise<DatabaseObject[]> {
        const catalog = this.catalogPrefix(search);
        const predicates: string[] = [];
        if (search.schema) {
            predicates.push(`SchemaName = N'${this.quoteLiteral(search.schema)}'`);
        }
        if ("name" in search) {
            predicates.push(`ObjectName = N'${this.quoteLiteral(search.name)}'`);
        } else if (search.prefix) {
            predicates.push(
                `ObjectName LIKE N'${this.quoteLikePrefix(search.prefix)}%' ESCAPE N'~'`,
            );
        }
        if ("types" in search && search.types && search.types.length > 0) {
            predicates.push(
                `ObjectType IN (${search.types
                    .map((type) => `N'${this.quoteLiteral(type)}'`)
                    .join(", ")})`,
            );
        }
        const orderBy = exact
            ? "ORDER BY CASE WHEN SchemaName = SCHEMA_NAME() THEN 0 WHEN SchemaName = 'dbo' THEN 1 ELSE 2 END, SchemaName, ObjectName"
            : "ORDER BY SchemaName, ObjectName";
        const top = exact ? "" : `TOP (${maximumObjectSuggestions + 1}) `;
        const result = await this.execute(
            connectionId,
            "objects",
            `SELECT ${top}SchemaName, ObjectName, ObjectType, BaseObjectName
FROM (
    SELECT s.name AS SchemaName, o.name AS ObjectName,
    CASE
        WHEN o.type = 'U' THEN 'table'
        WHEN o.type = 'V' THEN 'view'
        WHEN o.type IN ('P', 'PC') THEN 'storedProcedure'
        WHEN o.type = 'FN' THEN 'scalarFunction'
        ELSE 'tableValuedFunction'
    END AS ObjectType,
        CAST(NULL AS nvarchar(1035)) AS BaseObjectName
    FROM ${catalog}sys.all_objects o WITH (NOLOCK)
    JOIN ${catalog}sys.schemas s WITH (NOLOCK) ON s.schema_id = o.schema_id
    WHERE o.type IN (${supportedObjectTypes})
        ${search.schema?.toLocaleLowerCase() === "sys" ? "" : "AND o.is_ms_shipped = 0"}
    UNION ALL
    SELECT s.name, sn.name,
        CASE
            WHEN target.type = 'U' THEN 'table'
            WHEN target.type = 'V' THEN 'view'
            WHEN target.type IN ('P', 'PC') THEN 'storedProcedure'
            WHEN target.type = 'FN' THEN 'scalarFunction'
            WHEN target.type IN ('IF', 'TF') THEN 'tableValuedFunction'
        END,
        sn.base_object_name
    FROM ${catalog}sys.synonyms sn WITH (NOLOCK)
    JOIN ${catalog}sys.schemas s WITH (NOLOCK) ON s.schema_id = sn.schema_id
    LEFT JOIN ${catalog}sys.all_objects target WITH (NOLOCK)
        ON target.object_id = OBJECT_ID(sn.base_object_name)
) objects
${predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : ""}
${orderBy}`,
        );
        const objects = await Promise.all(
            result.rows.map(async (row): Promise<DatabaseObject | undefined> => {
                const schema = this.cellValue(row, 0);
                const name = this.cellValue(row, 1);
                const type = this.cellValue(row, 2);
                if (!schema || !name) {
                    return undefined;
                }
                const baseObject = parseObjectReference(this.cellValue(row, 3));
                if (
                    this.isObjectType(type) &&
                    (!baseObject || (!baseObject.server && !baseObject.database))
                ) {
                    return {
                        server: search.server,
                        database: search.database,
                        schema,
                        name,
                        type,
                        baseObject,
                    } satisfies DatabaseObject;
                }
                if (!baseObject) {
                    return undefined;
                }
                const target = await this.getObject(
                    connectionId,
                    this.inheritCatalog(baseObject, search),
                );
                return target
                    ? ({
                          server: search.server,
                          database: search.database,
                          schema,
                          name,
                          type: target.type,
                          baseObject,
                      } satisfies DatabaseObject)
                    : undefined;
            }),
        );
        return objects
            .filter((object): object is DatabaseObject => Boolean(object))
            .filter(
                (object) =>
                    (!("types" in search) || !search.types || search.types.includes(object.type)) &&
                    (!("prefix" in search) ||
                        !search.prefix ||
                        object.name.toLowerCase().startsWith(search.prefix.toLowerCase())),
            )
            .slice(0, maximumObjectSuggestions);
    }

    private async loadSingleColumn(
        connectionId: string,
        fetchType: MetadataFetchType,
        query: string,
    ): Promise<string[]> {
        const result = await this.execute(connectionId, fetchType, query);
        return result.rows.flatMap((row) => {
            const value = this.cellValue(row, 0);
            return value ? [value] : [];
        });
    }

    private getOrCreate<T>(
        cache: Map<string, Promise<T>>,
        key: string,
        loader: () => Promise<T>,
    ): Promise<T> {
        const existing = cache.get(key);
        if (existing) {
            return existing;
        }
        const value = loader().catch((error) => {
            cache.delete(key);
            throw error;
        });
        cache.set(key, value);
        return value;
    }

    private objectKey(object: ObjectReference): string {
        return [object.server, object.database, object.schema, object.name]
            .map((value) => value?.toLowerCase() ?? "")
            .join("|");
    }

    private quoteIdentifier(value: string): string {
        return `[${value.replaceAll("]", "]]")}]`;
    }

    private quoteLiteral(value: string): string {
        return value.replaceAll("'", "''");
    }

    private quoteLikePrefix(value: string): string {
        return this.quoteLiteral(value)
            .replaceAll("~", "~~")
            .replaceAll("%", "~%")
            .replaceAll("_", "~_")
            .replaceAll("[", "~[");
    }

    private catalogPrefix(reference: Pick<ObjectReference, "server" | "database">): string {
        const parts = [reference.server, reference.database].filter((part): part is string =>
            Boolean(part),
        );
        return parts.length > 0
            ? `${parts.map((part) => this.quoteIdentifier(part)).join(".")}.`
            : "";
    }

    private isObjectType(value: string | undefined): value is DatabaseObject["type"] {
        return (
            value === "table" ||
            value === "view" ||
            value === "scalarFunction" ||
            value === "tableValuedFunction" ||
            value === "storedProcedure"
        );
    }

    private inheritCatalog(
        reference: ObjectReference,
        catalog: Pick<ObjectReference, "server" | "database">,
    ): ObjectReference {
        return {
            server: reference.server ?? catalog.server,
            database: reference.database ?? catalog.database,
            schema: reference.schema,
            name: reference.name,
        };
    }

    private wouldCreateSynonymCycle(source: string, target: string): boolean {
        let current: string | undefined = target;
        const visited = new Set<string>();
        while (current && !visited.has(current)) {
            if (current === source) {
                return true;
            }
            visited.add(current);
            current = this._synonymTargets.get(current);
        }
        return false;
    }

    private async execute(
        connectionId: string,
        fetchType: MetadataFetchType,
        queryString: string,
        token?: vscode.CancellationToken,
    ): Promise<SimpleExecuteResult> {
        return this.executeRequest(connectionId, fetchType, queryString, token);
    }

    private async executeRequest(
        connectionId: string,
        fetchType: MetadataFetchType,
        queryString: string,
        token?: vscode.CancellationToken,
    ): Promise<SimpleExecuteResult> {
        const failureKey = `${connectionId}|${fetchType}|${queryString}`;
        const retryAfter = this._retryAfter.get(failureKey) ?? 0;
        if (retryAfter > Date.now()) {
            throw new Error("Metadata fetch is temporarily paused after a previous failure.");
        }

        const ownerUri = this._ownerUris.get(connectionId);
        if (!ownerUri) {
            throw new Error("No connected owner URI is available for metadata fetches.");
        }

        const startTime = performance.now();
        this.setRequestStarted(connectionId);
        this._logger.info("Metadata fetch started", { fetchType });
        try {
            const result = await Promise.resolve(
                this._client.sendRequest(
                    simpleExecuteRequest,
                    {
                        ownerUri,
                        queryString,
                    },
                    token,
                ),
            );
            this._retryAfter.delete(failureKey);
            this.setRequestFinished(connectionId, true);
            this._logger.info("Metadata fetch completed", {
                fetchType,
                rowCount: result.rowCount,
                durationMs: Math.round(performance.now() - startTime),
            });
            return result;
        } catch (error) {
            this._retryAfter.set(failureKey, Date.now() + metadataFailureCooldownMs);
            this.setRequestFinished(connectionId, false);
            this._logger.error("Metadata fetch failed", {
                fetchType,
                durationMs: Math.round(performance.now() - startTime),
                error,
            });
            throw error;
        }
    }

    private setRequestStarted(connectionId: string): void {
        if (!this._activeRequests.has(connectionId)) {
            this._requestFailures.delete(connectionId);
        }
        this._activeRequests.set(connectionId, (this._activeRequests.get(connectionId) ?? 0) + 1);
        if (this._status.get(connectionId) !== "loading") {
            this._status.set(connectionId, "loading");
            this._statusChanged.fire(connectionId);
        }
    }

    private setRequestFinished(connectionId: string, succeeded: boolean): void {
        if (!succeeded) {
            this._requestFailures.add(connectionId);
        }
        const remaining = Math.max(0, (this._activeRequests.get(connectionId) ?? 1) - 1);
        if (remaining > 0) {
            this._activeRequests.set(connectionId, remaining);
            if (!succeeded) {
                this._status.set(connectionId, "error");
                this._statusChanged.fire(connectionId);
            }
            return;
        }
        this._activeRequests.delete(connectionId);
        this._status.set(connectionId, this._requestFailures.has(connectionId) ? "error" : "ready");
        this._statusChanged.fire(connectionId);
    }

    private deleteConnectionFailures(connectionId: string): void {
        const prefix = `${connectionId}|`;
        for (const key of this._retryAfter.keys()) {
            if (key.startsWith(prefix)) {
                this._retryAfter.delete(key);
            }
        }
    }

    private cellValue(row: SimpleExecuteResult["rows"][number], index: number): string | undefined {
        const cell = row[index];
        if (!cell || cell.isNull) {
            return undefined;
        }
        const value = cell.displayValue.trim();
        return value || undefined;
    }
}

/** Reuses package parsing and catalog analysis across every provider and document edit. */
export class BetaSqlSessionManager implements vscode.Disposable {
    private readonly _entries = new Map<string, SessionCacheEntry>();
    private readonly _langium = createTsqlSqlLanguageServices();

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog: BetaSqlMetadataCatalog,
    ) {}

    /** Langium's current immutable document snapshots, shared by every LSP feature. */
    public get documents(): TsqlDocumentService {
        return this._langium.documents;
    }

    /** Langium-composed protocol providers sharing this manager's document lifecycle. */
    public get languageServices(): TsqlSqlLanguageServices {
        return this._langium;
    }

    public getSession(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken,
    ): Promise<SessionResult | undefined> {
        const entry = this.ensureSession(document, token);
        if (!entry) {
            return Promise.resolve(undefined);
        }
        const result = waitForCancellation(
            entry.promise ?? Promise.resolve(this.toSessionResult(entry)),
            token,
        );
        return result.then((value) =>
            value && this.isCurrent(document, entry) ? value : undefined,
        );
    }

    /**
     * Returns the current parse immediately and starts metadata enrichment in the background.
     * Structural editor features must not wait for a database round trip.
     */
    public getParsedSession(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken,
    ): SessionResult | undefined {
        const entry = this.ensureSession(document, token);
        return entry ? this.toSessionResult(entry) : undefined;
    }

    private ensureSession(
        document: vscode.TextDocument,
        token?: vscode.CancellationToken,
    ): SessionCacheEntry | undefined {
        if (token?.isCancellationRequested) {
            return undefined;
        }
        const uri = getUriKey(document.uri);
        const connectionId = this._connectionManager.getConnectionInfo(uri)?.connectionId;
        const generation = this._catalog.generationFor(connectionId);
        const existing = this._entries.get(uri);
        if (
            existing?.documentVersion === document.version &&
            existing.connectionId === connectionId &&
            existing.generation === generation
        ) {
            return existing;
        }

        const canReuse = existing !== undefined && existing.connectionId === connectionId;
        const schema = canReuse ? existing.schema : new BetaSqlDocumentSchema();
        const text = getParseableEditorText(document.getText());
        const langiumDocument = updateFromVsCodeDocument(this.documents, document, {
            catalog: {
                provider: schema,
                revision: `${generation}:pending`,
                connectionId,
            },
            parseText: text,
            cancellationToken: token,
        });
        const entry: SessionCacheEntry = {
            connectionId,
            documentVersion: document.version,
            generation,
            schema,
            session: requireAnalysisSnapshot(langiumDocument),
            document: langiumDocument,
        };
        this._entries.set(uri, entry);
        entry.promise = this.buildSession(document, entry);
        return entry;
    }

    public invalidate(documentUri?: vscode.Uri): void {
        if (documentUri) {
            const uri = getUriKey(documentUri);
            this._entries.delete(uri);
            this.documents.delete(uri);
        } else {
            this._entries.clear();
            this.documents.clear();
        }
    }

    public retainConnections(connectionIds: ReadonlySet<string>): void {
        for (const [uri, entry] of this._entries) {
            if (entry.connectionId && !connectionIds.has(entry.connectionId)) {
                this._entries.delete(uri);
                this.documents.delete(uri);
            }
        }
    }

    public dispose(): void {
        this.invalidate();
    }

    private async buildSession(
        document: vscode.TextDocument,
        entry: SessionCacheEntry,
    ): Promise<SessionResult | undefined> {
        let remoteMapping: SchemaMapping = {};
        let metadataComplete = false;
        if (entry.connectionId) {
            const ownerUri = getUriKey(document.uri);
            this._catalog.setOwnerUri(entry.connectionId, ownerUri);
            const references = new Map<string, ObjectReference>();
            const documentText = document.getText();
            const localQualifierNames = new Set(
                entry.session
                    .symbols()
                    .filter((symbol) =>
                        ["alias", "cte", "subquery", "lateral", "column", "tempTable"].includes(
                            symbol.kind,
                        ),
                    )
                    .filter((symbol) => !symbol.name.includes("."))
                    .map((symbol) => symbol.name.toLocaleLowerCase()),
            );
            for (const reference of entry.session.externalReferences()) {
                const parts = reference.nameParts ?? splitMultipartIdentifier(reference.name);
                if (
                    (reference.kind === "function" &&
                        (parts.length === 1 ||
                            localQualifierNames.has(parts[0]?.toLocaleLowerCase()))) ||
                    /^\s*\./u.test(documentText.slice(reference.span.end))
                ) {
                    continue;
                }
                const objectReference = objectReferenceFromParts(parts);
                if (objectReference) {
                    references.set(
                        formatObjectReference(objectReference).toLocaleLowerCase(),
                        objectReference,
                    );
                }
            }
            collectTextObjectReferences(documentText, references);
            const remoteReferences = [...references.values()].filter(
                (reference) => !isLocalObjectName(reference.name),
            );
            try {
                remoteMapping = await this._catalog.createSchemaMapping(
                    entry.connectionId,
                    remoteReferences,
                );
                metadataComplete = true;
            } catch {
                metadataComplete = false;
            }
        }

        const localMapping = getLocalSchemaMapping(
            document.getText(),
            hasSchemaEntries(remoteMapping) ? new Schema(remoteMapping) : undefined,
        );
        if (this.isCurrent(document, entry)) {
            // Never publish final-script CREATE TABLE declarations as a global catalog. The
            // package's DocumentSchemaEvolution resolves them at each occurrence offset, so
            // references before CREATE and after DROP retain SQL Server's MSSQL208 behavior.
            entry.schema.update(remoteMapping, metadataComplete);
            entry.featureSchema = hasSchemaEntries(localMapping)
                ? new OverlaySchemaProvider(new Schema(localMapping), entry.schema)
                : entry.schema;
            entry.document = updateFromVsCodeDocument(this.documents, document, {
                catalog: {
                    provider: entry.schema,
                    revision: `${entry.generation}:${entry.schema.version}`,
                    connectionId: entry.connectionId,
                },
                parseText: entry.session.text,
            });
            entry.session = requireAnalysisSnapshot(entry.document);
        } else {
            return undefined;
        }
        return this.toSessionResult(entry, metadataComplete);
    }

    private isCurrent(document: vscode.TextDocument, entry: SessionCacheEntry): boolean {
        return (
            this._entries.get(getUriKey(document.uri)) === entry &&
            entry.documentVersion === document.version &&
            entry.generation === this._catalog.generationFor(entry.connectionId) &&
            this.documents.isCurrent(entry.document)
        );
    }

    private toSessionResult(
        entry: SessionCacheEntry,
        metadataComplete = entry.schema.world === "closed",
    ): SessionResult {
        return {
            session: entry.session,
            schema: entry.featureSchema ?? entry.schema,
            metadataComplete,
            document: entry.document,
        };
    }
}

function waitForCancellation<T>(
    promise: Promise<T>,
    token?: vscode.CancellationToken,
): Promise<T | undefined> {
    if (!token) {
        return promise;
    }
    if (token.isCancellationRequested) {
        return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve, reject) => {
        const subscription = token.onCancellationRequested(() => {
            subscription.dispose();
            resolve(undefined);
        });
        void promise.then(
            (value) => {
                subscription.dispose();
                resolve(value);
            },
            (error) => {
                subscription.dispose();
                reject(error);
            },
        );
    });
}

export class BetaSqlCompletionProvider implements vscode.CompletionItemProvider {
    private readonly _completionResolveData = new WeakMap<
        vscode.CompletionItem,
        ReturnType<typeof createCompletionResolveData>
    >();

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog = new BetaSqlMetadataCatalog(SqlToolsServiceClient.instance),
        private readonly _sessions = new BetaSqlSessionManager(_connectionManager, _catalog),
    ) {}

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
        context?: vscode.CompletionContext,
    ): Promise<vscode.CompletionItem[]> {
        if (!betaSqlOwnsDocument(document)) {
            return [];
        }
        if (isExplicitRelationAliasPosition(document, position)) {
            return [];
        }
        const finalize = (items: vscode.CompletionItem[]): vscode.CompletionItem[] =>
            this.prepareCompletionItems(items, document, position);

        const createTableContext = getCreateTableCompletionContext(document, position);
        if (createTableContext) {
            const staticItems = this.getCreateTableStaticItems(createTableContext);
            if (staticItems !== undefined) {
                return finalize(staticItems);
            }
        }

        const starExpansionContext = getSelectStarExpansionContext(document, position);
        if (
            context?.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter &&
            context.triggerCharacter === "*" &&
            !starExpansionContext
        ) {
            return [];
        }
        const qualifiers = this.getQualifiers(document, position);
        const qualifiedPrefix =
            qualifiers.length === 0 ? this.getQualifiedPrefix(document, position) : undefined;
        const insertColumnContext = this.getInsertColumnContext(document, position);
        const executeParameterContext = this.getExecuteParameterContext(document, position);
        const relationPosition = this.isRelationPosition(document, position);
        const executePosition = this.isExecutePosition(document, position);
        const objectTypes: DatabaseObject["type"][] | undefined = relationPosition
            ? ["table", "view", "tableValuedFunction"]
            : executePosition
              ? ["storedProcedure"]
              : undefined;
        const references = relationPosition
            ? new Map<string, ObjectReference>()
            : this.getObjectReferences(document, position, Boolean(qualifiedPrefix));
        const fallbackItems = this.getKeywordItems(document, position);
        const connection = this._connectionManager.getConnectionInfo(getUriKey(document.uri));
        const requestedVersion = document.version;
        if (
            connection?.connectionId &&
            relationPosition &&
            (qualifiers.length > 0 || qualifiedPrefix)
        ) {
            this._catalog.setOwnerUri(connection.connectionId, getUriKey(document.uri));
            try {
                const items = qualifiedPrefix
                    ? await this.getQualifiedItems(
                          connection.connectionId,
                          qualifiedPrefix.qualifiers,
                          qualifiedPrefix.prefix,
                          objectTypes,
                      )
                    : await this.getQualifiedItems(
                          connection.connectionId,
                          qualifiers,
                          "",
                          objectTypes,
                      );
                return token?.isCancellationRequested || document.version !== requestedVersion
                    ? []
                    : finalize(items);
            } catch {
                if (token?.isCancellationRequested || document.version !== requestedVersion) {
                    return [];
                }
                // Preserve grammar/local completion if the direct catalog lookup is unavailable.
            }
        }

        const sessionPromise = this._sessions.getSession(document, token);
        const sessionResult = await sessionPromise;
        if (!sessionResult || token?.isCancellationRequested) {
            return [];
        }
        if (isRelationAliasSymbolAt(sessionResult.session, document.offsetAt(position))) {
            return [];
        }
        if (createTableContext) {
            const metadataItems = await this.getCreateTableMetadataItems(
                createTableContext,
                sessionResult.schema,
                connection?.connectionId,
            );
            if (metadataItems !== undefined) {
                return finalize(metadataItems);
            }
        }
        if (starExpansionContext) {
            const expansion = this.getSelectStarExpansionItem(
                document,
                sessionResult.session,
                starExpansionContext,
            );
            if (expansion) {
                return finalize([expansion]);
            }
            if (
                context?.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter &&
                context.triggerCharacter === "*"
            ) {
                return [];
            }
        }
        if (insertColumnContext && !connection?.connectionId) {
            const localItems = this.createInsertCompletionItems(
                document,
                position,
                insertColumnContext,
                this.getSchemaObjectMembers(sessionResult.schema, insertColumnContext.target),
            );
            if (localItems.length > 0) {
                return finalize(localItems);
            }
        }
        const schemaItems = this.getSchemaMemberItems(
            document,
            sessionResult.schema,
            references,
            qualifiers.length > 0 ? qualifiers : qualifiedPrefix?.qualifiers,
            qualifiedPrefix?.prefix ?? "",
        );
        if (schemaItems.length > 0) {
            return finalize(schemaItems);
        }
        const recoveredCteItems = getRecoveredCteProjectionItems(document, position);
        if (recoveredCteItems.length > 0) {
            return finalize(recoveredCteItems);
        }
        if (!connection?.connectionId) {
            return finalize(
                this.mergeItems(
                    this.getAnalysisItems(document, position, undefined, sessionResult.session),
                    fallbackItems,
                ),
            );
        }
        this._catalog.setOwnerUri(connection.connectionId, getUriKey(document.uri));

        try {
            if (insertColumnContext) {
                const prefix = this.getCurrentPrefix(document, position);
                const object = await this._catalog.getObject(
                    connection.connectionId,
                    insertColumnContext.target,
                );
                const members = object
                    ? await this._catalog.getMembersWithTypes(connection.connectionId, object)
                    : this.getSchemaObjectMembers(sessionResult.schema, insertColumnContext.target);
                const columnItems = this.createInsertCompletionItems(
                    document,
                    position,
                    insertColumnContext,
                    members,
                    prefix,
                );
                return columnItems.length > 0
                    ? finalize(columnItems)
                    : finalize(
                          this.mergeItems(
                              this.getAnalysisItems(
                                  document,
                                  position,
                                  undefined,
                                  sessionResult.session,
                              ),
                              fallbackItems,
                          ),
                      );
            }
            if (executeParameterContext) {
                const object = await this._catalog.getObject(
                    connection.connectionId,
                    executeParameterContext.routine,
                );
                if (object?.type === "storedProcedure") {
                    const parameters = await this._catalog.getMembersWithTypes(
                        connection.connectionId,
                        object,
                    );
                    const items = parameters
                        .filter(
                            (parameter) =>
                                !executeParameterContext.usedParameters.has(
                                    parameter.name.toLowerCase(),
                                ) &&
                                this.startsWithCaseInsensitive(
                                    parameter.name,
                                    executeParameterContext.prefix,
                                ),
                        )
                        .map((parameter) => {
                            const item = new vscode.CompletionItem(
                                parameter.name,
                                vscode.CompletionItemKind.Variable,
                            );
                            item.detail = parameter.type;
                            item.insertText = `${parameter.name} = `;
                            item.sortText = `0_${parameter.name}`;
                            return item;
                        });
                    if (items.length > 0) {
                        return finalize(items);
                    }
                }
            }
            const analysisItems = this.getAnalysisItems(
                document,
                position,
                undefined,
                sessionResult.session,
            );
            if (qualifiers.length > 0) {
                const reference = references.get(qualifiers[0].toLocaleLowerCase());
                if (reference) {
                    const columnItems = analysisItems.filter(
                        (item) => item.kind === vscode.CompletionItemKind.Field,
                    );
                    return columnItems.length > 0
                        ? finalize(columnItems)
                        : finalize(
                              await this.getQualifiedItems(
                                  connection.connectionId,
                                  qualifiers,
                                  "",
                                  objectTypes,
                              ),
                          );
                }
                return finalize(
                    await this.getQualifiedItems(
                        connection.connectionId,
                        qualifiers,
                        "",
                        objectTypes,
                    ),
                );
            }
            if (qualifiedPrefix) {
                const reference = references.get(
                    qualifiedPrefix.qualifiers[0]?.toLocaleLowerCase(),
                );
                if (reference) {
                    const columnItems = analysisItems.filter(
                        (item) => item.kind === vscode.CompletionItemKind.Field,
                    );
                    if (columnItems.length > 0) {
                        return finalize(columnItems);
                    }
                }
                return finalize(
                    this.mergeItems(
                        await this.getQualifiedItems(
                            connection.connectionId,
                            qualifiedPrefix.qualifiers,
                            qualifiedPrefix.prefix,
                            objectTypes,
                        ),
                        analysisItems,
                    ),
                );
            }
            if (executePosition) {
                const prefix = this.getCurrentPrefix(document, position);
                const routines = await this._catalog.searchObjects(connection.connectionId, {
                    prefix: prefix || undefined,
                    types: ["storedProcedure"],
                });
                return finalize(
                    this.mergeItems(
                        routines.map((object) => this.createObjectItem(object, true)),
                        this.mergeItems(analysisItems, fallbackItems),
                    ),
                );
            }
            if (!relationPosition) {
                return finalize(this.mergeItems(analysisItems, fallbackItems));
            }
            return this.getRootItems(
                connection.connectionId,
                document,
                position,
                this.mergeItems(analysisItems, fallbackItems),
                token,
            );
        } catch {
            return finalize(
                this.mergeItems(
                    this.getAnalysisItems(document, position, undefined, sessionResult.session),
                    fallbackItems,
                ),
            );
        }
    }

    public async resolveCompletionItem(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken,
    ): Promise<vscode.CompletionItem> {
        const data = this._completionResolveData.get(item);
        if (!data || token.isCancellationRequested) {
            return item;
        }
        const resolved =
            await this._sessions.languageServices.lsp.CompletionResolveProvider.resolveCompletionItem(
                {
                    label: completionItemLabel(item),
                    detail: item.detail,
                    documentation:
                        typeof item.documentation === "string" ? item.documentation : undefined,
                    data,
                },
            );
        if (!token.isCancellationRequested) {
            item.detail = resolved.detail;
            if (resolved.documentation !== undefined) {
                item.documentation =
                    typeof resolved.documentation === "string"
                        ? resolved.documentation
                        : resolved.documentation.value;
            }
        }
        return item;
    }

    private async getRootItems(
        connectionId: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        keywordItems: vscode.CompletionItem[],
        token?: vscode.CancellationToken,
    ): Promise<vscode.CompletionItem[]> {
        const prefix = this.getCurrentPrefix(document, position);
        const [databases, schemas, objects] = await Promise.all([
            this._catalog.getDatabases(connectionId).catch(() => []),
            this._catalog.getSchemas(connectionId).catch(() => []),
            this._catalog
                .searchObjects(connectionId, {
                    prefix: prefix || undefined,
                    types: ["table", "view", "tableValuedFunction"],
                })
                .catch(() => []),
        ]);
        if (token?.isCancellationRequested) {
            return [];
        }
        const items = [
            ...keywordItems,
            ...databases.map((database) => this.createContainerItem(database, true)),
            ...schemas.map((schema) => this.createContainerItem(schema, false)),
            ...objects.map((object) => this.createObjectItem(object, true)),
        ];
        return this.prepareCompletionItems(items, document, position);
    }

    private prepareCompletionItems(
        items: vscode.CompletionItem[],
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        this.applyMetadataReplacementRange(items, document, position);
        const offset = document.offsetAt(position);
        for (const item of items) {
            this._completionResolveData.set(
                item,
                createCompletionResolveData(
                    document.uri.toString(),
                    offset,
                    completionItemLabel(item),
                    document.version,
                ),
            );
        }
        return items;
    }

    private applyMetadataReplacementRange(
        items: vscode.CompletionItem[],
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        const offset = document.offsetAt(position);
        const prefix = document.getText().slice(0, offset);
        const match = new RegExp(`(${sqlIdentifierPattern(true)})$`).exec(prefix);
        // Always provide an explicit range for metadata items. In particular, VS Code can otherwise
        // derive `dbo` as the filtering word at `dbo.|` and discard every returned object even though
        // the provider correctly resolved the schema. A trailing dot must insert at the caret.
        const replacementLength = match?.[1].length ?? 0;
        const range = new vscode.Range(document.positionAt(offset - replacementLength), position);
        for (const item of items) {
            if (item.insertText !== undefined && item.range === undefined) {
                item.range = range;
            }
        }
        return items;
    }

    private getKeywordItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        const prefix = this.getCurrentPrefix(document, position).toLocaleUpperCase();
        return tsqlReservedKeywords
            .filter((keyword) => keyword.startsWith(prefix))
            .map((keyword) => {
                const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                item.sortText = `2_${keyword}`;
                return item;
            });
    }

    private getCreateTableStaticItems(
        context: CreateTableCompletionContext,
    ): vscode.CompletionItem[] | undefined {
        switch (context.kind) {
            case "columnName":
                return [];
            case "definition":
                return this.createCreateTableDefinitionItems(context);
            case "dataType":
                return this.createDataTypeItems(context.prefix);
            case "typeArgument":
                return this.createTypeArgumentItems(context.typeName ?? "", context.prefix);
            case "columnOption":
                return this.createCreateTableColumnOptionItems(context.prefix);
            case "nullKeyword":
                return this.createKeywordOrSnippetItems(["NULL"], context.prefix, "0_");
            case "keyKeyword":
                return this.createKeywordOrSnippetItems(["KEY"], context.prefix, "0_");
            case "constraintType":
                return this.createKeywordOrSnippetItems(
                    ["PRIMARY KEY", "FOREIGN KEY", "UNIQUE", "CHECK", "DEFAULT"],
                    context.prefix,
                    "0_",
                );
            case "localColumn":
                return this.createCreateTableColumnItems(context);
            case "referencesKeyword":
                return this.createKeywordOrSnippetItems(["REFERENCES"], context.prefix, "0_");
            case "expression":
            case "tableName":
            case "referenceTable":
            case "referenceColumn":
                return undefined;
        }
    }

    private async getCreateTableMetadataItems(
        context: CreateTableCompletionContext,
        schema: SchemaProvider,
        connectionId?: string,
    ): Promise<vscode.CompletionItem[] | undefined> {
        if (context.kind === "tableName") {
            const items = [this.createTableDefinitionItem(context)];
            if (!connectionId) {
                return items;
            }
            try {
                if (!context.qualifiers?.length) {
                    const [databases, schemas] = await Promise.all([
                        this._catalog.getDatabases(connectionId),
                        this._catalog.getSchemas(connectionId),
                    ]);
                    items.push(
                        ...databases
                            .filter((value) =>
                                this.startsWithCaseInsensitive(value, context.prefix),
                            )
                            .map((value) => this.createContainerItem(value, true)),
                        ...schemas
                            .filter((value) =>
                                this.startsWithCaseInsensitive(value, context.prefix),
                            )
                            .map((value) => this.createContainerItem(value, false)),
                    );
                } else if (context.qualifiers.length === 1) {
                    const databases = await this._catalog.getDatabases(connectionId);
                    const database = this.findCaseInsensitive(databases, context.qualifiers[0]);
                    if (database) {
                        items.push(
                            ...(await this._catalog.getSchemas(connectionId, database))
                                .filter((value) =>
                                    this.startsWithCaseInsensitive(value, context.prefix),
                                )
                                .map((value) => this.createContainerItem(value, false)),
                        );
                    }
                }
            } catch {
                // The table-definition snippet remains useful while catalog metadata is unavailable.
            }
            return items;
        }

        if (context.kind === "referenceTable") {
            if (!connectionId) {
                return schema
                    .tables("tsql")
                    .filter((table) => this.startsWithCaseInsensitive(table, context.prefix))
                    .map((table) => {
                        const item = new vscode.CompletionItem(
                            table,
                            vscode.CompletionItemKind.Class,
                        );
                        item.insertText = quoteCompletionIdentifier(table);
                        return item;
                    });
            }
            try {
                if (context.qualifiers?.length) {
                    return await this.getQualifiedItems(
                        connectionId,
                        context.qualifiers,
                        context.prefix,
                        ["table"],
                    );
                }
                const [databases, schemas, tables] = await Promise.all([
                    this._catalog.getDatabases(connectionId),
                    this._catalog.getSchemas(connectionId),
                    this._catalog.searchObjects(connectionId, {
                        prefix: context.prefix || undefined,
                        types: ["table"],
                    }),
                ]);
                return [
                    ...databases
                        .filter((value) => this.startsWithCaseInsensitive(value, context.prefix))
                        .map((value) => this.createContainerItem(value, true)),
                    ...schemas
                        .filter((value) => this.startsWithCaseInsensitive(value, context.prefix))
                        .map((value) => this.createContainerItem(value, false)),
                    ...tables.map((table) => {
                        const item = this.createObjectItem(table, true);
                        item.filterText = table.name;
                        return item;
                    }),
                ];
            } catch {
                return [];
            }
        }

        if (context.kind !== "referenceColumn" || !context.referencedTable) {
            return undefined;
        }
        let members = this.getSchemaObjectMembers(schema, context.referencedTable);
        if (members.length === 0 && connectionId) {
            try {
                const object = await this._catalog.getObject(connectionId, context.referencedTable);
                if (object) {
                    members = await this._catalog.getMembersWithTypes(connectionId, object);
                }
            } catch {
                return [];
            }
        }
        return this.createMemberCompletionItems(members, context.prefix, context.usedColumns);
    }

    private createCreateTableDefinitionItems(
        context: CreateTableCompletionContext,
    ): vscode.CompletionItem[] {
        const tableName = context.table?.name ?? "Table";
        const safeName = tableName.replace(/[^A-Za-z0-9_]/g, "_");
        const items = this.createKeywordOrSnippetItems(
            createTableDefinitionKeywords,
            context.prefix,
            "1_",
        );
        if (!context.prefix) {
            items.unshift(
                this.createSnippetItem(
                    "Column definition",
                    "[${1:ColumnName}] ${2:int} ${3:NULL}",
                    "Name, type, and nullability",
                    "0_0",
                ),
                this.createSnippetItem(
                    "PRIMARY KEY constraint",
                    `CONSTRAINT [\${1:PK_${safeName}}] PRIMARY KEY (\${2:ColumnName})`,
                    "Named table primary key",
                    "0_1",
                ),
                this.createSnippetItem(
                    "FOREIGN KEY constraint",
                    `CONSTRAINT [\${1:FK_${safeName}}] FOREIGN KEY (\${2:ColumnName}) REFERENCES \${3:dbo.Parent} (\${4:Id})`,
                    "Named table foreign key",
                    "0_2",
                ),
                this.createSnippetItem(
                    "CHECK constraint",
                    `CONSTRAINT [\${1:CK_${safeName}}] CHECK (\${2:expression})`,
                    "Named table check constraint",
                    "0_3",
                ),
            );
        }
        return items;
    }

    private createCreateTableColumnItems(
        context: CreateTableCompletionContext,
    ): vscode.CompletionItem[] {
        return this.createMemberCompletionItems(
            context.columns,
            context.prefix,
            context.usedColumns,
        );
    }

    private createCreateTableColumnOptionItems(prefix: string): vscode.CompletionItem[] {
        return createTableColumnOptions
            .filter((value) => this.startsWithCaseInsensitive(value, prefix))
            .map((value) => {
                const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Keyword);
                const snippets: Partial<Record<(typeof createTableColumnOptions)[number], string>> =
                    {
                        IDENTITY: "IDENTITY(${1:1}, ${2:1})",
                        DEFAULT: "DEFAULT (${1:value})",
                        CHECK: "CHECK (${1:expression})",
                        REFERENCES: "REFERENCES ${1:dbo.Parent} (${2:Id})",
                        "MASKED WITH": "MASKED WITH (FUNCTION = '${1:default()}')",
                    };
                item.insertText = snippets[value]
                    ? new vscode.SnippetString(snippets[value])
                    : value;
                item.sortText = `1_${value}`;
                return item;
            });
    }

    private createMemberCompletionItems(
        members: ObjectMember[],
        prefix: string,
        used = new Set<string>(),
    ): vscode.CompletionItem[] {
        return members
            .filter(
                (member) =>
                    !used.has(member.name.toLocaleLowerCase()) &&
                    this.startsWithCaseInsensitive(member.name, prefix),
            )
            .map((member) => {
                const item = new vscode.CompletionItem(
                    member.name,
                    vscode.CompletionItemKind.Field,
                );
                item.detail = member.type;
                item.insertText = quoteCompletionIdentifier(member.name);
                item.sortText = `0_${member.name}`;
                return item;
            });
    }

    private createDataTypeItems(prefix: string): vscode.CompletionItem[] {
        return tsqlDataTypes
            .filter((type) => this.startsWithCaseInsensitive(type, prefix))
            .map((type) => {
                const item = new vscode.CompletionItem(
                    type,
                    vscode.CompletionItemKind.TypeParameter,
                );
                item.detail = "SQL Server data type";
                item.insertText = this.getDataTypeSnippet(type);
                item.sortText = `0_${type}`;
                return item;
            });
    }

    private getDataTypeSnippet(
        type: (typeof tsqlDataTypes)[number],
    ): string | vscode.SnippetString {
        if (["binary", "char", "nchar", "varbinary", "varchar", "nvarchar"].includes(type)) {
            return new vscode.SnippetString(`${type}(\${1:50})`);
        }
        if (type === "decimal" || type === "numeric") {
            return new vscode.SnippetString(`${type}(\${1:18}, \${2:2})`);
        }
        if (["datetime2", "datetimeoffset", "time"].includes(type)) {
            return new vscode.SnippetString(`${type}(\${1:7})`);
        }
        if (type === "float") {
            return new vscode.SnippetString(`${type}(\${1:53})`);
        }
        return type;
    }

    private createTypeArgumentItems(typeName: string, prefix: string): vscode.CompletionItem[] {
        const values =
            typeName === "decimal-scale"
                ? ["0", "2", "4", "6"]
                : typeName === "decimal" || typeName === "numeric"
                  ? ["18, 2", "10, 2", "19, 4"]
                  : ["varchar", "nvarchar", "varbinary"].includes(typeName)
                    ? ["MAX", "50", "100", "255"]
                    : ["7", "6", "3", "0"];
        return values
            .filter((value) => value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
            .map((value) => {
                const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
                item.insertText = value;
                item.sortText = `0_${value}`;
                return item;
            });
    }

    private createKeywordOrSnippetItems(
        values: readonly string[],
        prefix: string,
        sortPrefix: string,
    ): vscode.CompletionItem[] {
        return values
            .filter((value) => this.startsWithCaseInsensitive(value, prefix))
            .map((value) => {
                const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Keyword);
                item.insertText = value;
                item.sortText = `${sortPrefix}${value}`;
                return item;
            });
    }

    private createSnippetItem(
        label: string,
        snippet: string,
        detail: string,
        sortText: string,
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
        item.insertText = new vscode.SnippetString(snippet);
        item.detail = detail;
        item.sortText = sortText;
        return item;
    }

    private createTableDefinitionItem(
        context: CreateTableCompletionContext,
    ): vscode.CompletionItem {
        const item = this.createSnippetItem(
            "New table definition",
            "[${1:TableName}] (\n    [${2:Id}] ${3:int} ${4:NOT NULL}\n);",
            "Table name and initial column",
            "0_0",
        );
        item.filterText = context.prefix || "New table definition";
        return item;
    }

    private getSelectStarExpansionItem(
        document: vscode.TextDocument,
        session: SqlAnalysisSnapshot,
        context: SelectStarExpansionContext,
    ): vscode.CompletionItem | undefined {
        const columns = session.expandStarAt(Math.max(context.startOffset, context.endOffset - 1));
        if (!columns?.length) {
            return undefined;
        }
        const expression = document.getText(
            new vscode.Range(
                document.positionAt(context.startOffset),
                document.positionAt(context.endOffset),
            ),
        );
        const explicitQualifier = expression.includes(".")
            ? expression.slice(0, expression.lastIndexOf(".")).trim()
            : undefined;
        const qualifyEveryColumn =
            Boolean(explicitQualifier) ||
            new Set(columns.map((column) => column.sourceKey)).size > 1;
        const columnText = columns.map((column) => {
            const name = quoteCompletionIdentifier(column.name);
            if (!qualifyEveryColumn) {
                return name;
            }
            const qualifier = explicitQualifier ?? quoteCompletionIdentifier(column.sourceKey);
            return qualifier ? `${qualifier}.${name}` : name;
        });
        const start = document.positionAt(context.startOffset);
        const continuationIndent = " ".repeat(start.character);
        const item = new vscode.CompletionItem(
            {
                label: "Expand * to columns",
                description: `${columns.length} columns`,
            },
            vscode.CompletionItemKind.Snippet,
        );
        item.detail = "Replace the wildcard with resolved column names";
        item.filterText = "*";
        item.insertText = columnText.join(`,\n${continuationIndent}`);
        item.range = new vscode.Range(start, document.positionAt(context.endOffset));
        item.sortText = "0_expand_star";
        item.preselect = true;
        return item;
    }

    private createInsertExpansionItem(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: InsertColumnContext,
        members: ObjectMember[],
    ): vscode.CompletionItem | undefined {
        if (members.length === 0) {
            return undefined;
        }
        const line = document.lineAt(position.line).text;
        const baseIndent = /^\s*/.exec(line)?.[0] ?? "";
        const innerIndent = `${baseIndent}    `;
        const snippet = new vscode.SnippetString();
        snippet.appendText(
            `\n${innerIndent}${members
                .map((member) => quoteCompletionIdentifier(member.name))
                .join(`,\n${innerIndent}`)}\n${baseIndent})\n${baseIndent}VALUES (\n`,
        );
        members.forEach((_member, index) => {
            snippet.appendText(innerIndent);
            snippet.appendPlaceholder("NULL", index + 1);
            snippet.appendText(index === members.length - 1 ? "\n" : ",\n");
        });
        snippet.appendText(`${baseIndent});`);
        snippet.appendTabstop(0);

        const item = new vscode.CompletionItem(
            {
                label: "Expand INSERT columns and VALUES",
                description: `${members.length} columns`,
            },
            vscode.CompletionItemKind.Snippet,
        );
        item.detail = "Insert every resolved column with editable value placeholders";
        item.filterText = "columns values";
        item.insertText = snippet;
        item.range = new vscode.Range(document.positionAt(context.contentStartOffset), position);
        item.sortText = "0_expand_insert";
        item.preselect = true;
        item.command = {
            command: "editor.action.triggerParameterHints",
            title: "Show INSERT value hints",
        };
        return item;
    }

    private createInsertCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: InsertColumnContext,
        members: ObjectMember[],
        prefix = this.getCurrentPrefix(document, position),
    ): vscode.CompletionItem[] {
        const insertableMembers = members.filter((member) => member.insertable !== false);
        const items = insertableMembers
            .filter(
                (member) =>
                    !context.usedColumns.has(member.name.toLocaleLowerCase()) &&
                    this.startsWithCaseInsensitive(member.name, prefix),
            )
            .map((member) => {
                const item = new vscode.CompletionItem(
                    member.name,
                    vscode.CompletionItemKind.Field,
                );
                item.detail = member.type;
                item.insertText = quoteCompletionIdentifier(member.name);
                item.sortText = `1_${member.name}`;
                return item;
            });
        const expansion = context.canExpand
            ? this.createInsertExpansionItem(document, position, context, insertableMembers)
            : undefined;
        if (expansion) {
            items.unshift(expansion);
        }
        return items;
    }

    private getSchemaObjectMembers(
        schema: SchemaProvider,
        reference: ObjectReference,
    ): ObjectMember[] {
        const parts = [
            reference.server,
            reference.database,
            reference.schema,
            reference.name,
        ].filter((part): part is string => Boolean(part));
        return (schema.columnsFor(parts, "tsql") ?? []).map((column) => ({
            name: column.name,
            type: column.type,
        }));
    }

    private async getQualifiedItems(
        connectionId: string,
        qualifiers: string[],
        prefix = "",
        objectTypes?: DatabaseObject["type"][],
    ): Promise<vscode.CompletionItem[]> {
        if (qualifiers.length === 1) {
            const [databases, schemas] = await Promise.all([
                this._catalog.getDatabases(connectionId),
                this._catalog.getSchemas(connectionId),
            ]);
            const database = this.findCaseInsensitive(databases, qualifiers[0]);
            if (database) {
                const databaseSchemas = await this._catalog.getSchemas(connectionId, database);
                return databaseSchemas
                    .filter((schema) => this.startsWithCaseInsensitive(schema, prefix))
                    .map((schema) => this.createContainerItem(schema, false));
            }
            const schema = this.findCaseInsensitive(schemas, qualifiers[0]);
            if (schema) {
                const objects = await this._catalog.searchObjects(connectionId, {
                    schema,
                    prefix: prefix || undefined,
                    types: objectTypes,
                });
                return objects.map((object) => this.createObjectItem(object, false));
            }
            return [];
        }

        if (qualifiers.length === 2) {
            const databases = await this._catalog.getDatabases(connectionId);
            const database = this.findCaseInsensitive(databases, qualifiers[0]);
            if (database) {
                const objects = await this._catalog.searchObjects(connectionId, {
                    database,
                    schema: qualifiers[1],
                    prefix,
                    types: objectTypes,
                });
                return objects.map((object) => this.createObjectItem(object, false));
            }
            return this.filterItems(
                await this.getMemberItems(connectionId, {
                    schema: qualifiers[0],
                    name: qualifiers[1],
                }),
                prefix,
            );
        }

        return this.filterItems(
            await this.getMemberItems(connectionId, {
                server: qualifiers.length >= 4 ? qualifiers.at(-4) : undefined,
                database: qualifiers.at(-3),
                schema: qualifiers.at(-2),
                name: qualifiers.at(-1)!,
            }),
            prefix,
        );
    }

    private async getMemberItems(
        connectionId: string,
        reference: ObjectReference,
    ): Promise<vscode.CompletionItem[]> {
        const object = await this._catalog.getObject(connectionId, reference);
        if (!object) {
            return [];
        }
        if (object.type === "storedProcedure" || object.type === "scalarFunction") {
            return [];
        }
        const members = await this._catalog.getMembers(connectionId, object);
        return members.map((member) => {
            const item = new vscode.CompletionItem(member, vscode.CompletionItemKind.Field);
            item.insertText = quoteCompletionIdentifier(member);
            item.sortText = `${systemSchemaNames.has(object.schema.toLocaleLowerCase()) ? "1" : "0"}_${member}`;
            return item;
        });
    }

    private getSchemaMemberItems(
        document: vscode.TextDocument,
        schema: SchemaProvider,
        references: Map<string, ObjectReference>,
        qualifiers: string[] | undefined,
        prefix: string,
    ): vscode.CompletionItem[] {
        if (!qualifiers || qualifiers.length === 0) {
            return [];
        }
        const reference =
            getAliasedObjectReference(document.getText(), qualifiers[0]) ??
            references.get(qualifiers[0].toLocaleLowerCase()) ??
            parseObjectReference(qualifiers.join("."));
        if (!reference) {
            return [];
        }
        const parts = [
            reference.server,
            reference.database,
            reference.schema,
            reference.name,
        ].filter((part): part is string => Boolean(part));
        const columns = schema.columnsFor(parts, "tsql");
        if (!columns) {
            return [];
        }
        return columns
            .filter((column) => this.startsWithCaseInsensitive(column.name, prefix))
            .map((column) => {
                const item = new vscode.CompletionItem(
                    column.name,
                    vscode.CompletionItemKind.Field,
                );
                item.detail = column.type;
                item.insertText = quoteCompletionIdentifier(column.name);
                item.sortText = `${systemSchemaNames.has(reference.schema?.toLocaleLowerCase() ?? "") ? "1" : "0"}_${column.name}`;
                return item;
            });
    }

    private getQualifiers(document: vscode.TextDocument, position: vscode.Position): string[] {
        const offset = document.offsetAt(position);
        const prefix = document.getText().slice(0, offset);
        const identifier = sqlIdentifierPattern(false);
        const match = new RegExp(
            String.raw`((?:${identifier})(?:\s*\.\s*${identifier})*\s*\.)\s*$`,
        ).exec(prefix);
        return match ? splitMultipartIdentifier(match[1].replace(/\.\s*$/, "")) : [];
    }

    private getCurrentPrefix(document: vscode.TextDocument, position: vscode.Position): string {
        const prefix = document.getText().slice(0, document.offsetAt(position));
        const match = new RegExp(`(${sqlIdentifierPattern(true)})$`).exec(prefix);
        return match ? unquoteIdentifier(match[1]) : "";
    }

    private getInsertColumnContext(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): InsertColumnContext | undefined {
        const text = document.getText().slice(0, document.offsetAt(position));
        const identifier = sqlIdentifierPattern(false);
        const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
        const match = new RegExp(
            String.raw`\binsert\s+into\s+(${qualifiedIdentifier})\s*\(([^)]*)$`,
            "i",
        ).exec(text);
        if (!match) {
            return undefined;
        }
        const parts = splitMultipartIdentifier(match[1]);
        if (parts.length === 0) {
            return undefined;
        }
        const target: ObjectReference =
            parts.length === 1
                ? { name: parts[0] }
                : parts.length === 2
                  ? { schema: parts[0], name: parts[1] }
                  : parts.length === 3
                    ? {
                          database: parts.at(-3),
                          schema: parts.at(-2),
                          name: parts.at(-1)!,
                      }
                    : {
                          server: parts.at(-4),
                          database: parts.at(-3),
                          schema: parts.at(-2),
                          name: parts.at(-1)!,
                      };
        const columnSegments = match[2].split(",");
        columnSegments.pop();
        const usedColumns = new Set(
            columnSegments
                .map((column) => unquoteIdentifier(column.trim()).toLocaleLowerCase())
                .filter(Boolean),
        );
        const contentStartOffset = match.index + match[0].lastIndexOf("(") + 1;
        return {
            target,
            usedColumns,
            contentStartOffset,
            canExpand: match[2].trim().length === 0,
        };
    }

    private getExecuteParameterContext(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): ExecuteParameterContext | undefined {
        const text = document.getText().slice(0, document.offsetAt(position));
        const identifier = sqlIdentifierPattern(false);
        const match = new RegExp(
            String.raw`\bexec(?:ute)?\s+(${identifier}(?:\s*\.\s*${identifier}){0,3})\s+([^;]*)$`,
            "i",
        ).exec(text);
        const routine = parseObjectReference(match?.[1]);
        if (!match || !routine) {
            return undefined;
        }
        const usedParameters = new Set(
            [...match[2].matchAll(/(@[A-Za-z_][\w$#@]*)\s*=/g)].map((parameter) =>
                parameter[1].toLowerCase(),
            ),
        );
        return {
            routine,
            prefix: this.getCurrentPrefix(document, position),
            usedParameters,
        };
    }

    private getQualifiedPrefix(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): QualifiedPrefix | undefined {
        const text = document.getText().slice(0, document.offsetAt(position));
        const identifier = sqlIdentifierPattern(false);
        const partialIdentifier = sqlIdentifierPattern(true);
        const match = new RegExp(
            String.raw`((?:${identifier}\s*\.\s*)+)(${partialIdentifier})$`,
        ).exec(text);
        if (!match) {
            return undefined;
        }
        const qualifiers = splitMultipartIdentifier(match[1].replace(/\.\s*$/, ""));
        const prefix = unquoteIdentifier(match[2]);
        return qualifiers.length > 0 ? { qualifiers, prefix } : undefined;
    }

    private isRelationPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
        const prefix = document.getText().slice(0, document.offsetAt(position));
        const identifier = sqlIdentifierPattern(true);
        return new RegExp(
            String.raw`\b(?:from|join|apply|update|into)\s+${identifier}?(?:\s*\.\s*${identifier}?){0,3}$`,
            "i",
        ).test(prefix);
    }

    private isExecutePosition(document: vscode.TextDocument, position: vscode.Position): boolean {
        const prefix = document.getText().slice(0, document.offsetAt(position));
        const identifier = sqlIdentifierPattern(true);
        return new RegExp(
            String.raw`\bexec(?:ute)?\s+${identifier}?(?:\s*\.\s*${identifier}?){0,3}$`,
            "i",
        ).test(prefix);
    }

    private getObjectReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        qualifiedPrefix = false,
    ): Map<string, ObjectReference> {
        return getObjectReferences(
            document,
            position,
            this.getQualifiers(document, position).length > 0 || qualifiedPrefix,
        );
    }

    private getAnalysisItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        schema?: SchemaProvider,
        existingSession?: SqlAnalysisSnapshot,
    ): vscode.CompletionItem[] {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const session =
            existingSession ??
            completionAnalysisEngine.createSnapshot({
                text: getParseableEditorText(text),
                catalog: schema,
            });
        if (isDataTypePosition(session.tokens, offset)) {
            const prefix = this.getCurrentPrefix(document, position).toLocaleLowerCase();
            return tsqlDataTypes
                .filter((type) => type.startsWith(prefix))
                .map(
                    (type) =>
                        new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter),
                );
        }
        const result = session.completeAt(offset);
        const candidates = [...result.items];
        if (/\.\s*$/.test(text.slice(0, offset))) {
            const recoveredText = `${text.slice(0, offset)}*${text.slice(offset)}`;
            const recovered = completionAnalysisEngine
                .createSnapshot({ text: getParseableEditorText(recoveredText), catalog: schema })
                .completeAt(offset).items;
            const seen = new Set(
                candidates.map((candidate) => `${candidate.kind}:${candidate.label}`),
            );
            candidates.push(
                ...recovered.filter(
                    (candidate) =>
                        candidate.kind === "column" &&
                        !seen.has(`${candidate.kind}:${candidate.label}`),
                ),
            );

            const separated = getSelectIntoCompletionRecovery(text, offset);
            if (separated) {
                const separatedResult = completionAnalysisEngine
                    .createSnapshot({
                        text: getParseableEditorText(separated.text),
                        catalog: schema,
                    })
                    .completeAt(separated.offset).items;
                candidates.push(
                    ...separatedResult.filter(
                        (candidate) =>
                            candidate.kind === "column" &&
                            !seen.has(`${candidate.kind}:${candidate.label}`),
                    ),
                );
            }
        }
        const range = result.replaceSpan
            ? new vscode.Range(
                  document.positionAt(result.replaceSpan.start),
                  document.positionAt(result.replaceSpan.end),
              )
            : undefined;
        return candidates.map((candidate) => {
            const item = new vscode.CompletionItem(
                candidate.label,
                this.getAnalysisCompletionKind(candidate),
            );
            item.detail = candidate.detail;
            item.documentation = candidate.documentation;
            if (candidate.kind === "column") {
                item.insertText = quoteCompletionIdentifier(candidate.label);
            }
            item.range = range;
            item.sortText = `${candidate.kind === "keyword" ? "2" : "1"}_${candidate.label}`;
            return item;
        });
    }

    private getAnalysisCompletionKind(candidate: Completion): vscode.CompletionItemKind {
        switch (candidate.kind) {
            case "keyword":
                return vscode.CompletionItemKind.Keyword;
            case "column":
                return vscode.CompletionItemKind.Field;
            case "table":
                return vscode.CompletionItemKind.Class;
            case "cte":
                return vscode.CompletionItemKind.Reference;
            case "namespace":
                return vscode.CompletionItemKind.Module;
            case "function":
                return vscode.CompletionItemKind.Function;
            case "template":
                return vscode.CompletionItemKind.Snippet;
            case "alias":
                return vscode.CompletionItemKind.Reference;
            case "procedure":
                return vscode.CompletionItemKind.Method;
            case "type":
                return vscode.CompletionItemKind.TypeParameter;
            case "text":
                return vscode.CompletionItemKind.Text;
        }
    }

    private mergeItems(
        primary: vscode.CompletionItem[],
        secondary: vscode.CompletionItem[],
    ): vscode.CompletionItem[] {
        const labels = new Set(primary.map((item) => item.label.toString().toLocaleLowerCase()));
        return [
            ...primary,
            ...secondary.filter((item) => !labels.has(item.label.toString().toLocaleLowerCase())),
        ];
    }

    private findCaseInsensitive(values: string[], expected: string): string | undefined {
        return values.find((value) => value.toLocaleLowerCase() === expected.toLocaleLowerCase());
    }

    private startsWithCaseInsensitive(value: string, prefix: string): boolean {
        return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
    }

    private filterItems(items: vscode.CompletionItem[], prefix: string): vscode.CompletionItem[] {
        return prefix
            ? items.filter((item) => this.startsWithCaseInsensitive(item.label.toString(), prefix))
            : items;
    }

    private createContainerItem(value: string, database: boolean): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            value,
            database ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.Module,
        );
        item.insertText = quoteCompletionIdentifier(value);
        item.filterText = value;
        const normalizedValue = value.toLocaleLowerCase();
        const systemMetadata = database
            ? systemDatabaseNames.has(normalizedValue)
            : systemSchemaNames.has(normalizedValue);
        item.sortText = `${systemMetadata ? "1" : "0"}_${value}`;
        return item;
    }

    private createObjectItem(object: DatabaseObject, qualify: boolean): vscode.CompletionItem {
        const label = qualify ? `${object.schema}.${object.name}` : object.name;
        const item = new vscode.CompletionItem(label, this.getObjectCompletionKind(object.type));
        const insertText = qualify
            ? `${quoteCompletionIdentifier(object.schema)}.${quoteCompletionIdentifier(object.name)}`
            : quoteCompletionIdentifier(object.name);
        item.insertText =
            object.type === "scalarFunction" || object.type === "tableValuedFunction"
                ? new vscode.SnippetString(`${insertText}($0)`)
                : insertText;
        item.filterText = qualify ? `${object.schema}.${object.name}` : object.name;
        item.sortText = `${systemSchemaNames.has(object.schema.toLocaleLowerCase()) ? "1" : "0"}_${label}`;
        return item;
    }

    private getObjectCompletionKind(type: DatabaseObject["type"]): vscode.CompletionItemKind {
        switch (type) {
            case "table":
                return vscode.CompletionItemKind.Class;
            case "view":
                return vscode.CompletionItemKind.Interface;
            case "scalarFunction":
            case "tableValuedFunction":
                return vscode.CompletionItemKind.Function;
            case "storedProcedure":
                return vscode.CompletionItemKind.Method;
        }
    }
}

function isExplicitRelationAliasPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): boolean {
    const text = document.getText().slice(0, document.offsetAt(position));
    const identifier = sqlIdentifierPattern(false);
    const partialIdentifier = sqlIdentifierPattern(true);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    return new RegExp(
        String.raw`\b(?:from|join|apply)\s+${qualifiedIdentifier}(?:\s*\([^;()]*\))?\s+as(?:\s+(?:${partialIdentifier})?)?$`,
        "i",
    ).test(text);
}

function isRelationAliasSymbolAt(session: SqlAnalysisSnapshot, offset: number): boolean {
    if (offset <= 0) {
        return false;
    }
    return session
        .symbols()
        .some(
            (symbol) =>
                symbol.kind === "alias" &&
                symbol.modifiers.includes("declaration") &&
                symbol.span.start <= offset - 1 &&
                offset - 1 < symbol.span.end,
        );
}

function getSelectStarExpansionContext(
    document: vscode.TextDocument,
    position: vscode.Position,
): SelectStarExpansionContext | undefined {
    const endOffset = document.offsetAt(position);
    const prefix = document.getText().slice(0, endOffset);
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = `${identifier}(?:\\s*\\.\\s*${identifier}){0,3}`;
    const match = new RegExp(`((?:${qualifiedIdentifier}\\s*\\.\\s*)?\\*)$`).exec(prefix);
    return match ? { startOffset: endOffset - match[1].length, endOffset } : undefined;
}

function isDataTypePosition(tokens: readonly Token[], offset: number): boolean {
    const preceding = tokens.filter(
        (token) => token.channel === "code" && token.span.start < offset,
    );
    let depth = 0;
    for (let index = preceding.length - 1; index >= 0; index--) {
        const token = preceding[index];
        if (token.text === ")") {
            depth++;
        } else if (token.text === "(") {
            if (depth > 0) {
                depth--;
                continue;
            }
            const functionName = preceding[index - 1]?.text.toLocaleLowerCase();
            const argumentsInProgress = preceding.slice(index + 1);
            return (
                (functionName === "cast" &&
                    argumentsInProgress.some(
                        (argument) => argument.text.toLocaleLowerCase() === "as",
                    )) ||
                (functionName === "convert" &&
                    !argumentsInProgress.some((argument) => argument.text === ","))
            );
        }
    }
    return false;
}

function getLocalSchemaMapping(text: string, baseSchema?: SchemaProvider): SchemaMapping {
    const mapping: SchemaMapping = {};
    addDeclaredLocalTables(text, mapping);
    addDeclaredSynonyms(text, mapping, baseSchema);
    if (!/#\w/.test(text) || !/\binto\b/i.test(text)) {
        addLocalAliasMappings(text, mapping);
        return mapping;
    }
    const tokens = completionAnalysisEngine
        .createSnapshot({ text: getParseableEditorText(text), catalog: baseSchema })
        .tokens.filter((token) => token.channel === "code");
    for (let intoIndex = 1; intoIndex < tokens.length - 1; intoIndex++) {
        if (
            tokens[intoIndex].text.toLocaleLowerCase() !== "into" ||
            !tokens[intoIndex + 1].text.startsWith("#")
        ) {
            continue;
        }
        const selectIndex = tokens.findLastIndex(
            (token, index) => index < intoIndex && token.text.toLocaleLowerCase() === "select",
        );
        if (selectIndex < 0) {
            continue;
        }
        const target = unquoteIdentifier(tokens[intoIndex + 1].text);
        let columnNames = getProjectionNames(text, tokens, selectIndex, intoIndex);
        if (columnNames.includes("*")) {
            const intoStart = tokens[intoIndex].span.start;
            const intoEnd = tokens[intoIndex + 1].span.end;
            const recoveredText = `${text.slice(0, intoStart)}${" ".repeat(
                intoEnd - intoStart,
            )}${text.slice(intoEnd)}`;
            const recovered = completionAnalysisEngine.createSnapshot({
                text: getParseableEditorText(recoveredText),
                catalog: new OverlaySchemaProvider(new Schema(mapping), baseSchema),
            });
            const star = tokens
                .slice(selectIndex + 1, intoIndex)
                .find((token) => token.text === "*");
            const expanded = star ? recovered.expandStarAt(star.span.start) : undefined;
            if (expanded?.length) {
                columnNames = expanded.map((column) => column.name);
            }
        }
        mapping[target] = Object.fromEntries(
            columnNames.filter((name) => name !== "*").map((name) => [name, "unknown"]),
        );
    }
    addLocalAliasMappings(text, mapping);
    return mapping;
}

function addDeclaredLocalTables(text: string, mapping: SchemaMapping): void {
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const declaration = new RegExp(
        String.raw`\b(?:create\s+table\s+(${qualifiedIdentifier})|declare\s+(@[A-Za-z_][\w$#@]*)\s+table)\s*\(`,
        "gi",
    );
    for (let match = declaration.exec(text); match; match = declaration.exec(text)) {
        const reference = match[1]
            ? parseObjectReference(match[1])
            : { name: unquoteIdentifier(match[2]) };
        if (!reference) {
            continue;
        }
        const openParen = declaration.lastIndex - 1;
        const closeParen = findMatchingParenthesis(text, openParen);
        if (closeParen < 0) {
            continue;
        }
        const columns: SchemaMapping = {};
        for (const definition of splitTopLevel(text.slice(openParen + 1, closeParen), ",")) {
            const trimmed = definition.trim();
            if (/^(?:constraint|primary|unique|foreign|check)\b/i.test(trimmed)) {
                continue;
            }
            const nameMatch = new RegExp(String.raw`^(${identifier})\s+([\s\S]+)$`, "i").exec(
                trimmed,
            );
            if (!nameMatch) {
                continue;
            }
            const type = nameMatch[2]
                .split(
                    /\s+(?=null\b|not\b|constraint\b|default\b|identity\b|collate\b|primary\b|unique\b|references\b|check\b|sparse\b|rowguidcol\b|encrypted\b|masked\b)/i,
                    1,
                )[0]
                .trim();
            columns[unquoteIdentifier(nameMatch[1])] = {
                type: type || "unknown",
                nullable: !/\bNOT\s+NULL\b/iu.test(nameMatch[2]),
            };
        }
        setSchemaObjectMapping(mapping, reference, columns);
        declaration.lastIndex = closeParen + 1;
    }
}

function setSchemaObjectMapping(
    mapping: SchemaMapping,
    reference: ObjectReference,
    value: SchemaMapping,
): void {
    const parts = [reference.server, reference.database, reference.schema, reference.name].filter(
        (part): part is string => Boolean(part),
    );
    let target = mapping;
    for (const part of parts.slice(0, -1)) {
        const existing = target[part];
        if (!existing || typeof existing === "string" || isSchemaLeaf(existing)) {
            target[part] = {};
        }
        target = target[part] as SchemaMapping;
    }
    target[parts.at(-1)!] = value;
}

function addLocalAliasMappings(text: string, mapping: SchemaMapping): void {
    const identifier = sqlIdentifierPattern(false);
    const source = new RegExp(
        String.raw`\b(?:from|join|apply|update)\s+([@#][A-Za-z_][\w$#@]*)\s+(?:(as)\s+)?(${identifier})`,
        "gi",
    );
    for (let match = source.exec(text); match; match = source.exec(text)) {
        const sourceName = unquoteIdentifier(match[1]);
        const sourceKey = Object.keys(mapping).find(
            (key) => key.toLocaleLowerCase() === sourceName.toLocaleLowerCase(),
        );
        const columns = sourceKey ? mapping[sourceKey] : undefined;
        if (!columns || typeof columns === "string" || isSchemaLeaf(columns)) {
            continue;
        }
        const alias = unquoteIdentifier(match[3]);
        const parserName = `${sourceName}${match[2] ? "AS" : ""}${alias}`;
        mapping[parserName] = columns;
    }
}

function addDeclaredSynonyms(
    text: string,
    mapping: SchemaMapping,
    baseSchema?: SchemaProvider,
): void {
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const declaration = new RegExp(
        String.raw`\bcreate\s+synonym\s+(${qualifiedIdentifier})\s+for\s+(${qualifiedIdentifier})`,
        "gi",
    );
    for (let match = declaration.exec(text); match; match = declaration.exec(text)) {
        const synonym = parseObjectReference(match[1]);
        const target = parseObjectReference(match[2]);
        if (!synonym || !target) {
            continue;
        }
        const targetParts = [target.server, target.database, target.schema, target.name].filter(
            (part): part is string => Boolean(part),
        );
        const provider = new OverlaySchemaProvider(new Schema(mapping), baseSchema);
        const columns = provider.columnsFor(targetParts, "tsql");
        if (!columns) {
            continue;
        }
        setSchemaObjectMapping(
            mapping,
            synonym,
            Object.fromEntries(columns.map((column) => [column.name, column.type])),
        );
    }
}

function getProjectionNames(
    text: string,
    tokens: readonly Token[],
    selectIndex: number,
    intoIndex: number,
): string[] {
    const columns: string[] = [];
    let depth = 0;
    let projectionStart = selectIndex + 1;
    for (let index = projectionStart; index <= intoIndex; index++) {
        const token = tokens[index];
        if (token.text === "(") {
            depth++;
        } else if (token.text === ")") {
            depth--;
        }
        if ((token.text === "," && depth === 0) || index === intoIndex) {
            const projection = tokens.slice(projectionStart, index);
            const asIndex = projection.findLastIndex(
                (candidate) => candidate.text.toLowerCase() === "as",
            );
            const nameStart =
                asIndex >= 0 ? projection[asIndex + 1]?.span.start : projection.at(-1)?.span.start;
            const nameEnd = projection.at(-1)?.span.end;
            if (nameStart !== undefined && nameEnd !== undefined) {
                const name = unquoteIdentifier(text.slice(nameStart, nameEnd).trim());
                if (name) {
                    columns.push(name);
                }
            }
            projectionStart = index + 1;
        }
    }
    return columns;
}

function findMatchingParenthesis(text: string, openParen: number): number {
    let depth = 0;
    let quote: "'" | '"' | "]" | undefined;
    for (let index = openParen; index < text.length; index++) {
        const character = text[index];
        if (quote) {
            if (character === quote) {
                if (text[index + 1] === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "'") {
            quote = "'";
        } else if (character === '"') {
            quote = '"';
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            depth++;
        } else if (character === ")" && --depth === 0) {
            return index;
        }
    }
    return -1;
}

function splitTopLevel(value: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: "'" | '"' | "]" | undefined;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote) {
                if (value[index + 1] === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            depth++;
        } else if (character === ")") {
            depth--;
        } else if (character === separator && depth === 0) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));
    return parts;
}

function getSelectIntoCompletionRecovery(
    text: string,
    offset: number,
): { text: string; offset: number } | undefined {
    if (!/#\w/.test(text) || !/\binto\b/i.test(text)) {
        return undefined;
    }
    const tokens = completionAnalysisEngine
        .createSnapshot({ text: getParseableEditorText(text) })
        .tokens.filter((token) => token.channel === "code");
    const intoIndex = tokens.findIndex(
        (token, index) =>
            token.text.toLocaleLowerCase() === "into" && tokens[index + 1]?.text.startsWith("#"),
    );
    if (intoIndex < 0) {
        return undefined;
    }
    const nextSelect = tokens.find(
        (token, index) =>
            index > intoIndex + 1 &&
            token.span.start < offset &&
            token.text.toLocaleLowerCase() === "select",
    );
    if (
        !nextSelect ||
        text.slice(tokens[intoIndex + 1].span.end, nextSelect.span.start).includes(";")
    ) {
        return undefined;
    }
    return {
        text: `${text.slice(0, nextSelect.span.start)};${text.slice(nextSelect.span.start)}`,
        offset: offset + 1,
    };
}

function hasSchemaEntries(mapping: SchemaMapping): boolean {
    return Object.keys(mapping).length > 0;
}

function isLocalObjectName(name: string): boolean {
    return name.startsWith("#") || name.startsWith("@");
}

function sqlIdentifierPattern(allowIncomplete: boolean): string {
    const bracketed = allowIncomplete
        ? String.raw`\[(?:[^\]\r\n]|\]\])*\]?`
        : String.raw`\[(?:[^\]\r\n]|\]\])*\]`;
    const quoted = allowIncomplete
        ? String.raw`"(?:[^"\r\n]|"")*"?`
        : String.raw`"(?:[^"\r\n]|"")*"`;
    return String.raw`(?:${bracketed}|${quoted}|[A-Za-z_@#][\w$#@]*)`;
}

function quoteCompletionIdentifier(value: string): string {
    if (
        value.startsWith("@") ||
        (/^[A-Za-z_#][\w$#@]*$/.test(value) &&
            !tsqlReservedKeywords.some((keyword) => keyword.toLowerCase() === value.toLowerCase()))
    ) {
        return value;
    }
    return `[${value.replaceAll("]", "]]")}]`;
}

function deduplicatePaths(paths: readonly (readonly string[])[]): readonly (readonly string[])[] {
    const seen = new Set<string>();
    return paths.filter((parts) => {
        const key = parts.map((part) => part.toLowerCase()).join("\u0000");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function isSchemaLeaf(
    value: SchemaMapping | Exclude<SchemaLeaf, string>,
): value is Exclude<SchemaLeaf, string> {
    return "type" in value || "nullable" in value;
}

function parseObjectReference(value: string | undefined): ObjectReference | undefined {
    if (!value) {
        return undefined;
    }
    const parts = splitMultipartIdentifier(value);
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 1) {
        return { name: parts[0] };
    }
    if (parts.length === 2) {
        return { schema: parts[0], name: parts[1] };
    }
    if (parts.length === 3) {
        return { database: parts[0], schema: parts[1], name: parts[2] };
    }
    return {
        server: parts.at(-4),
        database: parts.at(-3),
        schema: parts.at(-2),
        name: parts.at(-1)!,
    };
}

function getCreateTableCompletionContext(
    document: vscode.TextDocument,
    position: vscode.Position,
): CreateTableCompletionContext | undefined {
    const offset = document.offsetAt(position);
    const text = document.getText();
    const prefixText = text.slice(0, offset);
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const declaration = new RegExp(
        String.raw`\bcreate\s+table\s+(${qualifiedIdentifier})\s*\(`,
        "gi",
    );
    let active: { table: ObjectReference; openParen: number } | undefined;
    for (let match = declaration.exec(text); match; match = declaration.exec(text)) {
        const openParen = declaration.lastIndex - 1;
        const closeParen = findMatchingParenthesis(text, openParen);
        const table = parseObjectReference(match[1]);
        if (table && openParen < offset && (closeParen < 0 || offset <= closeParen)) {
            active = { table, openParen };
        }
    }

    if (!active) {
        const tableName = /\bcreate\s+table\s+([^;()]*)$/i.exec(prefixText);
        if (!tableName || !isPartialMultipartIdentifier(tableName[1])) {
            return undefined;
        }
        const path = getCompletionPath(tableName[1]);
        return {
            kind: "tableName",
            columns: [],
            prefix: path.prefix,
            qualifiers: path.qualifiers,
        };
    }

    const body = text.slice(active.openParen + 1, offset);
    const definitions = splitTopLevel(body, ",");
    const current = definitions.at(-1) ?? "";
    const trimmed = current.trim();
    const columns = definitions
        .map(parseCreateTableColumnDefinition)
        .filter((column): column is ObjectMember => Boolean(column));
    const currentPrefix = getCompletionIdentifierPrefix(prefixText);
    const base = {
        table: active.table,
        columns,
        prefix: currentPrefix,
    };

    const referenceColumns = new RegExp(
        String.raw`\breferences\s+(${qualifiedIdentifier})\s*\(([^)]*)$`,
        "i",
    ).exec(current);
    const referencedTable = parseObjectReference(referenceColumns?.[1]);
    if (referenceColumns && referencedTable) {
        return {
            ...base,
            kind: "referenceColumn",
            referencedTable,
            usedColumns: getUsedCreateTableColumns(referenceColumns[2]),
        };
    }

    const referenceTable = /\breferences\s+([^()]*)$/i.exec(current);
    if (referenceTable && isPartialMultipartIdentifier(referenceTable[1])) {
        const path = getCompletionPath(referenceTable[1]);
        return {
            ...base,
            kind: "referenceTable",
            prefix: path.prefix,
            qualifiers: path.qualifiers,
        };
    }

    const constrainedColumns = /\b(?:primary\s+key|unique|foreign\s+key)\s*\(([^)]*)$/i.exec(
        current,
    );
    if (constrainedColumns) {
        return {
            ...base,
            kind: "localColumn",
            usedColumns: getUsedCreateTableColumns(constrainedColumns[1]),
        };
    }
    if (/\bcheck\s*\([^)]*$/i.test(current) || /\bas\s*\([^)]*$/i.test(current)) {
        return { ...base, kind: "localColumn" };
    }
    if (/\bforeign\s+key\s*\([^)]*\)\s+r\w*$/i.test(trimmed)) {
        return { ...base, kind: "referencesKeyword" };
    }
    if (/\bnot(?:\s+\w*)?$/i.test(trimmed)) {
        return { ...base, kind: "nullKeyword" };
    }
    if (/\b(?:primary|foreign)(?:\s+\w*)?$/i.test(trimmed)) {
        return { ...base, kind: "keyKeyword" };
    }

    const namedConstraint = new RegExp(
        String.raw`^\s*constraint\s+${identifier}\s+(\w*)$`,
        "i",
    ).exec(current);
    if (namedConstraint) {
        return { ...base, kind: "constraintType", prefix: namedConstraint[1] };
    }
    if (/^\s*constraint(?:\s+[^\s]*)?$/i.test(current)) {
        return { ...base, kind: "columnName" };
    }

    if (!trimmed) {
        return { ...base, kind: "definition", prefix: "" };
    }
    if (
        !/\s/.test(trimmed) &&
        createTableDefinitionKeywords.some((keyword) =>
            keyword.toLocaleLowerCase().startsWith(trimmed.toLocaleLowerCase()),
        )
    ) {
        return { ...base, kind: "definition", prefix: trimmed };
    }

    const column = new RegExp(String.raw`^\s*(${identifier})(?:\s+([\s\S]*))?$`, "i").exec(current);
    if (!column || column[2] === undefined) {
        return { ...base, kind: "columnName" };
    }
    const remainder = column[2];
    if (!remainder.trim()) {
        return { ...base, kind: "dataType", prefix: "" };
    }

    const scaleArgument = /^\s*(decimal|numeric)\s*\([^,)]*,\s*([^)]*)$/i.exec(remainder);
    if (scaleArgument) {
        return {
            ...base,
            kind: "typeArgument",
            typeName: "decimal-scale",
            prefix: scaleArgument[2].trim(),
        };
    }
    const typeArgument = /^\s*([A-Za-z_][\w$#@]*)\s*\(\s*([^,)]*)$/i.exec(remainder);
    if (typeArgument) {
        return {
            ...base,
            kind: "typeArgument",
            typeName: typeArgument[1].toLocaleLowerCase(),
            prefix: typeArgument[2].trim(),
        };
    }
    if (/^\s*as\s*\(/i.test(remainder)) {
        return { ...base, kind: "localColumn" };
    }

    const type = new RegExp(
        String.raw`^\s*(${qualifiedIdentifier}(?:\s*\([^)]*\))?)([\s\S]*)$`,
        "i",
    ).exec(remainder);
    if (!type) {
        return { ...base, kind: "dataType", prefix: currentPrefix };
    }
    const typeParts = splitMultipartIdentifier(type[1].replace(/\s*\([^)]*\)\s*$/, ""));
    const typeName = typeParts.at(-1)?.toLocaleLowerCase() ?? "";
    const knownType = tsqlDataTypes.includes(typeName as (typeof tsqlDataTypes)[number]);
    const qualifiedType = typeParts.length > 1;
    if (!type[2] && !/\s$/.test(remainder)) {
        return {
            ...base,
            kind: "dataType",
            prefix: knownType || qualifiedType ? currentPrefix : typeName,
        };
    }

    const option = type[2].trimStart();
    if (/^not(?:\s+\w*)?$/i.test(option)) {
        return { ...base, kind: "nullKeyword" };
    }
    if (/^(?:primary|foreign)(?:\s+\w*)?$/i.test(option)) {
        return { ...base, kind: "keyKeyword" };
    }
    if (/^(?:default|check|collate|identity|masked|generated)\b/i.test(option)) {
        return { ...base, kind: "expression" };
    }
    return { ...base, kind: "columnOption", prefix: currentPrefix };
}

function parseCreateTableColumnDefinition(definition: string): ObjectMember | undefined {
    const identifier = sqlIdentifierPattern(false);
    const trimmed = definition.trim();
    if (!trimmed || /^(?:constraint|primary|unique|foreign|check|period|index)\b/i.test(trimmed)) {
        return undefined;
    }
    const match = new RegExp(String.raw`^(${identifier})\s+([\s\S]+)$`, "i").exec(trimmed);
    if (!match || /^as\b/i.test(match[2])) {
        return undefined;
    }
    const type = match[2]
        .split(
            /\s+(?=null\b|not\b|constraint\b|default\b|identity\b|collate\b|primary\b|unique\b|references\b|check\b|sparse\b|rowguidcol\b|generated\b|encrypted\b|masked\b)/i,
            1,
        )[0]
        .trim();
    return type ? { name: unquoteIdentifier(match[1]), type } : undefined;
}

function getUsedCreateTableColumns(value: string): Set<string> {
    const parts = splitTopLevel(value, ",");
    return new Set(
        parts
            .slice(0, -1)
            .map((column) => unquoteIdentifier(column.trim()).toLocaleLowerCase())
            .filter(Boolean),
    );
}

function getCompletionPath(value: string): { qualifiers: string[]; prefix: string } {
    const trimmed = value.trim();
    if (!trimmed) {
        return { qualifiers: [], prefix: "" };
    }
    const trailingDot = /\.\s*$/.test(trimmed);
    const parts = splitMultipartIdentifier(trimmed.replace(/\.\s*$/, ""));
    return trailingDot
        ? { qualifiers: parts, prefix: "" }
        : { qualifiers: parts.slice(0, -1), prefix: parts.at(-1) ?? "" };
}

function isPartialMultipartIdentifier(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        return true;
    }
    const identifier = sqlIdentifierPattern(true);
    return new RegExp(String.raw`^${identifier}(?:\s*\.\s*${identifier}){0,3}\s*$`, "i").test(
        trimmed,
    );
}

function getCompletionIdentifierPrefix(value: string): string {
    const match = new RegExp(`(${sqlIdentifierPattern(true)})$`).exec(value);
    return match ? unquoteIdentifier(match[1]) : "";
}

function getRoutineCallContext(prefix: string): RoutineCallContext | undefined {
    const openParen = findActiveOpenParenthesis(prefix);
    if (openParen === undefined) {
        return undefined;
    }
    const identifier = sqlIdentifierPattern(false);
    const match = new RegExp(
        String.raw`(${identifier}(?:\s*\.\s*${identifier}){0,3})\s*$`,
        "i",
    ).exec(prefix.slice(0, openParen));
    const routine = parseObjectReference(match?.[1]);
    return routine
        ? {
              routine,
              activeParameter: Math.max(
                  0,
                  splitTopLevel(prefix.slice(openParen + 1), ",").length - 1,
              ),
              kind: "function",
          }
        : undefined;
}

function getExecuteRoutineCallContext(prefix: string): RoutineCallContext | undefined {
    const identifier = sqlIdentifierPattern(false);
    const match = new RegExp(
        String.raw`\bexec(?:ute)?\s+(?:@[A-Za-z_][\w$#@]*\s*=\s*)?(${identifier}(?:\s*\.\s*${identifier}){0,3})(?:\s+([^;]*))?$`,
        "i",
    ).exec(prefix);
    const routine = parseObjectReference(match?.[1]);
    if (!routine) {
        return undefined;
    }
    return {
        routine,
        activeParameter: Math.max(0, splitTopLevel(match?.[2] ?? "", ",").length - 1),
        kind: "execute",
    };
}

function getInsertValuesContext(prefix: string): InsertValuesContext | undefined {
    const openParen = findActiveOpenParenthesis(prefix);
    if (openParen === undefined) {
        return undefined;
    }
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const pattern = new RegExp(
        String.raw`\binsert\s+into\s+(${qualifiedIdentifier})(?:\s*\(([^)]*)\))?\s+values\b`,
        "gi",
    );
    const beforeRow = prefix.slice(0, openParen);
    let insertMatch: RegExpExecArray | undefined;
    for (let match = pattern.exec(beforeRow); match; match = pattern.exec(beforeRow)) {
        insertMatch = match;
    }
    const target = parseObjectReference(insertMatch?.[1]);
    if (!insertMatch || !target) {
        return undefined;
    }
    const completedRows = beforeRow.slice(insertMatch.index + insertMatch[0].length);
    if (completedRows.trim()) {
        const rowSegments = splitTopLevel(completedRows, ",");
        if (
            rowSegments.at(-1)?.trim() ||
            rowSegments.slice(0, -1).some((row) => !/^\s*\([\s\S]*\)\s*$/.test(row))
        ) {
            return undefined;
        }
    }
    const columns = insertMatch[2]
        ? splitTopLevel(insertMatch[2], ",")
              .map((column) => unquoteIdentifier(column.trim()))
              .filter(Boolean)
        : undefined;
    return {
        target,
        columns,
        activeParameter: Math.max(0, splitTopLevel(prefix.slice(openParen + 1), ",").length - 1),
    };
}

function findActiveOpenParenthesis(text: string): number | undefined {
    const stack: number[] = [];
    let quote: "'" | '"' | "]" | undefined;
    let lineComment = false;
    let blockCommentDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (lineComment) {
            if (character === "\n" || character === "\r") {
                lineComment = false;
            }
            continue;
        }
        if (blockCommentDepth > 0) {
            if (character === "/" && next === "*") {
                blockCommentDepth++;
                index++;
            } else if (character === "*" && next === "/") {
                blockCommentDepth--;
                index++;
            }
            continue;
        }
        if (quote) {
            if (character === quote) {
                if (next === quote) {
                    index++;
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "-" && next === "-") {
            lineComment = true;
            index++;
        } else if (character === "/" && next === "*") {
            blockCommentDepth = 1;
            index++;
        } else if (character === "'" || character === '"') {
            quote = character;
        } else if (character === "[") {
            quote = "]";
        } else if (character === "(") {
            stack.push(index);
        } else if (character === ")") {
            stack.pop();
        }
    }
    return stack.at(-1);
}

function getAliasedObjectReference(
    text: string,
    expectedAlias: string,
): ObjectReference | undefined {
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const source = new RegExp(
        String.raw`\b(?:from|join|apply)\s+(${qualifiedIdentifier})\s+(?:as\s+)?(${identifier})`,
        "gi",
    );
    for (let match = source.exec(text); match; match = source.exec(text)) {
        if (unquoteIdentifier(match[2]).toLocaleLowerCase() === expectedAlias.toLocaleLowerCase()) {
            return parseObjectReference(match[1]);
        }
    }
    return undefined;
}

function splitMultipartIdentifier(value: string): string[] {
    const parts: string[] = [];
    let current = "";
    let quote: "]" | '"' | undefined;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            current += character;
            if (character === quote) {
                if (value[index + 1] === quote) {
                    current += value[++index];
                } else {
                    quote = undefined;
                }
            }
            continue;
        }
        if (character === "[") {
            quote = "]";
            current += character;
        } else if (character === '"') {
            quote = '"';
            current += character;
        } else if (character === ".") {
            parts.push(unquoteIdentifier(current.trim()));
            current = "";
        } else {
            current += character;
        }
    }
    if (current.trim()) {
        parts.push(unquoteIdentifier(current.trim()));
    }
    return parts.filter(Boolean);
}

function unquoteIdentifier(value: string): string {
    if (value.startsWith("[")) {
        return value.slice(1, value.endsWith("]") ? -1 : undefined).replaceAll("]]", "]");
    }
    const unicodeString = value.startsWith("N'") || value.startsWith("n'");
    if ((unicodeString || value.startsWith("'")) && value.endsWith("'")) {
        return value.slice(unicodeString ? 2 : 1, -1).replaceAll("''", "'");
    }
    if (value.startsWith('"')) {
        return value.slice(1, value.endsWith('"') ? -1 : undefined).replaceAll('""', '"');
    }
    return value;
}

/** Closes an editor's unfinished quoted identifier at EOF so parser recovery stays silent. */
function getParseableEditorText(text: string): string {
    let state: "normal" | "string" | "bracket" | "quoted" | "lineComment" | "blockComment" =
        "normal";
    let blockCommentDepth = 0;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        const next = text[index + 1];
        if (state === "lineComment") {
            if (character === "\n" || character === "\r") {
                state = "normal";
            }
            continue;
        }
        if (state === "blockComment") {
            if (character === "/" && next === "*") {
                blockCommentDepth++;
                index++;
            } else if (character === "*" && next === "/") {
                blockCommentDepth--;
                index++;
                if (blockCommentDepth === 0) {
                    state = "normal";
                }
            }
            continue;
        }
        if (state === "string" || state === "bracket" || state === "quoted") {
            const terminator = state === "string" ? "'" : state === "bracket" ? "]" : '"';
            if (character === terminator) {
                if (next === terminator) {
                    index++;
                } else {
                    state = "normal";
                }
            }
            continue;
        }
        if (character === "-" && next === "-") {
            state = "lineComment";
            index++;
        } else if (character === "/" && next === "*") {
            state = "blockComment";
            blockCommentDepth = 1;
            index++;
        } else if (character === "'") {
            state = "string";
        } else if (character === "[") {
            state = "bracket";
        } else if (character === '"') {
            state = "quoted";
        }
    }
    return state === "bracket" ? `${text}]` : state === "quoted" ? `${text}"` : text;
}

function getObjectReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    qualified: boolean,
): Map<string, ObjectReference> {
    const offset = document.offsetAt(position);
    const text = document.getText();
    const session = completionAnalysisEngine.createSnapshot({
        text: getParseableEditorText(
            `${text.slice(0, offset)}${qualified ? "*" : "__beta_completion__"}${text.slice(offset)}`,
        ),
    });
    const references = new Map<string, ObjectReference>();
    for (const external of session.externalReferences()) {
        if (external.name.includes("__beta_completion__")) {
            continue;
        }
        const reference = objectReferenceFromParts(
            external.nameParts ?? splitMultipartIdentifier(external.name),
        );
        if (!reference) {
            continue;
        }
        references.set(external.name.toLocaleLowerCase(), reference);
        references.set(reference.name.toLocaleLowerCase(), reference);
    }
    return references;
}

function collectTextObjectReferences(text: string, references: Map<string, ObjectReference>): void {
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const cteNames = new Set(
        [
            ...text.matchAll(
                new RegExp(String.raw`(?:\bwith|,)\s*(${identifier})\s+as\s*\(`, "gi"),
            ),
        ].map((match) => unquoteIdentifier(match[1]).toLocaleLowerCase()),
    );
    const source = new RegExp(
        String.raw`\b(?:from|join|apply|update|into)\s+(${qualifiedIdentifier})`,
        "gi",
    );
    for (let match = source.exec(text); match; match = source.exec(text)) {
        if (/^\s*[.(]/u.test(text.slice(source.lastIndex))) {
            continue;
        }
        const reference = parseObjectReference(match[1]);
        if (!reference || cteNames.has(reference.name.toLocaleLowerCase())) {
            continue;
        }
        const key = [reference.server, reference.database, reference.schema, reference.name]
            .filter((part): part is string => Boolean(part))
            .map((part) => part.toLocaleLowerCase())
            .join(".");
        references.set(key, reference);
    }
    const synonymTarget = new RegExp(
        String.raw`\bcreate\s+synonym\s+${qualifiedIdentifier}\s+for\s+(${qualifiedIdentifier})`,
        "gi",
    );
    for (let match = synonymTarget.exec(text); match; match = synonymTarget.exec(text)) {
        const reference = parseObjectReference(match[1]);
        if (!reference) {
            continue;
        }
        const key = [reference.server, reference.database, reference.schema, reference.name]
            .filter((part): part is string => Boolean(part))
            .map((part) => part.toLocaleLowerCase())
            .join(".");
        references.set(key, reference);
    }
}

function objectReferenceFromParts(parts: readonly string[]): ObjectReference | undefined {
    if (parts.length === 0) {
        return undefined;
    }
    return {
        server: parts.at(-4),
        database: parts.at(-3),
        schema: parts.at(-2),
        name: parts.at(-1)!,
    };
}

function rangeFromSpan(document: vscode.TextDocument, span: Sym["span"]): vscode.Range {
    return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
}

function rangeFromDiagnostic(
    document: vscode.TextDocument,
    diagnostic: AnalysisDiagnostic,
): vscode.Range {
    return new vscode.Range(
        document.positionAt(diagnostic.span.start),
        document.positionAt(Math.max(diagnostic.span.start + 1, diagnostic.span.end)),
    );
}

function toVsCodeDiagnostic(
    document: vscode.TextDocument,
    diagnostic: AnalysisDiagnostic,
): vscode.Diagnostic {
    const result = new vscode.Diagnostic(
        rangeFromDiagnostic(document, diagnostic),
        diagnostic.kind === "syntax"
            ? formatSqlParserDiagnosticMessage(diagnostic.message)
            : diagnostic.message,
        diagnostic.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : diagnostic.severity === "information"
              ? vscode.DiagnosticSeverity.Information
              : diagnostic.severity === "hint"
                ? vscode.DiagnosticSeverity.Hint
                : vscode.DiagnosticSeverity.Error,
    );
    result.source = "vscode-mssql";
    result.code = diagnostic.code;
    return result;
}

/**
 * Parser diagnostics expose low-level recovery details. Expectation sets are useful to a
 * parser author, but messages such as "1060 more" are neither stable nor useful in an editor. The
 * Microsoft SQL Parser and SQL Server report these failures as "Incorrect syntax near ..."; keep
 * the parser's offending token and source range while presenting that established wording.
 */
function formatSqlParserDiagnosticMessage(message: string): string {
    const offendingInput =
        /^(?:extraneous input|mismatched input)\s+((?:'[^']*')|(?:"[^"]*")|<EOF>)\s+expecting\b/i.exec(
            message,
        )?.[1] ?? /^missing\s+.+?\s+at\s+((?:'[^']*')|(?:"[^"]*")|<EOF>)$/i.exec(message)?.[1];
    if (offendingInput) {
        return offendingInput.toLocaleUpperCase() === "<EOF>"
            ? "Incorrect syntax near the end of the input."
            : `Incorrect syntax near ${offendingInput}.`;
    }

    const unrecognizedInput = /^token recognition error at:\s*(.+)$/i.exec(message)?.[1];
    if (unrecognizedInput) {
        return `Incorrect syntax near ${unrecognizedInput}.`;
    }

    const invalidAlternative = /^no viable alternative at input\s+(.+)$/i.exec(message)?.[1];
    if (invalidAlternative) {
        return `Incorrect syntax near ${invalidAlternative}.`;
    }

    return message;
}

function shouldPublishDiagnostic(
    diagnostic: AnalysisDiagnostic,
    document: vscode.TextDocument,
): boolean {
    const touchesDocumentEnd = diagnostic.span.end >= document.getText().length;
    return !(
        touchesDocumentEnd &&
        (diagnostic.span.start === document.getText().length ||
            diagnostic.message.includes("<EOF>") ||
            /\b(?:missing|expected|expecting|no viable alternative)\b/i.test(diagnostic.message))
    );
}

export class BetaSqlHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog: BetaSqlMetadataCatalog,
        private readonly _sessions = new BetaSqlSessionManager(_connectionManager, _catalog),
    ) {}

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        if (!betaSqlOwnsDocument(document)) {
            return undefined;
        }
        const result = await this._sessions.getSession(document, token);
        if (!result) {
            return undefined;
        }
        const session = result.session;
        const offset = document.offsetAt(position);
        const column = schemaColumnAt(session, result.schema, offset);
        if (column) {
            const contents = new vscode.MarkdownString();
            contents.appendCodeblock(`${column.name}: ${column.type}`, "sql");
            appendHoverField(contents, "Kind", "Column");
            appendHoverField(contents, "Source", column.source);
            if (column.nullable !== undefined) {
                appendHoverField(contents, "Nullable", column.nullable ? "Yes" : "No");
            }
            return new vscode.Hover(
                contents,
                new vscode.Range(
                    document.positionAt(column.start),
                    document.positionAt(column.end),
                ),
            );
        }
        const symbol = session.symbolAt(offset);
        if (!symbol) {
            return undefined;
        }
        const object = await this.getCatalogObject(document, symbol);
        if (
            token?.isCancellationRequested ||
            this._sessions.documents.get(document.uri.toString())?.version !== document.version
        ) {
            return undefined;
        }
        const contents = new vscode.MarkdownString();
        const inferredType = session.typeAt(offset);
        const displayType =
            symbol.type?.display ??
            (inferredType.kind === "unknown" ? undefined : inferredType.display);
        const type = displayType ? `: ${displayType}` : "";
        contents.appendCodeblock(
            `${object ? formatDatabaseObjectName(object) : symbol.name}${type}`,
            "sql",
        );
        if (object) {
            appendHoverField(
                contents,
                "Object type",
                object.baseObject ? "Synonym" : objectTypeLabel(object.type),
            );
            if (object.baseObject) {
                appendHoverField(contents, "Target type", objectTypeLabel(object.type));
                appendHoverField(
                    contents,
                    "Synonym target",
                    formatObjectReference(object.baseObject),
                );
            }
        } else {
            appendHoverField(contents, "Kind", symbolKindLabel(symbol.kind));
        }
        const sourceAlias =
            symbol.alias?.name ??
            (symbol.kind === "table" ? sourceAliasForSpan(session.text, symbol.span) : undefined);
        if (sourceAlias) {
            appendHoverField(contents, "Alias", sourceAlias);
        }
        if (symbol.kind === "column" && symbol.source) {
            appendHoverField(contents, "Source", symbol.source.name);
        }
        return new vscode.Hover(contents, hoverRangeAt(document, session, offset, symbol.span));
    }

    private async getCatalogObject(
        document: vscode.TextDocument,
        symbol: Sym,
    ): Promise<DatabaseObject | undefined> {
        if (symbol.kind !== "table" && !(symbol.kind === "function" && symbol.name.includes("."))) {
            return undefined;
        }
        const reference = parseObjectReference(symbol.name);
        const connection = this._connectionManager.getConnectionInfo(getUriKey(document.uri));
        if (!reference || isLocalObjectName(reference.name) || !connection?.connectionId) {
            return undefined;
        }
        this._catalog.setOwnerUri(connection.connectionId, getUriKey(document.uri));
        try {
            return await this._catalog.getObject(connection.connectionId, reference);
        } catch {
            return undefined;
        }
    }
}

function completionItemLabel(item: vscode.CompletionItem): string {
    return typeof item.label === "string" ? item.label : item.label.label;
}

function appendHoverField(contents: vscode.MarkdownString, label: string, value: string): void {
    contents.appendMarkdown(`\n\n**${label}:** `);
    contents.appendText(value);
}

function objectTypeLabel(type: DatabaseObject["type"]): string {
    switch (type) {
        case "table":
            return "Table";
        case "view":
            return "View";
        case "scalarFunction":
            return "Scalar function";
        case "tableValuedFunction":
            return "Table-valued function";
        case "storedProcedure":
            return "Stored procedure";
    }
}

function symbolKindLabel(kind: Sym["kind"]): string {
    switch (kind) {
        case "table":
            return "Table reference";
        case "cte":
            return "Common table expression";
        case "subquery":
            return "Derived table";
        case "lateral":
            return "Lateral row source";
        case "column":
            return "Column";
        case "alias":
            return "Alias";
        case "function":
            return "Function";
        case "parameter":
            return "Parameter";
        case "variable":
            return "Variable";
        case "procedure":
            return "Stored procedure";
        case "tempTable":
            return "Temporary table";
        case "type":
            return "Type";
    }
}

function formatDatabaseObjectName(object: DatabaseObject): string {
    return [object.server, object.database, object.schema, object.name]
        .filter((part): part is string => Boolean(part))
        .join(".");
}

function formatObjectReference(reference: ObjectReference): string {
    return [reference.server, reference.database, reference.schema, reference.name]
        .filter((part): part is string => Boolean(part))
        .join(".");
}

function hoverRangeAt(
    document: vscode.TextDocument,
    session: SqlAnalysisSnapshot,
    offset: number,
    fallback: Sym["span"],
): vscode.Range {
    const token = session.tokens.find(
        (candidate) =>
            candidate.channel === "code" &&
            candidate.span.start <= offset &&
            offset < candidate.span.end &&
            isIdentifierTokenForMetadata(candidate),
    );
    return token
        ? new vscode.Range(
              document.positionAt(token.span.start),
              document.positionAt(token.span.end),
          )
        : rangeFromSpan(document, fallback);
}

function schemaColumnAt(
    session: SqlAnalysisSnapshot,
    schema: SchemaProvider,
    offset: number,
):
    | {
          name: string;
          type: Column["type"];
          nullable?: boolean;
          source: string;
          start: number;
          end: number;
      }
    | undefined {
    const tokens = session.tokens.filter((token) => token.channel === "code");
    const tokenIndex = tokens.findIndex(
        (token) => token.span.start <= offset && offset < token.span.end,
    );
    const token = tokens[tokenIndex];
    if (
        !token ||
        tokenIndex < 2 ||
        tokens[tokenIndex - 1].text !== "." ||
        !isIdentifierTokenForMetadata(tokens[tokenIndex - 2])
    ) {
        return undefined;
    }
    const qualifier = unquoteIdentifier(tokens[tokenIndex - 2].text).toLocaleLowerCase();
    for (const reference of session.externalReferences()) {
        if (
            reference.role !== "read" ||
            sourceAliasForSpan(session.text, reference.span)?.toLocaleLowerCase() !== qualifier
        ) {
            continue;
        }
        const parts = reference.nameParts ?? splitMultipartIdentifier(reference.name);
        const columns = schema.columnsFor(parts, "tsql");
        const column = columns?.find(
            (candidate) =>
                candidate.name.toLocaleLowerCase() ===
                unquoteIdentifier(token.text).toLocaleLowerCase(),
        );
        if (column) {
            return {
                name: `${tokens[tokenIndex - 2].text}.${column.name}`,
                type: column.type,
                nullable: column.nullable,
                source: parts.join("."),
                start: token.span.start,
                end: token.span.end,
            };
        }
    }
    return undefined;
}

function sourceAliasForSpan(text: string, span: { readonly end: number }): string | undefined {
    const identifier = sqlIdentifierPattern(false);
    const match = new RegExp(String.raw`^\s+(?:as\s+)?(${identifier})`, "i").exec(
        text.slice(span.end),
    );
    if (
        !match ||
        /^(?:where|join|cross|inner|left|right|full|on|group|order|having)$/i.test(match[1])
    ) {
        return undefined;
    }
    return unquoteIdentifier(match[1]);
}

function isIdentifierTokenForMetadata(token: Token): boolean {
    return token.role === "identifier" || token.consumedAs === "identifier";
}

/** Recovers completed CTE projection names when a dangling member access damaged the CTE parse. */
function getRecoveredCteProjectionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
): vscode.CompletionItem[] {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const identifier = sqlIdentifierPattern(false);
    const qualifierMatch = new RegExp(`(${identifier})\s*\.\s*$`, "i").exec(text.slice(0, offset));
    if (!qualifierMatch) {
        return [];
    }
    const qualifier = unquoteIdentifier(qualifierMatch[1]);
    const ctePattern = new RegExp(String.raw`(?:\bwith|,)\s*(${identifier})\s+as\s*\(`, "gi");
    for (let match = ctePattern.exec(text); match; match = ctePattern.exec(text)) {
        const cteName = unquoteIdentifier(match[1]);
        if (cteName.toLocaleLowerCase() !== qualifier.toLocaleLowerCase()) {
            continue;
        }
        const openParenthesis = ctePattern.lastIndex - 1;
        const closeParenthesis = findMatchingParenthesis(text, openParenthesis);
        if (closeParenthesis < 0) {
            continue;
        }
        const body = text.slice(openParenthesis + 1, closeParenthesis);
        const projection = /\bselect\b([\s\S]*?)\bfrom\b/i.exec(body)?.[1];
        if (!projection) {
            continue;
        }
        const names = splitTopLevel(projection, ",")
            .map(projectionName)
            .filter((name): name is string => Boolean(name));
        return [...new Set(names)].map(
            (name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Field),
        );
    }
    return [];
}

function projectionName(expression: string): string | undefined {
    const trimmed = expression.trim();
    if (!trimmed || trimmed.endsWith(".")) {
        return undefined;
    }
    const identifier = sqlIdentifierPattern(false);
    const alias = new RegExp(`\bas\s+(${identifier})\s*$`, "i").exec(trimmed)?.[1];
    if (alias) {
        return unquoteIdentifier(alias);
    }
    const direct = new RegExp(`(?:^|\.)(${identifier})\s*$`, "i").exec(trimmed)?.[1];
    return direct ? unquoteIdentifier(direct) : undefined;
}

export class BetaSqlDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog: BetaSqlMetadataCatalog,
        private readonly _sessions = new BetaSqlSessionManager(_connectionManager, _catalog),
        private readonly _scriptingDefinitions?: ScriptingDefinitionProvider,
    ) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<vscode.Definition | undefined> {
        if (!betaSqlOwnsDocument(document)) {
            return undefined;
        }
        const session = (await this._sessions.getSession(document, token))?.session;
        if (!session) {
            return undefined;
        }
        const offset = document.offsetAt(position);
        const symbol = session.symbolAt(offset);
        const declaration = symbol?.definition ?? session.referencesAt(offset)?.declaration;
        if (declaration) {
            return new vscode.Location(document.uri, rangeFromSpan(document, declaration));
        }

        if (!this._scriptingDefinitions) {
            return undefined;
        }
        const external = session
            .externalReferences()
            .find(
                (reference) =>
                    reference.role !== "define" &&
                    reference.role !== "drop" &&
                    reference.span.start <= offset &&
                    offset <= reference.span.end,
            );
        const parts =
            external?.nameParts ?? (external ? splitMultipartIdentifier(external.name) : undefined);
        const reference = parts ? objectReferenceFromParts(parts) : undefined;
        const connection = this._connectionManager.getConnectionInfo(getUriKey(document.uri));
        if (!reference || !connection?.connectionId || token?.isCancellationRequested) {
            return undefined;
        }

        this._catalog.setOwnerUri(connection.connectionId, getUriKey(document.uri));
        let object: DatabaseObject | undefined;
        try {
            object = await this._catalog.getObject(connection.connectionId, reference);
        } catch {
            return undefined;
        }
        if (!object || object.baseObject || token?.isCancellationRequested) {
            return undefined;
        }
        const scriptingObject = catalogObjectFromMultipart(
            [object.server, object.database, object.schema, object.name].filter(
                (part): part is string => Boolean(part),
            ),
            object.type,
        );
        if (!scriptingObject) {
            return undefined;
        }
        const location = await this._scriptingDefinitions.resolveDefinition(
            document.uri,
            scriptingObject,
            this._catalog.generationFor(connection.connectionId),
            token,
        );
        return !token?.isCancellationRequested &&
            this._sessions.documents.get(document.uri.toString())?.version === document.version
            ? location
            : undefined;
    }
}

export class BetaSqlSignatureHelpProvider implements vscode.SignatureHelpProvider {
    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog: BetaSqlMetadataCatalog,
        private readonly _sessions = new BetaSqlSessionManager(_connectionManager, _catalog),
    ) {}

    public async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token?: vscode.CancellationToken,
    ): Promise<vscode.SignatureHelp | undefined> {
        if (!betaSqlOwnsDocument(document)) {
            return undefined;
        }
        const requestedVersion = document.version;
        const isCurrent = (): boolean =>
            !token?.isCancellationRequested && document.version === requestedVersion;
        const offset = document.offsetAt(position);
        const connection = this._connectionManager.getConnectionInfo(getUriKey(document.uri));
        const prefix = document.getText().slice(0, offset);
        const insertValuesContext = getInsertValuesContext(prefix);
        const call = insertValuesContext
            ? undefined
            : (getRoutineCallContext(prefix) ?? getExecuteRoutineCallContext(prefix));
        if (connection?.connectionId && call) {
            this._catalog.setOwnerUri(connection.connectionId, getUriKey(document.uri));
            const object = await this._catalog.getObject(connection.connectionId, call.routine);
            if (
                isCurrent() &&
                object &&
                ((call.kind === "function" &&
                    (object.type === "scalarFunction" || object.type === "tableValuedFunction")) ||
                    (call.kind === "execute" && object.type === "storedProcedure"))
            ) {
                const members = await this._catalog.getMembersWithTypes(
                    connection.connectionId,
                    object,
                );
                if (members.length > 0 && isCurrent()) {
                    const help = new vscode.SignatureHelp();
                    const name = [object.schema, object.name]
                        .map(quoteCompletionIdentifier)
                        .join(".");
                    const parameters = members
                        .map((member) => `${member.name} ${member.type}`)
                        .join(", ");
                    const signature = new vscode.SignatureInformation(
                        call.kind === "execute"
                            ? `${name} ${parameters}`
                            : `${name}(${parameters})`,
                    );
                    signature.parameters = members.map(
                        (member) =>
                            new vscode.ParameterInformation(`${member.name} ${member.type}`),
                    );
                    help.signatures = [signature];
                    help.activeSignature = 0;
                    help.activeParameter = Math.min(call.activeParameter, members.length - 1);
                    return help;
                }
            }
        }

        const sessionResult = await this._sessions.getSession(document, token);
        if (!isCurrent()) {
            return undefined;
        }
        const signature = sessionResult?.session.signatureAt(offset);
        if (signature) {
            const help = new vscode.SignatureHelp();
            help.signatures = signature.signatures.map((candidate) => {
                const information = new vscode.SignatureInformation(candidate.label);
                information.parameters = candidate.parameters.map(
                    (parameter) => new vscode.ParameterInformation(parameter.label),
                );
                return information;
            });
            help.activeSignature = signature.activeSignature;
            help.activeParameter = signature.activeParameter;
            return help;
        }
        return insertValuesContext && sessionResult
            ? this.getInsertValuesSignatureHelp(
                  insertValuesContext,
                  sessionResult.schema,
                  connection?.connectionId,
                  token,
                  isCurrent,
              )
            : undefined;
    }

    private async getInsertValuesSignatureHelp(
        context: InsertValuesContext,
        schema: SchemaProvider,
        connectionId: string | undefined,
        token?: vscode.CancellationToken,
        isCurrent: () => boolean = () => !token?.isCancellationRequested,
    ): Promise<vscode.SignatureHelp | undefined> {
        let members: ObjectMember[] = [];
        if (connectionId) {
            const object = await this._catalog.getObject(connectionId, context.target);
            if (!isCurrent()) {
                return undefined;
            }
            if (object) {
                members = await this._catalog.getMembersWithTypes(connectionId, object);
                if (!isCurrent()) {
                    return undefined;
                }
            }
        }
        if (members.length === 0) {
            const parts = [
                context.target.server,
                context.target.database,
                context.target.schema,
                context.target.name,
            ].filter((part): part is string => Boolean(part));
            members = (schema.columnsFor(parts, "tsql") ?? []).map((column) => ({
                name: column.name,
                type: column.type,
            }));
        }
        if (!isCurrent()) {
            return undefined;
        }
        const parameters = context.columns
            ? context.columns.map(
                  (column) =>
                      members.find(
                          (member) =>
                              member.name.toLocaleLowerCase() === column.toLocaleLowerCase(),
                      ) ?? { name: column, type: "unknown" },
              )
            : members.filter((member) => member.insertable !== false);
        if (parameters.length === 0) {
            return undefined;
        }
        const target = [
            context.target.server,
            context.target.database,
            context.target.schema,
            context.target.name,
        ]
            .filter((part): part is string => Boolean(part))
            .map(quoteCompletionIdentifier)
            .join(".");
        const parameterLabels = parameters.map(
            (parameter) => `${quoteCompletionIdentifier(parameter.name)} ${parameter.type}`,
        );
        const signature = new vscode.SignatureInformation(
            `INSERT INTO ${target} VALUES (${parameterLabels.join(", ")})`,
            "Each VALUES expression corresponds to the highlighted target column.",
        );
        signature.parameters = parameters.map(
            (parameter, index) =>
                new vscode.ParameterInformation(
                    parameterLabels[index],
                    `Column ${quoteCompletionIdentifier(parameter.name)} (${parameter.type})`,
                ),
        );
        const help = new vscode.SignatureHelp();
        help.signatures = [signature];
        help.activeSignature = 0;
        help.activeParameter = Math.min(context.activeParameter, parameters.length - 1);
        return help;
    }
}

export class BetaSqlDiagnostics implements vscode.Disposable {
    private readonly _versions = new Map<string, number>();
    private readonly _pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        connectionManager: ConnectionManager,
        catalog: BetaSqlMetadataCatalog,
        private readonly _collection: vscode.DiagnosticCollection,
        private readonly _sessions = new BetaSqlSessionManager(connectionManager, catalog),
    ) {}

    public async update(document: vscode.TextDocument): Promise<void> {
        if (document.languageId !== Constants.languageId) {
            return;
        }
        const key = getUriKey(document.uri);
        const version = document.version;
        this._versions.set(key, version);
        if (!betaSqlOwnsDocument(document)) {
            this._collection.delete(document.uri);
            return;
        }
        let result: SessionResult | undefined;
        try {
            result = await this._sessions.getSession(document);
        } catch {
            const schema = new BetaSqlDocumentSchema();
            schema.update(getLocalSchemaMapping(document.getText()), false);
            const langiumDocument = updateFromVsCodeDocument(this._sessions.documents, document, {
                catalog: { provider: schema, revision: schema.version },
                parseText: getParseableEditorText(document.getText()),
            });
            result = {
                session: requireAnalysisSnapshot(langiumDocument),
                schema,
                metadataComplete: false,
                document: langiumDocument,
            };
        }
        if (!result || this._versions.get(key) !== version) {
            return;
        }
        const diagnostics = [
            ...result.session.syntaxDiagnostics,
            ...result.session.semanticDiagnostics,
        ]
            .filter((diagnostic) => shouldPublishDiagnostic(diagnostic, document))
            .map((diagnostic) => toVsCodeDiagnostic(document, diagnostic));
        diagnostics.push(...getSupplementalStructuralDiagnostics(document, result.session));
        this._collection.set(document.uri, deduplicateDiagnostics(diagnostics));
    }

    public schedule(document: vscode.TextDocument, delayMs = 500): void {
        if (document.languageId !== Constants.languageId) {
            return;
        }
        const key = getUriKey(document.uri);
        const pending = this._pendingUpdates.get(key);
        if (pending) {
            clearTimeout(pending);
        }
        this._pendingUpdates.set(
            key,
            setTimeout(() => {
                this._pendingUpdates.delete(key);
                void this.update(document);
            }, delayMs),
        );
    }

    public clear(documentUri?: vscode.Uri): void {
        if (documentUri) {
            const key = getUriKey(documentUri);
            const pending = this._pendingUpdates.get(key);
            if (pending) {
                clearTimeout(pending);
                this._pendingUpdates.delete(key);
            }
            this._versions.delete(key);
            this._collection.delete(documentUri);
        } else {
            for (const pending of this._pendingUpdates.values()) {
                clearTimeout(pending);
            }
            this._pendingUpdates.clear();
            this._versions.clear();
            this._collection.clear();
        }
    }

    public dispose(): void {
        this.clear();
        this._collection.dispose();
    }
}

/** Metadata-independent checks which supplement the parser-neutral analysis snapshot. */
function getSupplementalStructuralDiagnostics(
    document: vscode.TextDocument,
    session: SqlAnalysisSnapshot,
): vscode.Diagnostic[] {
    return [
        ...getDuplicateSourceDiagnostics(document, session),
        ...getUndeclaredVariableDiagnostics(document, session),
        ...getInsertArityDiagnostics(document),
    ];
}

function getDuplicateSourceDiagnostics(
    document: vscode.TextDocument,
    session: SqlAnalysisSnapshot,
): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    for (const statement of session.statements) {
        const references = session
            .externalReferences()
            .filter(
                (reference) =>
                    reference.role === "read" &&
                    !/^[#@]/.test(reference.name) &&
                    !session
                        .symbols()
                        .some(
                            (symbol) =>
                                symbol.kind === "cte" &&
                                symbol.span.start === reference.span.start &&
                                symbol.span.end === reference.span.end,
                        ) &&
                    statement.span.start <= reference.span.start &&
                    reference.span.end <= statement.span.end,
            )
            .filter(
                (reference, index, all) =>
                    all.findIndex(
                        (candidate) =>
                            candidate.span.start === reference.span.start &&
                            candidate.span.end === reference.span.end,
                    ) === index,
            );
        const byExposedName = new Map<string, typeof references>();
        for (const reference of references) {
            const exposed =
                sourceAliasForSpan(session.text, reference.span) ??
                reference.nameParts?.at(-1) ??
                reference.name.split(".").at(-1)!;
            const values = byExposedName.get(exposed.toLocaleLowerCase()) ?? [];
            values.push(reference);
            byExposedName.set(exposed.toLocaleLowerCase(), values);
        }
        for (const duplicates of byExposedName.values()) {
            if (duplicates.length < 2) {
                continue;
            }
            diagnostics.push(
                createSupplementalDiagnostic(
                    document,
                    `The objects '${duplicates[0].name}' and '${duplicates[1].name}' in the FROM clause have the same exposed names. Use correlation names to distinguish them.`,
                    duplicates[1].span.start,
                    duplicates[1].span.end,
                    "duplicate-exposed-name",
                ),
            );
        }
    }
    for (const scope of session.scopes) {
        const sourcesByKey = new Map<string, (typeof scope.sources)[number][]>();
        for (const binding of scope.sources) {
            const sources = sourcesByKey.get(binding.key) ?? [];
            sources.push(binding);
            sourcesByKey.set(binding.key, sources);
        }
        for (const duplicates of sourcesByKey.values()) {
            if (duplicates.length < 2) {
                continue;
            }
            const first = duplicates[0];
            const second = duplicates[1];
            if (first.kind !== "table" || second.kind !== "table") {
                continue;
            }
            const name = first.name ?? first.nameParts?.join(".") ?? first.key;
            const secondName = second.name ?? second.nameParts?.join(".") ?? second.key;
            const start = second.span?.start ?? 0;
            const end = second.span?.end ?? start + secondName.length;
            diagnostics.push(
                createSupplementalDiagnostic(
                    document,
                    `The objects '${name}' and '${secondName}' in the FROM clause have the same exposed names. Use correlation names to distinguish them.`,
                    start,
                    end,
                    "duplicate-exposed-name",
                ),
            );
        }
    }
    return diagnostics;
}

function getUndeclaredVariableDiagnostics(
    document: vscode.TextDocument,
    session: SqlAnalysisSnapshot,
): vscode.Diagnostic[] {
    const seen = new Set<number>();
    const diagnostics: vscode.Diagnostic[] = [];
    for (const symbol of session.symbols()) {
        if (
            symbol.kind !== "variable" ||
            symbol.definition ||
            symbol.modifiers.includes("declaration") ||
            seen.has(symbol.span.start)
        ) {
            continue;
        }
        const raw = document.getText().slice(symbol.span.start, symbol.span.end);
        if (!raw.startsWith("@") || raw.startsWith("@@")) {
            continue;
        }
        seen.add(symbol.span.start);
        diagnostics.push(
            createSupplementalDiagnostic(
                document,
                `Must declare the scalar variable "${raw}".`,
                symbol.span.start,
                symbol.span.end,
                "undeclared-variable",
            ),
        );
    }
    return diagnostics;
}

function getInsertArityDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const text = document.getText();
    const identifier = sqlIdentifierPattern(false);
    const qualifiedIdentifier = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,3}`;
    const pattern = new RegExp(
        String.raw`\binsert\s+into\s+${qualifiedIdentifier}\s*\(([^)]*)\)\s*values\s*`,
        "gi",
    );
    const diagnostics: vscode.Diagnostic[] = [];
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        const columns = splitTopLevel(match[1], ",").filter((column) => column.trim());
        const rowStart = text.indexOf("(", pattern.lastIndex);
        if (rowStart < 0) {
            continue;
        }
        const rowEnd = findMatchingParenthesis(text, rowStart);
        if (rowEnd < 0) {
            continue;
        }
        const values = splitTopLevel(text.slice(rowStart + 1, rowEnd), ",").filter((value) =>
            value.trim(),
        );
        if (columns.length !== values.length) {
            const comparison = columns.length > values.length ? "more" : "fewer";
            diagnostics.push(
                createSupplementalDiagnostic(
                    document,
                    `There are ${comparison} columns in the INSERT statement than values specified in the VALUES clause. The number of values in the VALUES clause must match the number of columns specified in the INSERT statement.`,
                    rowStart,
                    rowEnd + 1,
                    "insert-values-arity",
                ),
            );
        }
        pattern.lastIndex = rowEnd + 1;
    }
    return diagnostics;
}

function createSupplementalDiagnostic(
    document: vscode.TextDocument,
    message: string,
    start: number,
    end: number,
    code: string,
): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(start), document.positionAt(end)),
        message,
        vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = "vscode-mssql";
    diagnostic.code = code;
    return diagnostic;
}

function deduplicateDiagnostics(diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.message}|${diagnostic.range.start.line}:${diagnostic.range.start.character}|${diagnostic.range.end.line}:${diagnostic.range.end.character}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/** Offers a safe recovery action for diagnostics that may be based on stale catalog metadata. */
export class BetaSqlCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    };

    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        if (!betaSqlOwnsDocument(document)) {
            return [];
        }
        const diagnostics = context.diagnostics.filter(
            (diagnostic) => diagnostic.source === "vscode-mssql",
        );
        if (diagnostics.length === 0) {
            return [];
        }
        const refresh = new vscode.CodeAction(
            loc.codeLensRefreshTooltip,
            vscode.CodeActionKind.QuickFix,
        );
        refresh.diagnostics = diagnostics;
        refresh.command = {
            title: loc.codeLensRefreshTooltip,
            command: Constants.cmdRefreshBetaLanguageService,
            arguments: [document.uri],
        };
        return [refresh];
    }
}

export class BetaSqlCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly _changed = new vscode.EventEmitter<void>();
    private readonly _subscriptions: vscode.Disposable;
    public readonly onDidChangeCodeLenses = this._changed.event;

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _catalog: BetaSqlMetadataCatalog,
    ) {
        this._subscriptions = vscode.Disposable.from(
            _connectionManager.onConnectionsChanged
                ? _connectionManager.onConnectionsChanged(() => this._changed.fire())
                : vscode.Disposable.from(),
            _catalog.onDidChangeStatus(() => this._changed.fire()),
        );
    }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!betaSqlOwnsDocument(document)) {
            return [];
        }
        const connection = this._connectionManager.getConnectionInfo(getUriKey(document.uri));
        if (!connection?.connectionId) {
            return [];
        }
        const status = this._catalog.getStatus(connection.connectionId);
        const title =
            status === "loading"
                ? loc.codeLensLoading
                : status === "error"
                  ? loc.codeLensError
                  : status === "ready"
                    ? loc.codeLensReady
                    : loc.codeLensIdle;
        return [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title,
                tooltip: loc.codeLensRefreshTooltip,
                command: Constants.cmdRefreshBetaLanguageService,
                arguments: [document.uri],
            }),
        ];
    }

    public refresh(documentUri: vscode.Uri): void {
        const connection = this._connectionManager.getConnectionInfo(getUriKey(documentUri));
        this._catalog.clear(connection?.connectionId);
        this._changed.fire();
    }

    public notifyChanged(): void {
        this._changed.fire();
    }

    public dispose(): void {
        this._subscriptions.dispose();
        this._changed.dispose();
    }
}

export function synchronizeBetaSqlLanguageService(connectionManager: ConnectionManager): void {
    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId !== Constants.languageId) {
            continue;
        }
        const owned = betaSqlOwnsDocument(document);
        const flavor = owned ? Constants.noneProviderName : Constants.mssqlProviderName;
        if (owned) {
            SqlToolsServiceClient.instance.clearLanguageServiceDiagnostics(document.uri);
        }
        const documentUri = getUriKey(document.uri);
        connectionManager.setLanguageServiceForFile(documentUri, flavor);
    }
}

export function registerBetaSqlLanguageService(
    connectionManager: ConnectionManager,
    scriptingService?: ScriptingDefinitionScriptingApi,
): vscode.Disposable[] {
    const catalog = new BetaSqlMetadataCatalog(SqlToolsServiceClient.instance);
    const sessions = new BetaSqlSessionManager(connectionManager, catalog);
    const scriptingDefinitions = scriptingService
        ? new ScriptingDefinitionProvider(connectionManager, scriptingService)
        : undefined;
    const langiumFeatureProviders = new TsqlVsCodeFeatureProviders(sessions);
    const codeLensProvider = new BetaSqlCodeLensProvider(connectionManager, catalog);
    const diagnostics = new BetaSqlDiagnostics(
        connectionManager,
        catalog,
        vscode.languages.createDiagnosticCollection("vscode-mssql"),
        sessions,
    );
    let knownConnectionIds = new Set<string>();
    const refreshConnections = (): void => {
        const activeConnectionIds = new Set<string>();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId !== Constants.languageId) {
                continue;
            }
            const uri = getUriKey(document.uri);
            const connectionId = connectionManager.getConnectionInfo(uri)?.connectionId;
            if (connectionId) {
                activeConnectionIds.add(connectionId);
                catalog.setOwnerUri(connectionId, uri);
            }
        }
        for (const connectionId of knownConnectionIds) {
            if (!activeConnectionIds.has(connectionId)) {
                scriptingDefinitions?.invalidate(connectionId);
            }
        }
        knownConnectionIds = activeConnectionIds;
        catalog.retainConnections(activeConnectionIds);
        sessions.retainConnections(activeConnectionIds);
        synchronizeBetaSqlLanguageService(connectionManager);
        codeLensProvider.notifyChanged();
        for (const document of vscode.workspace.textDocuments) {
            diagnostics.schedule(document, 0);
        }
    };
    synchronizeBetaSqlLanguageService(connectionManager);
    for (const document of vscode.workspace.textDocuments) {
        void diagnostics.update(document);
    }
    return [
        codeLensProvider,
        diagnostics,
        sessions,
        catalog,
        ...(scriptingDefinitions
            ? [
                  scriptingDefinitions,
                  vscode.workspace.registerTextDocumentContentProvider(
                      ScriptingDefinitionProvider.scheme,
                      scriptingDefinitions,
                  ),
              ]
            : []),
        ...langiumFeatureProviders.register({ language: "sql" }),
        vscode.languages.registerCompletionItemProvider(
            { language: "sql" },
            new BetaSqlCompletionProvider(connectionManager, catalog, sessions),
            ".",
            "(",
            ",",
            "*",
        ),
        vscode.languages.registerHoverProvider(
            { language: "sql" },
            new BetaSqlHoverProvider(connectionManager, catalog, sessions),
        ),
        vscode.languages.registerDefinitionProvider(
            { language: "sql" },
            new BetaSqlDefinitionProvider(
                connectionManager,
                catalog,
                sessions,
                scriptingDefinitions,
            ),
        ),
        vscode.languages.registerSignatureHelpProvider(
            { language: "sql" },
            new BetaSqlSignatureHelpProvider(connectionManager, catalog, sessions),
            "(",
            ",",
        ),
        vscode.languages.registerCodeActionsProvider(
            { language: "sql" },
            new BetaSqlCodeActionProvider(),
            BetaSqlCodeActionProvider.metadata,
        ),
        vscode.languages.registerCodeLensProvider({ language: "sql" }, codeLensProvider),
        vscode.commands.registerCommand(
            Constants.cmdRefreshBetaLanguageService,
            (documentUri: vscode.Uri) => {
                const connectionId = connectionManager.getConnectionInfo(
                    getUriKey(documentUri),
                )?.connectionId;
                codeLensProvider.refresh(documentUri);
                scriptingDefinitions?.invalidate(connectionId);
                sessions.invalidate(documentUri);
                const document = vscode.workspace.textDocuments.find(
                    (candidate) => candidate.uri.toString() === documentUri.toString(),
                );
                if (document) {
                    void diagnostics.update(document);
                }
            },
        ),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === Constants.languageId) {
                const flavor = betaSqlOwnsDocument(document)
                    ? Constants.noneProviderName
                    : Constants.mssqlProviderName;
                connectionManager.setLanguageServiceForFile(getUriKey(document.uri), flavor);
            }
            void diagnostics.update(document);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            diagnostics.schedule(event.document);
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            diagnostics.clear(document.uri);
            sessions.invalidate(document.uri);
            forgetSqlDocumentOwnership(document.uri);
        }),
        connectionManager.onConnectionsChanged(() => refreshConnections()),
        connectionManager.onSuccessfulConnection(({ connection, fileUri }) => {
            if (connection.connectionId) {
                catalog.clear(connection.connectionId);
                scriptingDefinitions?.invalidate(connection.connectionId);
                catalog.setOwnerUri(connection.connectionId, fileUri);
            }
            const document = vscode.workspace.textDocuments.find(
                (candidate) => candidate.uri.toString() === fileUri,
            );
            if (document) {
                sessions.invalidate(document.uri);
            }
            refreshConnections();
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration(getPreviewConfigKey(PreviewFeature.BetaLanguageService))
            ) {
                synchronizeBetaSqlLanguageService(connectionManager);
                sessions.invalidate();
                codeLensProvider.notifyChanged();
                for (const document of vscode.workspace.textDocuments) {
                    void diagnostics.update(document);
                }
            }
        }),
    ];
}
