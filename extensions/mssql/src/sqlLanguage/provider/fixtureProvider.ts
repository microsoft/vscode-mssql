/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test/fixture provider (design 05 §6.1, §17.5): a fully in-memory catalog
 * with declarative table/view/routine fixtures, used by the fourslash harness
 * and unit tests. Provider-equivalence tests run the same feature expectations
 * against this, the null provider, and the catalog adapter over a fixture
 * snapshot.
 */

import {
    DefinitionResult,
    IPinnedMetadataView,
    ISqlLanguageMetadataProvider,
    LangColumn,
    LangDatabase,
    LangFkEdge,
    LangKeyConstraint,
    LangObjectInfo,
    LangObjectKind,
    LangObjectRef,
    LangParam,
    LangResolution,
    LanguageReadiness,
    ObjectSearchQuery,
    SqlLanguageEnvironment,
} from "./types";

export interface FixtureObject {
    readonly schema: string;
    readonly name: string;
    readonly kind: LangObjectKind;
    readonly columns?: readonly LangColumn[];
    readonly parameters?: readonly LangParam[];
    readonly definition?: string;
    /** Honest-unavailability fixture (encrypted / permission-hidden modules). */
    readonly definitionUnavailable?: "encrypted" | "permission";
    /** PK/unique constraints with names and key order (H4 shape, scripting F2). */
    readonly keyConstraints?: readonly LangKeyConstraint[];
    /** MS_Description-style object description (H7 shape). */
    readonly description?: string;
    /** Column descriptions by column name (H7 shape). */
    readonly columnDescriptions?: Readonly<Record<string, string>>;
}

export interface FixtureForeignKey {
    readonly name?: string;
    readonly from: string; // "schema.table"
    readonly to: string; // "schema.table"
    readonly columns: readonly { fromColumn: string; toColumn: string }[];
}

export interface FixtureCatalogSpec {
    readonly objects: readonly FixtureObject[];
    readonly foreignKeys?: readonly FixtureForeignKey[];
    readonly databases?: readonly string[];
    readonly env?: Partial<SqlLanguageEnvironment>;
    readonly readiness?: Partial<LanguageReadiness>;
    readonly generation?: number;
}

const READY: LanguageReadiness = {
    objects: "ready",
    columns: "ready",
    parameters: "ready",
    foreignKeys: "ready",
    definitions: "lazy",
    mode: "full",
};

export class FixtureLanguageMetadataProvider implements ISqlLanguageMetadataProvider {
    readonly generation: number;
    private readonly view: FixturePinnedView;
    private readonly databaseList?: readonly LangDatabase[];
    private readonly listeners = new Set<() => void>();

    constructor(spec: FixtureCatalogSpec) {
        this.generation = spec.generation ?? 1;
        this.view = new FixturePinnedView(spec, this.generation);
        this.databaseList = spec.databases?.map((name) => ({ name }));
    }

    env(): SqlLanguageEnvironment {
        return this.view.env;
    }
    readiness(): LanguageReadiness {
        return this.view.readiness;
    }
    pin(): IPinnedMetadataView {
        return this.view;
    }
    databases(): readonly LangDatabase[] | undefined {
        return this.databaseList;
    }
    onDidChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** Test hook: signal a metadata change to subscribers. */
    fireDidChange(): void {
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}

class FixturePinnedView implements IPinnedMetadataView {
    readonly generation: number;
    readonly env: SqlLanguageEnvironment;
    readonly readiness: LanguageReadiness;

    private readonly objects: LangObjectInfo[] = [];
    private readonly columnsById = new Map<number, readonly LangColumn[]>();
    private readonly paramsById = new Map<number, readonly LangParam[]>();
    private readonly definitionsById = new Map<number, string>();
    private readonly definitionUnavailableById = new Map<number, "encrypted" | "permission">();
    private readonly keyConstraintsById = new Map<number, readonly LangKeyConstraint[]>();
    private readonly descriptionsById = new Map<number, string>();
    private readonly columnDescriptionsById = new Map<number, Readonly<Record<string, string>>>();
    private readonly fkEdges: LangFkEdge[] = [];
    private readonly caseSensitive: boolean;

    constructor(spec: FixtureCatalogSpec, generation: number) {
        this.generation = generation;
        this.env = {
            defaultSchema: "dbo",
            caseSensitive: false,
            capabilities: { createOrAlterProgrammability: true, dropIfExists: true },
            ...spec.env,
        };
        this.caseSensitive = this.env.caseSensitive;
        this.readiness = { ...READY, ...spec.readiness };

        let nextId = 1;
        const byKey = new Map<string, number>();
        for (const fixture of spec.objects) {
            const objectId = nextId++;
            this.objects.push({
                ref: { objectId },
                schema: fixture.schema,
                name: fixture.name,
                kind: fixture.kind,
            });
            byKey.set(this.fold(`${fixture.schema}.${fixture.name}`), objectId);
            if (fixture.columns !== undefined) {
                this.columnsById.set(objectId, fixture.columns);
            }
            if (fixture.parameters !== undefined) {
                this.paramsById.set(objectId, fixture.parameters);
            }
            if (fixture.definition !== undefined) {
                this.definitionsById.set(objectId, fixture.definition);
            }
            if (fixture.definitionUnavailable !== undefined) {
                this.definitionUnavailableById.set(objectId, fixture.definitionUnavailable);
            }
            if (fixture.keyConstraints !== undefined) {
                this.keyConstraintsById.set(objectId, fixture.keyConstraints);
            }
            if (fixture.description !== undefined) {
                this.descriptionsById.set(objectId, fixture.description);
            }
            if (fixture.columnDescriptions !== undefined) {
                this.columnDescriptionsById.set(objectId, fixture.columnDescriptions);
            }
        }
        for (const fk of spec.foreignKeys ?? []) {
            const from = byKey.get(this.fold(fk.from));
            const to = byKey.get(this.fold(fk.to));
            if (from === undefined || to === undefined) {
                throw new Error(`Fixture FK references unknown object: ${fk.from} -> ${fk.to}`);
            }
            this.fkEdges.push({
                name: fk.name,
                from: { objectId: from },
                to: { objectId: to },
                columns: fk.columns,
            });
        }
    }

    private fold(value: string): string {
        return this.caseSensitive ? value : value.toLowerCase();
    }

    resolveObject(parts: readonly string[]): LangResolution {
        if (parts.length === 0) {
            return { kind: "notFound" };
        }
        const name = parts[parts.length - 1];
        const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
        const matches = this.objects.filter(
            (o) =>
                this.fold(o.name) === this.fold(name) &&
                (schema === undefined || this.fold(o.schema) === this.fold(schema)),
        );
        if (matches.length === 1) {
            const confidence =
                schema !== undefined ||
                this.fold(matches[0].schema) === this.fold(this.env.defaultSchema)
                    ? schema !== undefined
                        ? "exact"
                        : "defaultSchema"
                    : "exact";
            return { kind: "resolved", ref: matches[0].ref, confidence };
        }
        if (matches.length > 1) {
            const preferred = matches.find(
                (o) => this.fold(o.schema) === this.fold(this.env.defaultSchema),
            );
            if (schema === undefined && preferred !== undefined) {
                return { kind: "resolved", ref: preferred.ref, confidence: "defaultSchema" };
            }
            return { kind: "ambiguous", candidates: matches.map((o) => o.ref) };
        }
        return { kind: "notFound" };
    }

    getObject(ref: LangObjectRef): LangObjectInfo | undefined {
        return this.objects.find((o) => o.ref.objectId === ref.objectId);
    }
    getColumns(ref: LangObjectRef): readonly LangColumn[] | undefined {
        return this.columnsById.get(ref.objectId);
    }
    getParameters(ref: LangObjectRef): readonly LangParam[] | undefined {
        return this.paramsById.get(ref.objectId);
    }
    fkFrom(ref: LangObjectRef): readonly LangFkEdge[] {
        return this.fkEdges.filter((e) => e.from.objectId === ref.objectId);
    }
    fkTo(ref: LangObjectRef): readonly LangFkEdge[] {
        return this.fkEdges.filter((e) => e.to.objectId === ref.objectId);
    }
    getKeyConstraints(ref: LangObjectRef): readonly LangKeyConstraint[] | undefined {
        return this.keyConstraintsById.get(ref.objectId);
    }

    searchObjects(query: ObjectSearchQuery): readonly LangObjectInfo[] {
        const prefix = query.prefix !== undefined ? this.fold(query.prefix) : undefined;
        const limit = query.limit ?? 100;
        const out: LangObjectInfo[] = [];
        for (const o of this.objects) {
            if (query.schema !== undefined && this.fold(o.schema) !== this.fold(query.schema)) {
                continue;
            }
            if (query.kinds !== undefined && !query.kinds.includes(o.kind)) {
                continue;
            }
            if (prefix !== undefined && !this.fold(o.name).startsWith(prefix)) {
                continue;
            }
            out.push(o);
            if (out.length >= limit) {
                break;
            }
        }
        return out;
    }

    listSchemas(): readonly { name: string }[] {
        return [...new Set(this.objects.map((o) => o.schema))].sort().map((name) => ({ name }));
    }

    getDescription(ref: LangObjectRef, column?: string): string | undefined {
        if (column === undefined) {
            return this.descriptionsById.get(ref.objectId);
        }
        const byColumn = this.columnDescriptionsById.get(ref.objectId);
        if (byColumn === undefined) {
            return undefined;
        }
        if (byColumn[column] !== undefined) {
            return byColumn[column];
        }
        const folded = this.fold(column);
        for (const [name, value] of Object.entries(byColumn)) {
            if (this.fold(name) === folded) {
                return value;
            }
        }
        return undefined;
    }

    getDefinition(ref: LangObjectRef): Promise<DefinitionResult> {
        const unavailable = this.definitionUnavailableById.get(ref.objectId);
        if (unavailable !== undefined) {
            return Promise.resolve({ unavailableReason: unavailable });
        }
        const text = this.definitionsById.get(ref.objectId);
        return Promise.resolve(text !== undefined ? { text } : { unavailableReason: "notLoaded" });
    }
}
