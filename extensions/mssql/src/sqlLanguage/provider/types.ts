/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The metadata seam (language-service design 05 §8). The engine sees ONLY
 * these types — never MetadataService, CatalogSnapshot, STS2 DTOs, or vscode
 * (design §3.1: "the native engine should not know whether metadata came from
 * STS2, a fixture, a cache file, a live connection, or a future provider").
 * Pure: no imports outside src/sqlLanguage (lint-enforced).
 */

export type SectionState = "unknown" | "loading" | "ready" | "partial" | "failed" | "stale";

export interface LanguageReadiness {
    readonly objects: SectionState;
    readonly columns: SectionState;
    readonly parameters: SectionState;
    readonly foreignKeys: SectionState;
    /** "lazy" = available on demand through getDefinition, not hydrated. */
    readonly definitions: SectionState | "lazy";
    readonly mode: "full" | "lite" | "partial" | "offline";
}

export interface SqlLanguageServerCapabilities {
    readonly createOrAlterProgrammability: boolean;
    readonly dropIfExists: boolean;
}

export interface SqlLanguageEnvironment {
    readonly currentDatabase?: string;
    readonly defaultSchema: string;
    readonly caseSensitive: boolean;
    readonly engineEdition?: number;
    readonly serverVersion?: string;
    readonly capabilities: SqlLanguageServerCapabilities;
}

export type LangObjectKind =
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym";

/** Opaque object handle, stable within one provider generation. */
export interface LangObjectRef {
    readonly objectId: number;
    /** Set when the object belongs to a database other than the pin's context. */
    readonly database?: string;
}

export interface LangObjectInfo {
    readonly ref: LangObjectRef;
    readonly schema: string;
    readonly name: string;
    readonly kind: LangObjectKind;
}

export interface LangColumn {
    readonly name: string;
    /** Absent = type unknown (e.g. static system-catalog columns) — never "". */
    readonly typeDisplay?: string;
    readonly nullable?: boolean;
    readonly isPrimaryKey?: boolean;
    readonly isIdentity?: boolean;
    readonly isComputed?: boolean;
}

export interface LangParam {
    /** Ordinal 0 is the return value where the source exposes it. */
    readonly ordinal: number;
    readonly name: string;
    readonly typeDisplay: string;
    readonly isOutput: boolean;
}

export interface LangFkColumnPair {
    readonly fromColumn: string;
    readonly toColumn: string;
}

/** PK/unique key constraint with columns in key-ordinal order (scripting F2). */
export interface LangKeyConstraint {
    readonly name: string;
    readonly kind: "primaryKey" | "uniqueConstraint";
    readonly columns: readonly string[];
}

export interface LangFkEdge {
    readonly name?: string;
    readonly from: LangObjectRef;
    readonly to: LangObjectRef;
    /** Ordered column pairs; empty when pair data is unavailable. */
    readonly columns: readonly LangFkColumnPair[];
}

export interface LangSchema {
    readonly name: string;
}

export interface LangDatabase {
    readonly name: string;
}

export type LangResolution =
    | {
          readonly kind: "resolved";
          readonly ref: LangObjectRef;
          readonly confidence: "exact" | "defaultSchema";
      }
    | { readonly kind: "ambiguous"; readonly candidates: readonly LangObjectRef[] }
    | { readonly kind: "notFound" }
    | { readonly kind: "unavailable"; readonly section: keyof LanguageReadiness };

export interface ObjectSearchQuery {
    readonly prefix?: string;
    readonly schema?: string;
    readonly kinds?: readonly LangObjectKind[];
    readonly limit?: number;
}

export interface DefinitionResult {
    readonly text?: string;
    /** Why text is absent: encrypted, permission, unsupported, notLoaded. */
    readonly unavailableReason?: "encrypted" | "permission" | "unsupported" | "notLoaded";
}

export interface HydrationRequest {
    readonly kind: "objects" | "columns" | "parameters" | "foreignKeys" | "definitions";
    readonly object?: LangObjectRef;
    readonly priority: "interactiveFollowup" | "background";
}

/**
 * One consistent metadata generation (design §4.3: pin once per request; a
 * language request must never mix generations). All members are synchronous
 * snapshot reads except getDefinition (the single sanctioned lazy read).
 */
export interface IPinnedMetadataView {
    readonly generation: number;
    readonly env: SqlLanguageEnvironment;
    readonly readiness: LanguageReadiness;

    resolveObject(parts: readonly string[]): LangResolution;
    getObject(ref: LangObjectRef): LangObjectInfo | undefined;
    getColumns(ref: LangObjectRef): readonly LangColumn[] | undefined;
    getParameters(ref: LangObjectRef): readonly LangParam[] | undefined;

    fkFrom(ref: LangObjectRef): readonly LangFkEdge[];
    fkTo(ref: LangObjectRef): readonly LangFkEdge[];

    /**
     * PK/unique constraints with names and key order (scripting F2);
     * undefined = the section is not trustworthy (emitters note the gap).
     */
    getKeyConstraints?(ref: LangObjectRef): readonly LangKeyConstraint[] | undefined;

    searchObjects(query: ObjectSearchQuery): readonly LangObjectInfo[];
    listSchemas(): readonly LangSchema[];

    getDescription?(ref: LangObjectRef, column?: string): string | undefined;
    getDefinition?(ref: LangObjectRef): Promise<DefinitionResult>;
}

export interface ISqlLanguageMetadataProvider {
    readonly generation: number;

    env(): SqlLanguageEnvironment;
    readiness(): LanguageReadiness;

    pin(): IPinnedMetadataView;

    /** undefined when the database list is not available from this provider. */
    databases(): readonly LangDatabase[] | undefined;

    requestHydration?(request: HydrationRequest): void;

    /** Returns an unsubscribe function (pure substitute for vscode.Event). */
    onDidChange(listener: () => void): () => void;
}
