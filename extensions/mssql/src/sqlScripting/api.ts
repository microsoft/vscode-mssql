/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript scripting engine contract (language-service design 05 §13.1,
 * B12/LS-4). The engine scripts catalog objects from pinned metadata:
 * module text (views/procedures/functions) with token-level CREATE→ALTER /
 * CREATE OR ALTER head rewrites, synthesized CREATE TABLE at explicit
 * fidelity levels (§13.2), and DML templates. Every result carries anchors
 * (emitted-script regions for logical elements) and fidelity notes (what the
 * script could NOT include). When no honest script exists (encrypted or
 * permission-hidden definitions, metadata not loaded) the result is an
 * explanatory comment plus a structured `unavailableReason` — never a
 * fabricated body (§13.3 honesty).
 *
 * Pure: no vscode, no node builtins, no I/O beyond the provider seam's
 * sanctioned lazy getDefinition (lint-enforced alongside sqlLanguage).
 */

import { LangObjectKind, LangObjectRef } from "../sqlLanguage/provider/types";

export type ScriptOperation =
    | "create"
    | "alter"
    | "createOrAlter"
    | "drop"
    | "dropAndCreate"
    | "selectTop"
    | "insert"
    | "update"
    | "delete"
    | "execute";

/** Fidelity levels per design §13.2 (F3 requires round-trip proof — later). */
export type ScriptFidelity = "F0" | "F1" | "F2";

export type ScriptUnavailableReason =
    | "encrypted"
    | "permission"
    | "unsupported"
    | "notLoaded"
    | "notValidated"
    | "offline";

/**
 * Snapshot provenance for the metadata generation a script is produced from
 * (cache/drift addendum §7.5 — normative). Populated HOST-side from the
 * FreshCatalogResult used to pin the snapshot and handed INTO the engine as
 * request data (the diagnostics-verdict pattern, CACHE-5), so the honest
 * refusal (freshness "unavailable"), the §16.3 offline banner, and
 * telemetry all derive from ONE source of truth and can never disagree.
 * The string unions mirror FreshCatalogResult structurally — the pure
 * engine never imports from services/**.
 */
export interface ScriptMetadataProvenance {
    readonly generation: number;
    /** Canonical snapshot content hash (addendum C-2), when known. */
    readonly contentHash?: string;
    /** "none" ⇔ no snapshot backed the freshness decision. */
    readonly source: "memory" | "disk" | "live" | "offline" | "none";
    readonly freshness: "live" | "validated" | "stale" | "refreshing" | "unavailable";
    readonly capturedAtUtc?: string;
}

export interface ScriptTarget {
    readonly ref: LangObjectRef;
}

export interface ScriptRequest {
    readonly target: ScriptTarget;
    readonly operation: ScriptOperation;
    /**
     * CACHE-6 strict flow: the host's ensureFresh verdict. Absent = a
     * consumer outside the strict flow (definition/peek keeps its own
     * honesty ladder); results then carry no provenance and no banner.
     */
    readonly provenance?: ScriptMetadataProvenance;
}

/** Emitted-script span in UTF-16 code units (start inclusive, end exclusive). */
export interface ScriptTextSpan {
    readonly start: number;
    readonly end: number;
}

/** Logical element an anchor points at (names appear in the script anyway). */
export type ScriptSymbolRef =
    | { readonly kind: "header" }
    | { readonly kind: "objectName" }
    | { readonly kind: "column"; readonly name: string }
    | { readonly kind: "parameter"; readonly name: string }
    | { readonly kind: "constraint"; readonly name: string }
    | { readonly kind: "foreignKey"; readonly name: string };

export interface ScriptAnchor {
    readonly symbol: ScriptSymbolRef;
    readonly span: ScriptTextSpan;
    /** Zero-based line/character of the span start in the emitted text. */
    readonly line: number;
    readonly character: number;
}

export interface ScriptResult {
    readonly text: string;
    readonly anchors: readonly ScriptAnchor[];
    /** What the script could NOT include (rendered as header comments too). */
    readonly fidelityNotes: readonly string[];
    readonly fidelity: ScriptFidelity;
    readonly source: "catalogDefinition" | "synthesized" | "template" | "localDocument";
    readonly metadataGeneration: number;
    readonly operation: ScriptOperation;
    readonly objectKind: LangObjectKind;
    /** Set when no honest script exists; text is an explanatory comment. */
    readonly unavailableReason?: ScriptUnavailableReason;
    /**
     * Provenance of the metadata this script was generated from (addendum
     * §7.5): the request's provenance echoed verbatim. When source is
     * "offline" (and a script was produced) the text carries the §16.3
     * offline banner rendered from these same fields.
     */
    readonly provenance?: ScriptMetadataProvenance;
}

export interface SqlScriptingService {
    script(request: ScriptRequest): Promise<ScriptResult>;
    capabilities(target: ScriptTarget): readonly ScriptOperation[];
}
