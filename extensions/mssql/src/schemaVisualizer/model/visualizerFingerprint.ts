/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Visualizer fingerprint (SV-R2; addendum §5.7 — NORMATIVE). A pure,
 * deterministic hash over commit-relevant schema content. THE drift signal:
 * generation is a hydration counter and MUST NOT be used for drift,
 * identity, or rebase decisions (§6.1); this fingerprint is what "the
 * schema changed" means everywhere in the visualizer.
 *
 * Includes (canonical order): database identity, case sensitivity, per
 * table (objectId order): identity/schema/name, columns in ordinal order
 * with identity + display + exact facts (availability-aware — an
 * unknown→known transition IS a content change), key constraints, FK
 * identities/endpoints/ordered pairs/actions.
 *
 * Excludes: generation, capture timestamp, mode, section readiness,
 * capabilities, layout, selections, descriptions (not commit-relevant in
 * v1), diagnostics.
 *
 * Invariants (tested):
 * - identical full hydrations at generation N and N+1 → identical hash;
 * - any commit-relevant field change → different hash.
 */

import { createHash } from "crypto";
import {
    Available,
    SchemaVisualizerCatalogModel,
    SqlTypeSpec,
    VisualizerColumn,
} from "./schemaVisualizerModel";

export interface VisualizerFingerprint {
    /** `svf_` + base64url(sha256(canonical JSON)).slice(0, 22). */
    hash: string;
    /**
     * True when every commit-relevant section was available (the
     * informationalScript capability set). Pre-preview flows MUST refuse
     * an incomplete fingerprint (§6.5) — an incomplete hash is still
     * deterministic (usable for render-refresh comparisons) but is not a
     * publish baseline.
     */
    complete: boolean;
}

/** Availability serialized so unknown→known transitions move the hash. */
function availabilityTuple<T>(
    available: Available<T>,
    project: (value: T) => unknown,
): readonly unknown[] {
    return available.state === "known"
        ? ["known", project(available.value)]
        : ["unknown", available.reason];
}

function typeTuple(spec: SqlTypeSpec): readonly unknown[] {
    // Derived fields (logicalLength, vectorDimensions, displayText) are
    // functions of included facts — excluded to keep one source of truth.
    return [
        spec.typeName,
        spec.typeSchema ?? null,
        spec.baseTypeName ?? null,
        spec.systemTypeId,
        spec.userTypeId,
        spec.isUserDefined,
        spec.isAssemblyType,
        spec.maxLengthBytes,
        spec.precision,
        spec.scale,
        spec.collationName ?? null,
    ];
}

function columnTuple(column: VisualizerColumn): readonly unknown[] {
    return [
        column.identity.columnId ?? null,
        column.ordinal,
        column.name,
        column.typeDisplay,
        column.nullable,
        column.isIdentity,
        column.isComputed,
        availabilityTuple(column.inPrimaryKey, (v) => v),
        availabilityTuple(column.type, typeTuple),
        availabilityTuple(column.defaultConstraint, (v) =>
            v === null ? null : [v.name ?? null, v.definition],
        ),
        availabilityTuple(column.identitySpec, (v) => [v.seedText, v.incrementText]),
        availabilityTuple(column.computed, (v) =>
            v === null ? null : [v.definition, v.persisted],
        ),
        // description intentionally excluded (§5.7).
    ];
}

export function computeVisualizerFingerprint(
    model: SchemaVisualizerCatalogModel,
): VisualizerFingerprint {
    const canonical = {
        v: 1,
        database: [model.databaseIdentity.serverFingerprint, model.databaseIdentity.database],
        caseSensitive: model.caseSensitive,
        tables: model.tables.map((table) => [
            table.identity.objectId,
            table.schema,
            table.name,
            table.columns.map(columnTuple),
            table.keyConstraints.map((k) => [k.name, k.kind, k.columns]),
        ]),
        foreignKeys: model.foreignKeys.map((fk) => [
            fk.identity.constraintObjectId ?? null,
            fk.name,
            fk.fromObjectId,
            fk.toObjectId,
            fk.columnPairs.map((pair) => [
                pair.ordinal ?? null,
                pair.fromColumnId ?? null,
                pair.toColumnId ?? null,
                pair.fromColumnName,
                pair.toColumnName,
            ]),
            availabilityTuple(fk.onDelete, (v) => v),
            availabilityTuple(fk.onUpdate, (v) => v),
        ]),
    };
    const digest = createHash("sha256")
        .update(JSON.stringify(canonical), "utf8")
        .digest("base64url");
    return {
        hash: `svf_${digest.slice(0, 22)}`,
        complete: model.capabilities.informationalScript.state === "available",
    };
}
