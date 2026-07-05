/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Binder v1 (design 05 §7.5) — completion-driven scope: resolves the sketch's
 * sources against the pinned metadata view + overlay + CTEs, alias BEFORE
 * object name, innermost scope outward. Produces suppression reasons instead
 * of guesses when it cannot be honest. Occurrence indexing and full column
 * reference binding deepen with diagnostics (B10) and highlights (B13).
 */

import { CteDecl, SelectItem, SourceRef, StatementSketch } from "./sketch";
import { OverlayObject, ScriptOverlay } from "./overlay";
import { IPinnedMetadataView, LangColumn, LangObjectRef } from "../provider/types";

export type SuppressionReason =
    | "providerNotReady"
    | "columnsNotReady"
    | "databaseNotHydrated"
    | "crossDatabaseUnhydrated"
    | "linkedServer"
    | "opaqueSource"
    | "dynamicSql"
    | "unknownSketchRegion"
    | "unknownOverlayType"
    | "ambiguous"
    | "notFound";

export type SourceResolution =
    | { readonly kind: "catalog"; readonly ref: LangObjectRef }
    | { readonly kind: "cte"; readonly cte: CteDecl }
    | { readonly kind: "overlay"; readonly overlay: OverlayObject }
    | { readonly kind: "derived" }
    | { readonly kind: "opaque"; readonly reason: SuppressionReason };

export interface BoundSource {
    readonly source: SourceRef;
    readonly resolution: SourceResolution;
    /** Display label for the source (alias if present, else last name part). */
    readonly label: string;
}

export interface BoundColumn {
    readonly name: string;
    readonly typeDisplay?: string;
    readonly isPrimaryKey?: boolean;
    readonly isIdentity?: boolean;
    readonly isComputed?: boolean;
    readonly fromLabel: string;
}

export interface StatementBinding {
    readonly sketch: StatementSketch;
    scopeAt(offset: number): number;
    /** Sources visible at an offset: innermost scope first, then ancestors. */
    sourcesAt(offset: number): readonly BoundSource[];
    /** Alias-first qualifier resolution among visible sources. */
    resolveQualifier(offset: number, qualifier: string): BoundSource | undefined;
    /** Columns of one bound source; undefined = cannot claim (suppression). */
    columnsOf(bound: BoundSource): readonly BoundColumn[] | undefined;
    /** All columns visible unqualified at an offset (union across sources). */
    visibleColumns(offset: number): {
        readonly columns: readonly BoundColumn[];
        readonly complete: boolean;
    };
}

export interface BindInput {
    readonly text: string;
    readonly sketch: StatementSketch;
    readonly overlay: ScriptOverlay;
    readonly batchIndex: number;
    readonly ordinal: number;
    readonly pinned: IPinnedMetadataView;
    readonly caseSensitive: boolean;
}

export function bindStatement(input: BindInput): StatementBinding {
    const { sketch, overlay, batchIndex, ordinal, pinned } = input;
    const fold = (value: string): string => (input.caseSensitive ? value : value.toLowerCase());

    const resolveSource = (source: SourceRef): SourceResolution => {
        if (source.kind === "derived" || source.kind === "values") {
            return { kind: "derived" };
        }
        if (source.kind === "openrowset" || source.kind === "unknown") {
            return { kind: "opaque", reason: "opaqueSource" };
        }
        const parts = source.parts.filter((p) => p.length > 0);
        if (parts.length === 0) {
            return { kind: "opaque", reason: "unknownSketchRegion" };
        }
        const last = parts[parts.length - 1];
        // 1. Statement CTEs.
        if (parts.length === 1) {
            const cte = sketch.ctes.find((c) => fold(c.name) === fold(last));
            if (cte !== undefined) {
                return { kind: "cte", cte };
            }
        }
        // 2. Overlay objects (#temp, @tablevar, script tables).
        if (parts.length === 1 || last.startsWith("#")) {
            const obj = overlay.findObject(last, batchIndex, ordinal);
            if (obj !== undefined) {
                return { kind: "overlay", overlay: obj };
            }
            if (last.startsWith("#") || last.startsWith("@")) {
                return { kind: "opaque", reason: "notFound" };
            }
        }
        // 3. Cross-database / linked-server honesty.
        if (parts.length >= 4) {
            return { kind: "opaque", reason: "linkedServer" };
        }
        if (parts.length === 3) {
            const database = parts[0];
            const current = pinned.env.currentDatabase;
            if (current === undefined || fold(database) !== fold(current)) {
                return { kind: "opaque", reason: "crossDatabaseUnhydrated" };
            }
        }
        // 4. Catalog (TVFs resolve like objects).
        if (pinned.readiness.objects !== "ready" && pinned.readiness.objects !== "partial") {
            return { kind: "opaque", reason: "providerNotReady" };
        }
        const nameParts = parts.length === 3 ? parts.slice(1) : parts;
        const resolution = pinned.resolveObject(nameParts);
        switch (resolution.kind) {
            case "resolved":
                return { kind: "catalog", ref: resolution.ref };
            case "ambiguous":
                return { kind: "opaque", reason: "ambiguous" };
            case "unavailable":
                return { kind: "opaque", reason: "providerNotReady" };
            case "notFound":
            default:
                return { kind: "opaque", reason: "notFound" };
        }
    };

    const bindSource = (source: SourceRef): BoundSource => {
        const parts = source.parts.filter((p) => p.length > 0);
        const label = source.alias ?? (parts.length > 0 ? parts[parts.length - 1] : "(derived)");
        return { source, resolution: resolveSource(source), label };
    };

    const scopeAt = (offset: number): number => {
        let best = 0;
        let bestSize = Number.MAX_SAFE_INTEGER;
        for (const scope of sketch.scopes) {
            if (offset >= scope.span.start && offset <= scope.span.end) {
                const size = scope.span.end - scope.span.start;
                if (size < bestSize) {
                    best = scope.id;
                    bestSize = size;
                }
            }
        }
        return best;
    };

    const sourcesAt = (offset: number): BoundSource[] => {
        const chain: number[] = [];
        let scopeId: number | undefined = scopeAt(offset);
        while (scopeId !== undefined) {
            chain.push(scopeId);
            scopeId = sketch.scopes[scopeId]?.parentId;
        }
        const out: BoundSource[] = [];
        for (const id of chain) {
            for (const source of sketch.sources) {
                if (source.scopeId === id) {
                    out.push(bindSource(source));
                }
            }
        }
        return out;
    };

    const derivedColumns = (innerScopeId: number | undefined): BoundColumn[] | undefined => {
        if (innerScopeId === undefined) {
            return undefined;
        }
        const items = sketch.selectItems.filter((it) => it.scopeId === innerScopeId);
        if (items.length === 0) {
            return undefined;
        }
        const columns: BoundColumn[] = [];
        for (const item of items) {
            const name = selectItemName(input.text, item);
            if (name === undefined) {
                return undefined; // an unnameable item makes the shape unknown
            }
            columns.push({ name, fromLabel: "(derived)" });
        }
        return columns;
    };

    const columnsOf = (bound: BoundSource): readonly BoundColumn[] | undefined => {
        switch (bound.resolution.kind) {
            case "catalog": {
                if (
                    pinned.readiness.columns !== "ready" &&
                    pinned.readiness.columns !== "partial"
                ) {
                    return undefined;
                }
                const columns = pinned.getColumns(bound.resolution.ref);
                if (columns === undefined) {
                    return undefined;
                }
                return columns.map((c: LangColumn) => ({
                    name: c.name,
                    typeDisplay: c.typeDisplay,
                    isPrimaryKey: c.isPrimaryKey,
                    isIdentity: c.isIdentity,
                    isComputed: c.isComputed,
                    fromLabel: bound.label,
                }));
            }
            case "cte": {
                const cte = bound.resolution.cte;
                if (cte.columns !== undefined && cte.columns.length > 0) {
                    return cte.columns.map((name) => ({ name, fromLabel: bound.label }));
                }
                const derived = derivedColumns(cte.bodyScopeId);
                return derived?.map((c) => ({ ...c, fromLabel: bound.label }));
            }
            case "overlay":
                return bound.resolution.overlay.columns.map((name) => ({
                    name,
                    fromLabel: bound.label,
                }));
            case "derived": {
                const derived = derivedColumns(bound.source.innerScopeId);
                return derived?.map((c) => ({ ...c, fromLabel: bound.label }));
            }
            case "opaque":
            default:
                return undefined;
        }
    };

    return {
        sketch,
        scopeAt,
        sourcesAt,
        resolveQualifier: (offset, qualifier) => {
            const folded = fold(qualifier);
            const visible = sourcesAt(offset);
            // Alias first (design §7.5: resolve source aliases before objects).
            for (const bound of visible) {
                if (bound.source.alias !== undefined && fold(bound.source.alias) === folded) {
                    return bound;
                }
            }
            for (const bound of visible) {
                const parts = bound.source.parts.filter((p) => p.length > 0);
                if (parts.length > 0 && fold(parts[parts.length - 1]) === folded) {
                    return bound;
                }
            }
            return undefined;
        },
        columnsOf,
        visibleColumns: (offset) => {
            const columns: BoundColumn[] = [];
            let complete = true;
            for (const bound of sourcesAt(offset)) {
                const cols = columnsOf(bound);
                if (cols === undefined) {
                    complete = false;
                    continue;
                }
                columns.push(...cols);
            }
            return { columns, complete };
        },
    };
}

/** Derive a display column name from a SELECT item (alias, else last part). */
export function selectItemName(text: string, item: SelectItem): string | undefined {
    if (item.alias !== undefined) {
        return item.alias;
    }
    if (item.isStar) {
        return undefined;
    }
    const raw = text.slice(item.span.start, item.span.end).trim();
    // Simple trailing identifier of a dotted chain; anything else is unnameable.
    const match = /(?:^|\.)\s*(\[?[A-Za-z_][A-Za-z0-9_$]*\]?)\s*$/.exec(raw);
    if (match === null) {
        return undefined;
    }
    return match[1].replace(/^\[|\]$/g, "");
}
