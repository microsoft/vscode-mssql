/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type {
    ColumnMetadata,
    DatabaseMetadata,
    InMemoryMetadataInput,
    MetadataCompleteness,
    MetadataHydrationRequest,
    MetadataLoadState,
    MetadataProvider,
    MetadataRefreshResult,
    MetadataView,
    ObjectMetadata,
    ObjectRef,
    ObjectResolution,
    ObjectSearchQuery,
    ParameterMetadata,
    SchemaMetadata,
    SqlEnvironment,
} from "./contracts.js";

const ready: MetadataCompleteness = Object.freeze({
    databases: "ready",
    schemas: "ready",
    objects: "ready",
    columns: "ready",
    parameters: "ready",
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
    private readonly _objectsById: ReadonlyMap<string, ObjectMetadata>;
    private readonly _objects: readonly ObjectMetadata[];
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
    private readonly _schemas: readonly SchemaMetadata[];
    private readonly _databases: readonly DatabaseMetadata[];

    public readonly publishedAt = Date.now();

    public constructor(
        public readonly providerId: string,
        public readonly generation: number,
        public readonly environment: SqlEnvironment,
        public readonly completeness: MetadataCompleteness,
        input: InMemoryMetadataInput,
    ) {
        this._objects = Object.freeze([...(input.objects ?? [])]);
        this._objectsById = new Map(this._objects.map((object) => [object.ref.id, object]));
        this._columns = input.columns ?? new Map();
        this._parameters = input.parameters ?? new Map();
        this._columnStates = input.columnStates ?? new Map();
        this._parameterStates = input.parameterStates ?? new Map();
        this._schemas = Object.freeze([...(input.schemas ?? [])]);
        this._databases = Object.freeze([...(input.databases ?? [])]);
    }

    public resolveObject(parts: readonly string[]): ObjectResolution {
        const name = parts.at(-1);
        if (!name) return { kind: "notFound" };
        const schema = parts.length >= 2 ? parts.at(-2) : this.environment.defaultSchema;
        const database = parts.length >= 3 ? parts.at(-3) : this.environment.currentDatabase;
        const matches = this._objects.filter(
            (object) =>
                equal(object.name, name, this.environment.caseSensitive) &&
                equal(object.schema, schema, this.environment.caseSensitive) &&
                (!database ||
                    !object.database ||
                    equal(object.database, database, this.environment.caseSensitive)),
        );
        if (matches.length === 1) return { kind: "resolved", object: matches[0]! };
        if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
        if (this.completeness.objects !== "ready") {
            return { kind: "unknown", reason: stateReason(this.completeness.objects) };
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

    public searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[] {
        const prefix = query.prefix ?? "";
        const limit = query.limit ?? 100;
        return this._objects
            .filter(
                (object) =>
                    (!query.database || object.database === query.database) &&
                    (!query.schema || object.schema === query.schema) &&
                    (!query.kinds || query.kinds.includes(object.kind)) &&
                    startsWith(object.name, prefix, this.environment.caseSensitive),
            )
            .slice(0, limit);
    }

    public schemas(database?: string): readonly SchemaMetadata[] | undefined {
        if (["unknown", "failed"].includes(this.completeness.schemas)) return undefined;
        return database
            ? this._schemas.filter((schema) => !schema.database || schema.database === database)
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
        objects: next.objects ?? previous.objects,
        schemas: next.schemas ?? previous.schemas,
        databases: next.databases ?? previous.databases,
        columns: mergeMap(previous.columns, next.columns),
        parameters: mergeMap(previous.parameters, next.parameters),
        columnStates: mergeMap(previous.columnStates, next.columnStates),
        parameterStates: mergeMap(previous.parameterStates, next.parameterStates),
    };
}

function mergeMap<K, V>(
    previous: ReadonlyMap<K, V> | undefined,
    next: ReadonlyMap<K, V> | undefined,
): ReadonlyMap<K, V> | undefined {
    if (!previous && !next) return undefined;
    return new Map([...(previous ?? []), ...(next ?? [])]);
}

function equal(
    left: string | undefined,
    right: string | undefined,
    caseSensitive: boolean,
): boolean {
    if (left === undefined || right === undefined) return left === right;
    return caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function startsWith(value: string, prefix: string, caseSensitive: boolean): boolean {
    return caseSensitive
        ? value.startsWith(prefix)
        : value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
}

function stateReason(state: MetadataCompleteness["objects"]) {
    if (state === "stale") return "metadataStale" as const;
    if (state === "loading" || state === "partial" || state === "unknown") {
        return "metadataPending" as const;
    }
    return "metadataUnavailable" as const;
}
