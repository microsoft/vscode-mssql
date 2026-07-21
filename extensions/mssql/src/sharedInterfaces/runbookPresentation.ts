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

export const LEGACY_PRESENTATION_SCHEMA_VERSION = 1 as const;
export const PRESENTATION_SCHEMA_VERSION = 2 as const;

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
    "workloadPreview/1": ["scalar-cards", "json"],
    "workloadResults/1": ["grid", "bar", "json"],
    "xeventSessionLease/1": ["scalar-cards", "json"],
    "xeventCapture/1": ["scalar-cards", "json"],
    "xelArtifact/1": ["scalar-cards", "json"],
    "deploymentPreview/1": ["log-view", "json"],
    "deploymentEvidence/1": ["scalar-cards", "json"],
    "schemaMutationEvidence/1": ["scalar-cards", "json"],
    "schemaDiff/1": ["diff", "log-view", "json"],
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

export type OutputFieldValueType = "string" | "number" | "boolean" | "dateTime" | "unknown";
export type OutputFieldRole = "category" | "measure" | "time" | "label";

/** Bounded authoring-time shape owned by a registered activity descriptor.
 * Absence means the activity's fields are known only after execution. */
export interface OutputSchemaDescriptor {
    fields: Array<{
        name: string;
        valueType: OutputFieldValueType;
        roles?: OutputFieldRole[];
    }>;
}

/** Deterministic authoring identity. Runtime-only shapes retain the legacy
 * contract fingerprint; known field descriptors add ordered names/types and
 * normalized roles so a catalog change becomes explicitly reviewable. */
export function outputSchemaFingerprint(contract: string, schema?: OutputSchemaDescriptor): string {
    if (!schema) {
        return contract;
    }
    return `schema-v1:${contract}:${JSON.stringify(
        schema.fields.map((field) => ({
            name: field.name,
            valueType: field.valueType,
            roles: [...(field.roles ?? [])].sort(),
        })),
    )}`;
}

export type ViewCandidateCompatibility = "compatible" | "conditional" | "incompatible";
export type ViewCandidateReason =
    | "runtime-shape-required"
    | "category-and-measure"
    | "time-and-measure"
    | "numeric-field-missing"
    | "category-field-missing"
    | "temporal-field-missing";

export interface ViewCandidateDescriptor {
    view: ViewKind;
    tier: ViewCandidateTier;
    score: number;
    compatibility: ViewCandidateCompatibility;
    reason?: ViewCandidateReason;
    requirements?: Array<{
        roles: OutputFieldRole[];
        valueTypes: OutputFieldValueType[];
    }>;
    bindings?: { categoryField?: string; timeField?: string; valueFields?: string[] };
}

function baselineCandidateScore(view: ViewKind, tier: ViewCandidateTier): number {
    if (view === "timeseries") {
        return 0.88;
    }
    if (view === "bar") {
        return 0.78;
    }
    return tier === "recommended" ? 0.95 : tier === "fallback" ? 0.35 : 0.65;
}

export function viewCandidateTier(contract: string, view: ViewKind): ViewCandidateTier {
    const candidates = compatibleViews(contract);
    if (view === candidates[0]) {
        return "recommended";
    }
    return view === "json" ? "fallback" : "available";
}

/** Contract-first candidate computation refined only by catalog-owned field
 * descriptors. Unknown runtime rowsets remain selectable but conditional;
 * known impossible chart shapes are retained as disabled candidates. */
export function viewCandidates(
    contract: string,
    schema?: OutputSchemaDescriptor,
): ViewCandidateDescriptor[] {
    return compatibleViews(contract).map((view) => {
        const tier = viewCandidateTier(contract, view);
        const base: ViewCandidateDescriptor = {
            view,
            tier,
            score: baselineCandidateScore(view, tier),
            compatibility: "compatible",
            ...(view === "bar"
                ? {
                      requirements: [
                          {
                              roles: ["category", "label"] as OutputFieldRole[],
                              valueTypes: ["string", "boolean"] as OutputFieldValueType[],
                          },
                          {
                              roles: ["measure"] as OutputFieldRole[],
                              valueTypes: ["number"] as OutputFieldValueType[],
                          },
                      ],
                  }
                : view === "timeseries"
                  ? {
                        requirements: [
                            {
                                roles: ["time"] as OutputFieldRole[],
                                valueTypes: ["dateTime"] as OutputFieldValueType[],
                            },
                            {
                                roles: ["measure"] as OutputFieldRole[],
                                valueTypes: ["number"] as OutputFieldValueType[],
                            },
                        ],
                    }
                  : {}),
        };
        if (view !== "bar" && view !== "timeseries") {
            return base;
        }
        if (!schema) {
            return { ...base, compatibility: "conditional", reason: "runtime-shape-required" };
        }
        const measures = schema.fields.filter(
            (field) => field.roles?.includes("measure") || field.valueType === "number",
        );
        if (measures.length === 0) {
            return {
                ...base,
                score: 0,
                compatibility: "incompatible",
                reason: "numeric-field-missing",
            };
        }
        if (view === "bar") {
            const category = schema.fields.find(
                (field) =>
                    field.roles?.includes("category") ||
                    field.roles?.includes("label") ||
                    field.valueType === "string" ||
                    field.valueType === "boolean",
            );
            return category
                ? {
                      ...base,
                      reason: "category-and-measure",
                      bindings: {
                          categoryField: category.name,
                          valueFields: measures.map((field) => field.name),
                      },
                  }
                : {
                      ...base,
                      score: 0,
                      compatibility: "incompatible",
                      reason: "category-field-missing",
                  };
        }
        const time = schema.fields.find(
            (field) => field.roles?.includes("time") || field.valueType === "dateTime",
        );
        return time
            ? {
                  ...base,
                  reason: "time-and-measure",
                  bindings: {
                      timeField: time.name,
                      valueFields: measures.map((field) => field.name),
                  },
              }
            : {
                  ...base,
                  score: 0,
                  compatibility: "incompatible",
                  reason: "temporal-field-missing",
              };
    });
}

export function isViewCandidateSelectable(
    contract: string,
    view: ViewKind,
    schema?: OutputSchemaDescriptor,
): boolean {
    return (
        viewCandidates(contract, schema).find((candidate) => candidate.view === view)
            ?.compatibility !== "incompatible" && compatibleViews(contract).includes(view)
    );
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
    "dacpac.extract": "dacpacArtifact/1",
    "sandbox.provision": "databaseLease/1",
    "devdatabase.provision": "databaseLease/1",
    "sql.container.provision": "databaseLease/1",
    "sql.workload.inspect": "workloadPreview/1",
    "dacpac.deploy.preview": "deploymentPreview/1",
    "dacpac.deploy": "deploymentEvidence/1",
    "dacpac.deploy.dev": "deploymentEvidence/1",
    "dacpac.deploy.container": "deploymentEvidence/1",
    "sql.schema.apply": "schemaMutationEvidence/1",
    "xevent.session.start": "xeventSessionLease/1",
    "sql.workload.run": "workloadResults/1",
    "xevent.session.stop": "xeventCapture/1",
    "xevent.xel.collect": "xelArtifact/1",
    "schema.compare": "schemaDiff/1",
    "schema.compare.export": "schemaDiff/1",
    "sqltest.run": "testResults/1",
    "sandbox.dispose": "cleanupEvidence/1",
    "sql.container.dispose": "cleanupEvidence/1",
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
// Persisted definition (lives in the artifact's `presentation` section).
// V2 follows the rendering specification's semantic grammar: source bindings
// are separate from sections, a widget can own multiple views, and layout is
// expressed as responsive spans rather than pixels. The legacy V1 shape is
// retained only as an input contract for deterministic migration.
// ---------------------------------------------------------------------------

export interface LegacyPresentationSourceRef {
    nodeId: string;
    outputIndex?: number;
}

export interface LegacyPresentationWidgetDefinition {
    id: string;
    source: LegacyPresentationSourceRef;
    view: ViewKind;
    title?: string;
    pinnedByUser?: boolean;
}

export interface LegacyPresentationSectionDefinition {
    id: string;
    title?: string;
    widgets: LegacyPresentationWidgetDefinition[];
}

export interface LegacyPresentationDefinition {
    schemaVersion: typeof LEGACY_PRESENTATION_SCHEMA_VERSION;
    revision: number;
    sections: LegacyPresentationSectionDefinition[];
}

/** Stable semantic source identity; never references a concrete data handle. */
export type RunFieldName =
    | "status"
    | "verdict"
    | "elapsedMs"
    | "warningCount"
    | "errorCount"
    | "completedNodeCount"
    | "totalNodeCount";

export const RUN_FIELD_NAMES: readonly RunFieldName[] = [
    "status",
    "verdict",
    "elapsedMs",
    "warningCount",
    "errorCount",
    "completedNodeCount",
    "totalNodeCount",
];

export type PresentationSourceRef =
    | { kind: "activity-output"; nodeId: string; slot: string }
    | { kind: "run-field"; field: RunFieldName }
    | { kind: "run-metric"; key: string }
    | { kind: "derived"; sourceId: string };

export type SortSpec = { field: string; direction: "asc" | "desc" };

interface BaseViewSpec {
    id: string;
    label?: string;
    title?: string;
    description?: string;
}

export type ViewSpec =
    | (BaseViewSpec & {
          kind: "grid";
          props: {
              columns?: string[];
              sort?: SortSpec[];
              pageSize?: number;
              density?: "compact" | "comfortable";
          };
      })
    | (BaseViewSpec & {
          kind: "timeseries";
          props: {
              timeField: string;
              valueFields: string[];
              seriesField?: string;
              interpolation?: "linear" | "step";
              yAxis?: "zero-based" | "auto";
          };
      })
    | (BaseViewSpec & {
          kind: "bar";
          props: {
              categoryField: string;
              valueFields: string[];
              orientation?: "vertical" | "horizontal";
              sort?: "category" | "value-asc" | "value-desc" | "none";
              maxCategories?: number;
          };
      })
    | (BaseViewSpec & {
          kind: "scalar-cards";
          props: { fields?: string[]; columns?: 1 | 2 | 3 | 4 };
      })
    | (BaseViewSpec & {
          kind: "er-diagram";
          props: {
              showTypes?: boolean;
              showRelationshipLabels?: boolean;
              initialLayout?: "hierarchical" | "force";
          };
      })
    | (BaseViewSpec & {
          kind: "diff";
          props: { mode?: "side-by-side" | "unified"; groupBySeverity?: boolean };
      })
    | (BaseViewSpec & {
          kind: "diagnostics";
          props: { groupBy?: "severity" | "code" | "file"; showResolved?: boolean };
      })
    | (BaseViewSpec & {
          kind: "form";
          props: { mode: "review" | "edit" | "create"; submitLabel?: string };
      })
    | (BaseViewSpec & {
          kind: "markdown";
          props: { allowLinks?: boolean; allowImages?: boolean };
      })
    | (BaseViewSpec & {
          kind: "json";
          props: { initiallyExpandedDepth?: number };
      })
    | (BaseViewSpec & {
          kind: "log-view";
          props: { follow?: boolean; wrap?: boolean; severityField?: string };
      })
    | (BaseViewSpec & {
          kind: "artifact-list";
          props: { showSize?: boolean; showMime?: boolean };
      });

export type PresentationMode =
    | { mode: "single" }
    | { mode: "tabs" }
    | { mode: "toggle" }
    | { mode: "split"; axis: "row" | "column" };

/** Closed, bounded subset of renderer settings exposed by native authoring.
 * Field bindings remain host-owned because they depend on the actual output
 * shape. A setting is only valid beneath its matching ViewKind key. */
export interface ViewRenderSettings {
    pageSize?: 25 | 50 | 100;
    density?: "compact" | "comfortable";
    orientation?: "vertical" | "horizontal";
    sort?: "category" | "value-asc" | "value-desc" | "none";
    maxCategories?: number;
    interpolation?: "linear" | "step";
    yAxis?: "zero-based" | "auto";
    columns?: 1 | 2 | 3 | 4;
    wrap?: boolean;
}

export type OutputViewSettings = Partial<Record<ViewKind, ViewRenderSettings>>;

/** Bounded authoring projection used by the Plan page. Source internals and
 * shape-dependent field bindings stay in the host-owned full definition. */
export interface OutputPresentationSummary {
    widgetId: string;
    views: ViewKind[];
    defaultView: ViewKind;
    presentation: PresentationMode;
    setByUser: boolean;
    sectionId: string;
    placement?: WidgetPlacement;
    hidden: boolean;
    settings?: OutputViewSettings;
    authoredContractFingerprint: string;
}

/** Source-aware persisted widget projection used by Results/Preview layout
 * authoring. Activity-output summaries remain separately keyed by node id
 * for the Plan page's slot editor. */
export interface PresentationWidgetSummary {
    layoutId: string;
    widgetId: string;
    source: PresentationSourceRef;
    defaultView: ViewKind;
    sectionId: string;
    placement?: WidgetPlacement;
    hidden: boolean;
    /** Present for derived widgets so the closed transform can participate
     * in staged editing and three-way conflict detection. */
    derivedSource?: DerivedSourceAuthoringEdit;
}

/** A user-authored output layout must be reviewed when the registered field
 * descriptor no longer matches the descriptor it was authored against.
 * Default-derived layouts remain safe to refresh automatically. */
export function outputPresentationNeedsReview(
    summary: OutputPresentationSummary | undefined,
    expectedFingerprint: string,
): boolean {
    return (
        summary?.setByUser === true && summary.authoredContractFingerprint !== expectedFingerprint
    );
}

/** Closed, provenance-free authoring projection. The host supplies user
 * provenance and validates the complete definition before preview or save. */
export interface DerivedSourceAuthoringEdit {
    id: string;
    from: PresentationSourceRef;
    pipeline: TransformPipeline;
    authoredContract: string;
}

export interface PresentationLayoutEdit {
    /** Omitted by legacy/activity-output callers; the host then resolves the
     * conventional primary output for `nodeId`. */
    source?: PresentationSourceRef;
    nodeId: string;
    widgetId?: string;
    defaultView: ViewKind;
    sectionId: string;
    placement: WidgetPlacement;
    hidden: boolean;
    /** Upserts the derived source used by this widget in the same staged
     * presentation transaction. Only valid for a matching derived source. */
    derivedSource?: DerivedSourceAuthoringEdit;
    /** Present with `derivedSource` when its identifier replaces this prior
     * identifier. The host retargets dependent sources and the widget
     * atomically after validating the complete graph. */
    renameDerivedSourceFrom?: string;
    /** Removes this derived source and its widget in the same staged
     * transaction. The host refuses removal while another derived source
     * depends on it. */
    removeDerivedSourceId?: string;
}

export type PresentationLayoutStrategy = "flow" | "stacked" | "grid";

/** Semantic page-level layout edit. The host derives the lower-level
 * document/dashboard flow from this closed strategy rather than accepting
 * arbitrary CSS or pixel geometry from the webview. */
export interface PresentationLayoutPolicyEdit {
    strategy: PresentationLayoutStrategy;
}

export type PresentationProvenance =
    | { by: "default" }
    | { by: "ai"; promptSpan?: string; modelLabel?: string }
    | { by: "user"; actor?: string; previous?: ViewKind }
    | { by: "migration"; fromSchemaVersion: number };

export type VisibilityPolicy =
    | { when: "never" }
    | { when: "always" }
    | { when: "source-ready" }
    | { when: "source-non-empty" }
    | { when: "run-complete" }
    | { when: "verdict"; values: Array<"pass" | "warn" | "fail"> };

export interface ResponsiveSpan {
    compact?: number;
    medium?: number;
    wide?: number;
}

export interface WidgetPlacement {
    order: number;
    span?: ResponsiveSpan;
    minHeight?: "short" | "medium" | "tall";
    priority?: "primary" | "normal" | "supporting";
}

export interface WidgetBinding {
    id: string;
    source: PresentationSourceRef;
    views: ViewSpec[];
    presentation: PresentationMode;
    defaultViewId: string;
    sectionId: string;
    placement?: WidgetPlacement;
    visibility?: VisibilityPolicy;
    authoredContract: string;
    authoredContractFingerprint: string;
    provenance: PresentationProvenance;
}

export type SectionRole =
    | "hero"
    | "summary"
    | "primary"
    | "secondary"
    | "details"
    | "appendix"
    | "overflow";

export interface SectionDefinition {
    id: string;
    label?: string;
    role: SectionRole;
    order: number;
    collapsible?: boolean;
    collapsedByDefault?: boolean;
    whenEmpty: "collapse" | "show-empty-state" | "reserve";
}

export interface BreakpointDefinition {
    name: "compact" | "medium" | "wide";
    minWidth: number;
    columns: number;
    gap: number;
}

export interface ResponsiveLayoutPolicy {
    breakpoints: BreakpointDefinition[];
    overflowSectionId: string;
    defaultSpan: ResponsiveSpan;
    sectionFlow: "document" | "dashboard";
    /** Optional for persisted schema-v2 compatibility. Older definitions
     * derive Flow from document and Grid from dashboard. */
    strategy?: PresentationLayoutStrategy;
}

export interface ResultsSurfaceDefinition {
    sections: SectionDefinition[];
    widgets: WidgetBinding[];
    layout: ResponsiveLayoutPolicy;
    emptyState?: { title: string; body?: string; suggestedAction?: string };
}

export interface DerivedSourceDefinition {
    id: string;
    from: PresentationSourceRef;
    /** Execution lands in a later slice; the persisted language is already
     * closed and typed so it cannot smuggle renderer code or side effects. */
    pipeline: TransformPipeline;
    authoredContract: string;
    provenance: PresentationProvenance;
}

export type JsonScalar = string | number | boolean | null;

export interface TransformPipeline {
    steps: TransformOp[];
}

export type TransformOp =
    | { op: "select"; columns: string[] }
    | { op: "rename"; columns: Record<string, string> }
    | { op: "filter"; predicate: PresentationPredicate }
    | { op: "sort"; by: SortSpec[] }
    | { op: "limit"; count: number }
    | { op: "aggregate"; by: string[]; measures: AggregateMeasure[] }
    | {
          op: "pivot";
          index: string[];
          column: string;
          value: string;
          reducer: AggregateFunction;
      }
    | { op: "to-timeseries"; timeField: string; measureFields: string[] };

export type PresentationPredicate =
    | {
          op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
          field: string;
          value: JsonScalar;
      }
    | { op: "in"; field: string; values: JsonScalar[] }
    | { op: "is-null" | "not-null"; field: string }
    | { op: "and" | "or"; children: PresentationPredicate[] }
    | { op: "not"; child: PresentationPredicate };

export type AggregateFunction = "sum" | "avg" | "min" | "max" | "count" | "count-distinct";

export interface AggregateMeasure {
    field?: string;
    fn: AggregateFunction;
    as: string;
}

export interface PresentationDefinition {
    schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
    revision: number;
    authoredForPlanRevision: string;
    registryVersion: string;
    results: ResultsSurfaceDefinition;
    derivedSources: DerivedSourceDefinition[];
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
    /** Stable semantic source used by generalized layout authoring. */
    source?: PresentationSourceRef;
    state: ResolvedWidgetState;
    /** The view that will actually render (may be a drift fallback). */
    view: ViewKind;
    /** V2 authored views in stable order. The scalar `view` above remains the
     *  active/default compatibility projection consumed by current widgets. */
    views: Array<{
        id: string;
        kind: ViewKind;
        title?: string;
        issue?: ViewIssue;
        settings?: ViewRenderSettings;
    }>;
    presentation: PresentationMode;
    defaultViewId: string;
    /** View selected after per-view compatibility/drift resolution. */
    activeViewId: string;
    sectionId: string;
    placement?: WidgetPlacement;
    provenance: PresentationProvenance;
    /** Set when the pinned/requested view was incompatible with the actual
     *  output contract and a fallback was substituted (visible degrade). */
    drift?: { requestedView: ViewKind; reason: "contractIncompatible" };
    /** Data handle to pull pages through the controller (state === ready). */
    handleId?: string;
    /** Host-resolved derived source identity. Page requests send only this
     * identity; the extension host reloads the trusted pipeline from the
     * current presentation definition instead of accepting transform code
     * from the webview. */
    derivedSourceId?: string;
    /** Opaque extension-host identity for the exact staged definition used
     * to resolve a derived preview. Never contains transform code. */
    derivedPreviewId?: string;
    contract?: string;
    rows?: number;
    /** Bounded structural metadata for a `run-field` source. This is not an
     * activity result payload and never creates a result-store handle. */
    runField?: { field: RunFieldName; value: string | number };
    /** Bounded scalar selected from the durable run metric map. */
    runMetric?: { key: string; value: string | number | boolean };
}

export interface ResolvedSection {
    id: string;
    title: string;
    role: SectionRole;
    order: number;
    whenEmpty: SectionDefinition["whenEmpty"];
    widgets: ResolvedWidget[];
}

export interface ViewIssue {
    viewId: string;
    code:
        | "CONTRACT_KIND_CHANGED"
        | "FIELD_MISSING"
        | "FIELD_TYPE_CHANGED"
        | "ACTION_UNAVAILABLE"
        | "RENDERER_UNAVAILABLE";
    message: string;
    fallbackViewId?: string;
}

export interface ResolvedPresentation {
    schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
    /** Definition revision this resolution was computed from (0 = derived). */
    revision: number;
    /** True when no persisted definition existed and the layout was derived
     *  from the run snapshot's typed outputs. */
    derived: boolean;
    layout: ResponsiveLayoutPolicy;
    /** Authored copy for sections whose `whenEmpty` policy requests an
     * explicit empty state. Suggested actions are descriptive only. */
    emptyState?: ResultsSurfaceDefinition["emptyState"];
    sections: ResolvedSection[];
}
