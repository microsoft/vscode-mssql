/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import { compareOrdinal } from "../common/ordinal.js";
import type {
    ClrTypeMetadata,
    ColumnMetadata,
    DatabaseCatalogCompleteness,
    DatabaseMetadata,
    ForeignKeyMetadata,
    IndexMetadata,
    InMemoryMetadataCheckpoint,
    InMemoryMetadataInput,
    MetadataCompleteness,
    MetadataHydrationRequest,
    MetadataLoadState,
    MetadataNameComparison,
    MetadataProvider,
    MetadataRefreshResult,
    MetadataSection,
    MetadataView,
    ObjectMetadata,
    ObjectRef,
    ObjectResolution,
    ObjectSearchQuery,
    ParameterMetadata,
    PrincipalMetadata,
    PrincipalSearchQuery,
    SchemaMetadata,
    SecurableMetadata,
    SecurableSearchQuery,
    SqlEnvironment,
    TriggerMetadata,
} from "./contracts.js";
import { createMetadataNameComparison } from "./nameComparison.js";

const ready: MetadataCompleteness = Object.freeze({
    databases: "ready",
    schemas: "ready",
    objects: "ready",
    columns: "ready",
    parameters: "ready",
    indexes: "ready",
    triggers: "ready",
    constraints: "ready",
    // A CLR member list only exists once a backend publishes it.
    clrTypes: "unknown",
    // Server-scoped security objects and collations are only authoritative once a backend
    // publishes them; an empty ready list would otherwise mean "none exist".
    securables: "unknown",
    collations: "unknown",
    principals: "ready",
    definitions: "unknown",
});

export class InMemoryMetadataProvider implements MetadataProvider {
    public readonly id: string;
    private readonly _listeners = new Set<() => void>();
    private _generation = 1;
    private _view: MetadataView;
    private _input: InMemoryMetadataInput;

    public constructor(input: InMemoryMetadataInput = {}, id = "memory") {
        this.id = id;
        this._input = cloneInput(input);
        this._view = createView(id, this._generation, this._input);
    }

    public pin(): MetadataView {
        return this._view;
    }

    public replace(input: InMemoryMetadataInput): void {
        this._input = cloneInput(input);
        this.publish();
    }

    public merge(input: InMemoryMetadataInput): void {
        this._input = mergeInput(this._input, input);
        this.publish();
    }

    /** Replaces one authoritative section without discarding unrelated catalog generations. */
    public replaceSection(section: MetadataSection, input: InMemoryMetadataInput): void {
        this._input = replaceSectionInput(this._input, section, input);
        this.publish();
    }

    /** Captures an immutable rollback point before a publisher exposes partial refresh stages. */
    public checkpoint(): InMemoryMetadataCheckpoint {
        return Object.freeze({ input: cloneInput(this._input) });
    }

    /** Restores a prior coherent catalog after a refresh fails or is cancelled. */
    public restore(checkpoint: InMemoryMetadataCheckpoint): void {
        this._input = cloneInput(checkpoint.input);
        this.publish();
    }

    private publish(): void {
        this._view = createView(this.id, ++this._generation, this._input);
        for (const listener of this._listeners) listener();
    }

    public requestHydration(_request: MetadataHydrationRequest): void {}

    public async refresh(_signal?: AbortSignal): Promise<MetadataRefreshResult> {
        return { generation: this._generation, published: false, elapsedMs: 0 };
    }

    public onDidChange(listener: () => void): Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }
}

function createView(id: string, generation: number, input: InMemoryMetadataInput): MetadataView {
    const environment: SqlEnvironment = Object.freeze({
        defaultSchema: "dbo",
        caseSensitive: false,
        ...input.environment,
    });
    const completeness: MetadataCompleteness = Object.freeze({
        ...ready,
        ...input.completeness,
    });
    return new MemoryView(id, generation, environment, completeness, input);
}

class MemoryView implements MetadataView {
    public readonly nameComparison;
    private readonly _objectsById: ReadonlyMap<string, ObjectMetadata>;
    private readonly _objectsByQualifiedName: ReadonlyMap<string, readonly ObjectMetadata[]>;
    private readonly _objects: readonly ObjectMetadata[];
    private readonly _objectsByScope: ReadonlyMap<string, readonly ObjectMetadata[]>;
    private readonly _columns: ReadonlyMap<string, readonly ColumnMetadata[]>;
    private readonly _parameters: ReadonlyMap<string, readonly ParameterMetadata[]>;
    private readonly _columnStates: ReadonlyMap<
        string,
        MetadataLoadState<readonly ColumnMetadata[]>
    >;
    private readonly _parameterStates: ReadonlyMap<
        string,
        MetadataLoadState<readonly ParameterMetadata[]>
    >;
    private readonly _indexes: ReadonlyMap<string, readonly IndexMetadata[]>;
    private readonly _indexStates: ReadonlyMap<string, MetadataLoadState<readonly IndexMetadata[]>>;
    private readonly _triggers: ReadonlyMap<string, readonly TriggerMetadata[]>;
    private readonly _triggerStates: ReadonlyMap<
        string,
        MetadataLoadState<readonly TriggerMetadata[]>
    >;
    private readonly _clrTypes: ReadonlyMap<string, ClrTypeMetadata>;
    private readonly _clrTypeStates: ReadonlyMap<string, MetadataLoadState<ClrTypeMetadata>>;
    private readonly _foreignKeys: ReadonlyMap<string, readonly ForeignKeyMetadata[]>;
    private readonly _foreignKeyStates: ReadonlyMap<
        string,
        MetadataLoadState<readonly ForeignKeyMetadata[]>
    >;
    private readonly _schemas: readonly SchemaMetadata[];
    private readonly _databases: readonly DatabaseMetadata[];
    private readonly _principals: readonly PrincipalMetadata[];
    private readonly _securables: readonly SecurableMetadata[];
    private readonly _collations: readonly string[] | undefined;
    private readonly _databaseCatalogCompleteness: ReadonlyMap<string, DatabaseCatalogCompleteness>;

    public readonly publishedAt = Date.now();

    public constructor(
        public readonly providerId: string,
        public readonly generation: number,
        public readonly environment: SqlEnvironment,
        public readonly completeness: MetadataCompleteness,
        input: InMemoryMetadataInput,
    ) {
        this.nameComparison = createMetadataNameComparison(environment.caseSensitive);
        this._objects = Object.freeze(
            [...(input.objects ?? [])].sort((left, right) =>
                compareObjects(left, right, environment, this.nameComparison),
            ),
        );
        this._objectsById = new Map(this._objects.map((object) => [object.ref.id, object]));
        this._objectsByQualifiedName = indexObjectsByQualifiedName(
            this._objects,
            this.nameComparison,
        );
        this._objectsByScope = indexObjectsByScope(this._objects, this.nameComparison);
        this._columns = input.columns ?? new Map();
        this._parameters = input.parameters ?? new Map();
        this._columnStates = input.columnStates ?? new Map();
        this._parameterStates = input.parameterStates ?? new Map();
        this._indexes = input.indexes ?? new Map();
        this._indexStates = input.indexStates ?? new Map();
        this._triggers = input.triggers ?? new Map();
        this._triggerStates = input.triggerStates ?? new Map();
        this._clrTypes = input.clrTypes ?? new Map();
        this._clrTypeStates = input.clrTypeStates ?? new Map();
        this._foreignKeys = input.foreignKeys ?? new Map();
        this._foreignKeyStates = input.foreignKeyStates ?? new Map();
        this._schemas = Object.freeze([...(input.schemas ?? [])]);
        this._databases = Object.freeze([...(input.databases ?? [])]);
        this._principals = Object.freeze(
            [...(input.principals ?? [])].sort((left, right) =>
                compareOrdinal(
                    this.nameComparison.key(left.name),
                    this.nameComparison.key(right.name),
                ),
            ),
        );
        this._securables = Object.freeze([...(input.securables ?? [])]);
        this._collations = input.collations && Object.freeze([...input.collations]);
        this._databaseCatalogCompleteness = new Map(
            [...(input.databaseCatalogCompleteness ?? [])].map(([database, state]) => [
                this.nameComparison.key(database),
                Object.freeze({
                    schemas: state.schemas ?? "unknown",
                    objects: state.objects ?? "unknown",
                }),
            ]),
        );
    }

    public resolveObject(parts: readonly string[]): ObjectResolution {
        const name = parts.at(-1);
        if (!name) return { kind: "notFound" };
        const schema = parts.length >= 2 ? parts.at(-2) : this.environment.defaultSchema;
        const database = parts.length >= 3 ? parts.at(-3) : this.environment.currentDatabase;
        const matches = database
            ? uniqueObjects([
                  ...(this._objectsByQualifiedName.get(
                      qualifiedNameKey(database, schema!, name, this.nameComparison),
                  ) ?? []),
                  ...(this._objectsByQualifiedName.get(
                      qualifiedNameKey(undefined, schema!, name, this.nameComparison),
                  ) ?? []),
              ])
            : this._objects.filter(
                  (object) =>
                      this.nameComparison.equals(object.name, name) &&
                      this.nameComparison.equals(object.schema, schema),
              );
        if (matches.length === 1) return { kind: "resolved", object: matches[0]! };
        if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
        const objectState = database
            ? this.databaseCatalogCompleteness(database).objects
            : this.completeness.objects;
        if (objectState !== "ready") {
            return { kind: "unknown", reason: stateReason(objectState) };
        }
        return { kind: "notFound" };
    }

    public object(ref: ObjectRef): ObjectMetadata | undefined {
        return this._objectsById.get(ref.id);
    }

    public columnState(ref: ObjectRef): MetadataLoadState<readonly ColumnMetadata[]> {
        return (
            this._columnStates.get(ref.id) ??
            stateFromLegacyMap(this._columns, ref.id, this.completeness.columns)
        );
    }

    public parameterState(ref: ObjectRef): MetadataLoadState<readonly ParameterMetadata[]> {
        return (
            this._parameterStates.get(ref.id) ??
            stateFromLegacyMap(this._parameters, ref.id, this.completeness.parameters)
        );
    }

    public indexState(ref: ObjectRef): MetadataLoadState<readonly IndexMetadata[]> {
        return (
            this._indexStates.get(ref.id) ??
            stateFromLegacyMap(this._indexes, ref.id, this.completeness.indexes)
        );
    }

    public triggerState(ref: ObjectRef): MetadataLoadState<readonly TriggerMetadata[]> {
        return (
            this._triggerStates.get(ref.id) ??
            stateFromLegacyMap(this._triggers, ref.id, this.completeness.triggers)
        );
    }

    public foreignKeyState(ref: ObjectRef): MetadataLoadState<readonly ForeignKeyMetadata[]> {
        return (
            this._foreignKeyStates.get(ref.id) ??
            stateFromLegacyMap(this._foreignKeys, ref.id, this.completeness.constraints)
        );
    }

    public clrTypeState(ref: ObjectRef): MetadataLoadState<ClrTypeMetadata> {
        const explicit = this._clrTypeStates.get(ref.id);
        if (explicit) return explicit;
        const value = this._clrTypes.get(ref.id);
        if (value) return { kind: "loaded", value };
        const state = this.completeness.clrTypes;
        if (state === "loading") return { kind: "loading" };
        if (state === "failed") return { kind: "failed" };
        return { kind: "notLoaded" };
    }

    public searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[] {
        const prefix = query.prefix ?? "";
        const limit = query.limit ?? 100;
        const scoped = query.schema
            ? (this._objectsByScope.get(
                  scopeKey(query.database, query.schema, this.nameComparison),
              ) ?? [])
            : this._objects;
        const matches = (object: ObjectMetadata) =>
            (!query.database ||
                this.nameComparison.equals(object.database ?? "", query.database)) &&
            (!query.schema || this.nameComparison.equals(object.schema, query.schema)) &&
            (!query.kinds || query.kinds.includes(object.kind));
        return query.schema
            ? prefixSearch(scoped, prefix, this.nameComparison, matches, limit)
            : scoped
                  .filter(
                      (object) =>
                          matches(object) && this.nameComparison.startsWith(object.name, prefix),
                  )
                  .slice(0, limit);
    }

    public databaseCatalogCompleteness(database: string): DatabaseCatalogCompleteness {
        const explicit = this._databaseCatalogCompleteness.get(this.nameComparison.key(database));
        if (explicit) return explicit;
        if (
            this.nameComparison.equals(database, this.environment.currentDatabase) ||
            this._databaseCatalogCompleteness.size === 0
        ) {
            return {
                schemas: this.completeness.schemas,
                objects: this.completeness.objects,
            };
        }
        return { schemas: "unknown", objects: "unknown" };
    }

    public searchPrincipals(query: PrincipalSearchQuery): readonly PrincipalMetadata[] {
        const prefix = query.prefix ?? "";
        const limit = query.limit ?? 100;
        return this._principals
            .filter(
                (principal) =>
                    (!query.database ||
                        !principal.database ||
                        this.nameComparison.equals(principal.database, query.database)) &&
                    (!query.kinds || query.kinds.includes(principal.kind)) &&
                    this.nameComparison.startsWith(principal.name, prefix),
            )
            .slice(0, limit);
    }

    public searchSecurables(query: SecurableSearchQuery): readonly SecurableMetadata[] {
        const prefix = query.prefix ?? "";
        return this._securables
            .filter(
                (securable) =>
                    this.nameComparison.equals(securable.database, query.database) &&
                    (!query.kinds || query.kinds.includes(securable.kind)) &&
                    this.nameComparison.startsWith(securable.name, prefix),
            )
            .slice(0, query.limit ?? 100);
    }

    public collations(): readonly string[] | undefined {
        return ["unknown", "failed"].includes(this.completeness.collations)
            ? undefined
            : (this._collations ?? []);
    }

    public schemas(database?: string): readonly SchemaMetadata[] | undefined {
        if (["unknown", "failed"].includes(this.completeness.schemas)) return undefined;
        if (
            database &&
            ["unknown", "loading", "failed"].includes(
                this.databaseCatalogCompleteness(database).schemas,
            )
        ) {
            return undefined;
        }
        return database
            ? this._schemas.filter(
                  (schema) =>
                      !schema.database || this.nameComparison.equals(schema.database, database),
              )
            : this._schemas;
    }

    public databases(): readonly DatabaseMetadata[] | undefined {
        return ["unknown", "failed"].includes(this.completeness.databases)
            ? undefined
            : this._databases;
    }
}

function stateFromLegacyMap<T>(
    values: ReadonlyMap<string, readonly T[]>,
    id: string,
    completeness: MetadataCompleteness[keyof MetadataCompleteness],
): MetadataLoadState<readonly T[]> {
    const value = values.get(id);
    if (value) return { kind: "loaded", value };
    if (completeness === "ready") return { kind: "loaded", value: [] };
    if (completeness === "loading") return { kind: "loading" };
    if (completeness === "failed") return { kind: "failed" };
    return { kind: "notLoaded" };
}

function cloneInput(input: InMemoryMetadataInput): InMemoryMetadataInput {
    return mergeInput({}, input);
}

function mergeInput(
    previous: InMemoryMetadataInput,
    next: InMemoryMetadataInput,
): InMemoryMetadataInput {
    return {
        environment: { ...previous.environment, ...next.environment },
        completeness: { ...previous.completeness, ...next.completeness },
        objects: mergeArray(previous.objects, next.objects, (object) => object.ref.id),
        schemas: mergeArray(previous.schemas, next.schemas, (schema) =>
            `${schema.database ?? ""}\u0000${schema.name}`.toLowerCase(),
        ),
        databases: mergeArray(previous.databases, next.databases, (database) =>
            database.name.toLowerCase(),
        ),
        databaseCatalogCompleteness: mergeNestedMap(
            previous.databaseCatalogCompleteness,
            next.databaseCatalogCompleteness,
        ),
        columns: mergeMap(previous.columns, next.columns),
        parameters: mergeMap(previous.parameters, next.parameters),
        indexes: mergeMap(previous.indexes, next.indexes),
        triggers: mergeMap(previous.triggers, next.triggers),
        foreignKeys: mergeMap(previous.foreignKeys, next.foreignKeys),
        clrTypes: mergeMap(previous.clrTypes, next.clrTypes),
        principals: mergeArray(previous.principals, next.principals, (principal) => principal.id),
        securables: mergeArray(previous.securables, next.securables, (securable) => securable.id),
        collations: next.collations ?? previous.collations,
        columnStates: mergeMap(previous.columnStates, next.columnStates),
        parameterStates: mergeMap(previous.parameterStates, next.parameterStates),
        indexStates: mergeMap(previous.indexStates, next.indexStates),
        triggerStates: mergeMap(previous.triggerStates, next.triggerStates),
        foreignKeyStates: mergeMap(previous.foreignKeyStates, next.foreignKeyStates),
        clrTypeStates: mergeMap(previous.clrTypeStates, next.clrTypeStates),
    };
}

function replaceSectionInput(
    previous: InMemoryMetadataInput,
    section: MetadataSection,
    replacement: InMemoryMetadataInput,
): InMemoryMetadataInput {
    const completeness = {
        ...previous.completeness,
        ...(replacement.completeness?.[section] === undefined
            ? {}
            : { [section]: replacement.completeness[section] }),
    };
    switch (section) {
        case "databases":
            return cloneInput({ ...previous, completeness, databases: replacement.databases });
        case "schemas":
            return cloneInput({ ...previous, completeness, schemas: replacement.schemas });
        case "objects":
            return cloneInput({ ...previous, completeness, objects: replacement.objects });
        case "columns":
            return cloneInput({
                ...previous,
                completeness,
                columns: replacement.columns,
                columnStates: replacement.columnStates,
            });
        case "parameters":
            return cloneInput({
                ...previous,
                completeness,
                parameters: replacement.parameters,
                parameterStates: replacement.parameterStates,
            });
        case "indexes":
            return cloneInput({
                ...previous,
                completeness,
                indexes: replacement.indexes,
                indexStates: replacement.indexStates,
            });
        case "triggers":
            return cloneInput({
                ...previous,
                completeness,
                triggers: replacement.triggers,
                triggerStates: replacement.triggerStates,
            });
        case "constraints":
            return cloneInput({
                ...previous,
                completeness,
                foreignKeys: replacement.foreignKeys,
                foreignKeyStates: replacement.foreignKeyStates,
            });
        case "clrTypes":
            return cloneInput({
                ...previous,
                completeness,
                clrTypes: replacement.clrTypes,
                clrTypeStates: replacement.clrTypeStates,
            });
        case "securables":
            return cloneInput({ ...previous, completeness, securables: replacement.securables });
        case "collations":
            return cloneInput({ ...previous, completeness, collations: replacement.collations });
        case "principals":
            return cloneInput({ ...previous, completeness, principals: replacement.principals });
        case "definitions":
            return cloneInput({ ...previous, completeness });
    }
}

function mergeArray<T>(
    previous: readonly T[] | undefined,
    next: readonly T[] | undefined,
    key: (value: T) => string,
): readonly T[] | undefined {
    if (!previous && !next) return undefined;
    if (!next) return previous;
    return [
        ...new Map([...(previous ?? []), ...next].map((value) => [key(value), value])).values(),
    ];
}

function mergeNestedMap(
    previous: ReadonlyMap<string, Partial<DatabaseCatalogCompleteness>> | undefined,
    next: ReadonlyMap<string, Partial<DatabaseCatalogCompleteness>> | undefined,
): ReadonlyMap<string, Partial<DatabaseCatalogCompleteness>> | undefined {
    if (!previous && !next) return undefined;
    const result = new Map(previous ?? []);
    for (const [database, state] of next ?? []) {
        result.set(database, { ...result.get(database), ...state });
    }
    return result;
}

function mergeMap<K, V>(
    previous: ReadonlyMap<K, V> | undefined,
    next: ReadonlyMap<K, V> | undefined,
): ReadonlyMap<K, V> | undefined {
    if (!previous && !next) return undefined;
    return new Map([...(previous ?? []), ...(next ?? [])]);
}

function indexObjectsByScope(
    objects: readonly ObjectMetadata[],
    comparison: MetadataNameComparison,
): ReadonlyMap<string, readonly ObjectMetadata[]> {
    const mutable = new Map<string, ObjectMetadata[]>();
    for (const object of objects) {
        const key = scopeKey(object.database, object.schema, comparison);
        const values = mutable.get(key) ?? [];
        values.push(object);
        mutable.set(key, values);
    }
    return new Map(
        [...mutable].map(([key, values]) => [
            key,
            Object.freeze(
                values.sort((left, right) =>
                    compareOrdinal(comparison.key(left.name), comparison.key(right.name)),
                ),
            ),
        ]),
    );
}

function indexObjectsByQualifiedName(
    objects: readonly ObjectMetadata[],
    comparison: MetadataNameComparison,
): ReadonlyMap<string, readonly ObjectMetadata[]> {
    const mutable = new Map<string, ObjectMetadata[]>();
    for (const object of objects) {
        const key = qualifiedNameKey(object.database, object.schema, object.name, comparison);
        const values = mutable.get(key) ?? [];
        values.push(object);
        mutable.set(key, values);
    }
    return mutable;
}

function qualifiedNameKey(
    database: string | undefined,
    schema: string,
    name: string,
    comparison: MetadataNameComparison,
): string {
    return comparison.key(`${database ?? ""}\u0000${schema}\u0000${name}`);
}

function uniqueObjects(objects: readonly ObjectMetadata[]): readonly ObjectMetadata[] {
    return [...new Map(objects.map((object) => [object.ref.id, object])).values()];
}

function prefixSearch(
    objects: readonly ObjectMetadata[],
    prefix: string,
    comparison: MetadataNameComparison,
    matches: (object: ObjectMetadata) => boolean,
    limit: number,
): readonly ObjectMetadata[] {
    const normalizedPrefix = comparison.key(prefix);
    let low = 0;
    let high = objects.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (comparison.key(objects[middle]!.name) < normalizedPrefix) low = middle + 1;
        else high = middle;
    }
    const result: ObjectMetadata[] = [];
    for (let index = low; index < objects.length && result.length < limit; index++) {
        const object = objects[index]!;
        if (!comparison.key(object.name).startsWith(normalizedPrefix)) break;
        if (matches(object)) result.push(object);
    }
    return result;
}

function scopeKey(
    database: string | undefined,
    schema: string,
    comparison: MetadataNameComparison,
): string {
    const value = `${database ?? ""}\u0000${schema}`;
    return comparison.key(value);
}

function compareObjects(
    left: ObjectMetadata,
    right: ObjectMetadata,
    environment: SqlEnvironment,
    comparison: MetadataNameComparison,
): number {
    return (
        objectRank(left, environment, comparison) - objectRank(right, environment, comparison) ||
        compareOrdinal(comparison.key(left.schema), comparison.key(right.schema)) ||
        compareOrdinal(comparison.key(left.name), comparison.key(right.name))
    );
}

function objectRank(
    object: ObjectMetadata,
    environment: SqlEnvironment,
    comparison: MetadataNameComparison,
): number {
    if (object.system) return 3;
    if (comparison.equals(object.schema, environment.defaultSchema)) return 0;
    if (comparison.equals(object.schema, "dbo")) return 1;
    return 2;
}

function stateReason(state: MetadataCompleteness["objects"]) {
    if (state === "stale") return "metadataStale" as const;
    if (state === "loading" || state === "partial" || state === "unknown") {
        return "metadataPending" as const;
    }
    return "metadataUnavailable" as const;
}
