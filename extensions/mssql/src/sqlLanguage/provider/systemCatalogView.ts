/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * System-catalog fallback view: decorates a pinned metadata view so
 * sys/INFORMATION_SCHEMA names resolve from the static curated catalog
 * (data/systemObjectCatalog) when — and only when — the live snapshot does
 * not know them. One seam for every feature: completion, hover, diagnostics
 * and definition all go through resolveObject/getColumns, so none of them
 * needs a system-object special case.
 *
 * Precedence rules:
 *   - LIVE METADATA ALWAYS WINS: the inner view answers first; the catalog
 *     only fills a miss (the metadata service excludes is_ms_shipped
 *     objects, so system names are always a miss on live snapshots).
 *   - SYSTEM SCHEMAS ONLY: the catalog answers schema-qualified names under
 *     sys/INFORMATION_SCHEMA — it never shadows user schemas or bare names.
 *   - Catalog refs live in a NEGATIVE objectId space (live ids are positive)
 *     so the two ref spaces cannot collide within a pin.
 *
 * Honesty: catalog entries surface as kind "view" with curated column
 * NAMES only — no types, nullability, keys, FKs, descriptions or
 * definitions are ever claimed, and the column lists are subsets (positive
 * facts only; consumers must not derive absence claims from them — see the
 * systemObject suppression in features/diagnostics.ts).
 */

import {
    findSystemObject,
    isSystemCatalogObjectId,
    isSystemSchemaName,
    systemObjectById,
    systemObjectsInSchema,
    SystemCatalogObject,
} from "../data/systemObjectCatalog";
import {
    IPinnedMetadataView,
    LangColumn,
    LangObjectInfo,
    LangObjectRef,
    LangResolution,
    ObjectSearchQuery,
} from "./types";

function toObjectInfo(object: SystemCatalogObject): LangObjectInfo {
    // All curated entries are catalog views / DMVs; "view" is the closest
    // seam kind (a few are table-valued DMFs — the distinction is not in
    // the source data and nothing downstream depends on it).
    return {
        ref: { objectId: object.objectId },
        schema: object.schema,
        name: object.name,
        kind: "view",
    };
}

function toColumns(object: SystemCatalogObject): readonly LangColumn[] {
    // Names only: the curated data carries no types or nullability, and an
    // absent typeDisplay is the honest "unknown" (never an empty string).
    return object.columns.map((name) => ({ name }));
}

/**
 * Wrap a pinned view with the static system-object fallback. The wrapper is
 * cheap (no copies); build one per pin.
 */
export function withSystemObjectCatalog(inner: IPinnedMetadataView): IPinnedMetadataView {
    const engineEdition = inner.env.engineEdition;

    const resolveObject = (parts: readonly string[]): LangResolution => {
        const resolution = inner.resolveObject(parts);
        if (resolution.kind === "resolved" || resolution.kind === "ambiguous") {
            return resolution; // live metadata wins
        }
        // Fallback for schema-qualified system names only (last two parts —
        // a leading database qualifier was validated by the binder already).
        const cleaned = parts.filter((p) => p.length > 0);
        if (cleaned.length < 2) {
            return resolution;
        }
        const object = findSystemObject(
            cleaned[cleaned.length - 2],
            cleaned[cleaned.length - 1],
            engineEdition,
        );
        if (object === undefined) {
            return resolution;
        }
        return { kind: "resolved", ref: { objectId: object.objectId }, confidence: "exact" };
    };

    const searchObjects = (query: ObjectSearchQuery): readonly LangObjectInfo[] => {
        const results = inner.searchObjects(query);
        // Catalog objects list ONLY under an explicit system-schema filter
        // (`sys.` member access) — unqualified searches stay live-only.
        if (query.schema === undefined || !isSystemSchemaName(query.schema)) {
            return results;
        }
        if (query.kinds !== undefined && !query.kinds.includes("view")) {
            return results;
        }
        const limit = query.limit ?? 100;
        const prefix = query.prefix?.toLowerCase();
        const taken = new Set(results.map((info) => info.name.toLowerCase()));
        const merged = [...results];
        for (const object of systemObjectsInSchema(query.schema, engineEdition)) {
            if (merged.length >= limit) {
                break;
            }
            const folded = object.name.toLowerCase();
            if (taken.has(folded)) {
                continue; // live metadata wins
            }
            if (prefix !== undefined && prefix.length > 0 && !folded.startsWith(prefix)) {
                continue;
            }
            merged.push(toObjectInfo(object));
        }
        return merged;
    };

    const listSchemas = (): readonly { name: string }[] => {
        const schemas = inner.listSchemas();
        const known = new Set(schemas.map((s) => s.name.toLowerCase()));
        const extra: { name: string }[] = [];
        for (const schema of ["sys", "INFORMATION_SCHEMA"]) {
            if (
                !known.has(schema.toLowerCase()) &&
                systemObjectsInSchema(schema, engineEdition).length > 0
            ) {
                extra.push({ name: schema });
            }
        }
        return extra.length === 0 ? schemas : [...schemas, ...extra];
    };

    const view: IPinnedMetadataView = {
        generation: inner.generation,
        env: inner.env,
        readiness: inner.readiness,
        resolveObject,
        getObject: (ref: LangObjectRef): LangObjectInfo | undefined => {
            if (isSystemCatalogObjectId(ref.objectId)) {
                const object = systemObjectById(ref.objectId, engineEdition);
                return object === undefined ? undefined : toObjectInfo(object);
            }
            return inner.getObject(ref);
        },
        getColumns: (ref: LangObjectRef): readonly LangColumn[] | undefined => {
            if (isSystemCatalogObjectId(ref.objectId)) {
                const object = systemObjectById(ref.objectId, engineEdition);
                return object === undefined ? undefined : toColumns(object);
            }
            return inner.getColumns(ref);
        },
        getParameters: (ref) =>
            isSystemCatalogObjectId(ref.objectId) ? undefined : inner.getParameters(ref),
        fkFrom: (ref) => (isSystemCatalogObjectId(ref.objectId) ? [] : inner.fkFrom(ref)),
        fkTo: (ref) => (isSystemCatalogObjectId(ref.objectId) ? [] : inner.fkTo(ref)),
        searchObjects,
        listSchemas,
    };
    // Optional members mirror the inner view's presence (scriptingService
    // treats a missing getDefinition as "offline" — never fake one).
    if (inner.getKeyConstraints !== undefined) {
        view.getKeyConstraints = (ref) =>
            isSystemCatalogObjectId(ref.objectId) ? undefined : inner.getKeyConstraints!(ref);
    }
    if (inner.getDescription !== undefined) {
        view.getDescription = (ref, column) =>
            isSystemCatalogObjectId(ref.objectId) ? undefined : inner.getDescription!(ref, column);
    }
    if (inner.getDefinition !== undefined) {
        view.getDefinition = (ref) =>
            isSystemCatalogObjectId(ref.objectId)
                ? Promise.resolve({ unavailableReason: "unsupported" as const })
                : inner.getDefinition!(ref);
    }
    return view;
}
