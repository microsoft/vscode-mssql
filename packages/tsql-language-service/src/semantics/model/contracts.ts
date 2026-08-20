/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FeatureAvailabilityDetail } from "../../common/platformFeatureRegistry.js";
import type { ColumnMetadata, ObjectRef, ParameterMetadata } from "../../metadata/index.js";
import type { TextRange } from "../../text/index.js";
import type { IdentifierPart } from "../identifiers.js";
import type { SymbolId } from "../symbolId.js";

/**
 * The shared semantic intermediate representation.
 *
 * Diagnostics, completion, hover, definition, signature help, and coloring are projections of the
 * values declared here. A feature that answers a question by walking syntax again is how the same
 * name came to resolve one way in a squiggle and another way in a tooltip, so the rule is: bind
 * once into this model, then read the model.
 */

/** How a written name was resolved. `unknown` metadata is never reported as absence. */
export type NameResolution =
    | { readonly kind: "catalog"; readonly object: ObjectRef; readonly objectKind: string }
    | { readonly kind: "local"; readonly symbol: SymbolId; readonly objectKind: string }
    | { readonly kind: "ambiguous"; readonly candidates: readonly ObjectRef[] }
    | { readonly kind: "unresolved"; readonly reason: "notFound" | "unknown" };

/** What a name occurrence stands for, before any feature interprets it. */
export type BoundNameRole =
    | "relation"
    | "column"
    | "routine"
    | "procedure"
    | "type"
    | "schema"
    | "database"
    | "principal"
    | "alias"
    | "unknown";

/**
 * One name occurrence, carrying both its source spelling and its semantic identity.
 *
 * The same value drives the diagnostic range, the hover target, the definition target, the colour
 * role, and the text completion writes back, which is what keeps those five answers equal.
 */
export interface BoundName {
    readonly parts: readonly IdentifierPart[];
    readonly range: TextRange;
    readonly role: BoundNameRole;
    /** The database part in force, whether written or defaulted. */
    readonly database?: string;
    /** The schema part in force, whether written or defaulted. */
    readonly schema?: string;
    /** The last written component, normalized. */
    readonly object: string;
    /** True when a component was omitted, as in `db..object`. */
    readonly hasOmittedParts: boolean;
    readonly resolution: NameResolution;
    /** The name as completion or rename should write it back. */
    readonly insertionForm: string;
}

/** One column visible through a relation. */
export interface BoundColumn {
    readonly name: string;
    readonly symbol?: SymbolId;
    readonly type?: ExpressionType;
    readonly range?: TextRange;
}

/** How a relation entered its scope. */
export type BoundRelationKind =
    | "table"
    | "view"
    | "tableFunction"
    | "synonym"
    | "cte"
    | "derived"
    | "variable"
    | "openRowset"
    | "openJson"
    | "xmlNodes"
    | "pivot"
    | "unpivot"
    | "pseudo"
    | "unknown";

/** A rowset in scope: a table source, an alias, a CTE, a derived table, or a pseudo-table. */
export interface BoundRelation {
    readonly id: SymbolId;
    readonly kind: BoundRelationKind;
    /** Absent for a derived table written without a name. */
    readonly name?: BoundName;
    /** The name the query refers to this relation by: the alias when written, else the object. */
    readonly exposedName: string;
    readonly scopeId: string;
    /** `"unknown"` when metadata has not delivered a shape; never an empty column list. */
    readonly columns: readonly BoundColumn[] | "unknown";
    readonly range: TextRange;
    /** True for `inserted`, `deleted`, and other rowsets the statement introduces implicitly. */
    readonly implicit: boolean;
}

/** One query boundary and everything visible inside it. */
export interface QueryScope {
    readonly id: string;
    readonly range: TextRange;
    readonly parent?: string;
    readonly relations: readonly BoundRelation[];
    readonly ctes: readonly BoundRelation[];
}

/** A call's argument, whether positional or named. */
export interface BoundArgument {
    readonly range: TextRange;
    /** The parameter label written as `@name = value`, normalized. */
    readonly name?: string;
    readonly nameRange?: TextRange;
    /** The parameter this argument binds to, when it could be mapped. */
    readonly parameter?: ParameterMetadata;
    readonly type?: ExpressionType;
    /** True for the `*` written in place of an argument list. */
    readonly wildcard: boolean;
}

/** One callable overload, in the shape signature help renders and validation compares against. */
export interface SignatureModel {
    readonly label: string;
    readonly parameters: readonly {
        readonly label: string;
        readonly optional: boolean;
        readonly documentation?: string;
    }[];
    readonly documentation?: string;
    /** How arguments are separated: `,` for ordinary calls, a keyword for CAST/CONVERT-style ones. */
    readonly separator: string;
    readonly returnType?: ExpressionType;
}

/**
 * How a callable's arguments are written.
 *
 * A parenthesized call, `CAST(x AS t)`, and `TOP (n) PERCENT` are all argument shapes. Sharing one
 * abstraction is what lets cursor tracking and active-parameter maths work for constructs that are
 * not function calls, without pretending that `TOP` is a function.
 */
export type ArgumentShape = "parenthesized" | "keywordSeparated" | "bare";

export type CallTarget =
    | { readonly kind: "builtin"; readonly name: string }
    | { readonly kind: "catalog"; readonly object: ObjectRef; readonly objectKind: string }
    | { readonly kind: "local"; readonly symbol: SymbolId; readonly objectKind: string }
    | { readonly kind: "operator"; readonly name: string }
    | { readonly kind: "unresolved"; readonly name: string };

/**
 * One invocation, whatever grammar node wrote it.
 *
 * Scalar calls, table-valued sources, `CAST`, `CONVERT`, `PARSE`, `EXEC`, and `TOP` all reduce to
 * this. Arity validation and signature help disagreeing about the same call — the confirmed
 * table-function defect — is exactly what one shared call model prevents.
 */
export interface ResolvedCall {
    readonly range: TextRange;
    /** The written name; absent for keyword operators such as `TOP`. */
    readonly name?: BoundName;
    /**
     * The span of the keyword a call was written as, for constructs the grammar spells with one.
     *
     * `CAST`, `CONVERT`, and `TOP` are keywords in source and routines in meaning. Recording the
     * keyword's own range is what lets coloring mark it as a library construct and signature help
     * describe it as a call without either layer deciding separately what the construct is.
     */
    readonly keywordRange?: TextRange;
    readonly target: CallTarget;
    readonly shape: ArgumentShape;
    /** The argument list node's span, when the grammar created one. */
    readonly argumentRange?: TextRange;
    readonly arguments: readonly BoundArgument[];
    /**
     * Offsets of the tokens that advance the active argument.
     *
     * A comma does it in an ordinary call; `AS` and `USING` do it in a conversion, and `PERCENT`
     * does it in `TOP`. Recording them while the tree is in hand means the caret-to-argument
     * calculation is one comparison against offsets rather than a second tree walk per feature.
     */
    readonly separators: readonly number[];
    readonly parameters: readonly ParameterMetadata[] | "unknown";
    readonly signatures: readonly SignatureModel[];
    readonly returnType?: ExpressionType;
    /** True when the call is a rowset source rather than a scalar expression. */
    readonly rowset: boolean;
}

/** One expression and the type bound to it. */
export interface BoundExpression {
    readonly range: TextRange;
    readonly type: ExpressionType;
}

/** A bound expression's type, with an explicit confidence so unknown never becomes a diagnostic. */
export interface ExpressionType {
    readonly displayName: string;
    readonly nullable: boolean;
    readonly category: "scalar" | "table" | "clr" | "xml" | "cursor" | "vector" | "unknown";
    readonly confidence: "known" | "inferred" | "unknown";
    readonly members?: readonly ColumnMetadata[];
    /** The relation a column expression was read from. */
    readonly sourceRelation?: SymbolId;
}

/** What a document-local `CREATE`/`ALTER`/`DROP`/`SELECT INTO` did, and where. */
export interface CatalogTimelineEvent {
    readonly offset: number;
    readonly action: "create" | "alter" | "drop";
    readonly parts: readonly string[];
    readonly kind: string;
    /** The declared object's exact name range, when this event introduces an identity. */
    readonly declaration?: TextRange;
    readonly columns?: readonly ColumnMetadata[];
    readonly parameters?: readonly ParameterMetadata[];
    /** Which kind of user-defined type a `type` event declared. */
    readonly typeCategory?: "alias" | "clr" | "table";
    /** The declaring statement's span, when the collector recorded one. */
    readonly range?: TextRange;
}

/** What the document says about an object at one offset, before the catalog is consulted. */
export interface LocalCatalogState {
    readonly exists: boolean;
    readonly kind?: string;
    readonly columns?: readonly ColumnMetadata[];
    readonly parameters?: readonly ParameterMetadata[];
    readonly typeCategory?: "alias" | "clr" | "table";
    readonly event?: CatalogTimelineEvent;
}

/**
 * Same-document DDL, ordered.
 *
 * Resolution at an offset asks the timeline before the catalog, so a table created earlier in the
 * document exists and a table dropped earlier does not — identically for diagnostics, completion,
 * hover, definition, and signature help.
 */
export interface CatalogTimeline {
    readonly events: readonly CatalogTimelineEvent[];
    /**
     * What the document says about a name at an offset.
     *
     * `kinds` narrows the answer to one namespace. SQL Server keeps procedures, relations, and
     * user-defined types in namespaces a single name can occupy independently, so a caller asking
     * about one must not be told about another.
     */
    resolve(
        parts: readonly string[],
        offset: number,
        kinds?: readonly string[],
    ): LocalCatalogState | undefined;
}

/** One engine/version decision, made once and read by every feature. */
export interface FeatureAvailabilityDecision {
    readonly featureId: string;
    readonly status: "available" | "unavailable" | "deferred";
    readonly range: TextRange;
    readonly reason?: string;
    readonly detail?: FeatureAvailabilityDetail;
}

/** What the caret is positioned to name. */
export type CursorExpectation =
    | "column"
    | "relation"
    | "function"
    | "parameter"
    | "datatype"
    | "keyword"
    | "unknown";

/**
 * The caret's semantic position.
 *
 * Completion and signature help become renderers over this value instead of each reconstructing a
 * damaged parse, which is what makes incomplete typing behave the same in both.
 */
export interface CursorContext {
    readonly offset: number;
    readonly replacementRange: TextRange;
    readonly expected: CursorExpectation;
    readonly scope?: QueryScope;
    readonly partialName?: BoundName;
    readonly call?: ResolvedCall;
    readonly activeArgument?: number;
    readonly recovery: "complete" | "recovered" | "incomplete";
}

/**
 * The document's bound semantic model.
 *
 * Published once per snapshot and read by every feature. Every accessor is a lookup over already
 * bound state: nothing here parses, walks syntax, or consults metadata a second time.
 */
export interface SemanticModel {
    readonly scopes: readonly QueryScope[];
    readonly relations: readonly BoundRelation[];
    readonly names: readonly BoundName[];
    readonly calls: readonly ResolvedCall[];
    /** Every expression whose type the binder could infer, innermost ranges included. */
    readonly expressions: readonly BoundExpression[];
    readonly timeline: CatalogTimeline;
    readonly availability: readonly FeatureAvailabilityDecision[];

    /** The innermost scope containing the offset. */
    scopeAt(offset: number): QueryScope | undefined;
    /** Every relation visible at the offset, innermost scope first. */
    visibleRelations(offset: number): readonly BoundRelation[];
    /** The relation an exposed name refers to at the offset. */
    relationFor(exposedName: string, offset: number): BoundRelation | undefined;
    /** The name occurrence covering the offset. */
    nameAt(offset: number): BoundName | undefined;
    /** The innermost call whose argument list contains the offset. */
    callAt(offset: number): ResolvedCall | undefined;
    /** The call owning the exact range, used when a feature already holds the call's node. */
    callForRange(range: TextRange): ResolvedCall | undefined;
    /** The bound type of the expression covering the offset. */
    typeAt(offset: number): ExpressionType | undefined;
    /** The availability decision covering the offset. */
    availabilityAt(offset: number): FeatureAvailabilityDecision | undefined;
}
