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
    /** Set only when true; absent means unknown/false (H3 extension). */
    isIdentity?: boolean;
    /** Set only when true; absent means unknown/false (H3 extension). */
    isComputed?: boolean;
    /**
     * sys.columns.column_id (SV-R1, visualizer addendum §5.1) — the durable
     * in-snapshot column identity. Absent = unknown (pre-cm2 fixture/cache).
     * column_id is NOT the ordinal: gaps appear after column drops.
     */
    columnId?: number;
    /**
     * Exact designer-grade facts (SV-R1, addendum §5.2/§5.4). Absent means
     * NOT HYDRATED (honest unknown) — never fabricate from typeDisplay.
     */
    detail?: ColumnDetailInfo;
}

/**
 * Exact column facts for designer surfaces (visualizer addendum §5.2–§5.4).
 * Raw catalog semantics are preserved: maxLengthBytes is sys.columns
 * .max_length (BYTES, -1 = max) — display/logical conversion is the
 * consumer's job; identity seed/increment ride as exact server-rendered
 * TEXT (sql_variant → nvarchar), never as JavaScript numbers (§5.3).
 */
export interface ColumnDetailInfo {
    /** Raw user-type name from sys.types (NOT lowercased/decorated). */
    typeName: string;
    /** Schema of the (user) type; undefined when unknown. */
    typeSchema?: string;
    /** Base/system type name (TYPE_NAME(system_type_id)); undefined = null. */
    baseTypeName?: string;
    systemTypeId: number;
    userTypeId: number;
    isUserDefined: boolean;
    isAssemblyType: boolean;
    /** sys.columns.max_length: BYTES; -1 = max type. */
    maxLengthBytes: number;
    precision: number;
    scale: number;
    collationName?: string;
    /** Present iff the column has a default constraint. */
    default?: { name?: string; definition: string };
    /**
     * Present iff exact identity facts were captured; a column can be
     * isIdentity=true with identity ABSENT (facts unknown) — consumers must
     * not substitute (1,1).
     */
    identity?: { seedText: string; incrementText: string };
    /** Present iff the column is computed AND the definition was captured. */
    computed?: { definition: string; persisted: boolean };
}

/**
 * FK referential action, normalized from the catalog's *_desc strings by
 * explicit mapping (visualizer addendum §5.5). NEVER cast the catalog's
 * numeric action: sys.foreign_keys 0=NO_ACTION/1=CASCADE, while the legacy
 * designer's OnAction enum is 0=CASCADE/1=NO_ACTION — a cast swaps the two
 * most common actions.
 */
export type FkReferentialAction = "NO_ACTION" | "CASCADE" | "SET_NULL" | "SET_DEFAULT";

/** Stored action state: UNKNOWN = not captured (old fixture/cache/failed). */
export type FkActionState = FkReferentialAction | "UNKNOWN";

export interface FkEdge {
    fromObjectId: number;
    toObjectId: number;
    name: string;
    /** sys.foreign_keys.object_id (SV-R1) — set when known (>= 0 at build). */
    constraintObjectId?: number;
    /** Set only when captured; absent = unknown — render "Unknown", NOT "NO ACTION". */
    onDelete?: FkReferentialAction;
    /** Set only when captured; absent = unknown. */
    onUpdate?: FkReferentialAction;
}

export interface FkColumnPair {
    fromColumn: string;
    toColumn: string;
    /** sys.foreign_key_columns.constraint_column_id; set when known (SV-R1). */
    ordinal?: number;
    /** parent_column_id; set when known (SV-R1). */
    fromColumnId?: number;
    /** referenced_column_id; set when known (SV-R1). */
    toColumnId?: number;
}

export interface FkDetail extends FkEdge {
    columns: FkColumnPair[];
}

export type KeyConstraintKind = "primaryKey" | "uniqueConstraint";

export interface KeyConstraintInfo {
    name: string;
    kind: KeyConstraintKind;
    /** Column names in key-ordinal order. */
    columns: string[];
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

/**
 * FRIEND VIEW for the persistent-cache codec (CACHE-1, cache/drift addendum
 * §6): the snapshot's SoA arrays plus the environment, exposed read-only so
 * `metadataCacheCodec.ts` can serialize a published snapshot without the
 * snapshot ever doing I/O itself (§3.3 purity). This is the ONE sanctioned
 * accessor — nothing else may reach into the builder's arrays, and the codec
 * must never mutate what it receives here.
 */
export interface CatalogCodecView {
    readonly strings: readonly string[];
    readonly schemaIds: readonly number[];
    readonly schemaNameSyms: readonly number[];
    readonly objectIds: readonly number[];
    readonly objectSchemaIds: readonly number[];
    readonly objectNameSyms: readonly number[];
    readonly objectKinds: readonly ObjectKind[];
    readonly objectModifyDates: readonly (string | undefined)[];
    readonly columnOwner: readonly number[];
    readonly columnNameSyms: readonly number[];
    readonly columnTypeSyms: readonly number[];
    readonly columnNullable: readonly boolean[];
    readonly columnIdentity: readonly boolean[];
    readonly columnComputed: readonly boolean[];
    readonly fkFrom: readonly number[];
    readonly fkTo: readonly number[];
    readonly fkNameSyms: readonly number[];
    readonly fkConstraintIds: readonly number[];
    readonly fkColumnConstraintIds: readonly number[];
    readonly fkColumnFromSyms: readonly number[];
    readonly fkColumnToSyms: readonly number[];
    readonly pkOwner: readonly number[];
    readonly pkColumnNameSyms: readonly number[];
    readonly keyConstraintOwner: readonly number[];
    readonly keyConstraintNameSyms: readonly number[];
    readonly keyConstraintKinds: readonly KeyConstraintKind[];
    readonly keyConstraintColumnSyms: readonly number[];
    readonly paramOwner: readonly number[];
    readonly paramOrdinals: readonly number[];
    readonly paramNameSyms: readonly number[];
    readonly paramTypeSyms: readonly number[];
    readonly paramOutput: readonly boolean[];
    readonly descriptionOwner: readonly number[];
    readonly descriptionColumnSyms: readonly number[];
    readonly descriptionValueSyms: readonly number[];
    // SV-R1 exact-detail arrays (cm2) — appended AFTER all cm1 fields;
    // existing array order is load-bearing for the canonical payload.
    readonly columnColumnIds: readonly number[];
    readonly columnDetailPresent: readonly boolean[];
    readonly columnSystemTypeIds: readonly number[];
    readonly columnUserTypeIds: readonly number[];
    readonly columnTypeNameSyms: readonly number[];
    readonly columnTypeSchemaSyms: readonly number[];
    readonly columnBaseTypeNameSyms: readonly number[];
    readonly columnIsUserDefined: readonly boolean[];
    readonly columnIsAssemblyType: readonly boolean[];
    readonly columnMaxLengthBytes: readonly number[];
    readonly columnPrecisions: readonly number[];
    readonly columnScales: readonly number[];
    readonly columnCollationSyms: readonly number[];
    readonly columnDefaultNameSyms: readonly number[];
    readonly columnDefaultDefinitionSyms: readonly number[];
    readonly columnIdentitySeedSyms: readonly number[];
    readonly columnIdentityIncrementSyms: readonly number[];
    readonly columnComputedDefinitionSyms: readonly number[];
    readonly columnComputedPersisted: readonly boolean[];
    readonly fkOnDeleteActions: readonly FkActionState[];
    readonly fkOnUpdateActions: readonly FkActionState[];
    readonly fkColumnOrdinals: readonly number[];
    readonly fkColumnFromIds: readonly number[];
    readonly fkColumnToIds: readonly number[];
    readonly environment: CatalogEnvironment;
}

/** Input bundle for CatalogBuilder.addColumn's exact detail (SV-R1). */
export interface AddColumnDetail {
    typeName: string;
    typeSchema?: string;
    baseTypeName?: string;
    systemTypeId: number;
    userTypeId: number;
    isUserDefined: boolean;
    isAssemblyType: boolean;
    maxLengthBytes: number;
    precision: number;
    scale: number;
    collationName?: string;
    defaultName?: string;
    defaultDefinition?: string;
    identitySeedText?: string;
    identityIncrementText?: string;
    computedDefinition?: string;
    computedPersisted?: boolean;
}

/**
 * Ordinal, locale-independent name comparator: Unicode-default case fold,
 * then a raw code-unit tiebreak so `Foo`/`foo` stay deterministic on
 * case-sensitive catalogs. Every ordering that feeds buildSchemaContext
 * output or any persisted/replayed artifact MUST use this, never
 * localeCompare: localeCompare delegates to the embedded ICU collator,
 * whose output changes across Electron/VS Code updates and platforms —
 * which would silently break the byte-identity guarantee, cached prompts,
 * and replay comparison (cache design C-1; lint-enforced).
 */
export function ordinalCompare(a: string, b: string): number {
    const fa = a.toLowerCase();
    const fb = b.toLowerCase();
    if (fa < fb) {
        return -1;
    }
    if (fa > fb) {
        return 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

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
    columnIdentity: boolean[] = [];
    columnComputed: boolean[] = [];

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

    // key constraints (H4): one row per (constraint, column), appended in
    // (object, index_id, key_ordinal) order so a constraint's rows are
    // consecutive
    keyConstraintOwner: number[] = []; // index into object table
    keyConstraintNameSyms: number[] = [];
    keyConstraintKinds: KeyConstraintKind[] = [];
    keyConstraintColumnSyms: number[] = [];

    // routine parameters (H6), appended grouped by object like columns
    paramOwner: number[] = []; // index into object table
    paramOrdinals: number[] = [];
    paramNameSyms: number[] = [];
    paramTypeSyms: number[] = [];
    paramOutput: boolean[] = [];

    // MS_Description extended properties (H7), appended AFTER all existing
    // SoA arrays — additive only, existing array order is load-bearing
    descriptionOwner: number[] = []; // index into object table
    descriptionColumnSyms: number[] = []; // -1 = object-level description
    descriptionValueSyms: number[] = [];

    // SV-R1 exact column detail (cm2), parallel to columnOwner. -1 sym/id
    // sentinels mean "no value"; columnDetailPresent=false means the WHOLE
    // detail block is unknown for that column (old fixture/cache shape).
    columnColumnIds: number[] = []; // sys.columns.column_id; -1 unknown
    columnDetailPresent: boolean[] = [];
    columnSystemTypeIds: number[] = [];
    columnUserTypeIds: number[] = [];
    columnTypeNameSyms: number[] = [];
    columnTypeSchemaSyms: number[] = [];
    columnBaseTypeNameSyms: number[] = [];
    columnIsUserDefined: boolean[] = [];
    columnIsAssemblyType: boolean[] = [];
    columnMaxLengthBytes: number[] = [];
    columnPrecisions: number[] = [];
    columnScales: number[] = [];
    columnCollationSyms: number[] = [];
    columnDefaultNameSyms: number[] = [];
    columnDefaultDefinitionSyms: number[] = [];
    columnIdentitySeedSyms: number[] = []; // exact text, interned (§5.3)
    columnIdentityIncrementSyms: number[] = [];
    columnComputedDefinitionSyms: number[] = [];
    columnComputedPersisted: boolean[] = [];

    // SV-R1 FK actions (parallel to fkFrom) + pair identities (parallel to
    // fkColumnConstraintIds). "UNKNOWN"/-1 = not captured.
    fkOnDeleteActions: FkActionState[] = [];
    fkOnUpdateActions: FkActionState[] = [];
    fkColumnOrdinals: number[] = [];
    fkColumnFromIds: number[] = [];
    fkColumnToIds: number[] = [];

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

    addColumn(
        objectId: number,
        name: string,
        typeDisplay: string,
        nullable: boolean,
        isIdentity = false,
        isComputed = false,
        columnId = -1,
        detail?: AddColumnDetail,
    ): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // column for unknown object: dropped (H3 raced a DDL)
        }
        this.columnOwner.push(objectIndex);
        this.columnNameSyms.push(this.intern(name));
        this.columnTypeSyms.push(this.intern(typeDisplay));
        this.columnNullable.push(nullable);
        this.columnIdentity.push(isIdentity);
        this.columnComputed.push(isComputed);
        this.columnColumnIds.push(columnId);
        this.columnDetailPresent.push(detail !== undefined);
        this.columnSystemTypeIds.push(detail?.systemTypeId ?? -1);
        this.columnUserTypeIds.push(detail?.userTypeId ?? -1);
        this.columnTypeNameSyms.push(detail === undefined ? -1 : this.intern(detail.typeName));
        this.columnTypeSchemaSyms.push(
            detail?.typeSchema === undefined ? -1 : this.intern(detail.typeSchema),
        );
        this.columnBaseTypeNameSyms.push(
            detail?.baseTypeName === undefined ? -1 : this.intern(detail.baseTypeName),
        );
        this.columnIsUserDefined.push(detail?.isUserDefined ?? false);
        this.columnIsAssemblyType.push(detail?.isAssemblyType ?? false);
        this.columnMaxLengthBytes.push(detail?.maxLengthBytes ?? 0);
        this.columnPrecisions.push(detail?.precision ?? 0);
        this.columnScales.push(detail?.scale ?? 0);
        this.columnCollationSyms.push(
            detail?.collationName === undefined ? -1 : this.intern(detail.collationName),
        );
        this.columnDefaultNameSyms.push(
            detail?.defaultName === undefined ? -1 : this.intern(detail.defaultName),
        );
        this.columnDefaultDefinitionSyms.push(
            detail?.defaultDefinition === undefined ? -1 : this.intern(detail.defaultDefinition),
        );
        this.columnIdentitySeedSyms.push(
            detail?.identitySeedText === undefined ? -1 : this.intern(detail.identitySeedText),
        );
        this.columnIdentityIncrementSyms.push(
            detail?.identityIncrementText === undefined
                ? -1
                : this.intern(detail.identityIncrementText),
        );
        this.columnComputedDefinitionSyms.push(
            detail?.computedDefinition === undefined ? -1 : this.intern(detail.computedDefinition),
        );
        this.columnComputedPersisted.push(detail?.computedPersisted ?? false);
    }

    addForeignKey(
        fromObjectId: number,
        toObjectId: number,
        name: string,
        constraintId: number = -1,
        onDelete: FkActionState = "UNKNOWN",
        onUpdate: FkActionState = "UNKNOWN",
    ): void {
        this.fkFrom.push(fromObjectId);
        this.fkTo.push(toObjectId);
        this.fkNameSyms.push(this.intern(name));
        this.fkConstraintIds.push(constraintId);
        this.fkOnDeleteActions.push(onDelete);
        this.fkOnUpdateActions.push(onUpdate);
    }

    addForeignKeyColumn(
        constraintId: number,
        fromColumn: string,
        toColumn: string,
        ordinal = -1,
        fromColumnId = -1,
        toColumnId = -1,
    ): void {
        this.fkColumnConstraintIds.push(constraintId);
        this.fkColumnFromSyms.push(this.intern(fromColumn));
        this.fkColumnToSyms.push(this.intern(toColumn));
        this.fkColumnOrdinals.push(ordinal);
        this.fkColumnFromIds.push(fromColumnId);
        this.fkColumnToIds.push(toColumnId);
    }

    markPrimaryKeyColumn(objectId: number, columnName: string): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // key for unknown object: dropped (H4 raced a DDL)
        }
        this.pkOwner.push(objectIndex);
        this.pkColumnNameSyms.push(this.intern(columnName));
    }

    addKeyConstraintColumn(
        objectId: number,
        constraintName: string,
        kind: KeyConstraintKind,
        columnName: string,
    ): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // constraint for unknown object: dropped (H4 raced a DDL)
        }
        this.keyConstraintOwner.push(objectIndex);
        this.keyConstraintNameSyms.push(this.intern(constraintName));
        this.keyConstraintKinds.push(kind);
        this.keyConstraintColumnSyms.push(this.intern(columnName));
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

    addDescription(objectId: number, value: string, columnName?: string): void {
        const objectIndex = this.objectIds.indexOf(objectId);
        if (objectIndex < 0) {
            return; // description for unknown object: dropped (H7 raced a DDL)
        }
        this.descriptionOwner.push(objectIndex);
        this.descriptionColumnSyms.push(columnName === undefined ? -1 : this.intern(columnName));
        this.descriptionValueSyms.push(this.intern(value));
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
    /** Backing for the set-once canonical content hash (cache C-2). */
    private contentHashValue: string | undefined;

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
    private keyConstraintsByObjectIndex = new Map<number, KeyConstraintInfo[]>();
    private fkColumnsByConstraint = new Map<number, FkColumnPair[]>();
    private schemaNameById = new Map<number, string>();
    /** object table index → { object-level description, per-column map } (H7). */
    private descriptionsByObjectIndex = new Map<
        number,
        { object?: string; byColumn: Map<string, string> }
    >();

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
        // key-constraint rows arrive with a constraint's columns consecutive
        // (H4 orders by object, index_id, key_ordinal); group by run
        for (let i = 0; i < b.keyConstraintOwner.length; i++) {
            const owner = b.keyConstraintOwner[i];
            const name = this.strings[b.keyConstraintNameSyms[i]];
            const kind = b.keyConstraintKinds[i];
            const column = this.strings[b.keyConstraintColumnSyms[i]];
            const constraints = this.keyConstraintsByObjectIndex.get(owner) ?? [];
            const last = constraints[constraints.length - 1];
            if (last && last.name === name && last.kind === kind) {
                last.columns.push(column);
            } else {
                constraints.push({ name, kind, columns: [column] });
            }
            this.keyConstraintsByObjectIndex.set(owner, constraints);
        }
        for (let i = 0; i < b.fkColumnConstraintIds.length; i++) {
            const constraintId = b.fkColumnConstraintIds[i];
            const pairs = this.fkColumnsByConstraint.get(constraintId) ?? [];
            const pair: FkColumnPair = {
                fromColumn: this.strings[b.fkColumnFromSyms[i]],
                toColumn: this.strings[b.fkColumnToSyms[i]],
            };
            // SV-R1 pair identities — set only when known so old-shape
            // fixtures keep their exact object shape (deep-equal safe).
            const ordinal = b.fkColumnOrdinals[i];
            if (ordinal !== undefined && ordinal >= 0) {
                pair.ordinal = ordinal;
            }
            const fromColumnId = b.fkColumnFromIds[i];
            if (fromColumnId !== undefined && fromColumnId >= 0) {
                pair.fromColumnId = fromColumnId;
            }
            const toColumnId = b.fkColumnToIds[i];
            if (toColumnId !== undefined && toColumnId >= 0) {
                pair.toColumnId = toColumnId;
            }
            pairs.push(pair);
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
        // H7 descriptions (additive — appended after all existing indexes)
        for (let i = 0; i < b.descriptionOwner.length; i++) {
            const owner = b.descriptionOwner[i];
            let entry = this.descriptionsByObjectIndex.get(owner);
            if (entry === undefined) {
                entry = { byColumn: new Map() };
                this.descriptionsByObjectIndex.set(owner, entry);
            }
            const value = this.strings[b.descriptionValueSyms[i]];
            const columnSym = b.descriptionColumnSyms[i];
            if (columnSym < 0) {
                entry.object = value;
            } else {
                entry.byColumn.set(this.strings[columnSym], value);
            }
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

    /**
     * Canonical content hash over the serialized payload in its frozen
     * canonical field order (cache C-2: `csh_<22 b64url>`); undefined until
     * the cache codec computes it. A plain readonly string — carrying it
     * does not violate snapshot purity. It rides result metadata and
     * feature capture ONLY, never rendered prompt text.
     */
    get contentHash(): string | undefined {
        return this.contentHashValue;
    }

    /**
     * SET-ONCE, by the cache codec/rehydrate path only (C-2). Repeating the
     * same value is an idempotent no-op; a second set with a DIFFERENT
     * value throws — a snapshot's content cannot change, so a conflicting
     * hash is always a caller bug, never data.
     */
    setContentHashOnce(hash: string): void {
        if (this.contentHashValue !== undefined) {
            if (this.contentHashValue !== hash) {
                throw new Error(
                    "CatalogSnapshot.contentHash is set-once (cache C-2); conflicting value rejected",
                );
            }
            return;
        }
        this.contentHashValue = hash;
    }

    /**
     * THE friend accessor for the persistent-cache codec (CACHE-1) — see
     * CatalogCodecView. Arrays are the builder's own (not copies); callers
     * must treat them as frozen.
     */
    get codecView(): CatalogCodecView {
        const environment: CatalogEnvironment = {
            defaultSchema: this.b.defaultSchema,
            caseSensitive: this.b.caseSensitive,
        };
        if (this.b.engineEdition !== undefined) {
            environment.engineEdition = this.b.engineEdition;
        }
        if (this.b.collationName !== undefined) {
            environment.collationName = this.b.collationName;
        }
        return {
            strings: this.b.stringTable,
            schemaIds: this.b.schemaIds,
            schemaNameSyms: this.b.schemaNameSyms,
            objectIds: this.b.objectIds,
            objectSchemaIds: this.b.objectSchemaIds,
            objectNameSyms: this.b.objectNameSyms,
            objectKinds: this.b.objectKinds,
            objectModifyDates: this.b.objectModifyDates,
            columnOwner: this.b.columnOwner,
            columnNameSyms: this.b.columnNameSyms,
            columnTypeSyms: this.b.columnTypeSyms,
            columnNullable: this.b.columnNullable,
            columnIdentity: this.b.columnIdentity,
            columnComputed: this.b.columnComputed,
            fkFrom: this.b.fkFrom,
            fkTo: this.b.fkTo,
            fkNameSyms: this.b.fkNameSyms,
            fkConstraintIds: this.b.fkConstraintIds,
            fkColumnConstraintIds: this.b.fkColumnConstraintIds,
            fkColumnFromSyms: this.b.fkColumnFromSyms,
            fkColumnToSyms: this.b.fkColumnToSyms,
            pkOwner: this.b.pkOwner,
            pkColumnNameSyms: this.b.pkColumnNameSyms,
            keyConstraintOwner: this.b.keyConstraintOwner,
            keyConstraintNameSyms: this.b.keyConstraintNameSyms,
            keyConstraintKinds: this.b.keyConstraintKinds,
            keyConstraintColumnSyms: this.b.keyConstraintColumnSyms,
            paramOwner: this.b.paramOwner,
            paramOrdinals: this.b.paramOrdinals,
            paramNameSyms: this.b.paramNameSyms,
            paramTypeSyms: this.b.paramTypeSyms,
            paramOutput: this.b.paramOutput,
            descriptionOwner: this.b.descriptionOwner,
            descriptionColumnSyms: this.b.descriptionColumnSyms,
            descriptionValueSyms: this.b.descriptionValueSyms,
            columnColumnIds: this.b.columnColumnIds,
            columnDetailPresent: this.b.columnDetailPresent,
            columnSystemTypeIds: this.b.columnSystemTypeIds,
            columnUserTypeIds: this.b.columnUserTypeIds,
            columnTypeNameSyms: this.b.columnTypeNameSyms,
            columnTypeSchemaSyms: this.b.columnTypeSchemaSyms,
            columnBaseTypeNameSyms: this.b.columnBaseTypeNameSyms,
            columnIsUserDefined: this.b.columnIsUserDefined,
            columnIsAssemblyType: this.b.columnIsAssemblyType,
            columnMaxLengthBytes: this.b.columnMaxLengthBytes,
            columnPrecisions: this.b.columnPrecisions,
            columnScales: this.b.columnScales,
            columnCollationSyms: this.b.columnCollationSyms,
            columnDefaultNameSyms: this.b.columnDefaultNameSyms,
            columnDefaultDefinitionSyms: this.b.columnDefaultDefinitionSyms,
            columnIdentitySeedSyms: this.b.columnIdentitySeedSyms,
            columnIdentityIncrementSyms: this.b.columnIdentityIncrementSyms,
            columnComputedDefinitionSyms: this.b.columnComputedDefinitionSyms,
            columnComputedPersisted: this.b.columnComputedPersisted,
            fkOnDeleteActions: this.b.fkOnDeleteActions,
            fkOnUpdateActions: this.b.fkOnUpdateActions,
            fkColumnOrdinals: this.b.fkColumnOrdinals,
            fkColumnFromIds: this.b.fkColumnFromIds,
            fkColumnToIds: this.b.fkColumnToIds,
            environment,
        };
    }

    listSchemas(): SchemaInfo[] {
        return this.b.schemaIds
            .map((schemaId, i) => ({ schemaId, name: this.strings[this.b.schemaNameSyms[i]] }))
            .sort((a, z) => ordinalCompare(a.name, z.name));
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
            (a, z) => ordinalCompare(a.schema, z.schema) || ordinalCompare(a.name, z.name),
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
            const column: ColumnInfo = {
                ordinal: c - start,
                name: this.strings[this.b.columnNameSyms[c]],
                typeDisplay: this.strings[this.b.columnTypeSyms[c]],
                nullable: this.b.columnNullable[c],
            };
            if (this.b.columnIdentity[c]) {
                column.isIdentity = true;
            }
            if (this.b.columnComputed[c]) {
                column.isComputed = true;
            }
            const columnId = this.b.columnColumnIds[c];
            if (columnId !== undefined && columnId >= 0) {
                column.columnId = columnId;
            }
            if (this.b.columnDetailPresent[c]) {
                column.detail = this.columnDetailAt(c);
            }
            columns.push(column);
        }
        return columns;
    }

    /** Exact detail projection for one column row (detailPresent verified). */
    private columnDetailAt(c: number): ColumnDetailInfo {
        const sym = (value: number): string | undefined =>
            value >= 0 ? this.strings[value] : undefined;
        const detail: ColumnDetailInfo = {
            typeName: this.strings[this.b.columnTypeNameSyms[c]],
            systemTypeId: this.b.columnSystemTypeIds[c],
            userTypeId: this.b.columnUserTypeIds[c],
            isUserDefined: this.b.columnIsUserDefined[c],
            isAssemblyType: this.b.columnIsAssemblyType[c],
            maxLengthBytes: this.b.columnMaxLengthBytes[c],
            precision: this.b.columnPrecisions[c],
            scale: this.b.columnScales[c],
        };
        const typeSchema = sym(this.b.columnTypeSchemaSyms[c]);
        if (typeSchema !== undefined) {
            detail.typeSchema = typeSchema;
        }
        const baseTypeName = sym(this.b.columnBaseTypeNameSyms[c]);
        if (baseTypeName !== undefined) {
            detail.baseTypeName = baseTypeName;
        }
        const collationName = sym(this.b.columnCollationSyms[c]);
        if (collationName !== undefined) {
            detail.collationName = collationName;
        }
        const defaultDefinition = sym(this.b.columnDefaultDefinitionSyms[c]);
        if (defaultDefinition !== undefined) {
            const defaultName = sym(this.b.columnDefaultNameSyms[c]);
            detail.default =
                defaultName === undefined
                    ? { definition: defaultDefinition }
                    : { name: defaultName, definition: defaultDefinition };
        }
        const seedText = sym(this.b.columnIdentitySeedSyms[c]);
        const incrementText = sym(this.b.columnIdentityIncrementSyms[c]);
        if (seedText !== undefined && incrementText !== undefined) {
            detail.identity = { seedText, incrementText };
        }
        const computedDefinition = sym(this.b.columnComputedDefinitionSyms[c]);
        if (computedDefinition !== undefined) {
            detail.computed = {
                definition: computedDefinition,
                persisted: this.b.columnComputedPersisted[c],
            };
        }
        return detail;
    }

    /** FK edge projection for builder row i (SV-R1 facts set only when known). */
    private fkEdgeAt(i: number): FkEdge {
        const edge: FkEdge = {
            fromObjectId: this.b.fkFrom[i],
            toObjectId: this.b.fkTo[i],
            name: this.strings[this.b.fkNameSyms[i]],
        };
        const constraintObjectId = this.b.fkConstraintIds[i];
        if (constraintObjectId >= 0) {
            edge.constraintObjectId = constraintObjectId;
        }
        const onDelete = this.b.fkOnDeleteActions[i];
        if (onDelete !== undefined && onDelete !== "UNKNOWN") {
            edge.onDelete = onDelete;
        }
        const onUpdate = this.b.fkOnUpdateActions[i];
        if (onUpdate !== undefined && onUpdate !== "UNKNOWN") {
            edge.onUpdate = onUpdate;
        }
        return edge;
    }

    getForeignKeysFrom(objectId: number): FkEdge[] {
        const edges: FkEdge[] = [];
        for (let i = 0; i < this.b.fkFrom.length; i++) {
            if (this.b.fkFrom[i] === objectId) {
                edges.push(this.fkEdgeAt(i));
            }
        }
        return edges;
    }

    getForeignKeysTo(objectId: number): FkEdge[] {
        const edges: FkEdge[] = [];
        for (let i = 0; i < this.b.fkTo.length; i++) {
            if (this.b.fkTo[i] === objectId) {
                edges.push(this.fkEdgeAt(i));
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

    /** PK/unique key constraints with columns in key-ordinal order (H4). */
    getKeyConstraints(objectId: number): readonly KeyConstraintInfo[] {
        const index = this.idIndex.get(objectId);
        if (index === undefined) {
            return [];
        }
        return (this.keyConstraintsByObjectIndex.get(index) ?? []).map((constraint) => ({
            ...constraint,
            columns: [...constraint.columns],
        }));
    }

    /** FK edges from an object with their column pairs (H5 + H5B). */
    getForeignKeyDetailsFrom(objectId: number): FkDetail[] {
        const details: FkDetail[] = [];
        for (let i = 0; i < this.b.fkFrom.length; i++) {
            if (this.b.fkFrom[i] === objectId) {
                details.push({
                    ...this.fkEdgeAt(i),
                    columns: (this.fkColumnsByConstraint.get(this.b.fkConstraintIds[i]) ?? []).map(
                        (pair) => ({ ...pair }),
                    ),
                });
            }
        }
        return details;
    }

    /** FK edges referencing an object with their column pairs (H5 + H5B). */
    getForeignKeyDetailsTo(objectId: number): FkDetail[] {
        const details: FkDetail[] = [];
        for (let i = 0; i < this.b.fkTo.length; i++) {
            if (this.b.fkTo[i] === objectId) {
                details.push({
                    ...this.fkEdgeAt(i),
                    columns: (this.fkColumnsByConstraint.get(this.b.fkConstraintIds[i]) ?? []).map(
                        (pair) => ({ ...pair }),
                    ),
                });
            }
        }
        return details;
    }

    /**
     * MS_Description for an object (no column) or one of its columns (H7).
     * PRIVACY: descriptions are user data — they serve hover/editor surfaces
     * ONLY and must never enter schema-context/remoteLm projections
     * (addendum §9 gate; buildSchemaContext does not read them).
     */
    getDescription(objectId: number, column?: string): string | undefined {
        const index = this.idIndex.get(objectId);
        if (index === undefined) {
            return undefined;
        }
        const entry = this.descriptionsByObjectIndex.get(index);
        if (entry === undefined) {
            return undefined;
        }
        if (column === undefined) {
            return entry.object;
        }
        const exact = entry.byColumn.get(column);
        if (exact !== undefined || this.b.caseSensitive) {
            return exact;
        }
        const folded = column.toLowerCase();
        for (const [name, value] of entry.byColumn) {
            if (name.toLowerCase() === folded) {
                return value;
            }
        }
        return undefined;
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
        return ordinalCompare(a.schema, z.schema) || ordinalCompare(a.name, z.name);
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
            .sort((a, z) => ordinalCompare(a.schema, z.schema) || ordinalCompare(a.name, z.name))
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
