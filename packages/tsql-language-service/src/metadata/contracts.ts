/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";

export type MetadataSection =
    | "databases"
    | "schemas"
    | "objects"
    | "columns"
    | "parameters"
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

export type SqlPrincipalKind =
    | "login"
    | "user"
    | "databaseRole"
    | "serverRole"
    | "applicationRole";

export interface PrincipalMetadata {
    readonly id: string;
    readonly database?: string;
    readonly name: string;
    readonly kind: SqlPrincipalKind;
    readonly system?: boolean;
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
    searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[];
    searchPrincipals(query: PrincipalSearchQuery): readonly PrincipalMetadata[];
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
}

export interface InMemoryMetadataInput {
    readonly environment?: Partial<SqlEnvironment>;
    readonly completeness?: Partial<MetadataCompleteness>;
    readonly objects?: readonly ObjectMetadata[];
    readonly columns?: ReadonlyMap<string, readonly ColumnMetadata[]>;
    readonly parameters?: ReadonlyMap<string, readonly ParameterMetadata[]>;
    readonly principals?: readonly PrincipalMetadata[];
    readonly databaseCatalogCompleteness?: ReadonlyMap<
        string,
        Partial<DatabaseCatalogCompleteness>
    >;
    readonly columnStates?: ReadonlyMap<string, MetadataLoadState<readonly ColumnMetadata[]>>;
    readonly parameterStates?: ReadonlyMap<string, MetadataLoadState<readonly ParameterMetadata[]>>;
    readonly schemas?: readonly SchemaMetadata[];
    readonly databases?: readonly DatabaseMetadata[];
}
