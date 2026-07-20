/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Presentation contracts (RBS2-9, rendering-spec first slice): ONE versioned
 * PresentationDefinition per runbook revision; a CLOSED semantic view
 * catalog; deterministic pure resolution (zero model calls); data handles,
 * never payload copies; per-view drift degrades visibly to a compatible
 * fallback — a widget never silently disappears and never renders blank.
 */

// ---------------------------------------------------------------------------
// Closed semantic view catalog (rendering spec §8.1). Adding a kind is a
// schema change; renderers register against these ids only.
// ---------------------------------------------------------------------------

export const PRESENTATION_SCHEMA_VERSION = 1;

export type ViewKind =
    | "grid"
    | "timeseries"
    | "bar"
    | "scalar-cards"
    | "er-diagram"
    | "diff"
    | "diagnostics"
    | "form"
    | "markdown"
    | "json"
    | "log-view"
    | "artifact-list";

/** Data contract -> compatible views, preference-ordered (first = default).
 *  `json` is the universal last-resort renderer for every contract. */
const COMPATIBILITY: Record<string, ViewKind[]> = {
    // Shape-specific renderers validate their stronger requirements after
    // the bounded page arrives. Keeping timeseries in the rowset candidate
    // set makes the already-shipped renderer reachable; it degrades visibly
    // to Grid when no time/monotonic X column exists.
    "rowset/1": ["grid", "bar", "timeseries", "json"],
    "scalarSet/1": ["scalar-cards", "grid", "json"],
    "markdown/1": ["markdown", "json"],
    "log/1": ["log-view", "json"],
    "diagnostics/1": ["diagnostics", "grid", "json"],
    "artifactList/1": ["artifact-list", "grid", "json"],
    "workspaceSnapshot/1": ["scalar-cards", "json"],
    "testSuiteDiscovery/1": ["grid", "json"],
    "dacpacArtifact/1": ["scalar-cards", "json"],
    "databaseLease/1": ["scalar-cards", "json"],
    "deploymentPreview/1": ["log-view", "json"],
    "deploymentEvidence/1": ["scalar-cards", "json"],
    "schemaDiff/1": ["log-view", "json"],
    "testResults/1": ["grid", "bar", "json"],
    "cleanupEvidence/1": ["scalar-cards", "json"],
    "evidenceBundle/1": ["log-view", "json"],
};

export function compatibleViews(contract: string): ViewKind[] {
    return COMPATIBILITY[contract] ?? ["json"];
}

/** Authoring-time candidate rank used by native editors. This is semantic
 *  metadata, not visual styling: the first compatible view is recommended,
 *  JSON is the total fallback when a richer view exists, and every other
 *  compatible renderer is an available alternative. */
export type ViewCandidateTier = "recommended" | "available" | "fallback";

export function viewCandidateTier(contract: string, view: ViewKind): ViewCandidateTier {
    const candidates = compatibleViews(contract);
    if (view === candidates[0]) {
        return "recommended";
    }
    return view === "json" ? "fallback" : "available";
}

/** Authoring-time expected output contract per activity kind (the actual
 *  contract is only known at run time; mockup state "Auto until run"). */
export const ACTIVITY_OUTPUT_CONTRACTS: Record<string, string> = {
    "sql.query.read": "rowset/1",
    "assert.threshold": "scalarSet/1",
    "workspace.inspect": "workspaceSnapshot/1",
    "sqltest.discover": "testSuiteDiscovery/1",
    "tsqlt.run": "testResults/1",
    "dacpac.build": "dacpacArtifact/1",
    "sandbox.provision": "databaseLease/1",
    "dacpac.deploy.preview": "deploymentPreview/1",
    "dacpac.deploy": "deploymentEvidence/1",
    "schema.compare": "schemaDiff/1",
    "sqltest.run": "testResults/1",
    "sandbox.dispose": "cleanupEvidence/1",
    "evidence.bundle": "evidenceBundle/1",
};

/** Expected contract for a plan node at authoring time; report nodes render
 *  markdown, gates produce no output (undefined). */
export function expectedContractFor(
    kind: "activity" | "gate" | "report",
    activityKind: string | undefined,
): string | undefined {
    if (kind === "report") {
        return "markdown/1";
    }
    if (kind === "gate") {
        return undefined;
    }
    return activityKind ? ACTIVITY_OUTPUT_CONTRACTS[activityKind] : undefined;
}

export function defaultViewFor(contract: string): ViewKind {
    return compatibleViews(contract)[0];
}

export function isViewCompatible(contract: string, view: ViewKind): boolean {
    return compatibleViews(contract).includes(view);
}

// ---------------------------------------------------------------------------
// Persisted definition (lives in the artifact's `presentation` section)
// ---------------------------------------------------------------------------

/** Stable source identity: a node's nth output. Survives replays and
 *  reformatting; never references a concrete handle id. */
export interface PresentationSourceRef {
    nodeId: string;
    /** Index into the node's outputs (default 0). */
    outputIndex?: number;
}

export interface PresentationWidgetDefinition {
    /** Stable widget identity (user pins and patches reference it). */
    id: string;
    source: PresentationSourceRef;
    /** Chosen view; validated against the source contract at resolve time. */
    view: ViewKind;
    title?: string;
    /** True when the user explicitly chose the view — survives AI rebinding
     *  and is preserved through drift fallback (flag stays, view degrades). */
    pinnedByUser?: boolean;
}

export interface PresentationSectionDefinition {
    id: string;
    title?: string;
    widgets: PresentationWidgetDefinition[];
}

export interface PresentationDefinition {
    schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
    /** Monotonic revision; patches apply atomically against a base revision. */
    revision: number;
    sections: PresentationSectionDefinition[];
}

// ---------------------------------------------------------------------------
// Resolved render model (host -> webview; deterministic, payload-free)
// ---------------------------------------------------------------------------

/** Every widget resolves to exactly one explicit state — total layout. */
export type ResolvedWidgetState = "ready" | "pending" | "noOutput" | "expired" | "sourceMissing";

export interface ResolvedWidget {
    id: string;
    title: string;
    nodeId: string;
    state: ResolvedWidgetState;
    /** The view that will actually render (may be a drift fallback). */
    view: ViewKind;
    /** Set when the pinned/requested view was incompatible with the actual
     *  output contract and a fallback was substituted (visible degrade). */
    drift?: { requestedView: ViewKind; reason: "contractIncompatible" };
    /** Data handle to pull pages through the controller (state === ready). */
    handleId?: string;
    contract?: string;
    rows?: number;
}

export interface ResolvedSection {
    id: string;
    title: string;
    widgets: ResolvedWidget[];
}

export interface ResolvedPresentation {
    schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
    /** Definition revision this resolution was computed from (0 = derived). */
    revision: number;
    /** True when no persisted definition existed and the layout was derived
     *  from the run snapshot's typed outputs. */
    derived: boolean;
    sections: ResolvedSection[];
}
