/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer canonical model (SV-R2; visualizer addendum §4 —
 * NORMATIVE). This — not the legacy `SchemaDesigner.Schema` DTO — is the
 * truth model for every visualizer read surface:
 *
 *   CatalogSnapshot → SchemaVisualizerCatalogModel → SchemaGraphProjection → UI
 *
 * Design rules the types encode:
 * - IDENTITY-RICH: object_id / column_id / FK constraint object_id ride
 *   everywhere; graph ids derive from them (§4.4) and NEVER contain the
 *   metadata generation (a hydration sequence number, not a content
 *   revision — §6.1).
 * - AVAILABILITY-AWARE: a fact the substrate did not capture is
 *   `unknown(reason)`, never a fabricated concrete value (§4.2 — "an
 *   unrelated edit can accidentally publish the fabricated value").
 *   `known(null)` means DEFINITIVELY absent (e.g. "this column has no
 *   default"), which is different from unknown.
 * - Whole-DB section outcomes live in the CAPABILITY MATRIX (§5.8), not on
 *   every row: a failed columns section limits the diagram capability; it
 *   does not turn every table into a sea of per-field unknowns.
 *
 * Pure module: no vscode, no I/O, no clocks.
 */

import { FkReferentialAction } from "../../services/metadata/catalogModel";

export type AvailabilityReason =
    | "sectionUnavailable"
    | "permissionLimited"
    | "notHydrated"
    | "unsupported"
    | "notApplicable";

export type Available<T> =
    | { state: "known"; value: T }
    | { state: "unknown"; reason: AvailabilityReason };

export function known<T>(value: T): Available<T> {
    return { state: "known", value };
}

export function unknown<T>(reason: AvailabilityReason): Available<T> {
    return { state: "unknown", reason };
}

export function availableValue<T>(available: Available<T>): T | undefined {
    return available.state === "known" ? available.value : undefined;
}

// ---------------------------------------------------------------------------
// Identity + stable graph ids (§4.4)
// ---------------------------------------------------------------------------

export interface CatalogEntityIdentity {
    objectId: number;
}

export interface CatalogColumnIdentity extends CatalogEntityIdentity {
    columnId: number;
}

/** `table:<objectId>` — stable across refreshes and generations. */
export function tableGraphId(objectId: number): string {
    return `table:${objectId}`;
}

/**
 * `column:<objectId>:<columnId>`; ordinal fallback ONLY for catalogs whose
 * column ids were not captured (pre-cm2 shape). Fallback ids are stable
 * within a fingerprint-unchanged catalog but are NOT edit-grade identity —
 * the capability matrix must keep such catalogs read-only.
 */
export function columnGraphId(
    objectId: number,
    columnId: number | undefined,
    ordinal: number,
): string {
    return columnId === undefined
        ? `column:${objectId}:ord${ordinal}`
        : `column:${objectId}:${columnId}`;
}

/** `fk:<constraintObjectId>`; deterministic name-keyed fallback when unknown. */
export function fkGraphId(
    constraintObjectId: number | undefined,
    fromObjectId: number,
    name: string,
): string {
    return constraintObjectId === undefined
        ? `fk:named:${fromObjectId}:${name}`
        : `fk:${constraintObjectId}`;
}

// ---------------------------------------------------------------------------
// Exact type semantics (§5.2)
// ---------------------------------------------------------------------------

/**
 * Exact SQL type facts. `maxLengthBytes` keeps the raw sys.columns BYTES
 * semantics (-1 = max); `logicalLength` is the derived display length
 * (chars for nchar/nvarchar, bytes otherwise, "max" for -1) — derivation
 * is one-way; NOTHING reverse-parses displayText (§20.8).
 */
export interface SqlTypeSpec {
    displayText: string;
    typeName: string;
    typeSchema?: string;
    baseTypeName?: string;
    systemTypeId: number;
    userTypeId: number;
    isUserDefined: boolean;
    isAssemblyType: boolean;
    maxLengthBytes: number;
    logicalLength?: number | "max";
    precision: number;
    scale: number;
    collationName?: string;
    /** Derived for vector(n) columns (documented layout: 8 + 4n bytes). */
    vectorDimensions?: number;
}

// ---------------------------------------------------------------------------
// Columns / keys / FKs / tables (§4.3)
// ---------------------------------------------------------------------------

export interface VisualizerColumn {
    identity: CatalogEntityIdentity & { columnId?: number };
    graphId: string;
    ordinal: number;
    name: string;
    /** Always present — the H3 display string (render-safe without detail). */
    typeDisplay: string;
    nullable: boolean;
    isIdentity: boolean;
    isComputed: boolean;
    inPrimaryKey: Available<boolean>;
    type: Available<SqlTypeSpec>;
    /** known(null) = definitively no default; unknown = facts not captured. */
    defaultConstraint: Available<{ name?: string; definition: string } | null>;
    /**
     * notApplicable when !isIdentity; unknown(notHydrated) when the column
     * IS identity but exact seed/increment text was not captured — the UI
     * must show unknown, never substitute (1,1) (§5.3).
     */
    identitySpec: Available<{ seedText: string; incrementText: string }>;
    /** known(null) = definitively not computed; unknown = not captured. */
    computed: Available<{ definition: string; persisted: boolean } | null>;
    description: Available<string | null>;
}

export type KeyConstraintKind = "primaryKey" | "uniqueConstraint";

export interface VisualizerKeyConstraint {
    name: string;
    kind: KeyConstraintKind;
    /** Column names in key-ordinal order (H4 ordering preserved). */
    columns: string[];
}

export interface VisualizerForeignKeyColumnPair {
    ordinal?: number;
    fromColumnId?: number;
    toColumnId?: number;
    fromColumnName: string;
    toColumnName: string;
}

export interface VisualizerForeignKey {
    identity: { constraintObjectId?: number };
    graphId: string;
    name: string;
    fromObjectId: number;
    toObjectId: number;
    columnPairs: VisualizerForeignKeyColumnPair[];
    onDelete: Available<FkReferentialAction>;
    onUpdate: Available<FkReferentialAction>;
}

export interface VisualizerTable {
    identity: CatalogEntityIdentity;
    graphId: string;
    schema: string;
    name: string;
    columns: VisualizerColumn[];
    keyConstraints: VisualizerKeyConstraint[];
    description: Available<string | null>;
}

// ---------------------------------------------------------------------------
// Capability matrix (§5.8)
// ---------------------------------------------------------------------------

export type VisualizerCapabilityId =
    | "tableList"
    | "diagramNodes"
    | "relationshipEdges"
    | "keyProperties"
    | "descriptions"
    | "informationalScript"
    | "columnIdentityGrade";

export type VisualizerCapabilityState =
    | { state: "available" }
    | { state: "limited"; reason: AvailabilityReason; failedSections: string[] };

export type VisualizerCapabilities = Record<VisualizerCapabilityId, VisualizerCapabilityState>;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface SchemaVisualizerCatalogModel {
    databaseIdentity: {
        serverFingerprint: string;
        database: string;
    };
    caseSensitive: boolean;
    /** Sorted by objectId ascending — deterministic, collation-free. */
    tables: VisualizerTable[];
    /** Sorted by (constraintObjectId ?? +inf, fromObjectId, name). */
    foreignKeys: VisualizerForeignKey[];
    capabilities: VisualizerCapabilities;
    /**
     * Provenance facts — diagnostics/display ONLY. Nothing here may enter
     * the fingerprint or graph ids (generation is a hydration counter,
     * capturedAtUtc is a clock read — §5.7 exclusions).
     */
    source: {
        generation: number;
        capturedAtUtc: string;
        mode: "full" | "lite" | "partial";
        sectionReadiness: Record<string, string>;
    };
}
