/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type { CatalogStatsSnapshot } from "../observability/contracts.js";

export type MetadataSection =
    | "databases"
    | "schemas"
    | "objects"
    | "columns"
    | "parameters"
    | "indexes"
    | "triggers"
    | "constraints"
    | "clrTypes"
    | "securables"
    | "collations"
    | "principals"
    | "definitions";

export type MetadataSectionState = "unknown" | "loading" | "ready" | "partial" | "stale" | "failed";

export type MetadataCompleteness = Readonly<Record<MetadataSection, MetadataSectionState>>;

/** Per-database identity readiness used by lazy cross-database catalog loading. */
export interface DatabaseCatalogCompleteness {
    readonly schemas: MetadataSectionState;
    readonly objects: MetadataSectionState;
}

export interface SqlEnvironment {
    readonly currentDatabase?: string;
    readonly defaultSchema: string;
    readonly caseSensitive: boolean;
    readonly engineEdition?: number;
    readonly serverVersion?: string;
    readonly compatibilityLevel?: number;
    /**
     * The connected server's name, when the backend reports one.
     *
     * It exists so the engine-profile resolver can separate Fabric Data Warehouse from Azure
     * Synapse serverless, which report the same engine edition. Nothing else reads it, and it is
     * never included in copied diagnostics.
     */
    readonly serverName?: string;
}

export type SqlObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym"
    | "type";

export interface ObjectRef {
    readonly id: string;
    readonly database?: string;
}

export interface ObjectMetadata {
    readonly ref: ObjectRef;
    readonly database?: string;
    readonly schema: string;
    readonly name: string;
    readonly kind: SqlObjectKind;
    /** Distinguishes alias, CLR, and table-valued user types when kind is `type`. */
    readonly typeCategory?: "alias" | "clr" | "table";
    /** True for SQL Server-shipped catalog objects; retained so hosts can rank rather than hide them. */
    readonly system?: boolean;
    /**
     * Whether a view was created WITH SCHEMABINDING. Undefined when the backend cannot say, which
     * is not the same as false: only an explicit `false` proves a view is not schema bound.
     */
    readonly schemaBound?: boolean;
    /** Whether a view was created WITH CHECK OPTION. Undefined means the backend cannot say. */
    readonly checkOption?: boolean;
    /**
     * True for an extended stored procedure, which is implemented outside SQL Server. Parameter
     * help cannot describe one, so callers present it differently from a Transact-SQL procedure.
     */
    readonly extendedProcedure?: boolean;
    /**
     * The type a scalar function returns, as written in its definition.
     *
     * Undefined means the backend did not report one, which is not the same as a function with no
     * result: an absent value leaves the call's type unknown rather than making it look untyped.
     */
    readonly returnType?: string;
}

/** One DML trigger owned by a table or view, described by the actions that fire it. */
export interface TriggerMetadata {
    readonly name: string;
    /** True for an INSTEAD OF trigger; false or undefined for an AFTER or FOR trigger. */
    readonly insteadOf?: boolean;
    readonly insert?: boolean;
    readonly update?: boolean;
    readonly delete?: boolean;
    readonly disabled?: boolean;
}

/** One callable or readable member of a CLR user-defined type. */
export interface ClrMemberMetadata {
    readonly name: string;
    readonly kind: "method" | "property" | "field";
    /** True for a member reached through the type; false or undefined for an instance member. */
    readonly static?: boolean;
    /**
     * The SQL type the member yields, as written.
     *
     * Undefined means the backend did not report one. A member that exists but has no reported
     * type leaves the expression untyped rather than making it look like an unknown member.
     */
    readonly typeDisplay?: string;
}

/**
 * The CLR class one user-defined type is bound to.
 *
 * `system` marks a type shipped with SQL Server, whose member list is complete. A member missing
 * from a non-system type proves nothing, because the backend may not enumerate user assemblies.
 */
export interface ClrTypeMetadata {
    readonly className: string;
    readonly assemblyName: string;
    readonly system?: boolean;
    readonly members: readonly ClrMemberMetadata[];
}

/** What a foreign key does to referencing rows when the referenced row changes. */
export type ForeignKeyAction = "noAction" | "cascade" | "setNull" | "setDefault";

/** One foreign key defined on a table, with the actions that make it cascade. */
export interface ForeignKeyMetadata {
    readonly name: string;
    readonly referencedObject?: ObjectRef;
    readonly updateAction?: ForeignKeyAction;
    readonly deleteAction?: ForeignKeyAction;
}

/**
 * How an index stores its data. Only a relational index participates in DROP_EXISTING replacement;
 * XML and spatial indexes have to be dropped and recreated.
 */
export type SqlIndexKind = "relational" | "xml" | "spatial";

export interface IndexColumnMetadata {
    readonly name: string;
    /** True for an INCLUDE column, which is stored with the index but is not part of its key. */
    readonly included?: boolean;
    readonly descending?: boolean;
}

/** One index or statistics object owned by a table or view. */
export interface IndexMetadata {
    readonly name: string;
    readonly kind: SqlIndexKind;
    readonly unique?: boolean;
    readonly clustered?: boolean;
    /** True for a statistics object, which shares the index namespace of its owning object. */
    readonly statistics?: boolean;
    readonly columns?: readonly IndexColumnMetadata[];
}

export interface ColumnMetadata {
    readonly name: string;
    readonly typeDisplay?: string;
    readonly nullable?: boolean;
    readonly identity?: boolean;
    readonly computed?: boolean;
    /** One-based position in the owning table's primary key, when catalog metadata provides it. */
    readonly primaryKeyOrdinal?: number;
}

export interface ParameterMetadata {
    readonly ordinal: number;
    readonly name: string;
    readonly typeDisplay?: string;
    readonly output?: boolean;
    /** Undefined when the metadata backend cannot authoritatively determine optionality. */
    readonly hasDefault?: boolean;
}

export interface SchemaMetadata {
    readonly database?: string;
    readonly name: string;
}

export interface DatabaseMetadata {
    readonly name: string;
}

export type SqlPrincipalKind = "login" | "user" | "databaseRole" | "serverRole" | "applicationRole";

export interface PrincipalMetadata {
    readonly id: string;
    readonly database?: string;
    readonly name: string;
    readonly kind: SqlPrincipalKind;
    readonly system?: boolean;
}

/** Security objects that are named directly by principal DDL rather than through sys.objects. */
export type SqlSecurableKind = "credential" | "certificate" | "asymmetricKey";

export interface SecurableMetadata {
    readonly id: string;
    readonly name: string;
    readonly kind: SqlSecurableKind;
    /** Absent for a server-scoped securable such as a credential or a server certificate. */
    readonly database?: string;
}

export interface SecurableSearchQuery {
    /** Omitted searches the server scope; a name searches that database's scope. */
    readonly database?: string;
    readonly kinds?: readonly SqlSecurableKind[];
    readonly prefix?: string;
    readonly limit?: number;
}

export interface PrincipalSearchQuery {
    readonly database?: string;
    readonly prefix?: string;
    readonly kinds?: readonly SqlPrincipalKind[];
    readonly limit?: number;
}

export interface ObjectSearchQuery {
    readonly database?: string;
    readonly schema?: string;
    readonly prefix?: string;
    readonly kinds?: readonly SqlObjectKind[];
    readonly limit?: number;
}

export type MetadataLoadState<T> =
    | { readonly kind: "loaded"; readonly value: T }
    | { readonly kind: "notLoaded" }
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly previous?: T };

export type ObjectResolution =
    | { readonly kind: "resolved"; readonly object: ObjectMetadata }
    | { readonly kind: "ambiguous"; readonly candidates: readonly ObjectMetadata[] }
    | { readonly kind: "notFound" }
    | {
          readonly kind: "unknown";
          readonly reason: "metadataPending" | "metadataUnavailable" | "metadataStale";
      };

export interface MetadataView {
    readonly providerId: string;
    readonly generation: number;
    readonly environment: SqlEnvironment;
    readonly completeness: MetadataCompleteness;
    readonly publishedAt: number;

    resolveObject(parts: readonly string[]): ObjectResolution;
    object(ref: ObjectRef): ObjectMetadata | undefined;
    columnState(ref: ObjectRef): MetadataLoadState<readonly ColumnMetadata[]>;
    parameterState(ref: ObjectRef): MetadataLoadState<readonly ParameterMetadata[]>;
    /**
     * The complete index and statistics set owned by one table or view.
     *
     * Only a `loaded` state proves which indexes exist. Every other state means unknown, so an
     * index conflict or absence must not be reported from it.
     */
    indexState(ref: ObjectRef): MetadataLoadState<readonly IndexMetadata[]>;
    /**
     * The complete DML trigger set owned by one table or view. Only a `loaded` state proves which
     * triggers exist, so a duplicate or ownership result must not come from any other state.
     */
    triggerState(ref: ObjectRef): MetadataLoadState<readonly TriggerMetadata[]>;
    /**
     * The complete foreign key set defined on one table. Only a `loaded` state proves which
     * cascading relationships exist.
     */
    foreignKeyState(ref: ObjectRef): MetadataLoadState<readonly ForeignKeyMetadata[]>;
    /**
     * The CLR class and member list behind one user-defined type. Only a `loaded` state describes
     * which members exist, and only a system type's list is complete enough to prove absence.
     */
    clrTypeState(ref: ObjectRef): MetadataLoadState<ClrTypeMetadata>;
    searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[];
    searchPrincipals(query: PrincipalSearchQuery): readonly PrincipalMetadata[];
    /**
     * Credentials, certificates, and asymmetric keys in one scope. Absence is only authoritative
     * when the securables section is ready.
     */
    searchSecurables(query: SecurableSearchQuery): readonly SecurableMetadata[];
    /**
     * The collations this server accepts, or undefined when that catalog is unavailable. An
     * unavailable list must never become an invalid-collation result.
     */
    collations(): readonly string[] | undefined;
    databaseCatalogCompleteness(database: string): DatabaseCatalogCompleteness;
    schemas(database?: string): readonly SchemaMetadata[] | undefined;
    databases(): readonly DatabaseMetadata[] | undefined;
}

export interface MetadataHydrationRequest {
    readonly section: MetadataSection;
    readonly object?: ObjectRef;
    /** Requests a lazily loaded catalog section for a database already advertised by databases(). */
    readonly database?: string;
    readonly priority: "interactive" | "background";
    /**
     * The interaction that needs this section -- "completion", "hover", "bind".
     *
     * Carried so the fetch log can say why a query ran, which is the difference between a list of
     * queries and an explanation. Optional because a provider must work without it, and absent
     * rather than guessed when a caller does not know.
     */
    readonly reason?: string;
}

export interface MetadataRefreshResult {
    readonly generation: number;
    readonly published: boolean;
    readonly elapsedMs: number;
}

export interface MetadataProvider {
    readonly id: string;
    pin(): MetadataView;
    requestHydration(request: MetadataHydrationRequest): void;
    /** Waits for interactive lazy loads already requested by editor features, when supported. */
    waitForHydration?(signal?: AbortSignal): Promise<void>;
    /**
     * Forces authoritative reloads for catalog sections invalidated by successful DDL.
     *
     * Unlike requestHydration, this must reload a section even when its current generation is
     * marked ready. Providers may fall back to a full refresh when they cannot isolate a section.
     */
    refreshSections?(
        sections: readonly MetadataSection[],
        signal?: AbortSignal,
    ): Promise<MetadataRefreshResult>;
    refresh(signal?: AbortSignal): Promise<MetadataRefreshResult>;
    onDidChange(listener: () => void): Disposable;
    /**
     * Reports that a caller used a section it found already resident, so no fetch was needed.
     *
     * Separate from {@link requestHydration} because the two are different events and only one of
     * them is a request: a feature that finds its columns in memory returns without asking for
     * anything, which is exactly why a fetch log alone shows every request going to the server and
     * makes the cache look absent.
     *
     * Optional, and ignored by providers that record nothing.
     */
    noteResidentUse?(request: MetadataHydrationRequest): void;
    /**
     * What this provider's catalog layer has observed, when it records it.
     *
     * Optional, and `undefined` even when implemented, because a provider may be constructed
     * without an observer. A runtime publishes an empty metadata section rather than a fabricated
     * one in either case: nothing here is reported as a measured zero unless it was measured.
     */
    catalogStats?(): CatalogStatsSnapshot | undefined;
}

export interface InMemoryMetadataInput {
    readonly environment?: Partial<SqlEnvironment>;
    readonly completeness?: Partial<MetadataCompleteness>;
    readonly objects?: readonly ObjectMetadata[];
    readonly columns?: ReadonlyMap<string, readonly ColumnMetadata[]>;
    readonly parameters?: ReadonlyMap<string, readonly ParameterMetadata[]>;
    readonly principals?: readonly PrincipalMetadata[];
    readonly securables?: readonly SecurableMetadata[];
    readonly collations?: readonly string[];
    readonly databaseCatalogCompleteness?: ReadonlyMap<
        string,
        Partial<DatabaseCatalogCompleteness>
    >;
    readonly indexes?: ReadonlyMap<string, readonly IndexMetadata[]>;
    readonly triggers?: ReadonlyMap<string, readonly TriggerMetadata[]>;
    readonly foreignKeys?: ReadonlyMap<string, readonly ForeignKeyMetadata[]>;
    readonly clrTypes?: ReadonlyMap<string, ClrTypeMetadata>;
    readonly columnStates?: ReadonlyMap<string, MetadataLoadState<readonly ColumnMetadata[]>>;
    readonly parameterStates?: ReadonlyMap<string, MetadataLoadState<readonly ParameterMetadata[]>>;
    readonly indexStates?: ReadonlyMap<string, MetadataLoadState<readonly IndexMetadata[]>>;
    readonly triggerStates?: ReadonlyMap<string, MetadataLoadState<readonly TriggerMetadata[]>>;
    readonly foreignKeyStates?: ReadonlyMap<
        string,
        MetadataLoadState<readonly ForeignKeyMetadata[]>
    >;
    readonly clrTypeStates?: ReadonlyMap<string, MetadataLoadState<ClrTypeMetadata>>;
    readonly schemas?: readonly SchemaMetadata[];
    readonly databases?: readonly DatabaseMetadata[];
}
