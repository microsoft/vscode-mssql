/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Catalog model (metadata design §6): structure-of-arrays storage with a
 * string intern table, folded name index for prefix search, collation-aware
 * exact resolution (case-sensitive catalogs never accept a folded-only
 * match — ambiguity is reported, not guessed), per-section readiness, and
 * the deterministic schema-context projection (§10) whose output is
 * byte-identical for the same (catalog generation, request) — replay
 * comparisons depend on that.
 */

export type CatalogSection =
    | "schemas"
    | "objects"
    | "synonyms"
    | "columns"
    | "types"
    | "keys"
    | "foreignKeys"
    | "indexes"
    | "constraints"
    | "parameters"
    | "descriptions"
    | "rowCounts";

export type SectionState = "absent" | "loading" | "ready" | "failed" | "stale" | "lite";

export type ObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym";

export interface SchemaInfo {
    schemaId: number;
    name: string;
}

export interface ObjectInfo {
    objectId: number;
    schema: string;
    name: string;
    kind: ObjectKind;
    modifyDate?: string;
}

export interface ColumnInfo {
    ordinal: number;
    name: string;
    typeDisplay: string;
    nullable: boolean;
}

export interface FkEdge {
    fromObjectId: number;
    toObjectId: number;
    name: string;
}

export interface FkColumnPair {
    fromColumn: string;
    toColumn: string;
}

export interface FkDetail extends FkEdge {
    columns: FkColumnPair[];
}

export interface ParameterInfo {
    /** sys.parameters parameter_id; 0 is a scalar function's return value. */
    ordinal: number;
    name: string;
    typeDisplay: string;
    isOutput: boolean;
}

export interface CatalogEnvironment {
    engineEdition?: number;
    defaultSchema?: string;
    collationName?: string;
    caseSensitive?: boolean;
}

export type Resolution =
    | { kind: "resolved"; objectId: number; confidence: "exact" | "defaultSchema" }
    | { kind: "ambiguous"; candidates: readonly number[] }
    | { kind: "notFound" }
    | { kind: "sectionUnavailable"; section: CatalogSection };

// ---------------------------------------------------------------------------
// Builder (streaming appends; snapshot publishes at section boundaries)
// ---------------------------------------------------------------------------

export class CatalogBuilder {
    private strings: string[] = [];
    private stringIndex = new Map<string, number>();

    // schema table
    schemaIds: number[] = [];
    schemaNameSyms: number[] = [];

    // object table
    objectIds: number[] = [];
    objectSchemaIds: number[] = [];
    objectNameSyms: number[] = [];
    objectKinds: ObjectKind[] = [];
    objectModifyDates: (string | undefined)[] = [];

    // column table (grouped by object append order)
    columnOwner: number[] = []; // index into object table
    columnNameSyms: number[] = [];
    columnTypeSyms: number[] = [];
    columnNullable: boolean[] = [];

    // fk edges (constraintIds parallel; -1 when the source lacks one)
    fkFrom: number[] = [];
    fkTo: number[] = [];
    fkNameSyms: number[] = [];
    fkConstraintIds: number[] = [];

    // fk column pairs, keyed by constraint id (H5B)
    fkColumnConstraintIds: number[] = [];
    fkColumnFromSyms: number[] = [];
    fkColumnToSyms: number[] = [];

    // primary key columns (H4), appended in (object, key_ordinal) order
    pkOwner: number[] = []; // index into object table
    pkColumnNameSyms: number[] = [];

    // routine parameters (H6), appended grouped by object like columns
    paramOwner: number[] = []; // index into object table
    paramOrdinals: number[] = [];
    paramNameSyms: number[] = [];
    paramTypeSyms: number[] = [];
    paramOutput: boolean[] = [];

    engineEdition: number | undefined;

    caseSensitive = false;
    collationName: string | undefined;
    defaultSchema = "dbo";

    intern(value: string): number {
        let sym = this.stringIndex.get(value);
        if (sym === undefined) {
            sym = this.strings.length;
            this.strings.push(value);
            this.stringIndex.set(value, sym);
        }
        return sym;
    }

    addSchema(schemaId: number, name: string): void {
        this.schemaIds.push(schemaId);
        this.schemaNameSyms.push(this.intern(name));
    }

    addObject(
        objectId: number,
        schemaId: number,
        name: string,
        kind: ObjectKind,
        modifyDate?: string,
    ): void {
        this.objectIds.push(objectId);
        this.objectSchemaIds.push(schemaId);
        this.objectNameSyms.push(this.intern(name));
        this.objectKinds.push(kind);
        this.objectModifyDates.push(modifyDate);
    }

    addColumn(objectId: number, name: string, typeDisplay: string, nullable: boolean): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // column for unknown object: dropped (H3 raced a DDL)
        }
        this.columnOwner.push(objectIndex);
        this.columnNameSyms.push(this.intern(name));
        this.columnTypeSyms.push(this.intern(typeDisplay));
        this.columnNullable.push(nullable);
    }

    addForeignKey(
        fromObjectId: number,
        toObjectId: number,
        name: string,
        constraintId: number = -1,
    ): void {
        this.fkFrom.push(fromObjectId);
        this.fkTo.push(toObjectId);
        this.fkNameSyms.push(this.intern(name));
        this.fkConstraintIds.push(constraintId);
    }

    addForeignKeyColumn(constraintId: number, fromColumn: string, toColumn: string): void {
        this.fkColumnConstraintIds.push(constraintId);
        this.fkColumnFromSyms.push(this.intern(fromColumn));
        this.fkColumnToSyms.push(this.intern(toColumn));
    }

    markPrimaryKeyColumn(objectId: number, columnName: string): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // key for unknown object: dropped (H4 raced a DDL)
        }
        this.pkOwner.push(objectIndex);
        this.pkColumnNameSyms.push(this.intern(columnName));
    }

    addParameter(
        objectId: number,
        ordinal: number,
        name: string,
        typeDisplay: string,
        isOutput: boolean,
    ): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // parameter for unknown object: dropped (H6 raced a DDL)
        }
        this.paramOwner.push(objectIndex);
        this.paramOrdinals.push(ordinal);
        this.paramNameSyms.push(this.intern(name));
        this.paramTypeSyms.push(this.intern(typeDisplay));
        this.paramOutput.push(isOutput);
    }

    setEnvironment(env: CatalogEnvironment): void {
        if (env.engineEdition !== undefined) {
            this.engineEdition = env.engineEdition;
        }
        if (env.defaultSchema) {
            this.defaultSchema = env.defaultSchema;
        }
        if (env.collationName) {
            this.collationName = env.collationName;
        }
        if (env.caseSensitive !== undefined) {
            this.caseSensitive = env.caseSensitive;
        }
    }

    build(
        generation: number,
        readiness: Partial<Record<CatalogSection, SectionState>>,
        mode: "full" | "lite" | "partial" = "full",
    ): CatalogSnapshot {
        return new CatalogSnapshot(this, generation, readiness, mode);
    }

    get stringTable(): readonly string[] {
        return this.strings;
    }
}

// ---------------------------------------------------------------------------
// Snapshot (immutable read surface)
// ---------------------------------------------------------------------------

const ALL_SECTIONS: CatalogSection[] = [
    "schemas",
    "objects",
    "synonyms",
    "columns",
    "types",
    "keys",
    "foreignKeys",
    "indexes",
    "constraints",
    "parameters",
    "descriptions",
    "rowCounts",
];

export class CatalogSnapshot {
    readonly generation: number;
    readonly capturedAtUtc: string;
    readonly readiness: Readonly<Record<CatalogSection, SectionState>>;
    readonly mode: "full" | "lite" | "partial";

    private strings: readonly string[];
    /** Sorted folded object names → object table index (prefix search). */
    private nameIndex: Array<{ folded: string; index: number }>;
    /** objectId → object table index. */
    private idIndex = new Map<number, number>();
    /** object table index → [start, end) into column arrays. */
    private columnRanges: Array<[number, number]>;
    /** object table index → [start, end) into parameter arrays. */
    private paramRanges: Array<[number, number]>;
    private pkColumnsByObjectIndex = new Map<number, string[]>();
    private fkColumnsByConstraint = new Map<number, FkColumnPair[]>();
    private schemaNameById = new Map<number, string>();

    constructor(
        private readonly b: CatalogBuilder,
        generation: number,
        readiness: Partial<Record<CatalogSection, SectionState>>,
        mode: "full" | "lite" | "partial",
    ) {
        this.generation = generation;
        this.capturedAtUtc = new Date().toISOString();
        this.mode = mode;
        const full = {} as Record<CatalogSection, SectionState>;
        for (const section of ALL_SECTIONS) {
            full[section] = readiness[section] ?? "absent";
        }
        this.readiness = full;
        this.strings = b.stringTable;

        for (let i = 0; i < b.schemaIds.length; i++) {
            this.schemaNameById.set(b.schemaIds[i], this.strings[b.schemaNameSyms[i]]);
        }
        for (let i = 0; i < b.objectIds.length; i++) {
            this.idIndex.set(b.objectIds[i], i);
        }
        this.nameIndex = b.objectIds
            .map((_, index) => ({
                folded: this.strings[b.objectNameSyms[index]].toLowerCase(),
                index,
            }))
            .sort((x, y) => (x.folded < y.folded ? -1 : x.folded > y.folded ? 1 : 0));

        // column ranges: columns were appended grouped by owner; compute spans
        this.columnRanges = new Array(b.objectIds.length).fill(null).map(() => [0, 0]);
        let cursor = 0;
        while (cursor < b.columnOwner.length) {
            const owner = b.columnOwner[cursor];
            const start = cursor;
            while (cursor < b.columnOwner.length && b.columnOwner[cursor] === owner) {
                cursor++;
            }
            this.columnRanges[owner] = [start, cursor];
        }

        for (let i = 0; i < b.pkOwner.length; i++) {
            const names = this.pkColumnsByObjectIndex.get(b.pkOwner[i]) ?? [];
            names.push(this.strings[b.pkColumnNameSyms[i]]);
            this.pkColumnsByObjectIndex.set(b.pkOwner[i], names);
        }
        for (let i = 0; i < b.fkColumnConstraintIds.length; i++) {
            const constraintId = b.fkColumnConstraintIds[i];
            const pairs = this.fkColumnsByConstraint.get(constraintId) ?? [];
            pairs.push({
                fromColumn: this.strings[b.fkColumnFromSyms[i]],
                toColumn: this.strings[b.fkColumnToSyms[i]],
            });
            this.fkColumnsByConstraint.set(constraintId, pairs);
        }
        this.paramRanges = new Array(b.objectIds.length).fill(null).map(() => [0, 0]);
        let paramCursor = 0;
        while (paramCursor < b.paramOwner.length) {
            const owner = b.paramOwner[paramCursor];
            const start = paramCursor;
            while (paramCursor < b.paramOwner.length && b.paramOwner[paramCursor] === owner) {
                paramCursor++;
            }
            this.paramRanges[owner] = [start, paramCursor];
        }
    }

    get stats(): { schemas: number; objects: number; columns: number; foreignKeys: number } {
        return {
            schemas: this.b.schemaIds.length,
            objects: this.b.objectIds.length,
            columns: this.b.columnOwner.length,
            foreignKeys: this.b.fkFrom.length,
        };
    }

    listSchemas(): SchemaInfo[] {
        return this.b.schemaIds
            .map((schemaId, i) => ({ schemaId, name: this.strings[this.b.schemaNameSyms[i]] }))
            .sort((a, z) => a.name.localeCompare(z.name));
    }

    private objectAt(index: number): ObjectInfo {
        return {
            objectId: this.b.objectIds[index],
            schema: this.schemaNameById.get(this.b.objectSchemaIds[index]) ?? "?",
            name: this.strings[this.b.objectNameSyms[index]],
            kind: this.b.objectKinds[index],
            modifyDate: this.b.objectModifyDates[index],
        };
    }

    getObject(objectId: number): ObjectInfo | undefined {
        const index = this.idIndex.get(objectId);
        return index === undefined ? undefined : this.objectAt(index);
    }

    listObjects(schema?: string, kinds?: ObjectKind[]): ObjectInfo[] {
        const objects: ObjectInfo[] = [];
        for (let i = 0; i < this.b.objectIds.length; i++) {
            const info = this.objectAt(i);
            if (schema && info.schema !== schema) {
                continue;
            }
            if (kinds && !kinds.includes(info.kind)) {
                continue;
            }
            objects.push(info);
        }
        return objects.sort(
            (a, z) => a.schema.localeCompare(z.schema) || a.name.localeCompare(z.name),
        );
    }

    getColumns(objectId: number): ColumnInfo[] {
        const index = this.idIndex.get(objectId);
        if (index === undefined) {
            return [];
        }
        const [start, end] = this.columnRanges[index];
        const columns: ColumnInfo[] = [];
        for (let c = start; c < end; c++) {
            columns.push({
                ordinal: c - start,
                name: this.strings[this.b.columnNameSyms[c]],
                typeDisplay: this.strings[this.b.columnTypeSyms[c]],
                nullable: this.b.columnNullable[c],
            });
        }
        return columns;
    }

    getForeignKeysFrom(objectId: number): FkEdge[] {
        const edges: FkEdge[] = [];
        for (let i = 0; i < this.b.fkFrom.length; i++) {
            if (this.b.fkFrom[i] === objectId) {
                edges.push({
                    fromObjectId: this.b.fkFrom[i],
                    toObjectId: this.b.fkTo[i],
                    name: this.strings[this.b.fkNameSyms[i]],
                });
            }
        }
        return edges;
    }

    getForeignKeysTo(objectId: number): FkEdge[] {
        const edges: FkEdge[] = [];
        for (let i = 0; i < this.b.fkTo.length; i++) {
            if (this.b.fkTo[i] === objectId) {
                edges.push({
                    fromObjectId: this.b.fkFrom[i],
                    toObjectId: this.b.fkTo[i],
                    name: this.strings[this.b.fkNameSyms[i]],
                });
            }
        }
        return edges;
    }

    /** Environment facts from H0 (undefined when the env probe failed). */
    get engineEdition(): number | undefined {
        return this.b.engineEdition;
    }

    get defaultSchema(): string {
        return this.b.defaultSchema;
    }

    get caseSensitive(): boolean {
        return this.b.caseSensitive;
    }

    /** PK columns in key-ordinal order (empty when keys are absent/failed). */
    getPrimaryKeyColumns(objectId: number): string[] {
        const index = this.idIndex.get(objectId);
        if (index === undefined) {
            return [];
        }
        return [...(this.pkColumnsByObjectIndex.get(index) ?? [])];
    }

    /** FK edges from an object with their column pairs (H5 + H5B). */
    getForeignKeyDetailsFrom(objectId: number): FkDetail[] {
        const details: FkDetail[] = [];
        for (let i = 0; i < this.b.fkFrom.length; i++) {
            if (this.b.fkFrom[i] === objectId) {
                details.push({
                    fromObjectId: this.b.fkFrom[i],
                    toObjectId: this.b.fkTo[i],
                    name: this.strings[this.b.fkNameSyms[i]],
                    columns: [...(this.fkColumnsByConstraint.get(this.b.fkConstraintIds[i]) ?? [])],
                });
            }
        }
        return details;
    }

    /** Routine parameters in parameter_id order (ordinal 0 = return value). */
    getParameters(objectId: number): ParameterInfo[] {
        const index = this.idIndex.get(objectId);
        if (index === undefined) {
            return [];
        }
        const [start, end] = this.paramRanges[index];
        const parameters: ParameterInfo[] = [];
        for (let p = start; p < end; p++) {
            parameters.push({
                ordinal: this.b.paramOrdinals[p],
                name: this.strings[this.b.paramNameSyms[p]],
                typeDisplay: this.strings[this.b.paramTypeSyms[p]],
                isOutput: this.b.paramOutput[p],
            });
        }
        return parameters;
    }

    /** Prefix search over the folded name index (binary search + scan). */
    search(prefix: string, limit = 50): ObjectInfo[] {
        const folded = prefix.toLowerCase();
        let lo = 0;
        let hi = this.nameIndex.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.nameIndex[mid].folded < folded) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        const results: ObjectInfo[] = [];
        for (let i = lo; i < this.nameIndex.length && results.length < limit; i++) {
            if (!this.nameIndex[i].folded.startsWith(folded)) {
                break;
            }
            results.push(this.objectAt(this.nameIndex[i].index));
        }
        return results;
    }

    /**
     * Resolve [schema, name] or [name] (§6.3): case-sensitive catalogs
     * require a raw match; folded-only multi-candidates are ambiguous.
     */
    resolveName(parts: string[]): Resolution {
        if (this.readiness.objects !== "ready" && this.readiness.objects !== "lite") {
            return { kind: "sectionUnavailable", section: "objects" };
        }
        const [schemaPart, namePart] =
            parts.length >= 2
                ? [parts[parts.length - 2], parts[parts.length - 1]]
                : [undefined, parts[0]];
        const foldedName = namePart.toLowerCase();
        const candidates: number[] = [];
        for (const entry of this.searchIndexRange(foldedName)) {
            const info = this.objectAt(entry.index);
            if (schemaPart) {
                const schemaMatches = this.b.caseSensitive
                    ? info.schema === schemaPart
                    : info.schema.toLowerCase() === schemaPart.toLowerCase();
                if (!schemaMatches) {
                    continue;
                }
            }
            candidates.push(entry.index);
        }
        if (candidates.length === 0) {
            return { kind: "notFound" };
        }
        if (this.b.caseSensitive) {
            const raw = candidates.filter(
                (index) => this.strings[this.b.objectNameSyms[index]] === namePart,
            );
            if (raw.length === 1) {
                return {
                    kind: "resolved",
                    objectId: this.b.objectIds[raw[0]],
                    confidence: schemaPart ? "exact" : "defaultSchema",
                };
            }
            if (raw.length > 1 || candidates.length > 1) {
                return {
                    kind: "ambiguous",
                    candidates: candidates.map((index) => this.b.objectIds[index]),
                };
            }
            return { kind: "notFound" };
        }
        if (!schemaPart && candidates.length > 1) {
            // Prefer the default schema before declaring ambiguity.
            const inDefault = candidates.filter(
                (index) =>
                    (this.schemaNameById.get(this.b.objectSchemaIds[index]) ?? "") ===
                    this.b.defaultSchema,
            );
            if (inDefault.length === 1) {
                return {
                    kind: "resolved",
                    objectId: this.b.objectIds[inDefault[0]],
                    confidence: "defaultSchema",
                };
            }
            return {
                kind: "ambiguous",
                candidates: candidates.map((index) => this.b.objectIds[index]),
            };
        }
        return {
            kind: "resolved",
            objectId: this.b.objectIds[candidates[0]],
            confidence: schemaPart ? "exact" : "defaultSchema",
        };
    }

    private *searchIndexRange(folded: string): Iterable<{ folded: string; index: number }> {
        let lo = 0;
        let hi = this.nameIndex.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.nameIndex[mid].folded < folded) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        for (let i = lo; i < this.nameIndex.length && this.nameIndex[i].folded === folded; i++) {
            yield this.nameIndex[i];
        }
    }
}

// ---------------------------------------------------------------------------
// Schema-context projection (§10) — deterministic, budgeted, privacy-gated
// ---------------------------------------------------------------------------

export interface SchemaContextRequest {
    budget: "tight" | "balanced" | "generous" | "unlimited" | { maxChars: number };
    focus?: { objectIds?: number[]; nameHints?: string[] };
    include?: { fkOneHop?: boolean };
    privacy: { destination: "local" | "remoteLm"; allowObjectNames: boolean };
}

export interface SchemaContextResult {
    text: string;
    charCount: number;
    objectsIncluded: number;
    catalogGeneration: number;
    truncated: boolean;
    degraded?: "catalogNotReady" | "privacyPolicy";
    composition: { tables: number; views: number; columnsElided: number };
}

const BUDGET_CHARS: Record<string, number> = {
    tight: 2_000,
    balanced: 8_000,
    generous: 24_000,
    unlimited: Number.MAX_SAFE_INTEGER,
};

export function buildSchemaContext(
    snapshot: CatalogSnapshot,
    request: SchemaContextRequest,
): SchemaContextResult {
    const empty = (degraded: "catalogNotReady" | "privacyPolicy"): SchemaContextResult => ({
        text: "",
        charCount: 0,
        objectsIncluded: 0,
        catalogGeneration: snapshot.generation,
        truncated: false,
        degraded,
        composition: { tables: 0, views: 0, columnsElided: 0 },
    });
    if (request.privacy.destination === "remoteLm" && !request.privacy.allowObjectNames) {
        // §10.1: no silent pseudonymization in v1 — degrade explicitly.
        return empty("privacyPolicy");
    }
    if (snapshot.readiness.objects !== "ready") {
        return empty("catalogNotReady");
    }
    const maxChars =
        typeof request.budget === "object" ? request.budget.maxChars : BUDGET_CHARS[request.budget];

    // 1) Seed: explicit ids + name hints; empty focus = whole catalog.
    const seeds = new Set<number>();
    for (const id of request.focus?.objectIds ?? []) {
        if (snapshot.getObject(id)) {
            seeds.add(id);
        }
    }
    for (const hint of request.focus?.nameHints ?? []) {
        const resolution = snapshot.resolveName(hint.split("."));
        if (resolution.kind === "resolved") {
            seeds.add(resolution.objectId);
        } else if (resolution.kind === "ambiguous") {
            for (const id of resolution.candidates) {
                seeds.add(id);
            }
        }
    }
    const focused = seeds.size > 0;

    // 2) FK one-hop expansion of the seed set.
    if (focused && (request.include?.fkOneHop ?? true)) {
        for (const id of [...seeds]) {
            for (const edge of snapshot.getForeignKeysFrom(id)) {
                seeds.add(edge.toObjectId);
            }
            for (const edge of snapshot.getForeignKeysTo(id)) {
                seeds.add(edge.fromObjectId);
            }
        }
    }

    // 3) Candidate list, importance-ranked: seeds first, then FK-degree,
    //    kind priority (tables before views), name asc. Deterministic.
    const kindPriority: Record<ObjectKind, number> = {
        table: 0,
        view: 1,
        tableFunction: 2,
        scalarFunction: 3,
        procedure: 4,
        synonym: 5,
    };
    const all = snapshot
        .listObjects(undefined, ["table", "view", "tableFunction"])
        .filter((o) => !focused || seeds.has(o.objectId));
    const degree = (id: number) =>
        snapshot.getForeignKeysFrom(id).length + snapshot.getForeignKeysTo(id).length;
    all.sort((a, z) => {
        const seedDelta = Number(seeds.has(z.objectId)) - Number(seeds.has(a.objectId));
        if (seedDelta !== 0) {
            return seedDelta;
        }
        const degreeDelta = degree(z.objectId) - degree(a.objectId);
        if (degreeDelta !== 0) {
            return degreeDelta;
        }
        const kindDelta = kindPriority[a.kind] - kindPriority[z.kind];
        if (kindDelta !== 0) {
            return kindDelta;
        }
        return a.schema.localeCompare(z.schema) || a.name.localeCompare(z.name);
    });

    // 4/5) Render at fidelity tiers, degrading from the tail until it fits.
    const renderFull = (o: ObjectInfo) => {
        const columns = snapshot.getColumns(o.objectId);
        const cols = columns
            .map((c) => `${c.name} ${c.typeDisplay}${c.nullable ? " NULL" : ""}`)
            .join(", ");
        return `${o.schema}.${o.name} (${o.kind}): ${cols}`;
    };
    const renderNames = (o: ObjectInfo) => {
        const columns = snapshot.getColumns(o.objectId);
        return `${o.schema}.${o.name}: ${columns.map((c) => c.name).join(", ")}`;
    };
    const renderBare = (o: ObjectInfo) => `${o.schema}.${o.name}`;

    // Included objects render sorted (schema asc, name asc) regardless of
    // selection rank — §10.2 step 6.
    let included = all.slice();
    let tier: Array<(o: ObjectInfo) => string> = [renderFull, renderNames, renderBare];
    let text = "";
    let truncated = false;
    let columnsElided = 0;

    const compose = (objects: ObjectInfo[], render: (o: ObjectInfo) => string) =>
        objects
            .slice()
            .sort((a, z) => a.schema.localeCompare(z.schema) || a.name.localeCompare(z.name))
            .map(render)
            .join("\n");

    outer: for (let t = 0; t < tier.length; t++) {
        for (let count = included.length; count > 0; count--) {
            const candidate = compose(included.slice(0, count), tier[t]);
            if (candidate.length <= maxChars) {
                text = candidate;
                truncated = count < all.length || t > 0;
                columnsElided = t >= 2 ? included.slice(0, count).length : 0;
                included = included.slice(0, count);
                break outer;
            }
        }
        if (t === tier.length - 1) {
            included = [];
            truncated = true;
        }
    }

    const tables = included.filter((o) => o.kind === "table").length;
    const views = included.filter((o) => o.kind === "view").length;
    return {
        text,
        charCount: text.length,
        objectsIncluded: included.length,
        catalogGeneration: snapshot.generation,
        truncated,
        composition: { tables, views, columnsElided },
    };
}
