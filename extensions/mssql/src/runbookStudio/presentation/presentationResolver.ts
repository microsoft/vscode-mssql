/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure presentation resolver. Persisted V1 definitions are migrated to the
 * semantic V2 grammar at the validation boundary; every writer therefore
 * emits V2 while existing library and source-controlled artifacts continue
 * to render. Resolution remains deterministic, payload-free, and total.
 */

import {
    compatibleViews,
    defaultViewFor,
    DerivedSourceDefinition,
    isViewCompatible,
    LegacyPresentationDefinition,
    OutputSchemaDescriptor,
    OutputPresentationSummary,
    OutputViewSettings,
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationDefinition,
    PresentationMode,
    RunFieldName,
    PRESENTATION_SCHEMA_VERSION,
    ResolvedPresentation,
    ResolvedSection,
    ResolvedWidget,
    ResponsiveLayoutPolicy,
    SectionDefinition,
    SectionRole,
    ViewIssue,
    ViewKind,
    ViewRenderSettings,
    ViewSpec,
    viewCandidates,
    WidgetBinding,
    TransformPipeline,
} from "../../sharedInterfaces/runbookPresentation";
import {
    DataHandleRef,
    RunbookNodeSnapshot,
    RunbookRunSnapshot,
} from "../../sharedInterfaces/runbookStudio";
import { isTerminalNodeState, isTerminalRunState } from "../runbookRunModel";
import { validateTransformPipeline } from "./presentationTransforms";

const VIEW_KINDS: ReadonlySet<string> = new Set<ViewKind>([
    "grid",
    "timeseries",
    "bar",
    "scalar-cards",
    "er-diagram",
    "diff",
    "diagnostics",
    "form",
    "markdown",
    "json",
    "log-view",
    "artifact-list",
]);
const RUN_FIELDS: ReadonlySet<string> = new Set<RunFieldName>([
    "status",
    "verdict",
    "elapsedMs",
    "warningCount",
    "errorCount",
    "completedNodeCount",
    "totalNodeCount",
]);
const SECTION_ROLES: ReadonlySet<string> = new Set<SectionRole>([
    "hero",
    "summary",
    "primary",
    "secondary",
    "details",
    "appendix",
    "overflow",
]);
const PROVENANCE_KINDS = new Set(["default", "ai", "user", "migration"]);
const MAX_DERIVED_SOURCES = 100;
const MAX_COMPOSED_TRANSFORM_STEPS = 20;

export const DEFAULT_PRESENTATION_LAYOUT: ResponsiveLayoutPolicy = {
    breakpoints: [
        { name: "compact", minWidth: 0, columns: 1, gap: 8 },
        { name: "medium", minWidth: 640, columns: 6, gap: 10 },
        { name: "wide", minWidth: 1000, columns: 12, gap: 12 },
    ],
    overflowSectionId: "overflow",
    defaultSpan: { compact: 1, medium: 6, wide: 12 },
    sectionFlow: "document",
    strategy: "flow",
};

function defaultDefinition(): PresentationDefinition {
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: 0,
        authoredForPlanRevision: "unknown",
        registryVersion: "2.0",
        results: {
            sections: defaultPresentationSections(),
            widgets: [],
            layout: DEFAULT_PRESENTATION_LAYOUT,
        },
        derivedSources: [],
    };
}

export function defaultPresentationSections(): SectionDefinition[] {
    return [
        defaultSection("summary", "summary", 0, "Summary"),
        defaultSection("primary", "primary", 1, "Primary"),
        defaultSection("details", "details", 2, "Details"),
        defaultSection("appendix", "appendix", 3, "Appendix"),
        defaultSection("overflow", "overflow", 4, "Overflow"),
    ];
}

function defaultSection(
    id: string,
    role: SectionRole,
    order: number,
    label?: string,
): SectionDefinition {
    return {
        id,
        ...(label ? { label } : {}),
        role,
        order,
        whenEmpty: "collapse",
    };
}

/** Trusted default spec construction. Shape-dependent settings deliberately
 * start empty; the renderer performs bounded runtime shape validation and
 * visibly degrades when required fields have not yet been authored. */
export function createViewSpec(kind: ViewKind, id = `view:${kind}`, title?: string): ViewSpec {
    const base = { id, ...(title ? { title } : {}) };
    switch (kind) {
        case "timeseries":
            return { ...base, kind, props: { timeField: "", valueFields: [] } };
        case "bar":
            return { ...base, kind, props: { categoryField: "", valueFields: [] } };
        case "form":
            return { ...base, kind, props: { mode: "review" } };
        default:
            return { ...base, kind, props: {} } as ViewSpec;
    }
}

/** Apply catalog-owned field bindings at an explicit authoring boundary.
 * Normal resolution deliberately does not call this helper: persisted user
 * mappings remain unchanged until the author reviews and saves them. */
export function applyOutputSchemaBindings(
    view: ViewSpec,
    contract: string,
    schema?: OutputSchemaDescriptor,
): ViewSpec {
    if (!schema) {
        return view;
    }
    const candidate = viewCandidates(contract, schema).find(
        (descriptor) => descriptor.view === view.kind,
    );
    if (candidate?.compatibility !== "compatible" || !candidate.bindings) {
        return view;
    }
    if (view.kind === "bar" && candidate.bindings.categoryField) {
        return {
            ...view,
            props: {
                ...view.props,
                categoryField: candidate.bindings.categoryField,
                valueFields: [...(candidate.bindings.valueFields ?? [])],
            },
        };
    }
    if (view.kind === "timeseries" && candidate.bindings.timeField) {
        return {
            ...view,
            props: {
                ...view.props,
                timeField: candidate.bindings.timeField,
                valueFields: [...(candidate.bindings.valueFields ?? [])],
            },
        };
    }
    return view;
}

function compactSettings(settings: ViewRenderSettings): ViewRenderSettings | undefined {
    const entries = Object.entries(settings).filter(([, value]) => value !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Project only settings that the native renderer currently honors. Shape
 * bindings (columns/fields) deliberately never cross this authoring API. */
function rendererSettingsOf(view: ViewSpec): ViewRenderSettings | undefined {
    switch (view.kind) {
        case "grid":
            return compactSettings({
                pageSize:
                    view.props.pageSize === 25 ||
                    view.props.pageSize === 50 ||
                    view.props.pageSize === 100
                        ? view.props.pageSize
                        : undefined,
                density: view.props.density,
            });
        case "bar":
            return compactSettings({
                orientation: view.props.orientation,
                sort: view.props.sort,
                maxCategories: view.props.maxCategories,
            });
        case "timeseries":
            return compactSettings({
                interpolation: view.props.interpolation,
                yAxis: view.props.yAxis,
            });
        case "scalar-cards":
            return compactSettings({ columns: view.props.columns });
        case "log-view":
            return compactSettings({ wrap: view.props.wrap });
        default:
            return undefined;
    }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

/** Validate the untrusted webview settings envelope. This is intentionally
 * stricter than the persisted ViewSpec validator: unknown keys, settings for
 * an unselected view, and unbounded numbers are rejected atomically. */
export function validateOutputViewSettings(
    raw: unknown,
    selectedViews: ViewKind[],
): raw is OutputViewSettings {
    if (!isRecord(raw)) {
        return false;
    }
    for (const [kind, candidate] of Object.entries(raw)) {
        if (
            !VIEW_KINDS.has(kind) ||
            !selectedViews.includes(kind as ViewKind) ||
            !isRecord(candidate)
        ) {
            return false;
        }
        switch (kind as ViewKind) {
            case "grid":
                if (
                    !hasOnlyKeys(candidate, ["pageSize", "density"]) ||
                    (candidate.pageSize !== undefined &&
                        candidate.pageSize !== 25 &&
                        candidate.pageSize !== 50 &&
                        candidate.pageSize !== 100) ||
                    (candidate.density !== undefined &&
                        candidate.density !== "compact" &&
                        candidate.density !== "comfortable")
                ) {
                    return false;
                }
                break;
            case "bar":
                if (
                    !hasOnlyKeys(candidate, ["orientation", "sort", "maxCategories"]) ||
                    (candidate.orientation !== undefined &&
                        candidate.orientation !== "vertical" &&
                        candidate.orientation !== "horizontal") ||
                    (candidate.sort !== undefined &&
                        candidate.sort !== "category" &&
                        candidate.sort !== "value-asc" &&
                        candidate.sort !== "value-desc" &&
                        candidate.sort !== "none") ||
                    (candidate.maxCategories !== undefined &&
                        (!Number.isInteger(candidate.maxCategories) ||
                            (candidate.maxCategories as number) < 5 ||
                            (candidate.maxCategories as number) > 50))
                ) {
                    return false;
                }
                break;
            case "timeseries":
                if (
                    !hasOnlyKeys(candidate, ["interpolation", "yAxis"]) ||
                    (candidate.interpolation !== undefined &&
                        candidate.interpolation !== "linear" &&
                        candidate.interpolation !== "step") ||
                    (candidate.yAxis !== undefined &&
                        candidate.yAxis !== "zero-based" &&
                        candidate.yAxis !== "auto")
                ) {
                    return false;
                }
                break;
            case "scalar-cards":
                if (
                    !hasOnlyKeys(candidate, ["columns"]) ||
                    (candidate.columns !== undefined &&
                        candidate.columns !== 1 &&
                        candidate.columns !== 2 &&
                        candidate.columns !== 3 &&
                        candidate.columns !== 4)
                ) {
                    return false;
                }
                break;
            case "log-view":
                if (
                    !hasOnlyKeys(candidate, ["wrap"]) ||
                    (candidate.wrap !== undefined && typeof candidate.wrap !== "boolean")
                ) {
                    return false;
                }
                break;
            default:
                // Other renderers do not yet expose native settings.
                return false;
        }
    }
    return true;
}

function applyRendererSettings(view: ViewSpec, settings: ViewRenderSettings | undefined): ViewSpec {
    if (!settings) {
        return view;
    }
    switch (view.kind) {
        case "grid":
            return {
                ...view,
                props: { ...view.props, pageSize: settings.pageSize, density: settings.density },
            };
        case "bar":
            return {
                ...view,
                props: {
                    ...view.props,
                    orientation: settings.orientation,
                    sort: settings.sort,
                    maxCategories: settings.maxCategories,
                },
            };
        case "timeseries":
            return {
                ...view,
                props: {
                    ...view.props,
                    interpolation: settings.interpolation,
                    yAxis: settings.yAxis,
                },
            };
        case "scalar-cards":
            return { ...view, props: { ...view.props, columns: settings.columns } };
        case "log-view":
            return { ...view, props: { ...view.props, wrap: settings.wrap } };
        default:
            return view;
    }
}

function roleForLegacySection(id: string, index: number): SectionRole {
    switch (id.toLowerCase()) {
        case "hero":
        case "summary":
        case "primary":
        case "secondary":
        case "details":
        case "appendix":
        case "overflow":
            return id.toLowerCase() as SectionRole;
        case "main":
            return "primary";
        default:
            return index === 0 ? "primary" : "details";
    }
}

/** Deterministic, lossless-for-V1 migration. The old selected view becomes a
 * single V2 view and old user pins become user provenance. */
export function migrateLegacyPresentationDefinition(
    legacy: LegacyPresentationDefinition,
): PresentationDefinition {
    const sections = legacy.sections.map((section, index) =>
        defaultSection(section.id, roleForLegacySection(section.id, index), index, section.title),
    );
    if (!sections.some((section) => section.id === "overflow")) {
        sections.push(defaultSection("overflow", "overflow", sections.length));
    }
    for (const standard of defaultPresentationSections()) {
        if (!sections.some((section) => section.role === standard.role)) {
            sections.push({ ...standard, order: sections.length });
        }
    }
    const widgets: WidgetBinding[] = legacy.sections.flatMap((section) =>
        section.widgets.map((widget, index) => {
            const viewId = `${widget.id}:${widget.view}`;
            return {
                id: widget.id,
                source: {
                    kind: "activity-output" as const,
                    nodeId: widget.source.nodeId,
                    slot:
                        (widget.source.outputIndex ?? 0) === 0
                            ? "primary"
                            : `legacy:${widget.source.outputIndex}`,
                },
                views: [createViewSpec(widget.view, viewId, widget.title)],
                presentation: { mode: "single" as const },
                defaultViewId: viewId,
                sectionId: section.id,
                placement: { order: index },
                authoredContract: "unknown/1",
                authoredContractFingerprint: "legacy:unknown",
                provenance: widget.pinnedByUser
                    ? ({ by: "user" } as const)
                    : ({ by: "migration", fromSchemaVersion: 1 } as const),
            };
        }),
    );
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: legacy.revision,
        authoredForPlanRevision: "unknown",
        registryVersion: "2.0",
        results: {
            sections,
            widgets,
            layout: { ...DEFAULT_PRESENTATION_LAYOUT },
        },
        derivedSources: [],
    };
}

/** Pin (or clear) the default view for a node's first output. This remains the
 * narrow edit used by today's Plan/Results UI. The full slot editor will use
 * a revision-checked V2 patch request for multi-view edits. */
export function upsertOutputPin(
    definition: PresentationDefinition | undefined,
    nodeId: string,
    view: ViewKind | undefined,
): PresentationDefinition {
    const base = definition ?? defaultDefinition();
    const pinId = `pin-${nodeId}`;
    let found = false;
    const widgets = base.results.widgets
        .map((widget): WidgetBinding | undefined => {
            if (
                widget.source.kind !== "activity-output" ||
                widget.source.nodeId !== nodeId ||
                widget.source.slot !== "primary"
            ) {
                return widget;
            }
            found = true;
            if (view === undefined) {
                return widget.id === pinId
                    ? undefined
                    : { ...widget, provenance: { by: "default" } };
            }
            const existing = widget.views.find((candidate) => candidate.kind === view);
            const selected = existing ?? createViewSpec(view, `${widget.id}:${view}`);
            const preserveMultiple =
                widget.views.length > 1 || widget.presentation.mode !== "single";
            return {
                ...widget,
                views: preserveMultiple
                    ? [...widget.views, ...(existing === undefined ? [selected] : [])]
                    : [selected],
                presentation: preserveMultiple ? widget.presentation : { mode: "single" },
                defaultViewId: selected.id,
                provenance: { by: "user", previous: defaultViewKind(widget) },
            };
        })
        .filter((widget): widget is WidgetBinding => widget !== undefined);

    const sections = [...base.results.sections];
    if (view !== undefined && !found) {
        let sectionId = sections.find((section) => section.role === "primary")?.id;
        if (!sectionId) {
            sectionId = "primary";
            sections.push(defaultSection(sectionId, "primary", sections.length));
        }
        const selected = createViewSpec(view, `${pinId}:${view}`);
        widgets.push({
            id: pinId,
            source: { kind: "activity-output", nodeId, slot: "primary" },
            views: [selected],
            presentation: { mode: "single" },
            defaultViewId: selected.id,
            sectionId,
            placement: {
                order: widgets.filter((widget) => widget.sectionId === sectionId).length,
            },
            authoredContract: "unknown/1",
            authoredContractFingerprint: "runtime:unknown",
            provenance: { by: "user" },
        });
    }

    return {
        ...base,
        revision: base.revision + 1,
        results: { ...base.results, sections, widgets },
    };
}

/** Replace a node's primary-output presentation with a validated V2
 * selection. Existing per-view settings survive when a kind stays selected. */
export function upsertOutputPresentation(
    definition: PresentationDefinition | undefined,
    nodeId: string,
    views: ViewKind[],
    presentation: PresentationMode,
    defaultView: ViewKind,
    settings?: OutputViewSettings,
    metadata?: {
        authoredContract?: string;
        authoredContractFingerprint?: string;
        outputSchema?: OutputSchemaDescriptor;
        planRevision?: string;
    },
): PresentationDefinition {
    const base = definition ?? defaultDefinition();
    const pinId = `pin-${nodeId}`;
    let found = false;
    const widgets = base.results.widgets.map((widget): WidgetBinding => {
        if (
            widget.source.kind !== "activity-output" ||
            widget.source.nodeId !== nodeId ||
            widget.source.slot !== "primary"
        ) {
            return widget;
        }
        found = true;
        const selected = views.map((kind) => {
            const view =
                widget.views.find((candidate) => candidate.kind === kind) ??
                createViewSpec(kind, `${widget.id}:${kind}`);
            return applyRendererSettings(
                applyOutputSchemaBindings(
                    view,
                    metadata?.authoredContract ?? widget.authoredContract,
                    metadata?.outputSchema,
                ),
                settings?.[kind],
            );
        });
        const defaultSpec = selected.find((candidate) => candidate.kind === defaultView)!;
        return {
            ...widget,
            views: selected,
            presentation,
            defaultViewId: defaultSpec.id,
            ...(metadata?.authoredContract
                ? {
                      authoredContract: metadata.authoredContract,
                      authoredContractFingerprint:
                          metadata.authoredContractFingerprint ?? metadata.authoredContract,
                  }
                : {}),
            provenance: { by: "user", previous: defaultViewKind(widget) },
        };
    });

    const sections = [...base.results.sections];
    if (!found) {
        let sectionId = sections.find((section) => section.role === "primary")?.id;
        if (!sectionId) {
            sectionId = "primary";
            sections.push(defaultSection(sectionId, "primary", sections.length));
        }
        const authoredContract = metadata?.authoredContract ?? "unknown/1";
        const selected = views.map((kind) =>
            applyRendererSettings(
                applyOutputSchemaBindings(
                    createViewSpec(kind, `${pinId}:${kind}`),
                    authoredContract,
                    metadata?.outputSchema,
                ),
                settings?.[kind],
            ),
        );
        const defaultSpec = selected.find((candidate) => candidate.kind === defaultView)!;
        widgets.push({
            id: pinId,
            source: { kind: "activity-output", nodeId, slot: "primary" },
            views: selected,
            presentation,
            defaultViewId: defaultSpec.id,
            sectionId,
            placement: {
                order: widgets.filter((widget) => widget.sectionId === sectionId).length,
            },
            authoredContract,
            authoredContractFingerprint:
                metadata?.authoredContractFingerprint ??
                metadata?.authoredContract ??
                "runtime:unknown",
            provenance: { by: "user" },
        });
    }

    return {
        ...base,
        revision: base.revision + 1,
        ...(metadata?.planRevision ? { authoredForPlanRevision: metadata.planRevision } : {}),
        results: { ...base.results, sections, widgets },
    };
}

/** Reset author overrides while preserving a hand-authored widget's layout.
 * Pin-created widgets can be removed entirely so normal derived presentation
 * takes over; migrated/authored widgets retain identity and placement. */
export function resetOutputPresentation(
    definition: PresentationDefinition,
    nodeId: string,
    suggestedView: ViewKind,
    metadata?: {
        authoredContract?: string;
        authoredContractFingerprint?: string;
        outputSchema?: OutputSchemaDescriptor;
        planRevision?: string;
    },
): PresentationDefinition {
    const pinId = `pin-${nodeId}`;
    const widgets = definition.results.widgets
        .map((widget): WidgetBinding | undefined => {
            if (
                widget.source.kind !== "activity-output" ||
                widget.source.nodeId !== nodeId ||
                widget.source.slot !== "primary"
            ) {
                return widget;
            }
            if (widget.id === pinId) {
                return undefined;
            }
            const retained =
                widget.views.find((candidate) => candidate.kind === suggestedView) ??
                createViewSpec(suggestedView, `${widget.id}:${suggestedView}`);
            const selected = applyOutputSchemaBindings(
                retained,
                metadata?.authoredContract ?? widget.authoredContract,
                metadata?.outputSchema,
            );
            return {
                ...widget,
                views: [selected],
                presentation: { mode: "single" },
                defaultViewId: selected.id,
                ...(metadata?.authoredContract
                    ? {
                          authoredContract: metadata.authoredContract,
                          authoredContractFingerprint:
                              metadata.authoredContractFingerprint ?? metadata.authoredContract,
                      }
                    : {}),
                provenance: { by: "default" },
            };
        })
        .filter((widget): widget is WidgetBinding => widget !== undefined);
    return {
        ...definition,
        revision: definition.revision + 1,
        ...(metadata?.planRevision ? { authoredForPlanRevision: metadata.planRevision } : {}),
        results: { ...definition.results, widgets },
    };
}

/** Apply one or more host-validated semantic layout edits atomically. Missing
 * bindings are materialized from their node/default-view identity so an
 * Overflow output can be intentionally placed or hidden. */
export function applyPresentationLayoutEdits(
    definition: PresentationDefinition | undefined,
    edits: PresentationLayoutEdit[],
    metadata?: {
        contractByNode?: Record<string, string>;
        fingerprintByNode?: Record<string, string>;
        outputSchemaByNode?: Record<string, OutputSchemaDescriptor>;
        planRevision?: string;
    },
    policy?: PresentationLayoutPolicyEdit,
): PresentationDefinition {
    const base = definition ?? defaultDefinition();
    const widgets = [...base.results.widgets];
    for (const edit of edits) {
        const index = widgets.findIndex(
            (widget) =>
                widget.source.kind === "activity-output" &&
                widget.source.nodeId === edit.nodeId &&
                widget.source.slot === "primary" &&
                (edit.widgetId === undefined || widget.id === edit.widgetId),
        );
        if (index >= 0) {
            const widget = widgets[index];
            const selected =
                widget.views.find((view) => view.kind === edit.defaultView) ??
                createViewSpec(edit.defaultView, `${widget.id}:${edit.defaultView}`);
            widgets[index] = {
                ...widget,
                sectionId: edit.sectionId,
                placement: edit.placement,
                visibility: edit.hidden ? { when: "never" } : { when: "always" },
                ...(!widget.views.some((view) => view.kind === edit.defaultView)
                    ? {
                          views: [selected],
                          presentation: { mode: "single" },
                          defaultViewId: selected.id,
                      }
                    : {}),
                provenance: { by: "user", previous: defaultViewKind(widget) },
            };
            continue;
        }
        const id = edit.widgetId ?? `layout-${edit.nodeId}`;
        const contract = metadata?.contractByNode?.[edit.nodeId] ?? "unknown/1";
        const selected = applyOutputSchemaBindings(
            createViewSpec(edit.defaultView, `${id}:${edit.defaultView}`),
            contract,
            metadata?.outputSchemaByNode?.[edit.nodeId],
        );
        widgets.push({
            id,
            source: { kind: "activity-output", nodeId: edit.nodeId, slot: "primary" },
            views: [selected],
            presentation: { mode: "single" },
            defaultViewId: selected.id,
            sectionId: edit.sectionId,
            placement: edit.placement,
            visibility: edit.hidden ? { when: "never" } : { when: "always" },
            authoredContract: contract,
            authoredContractFingerprint: metadata?.fingerprintByNode?.[edit.nodeId] ?? contract,
            provenance: { by: "user" },
        });
    }
    return {
        ...base,
        revision: base.revision + 1,
        ...(metadata?.planRevision ? { authoredForPlanRevision: metadata.planRevision } : {}),
        results: {
            ...base.results,
            widgets,
            ...(policy
                ? {
                      layout: {
                          ...base.results.layout,
                          strategy: policy.strategy,
                          sectionFlow: policy.strategy === "grid" ? "dashboard" : "document",
                      },
                  }
                : {}),
        },
    };
}

function defaultViewSpec(widget: WidgetBinding): ViewSpec {
    return widget.views.find((view) => view.id === widget.defaultViewId) ?? widget.views[0];
}

function defaultViewKind(widget: WidgetBinding): ViewKind | undefined {
    return defaultViewSpec(widget)?.kind;
}

/** User-pinned defaults by node id — the webview's "Set by you" markers. */
export function pinnedViewsOf(
    definition: PresentationDefinition | undefined,
): Record<string, ViewKind> {
    const pins: Record<string, ViewKind> = {};
    for (const widget of definition?.results.widgets ?? []) {
        if (
            widget.provenance.by === "user" &&
            widget.source.kind === "activity-output" &&
            widget.source.slot === "primary"
        ) {
            const kind = defaultViewKind(widget);
            if (kind) {
                pins[widget.source.nodeId] = kind;
            }
        }
    }
    return pins;
}

export function outputPresentationsOf(
    definition: PresentationDefinition | undefined,
): Record<string, OutputPresentationSummary> {
    const summaries: Record<string, OutputPresentationSummary> = {};
    for (const widget of definition?.results.widgets ?? []) {
        if (widget.source.kind !== "activity-output" || widget.source.slot !== "primary") {
            continue;
        }
        const defaultView = defaultViewKind(widget);
        if (!defaultView) {
            continue;
        }
        summaries[widget.source.nodeId] = {
            widgetId: widget.id,
            views: widget.views.map((view) => view.kind),
            defaultView,
            presentation: widget.presentation,
            setByUser: widget.provenance.by === "user",
            sectionId: widget.sectionId,
            ...(widget.placement ? { placement: widget.placement } : {}),
            hidden: widget.visibility?.when === "never",
            authoredContractFingerprint: widget.authoredContractFingerprint,
            ...(widget.views.some((view) => rendererSettingsOf(view) !== undefined)
                ? {
                      settings: Object.fromEntries(
                          widget.views.flatMap((view) => {
                              const settings = rendererSettingsOf(view);
                              return settings ? [[view.kind, settings]] : [];
                          }),
                      ) as OutputViewSettings,
                  }
                : {}),
        };
    }
    return summaries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isViewKind(value: unknown): value is ViewKind {
    return typeof value === "string" && VIEW_KINDS.has(value);
}

function validateLegacy(raw: Record<string, unknown>): LegacyPresentationDefinition | undefined {
    if (
        raw.schemaVersion !== 1 ||
        !Number.isInteger(raw.revision) ||
        !Array.isArray(raw.sections)
    ) {
        return undefined;
    }
    const widgetIds = new Set<string>();
    for (const section of raw.sections) {
        if (
            !isRecord(section) ||
            typeof section.id !== "string" ||
            !Array.isArray(section.widgets)
        ) {
            return undefined;
        }
        for (const widget of section.widgets) {
            if (
                !isRecord(widget) ||
                typeof widget.id !== "string" ||
                !isViewKind(widget.view) ||
                !isRecord(widget.source) ||
                typeof widget.source.nodeId !== "string" ||
                widgetIds.has(widget.id)
            ) {
                return undefined;
            }
            widgetIds.add(widget.id);
        }
    }
    return raw as unknown as LegacyPresentationDefinition;
}

function validSource(source: unknown): boolean {
    if (!isRecord(source) || typeof source.kind !== "string") {
        return false;
    }
    switch (source.kind) {
        case "activity-output":
            return (
                typeof source.nodeId === "string" &&
                typeof source.slot === "string" &&
                source.slot.length > 0
            );
        case "run-field":
            return typeof source.field === "string" && RUN_FIELDS.has(source.field);
        case "run-metric":
            return (
                typeof source.key === "string" && source.key.length > 0 && source.key.length <= 256
            );
        case "derived":
            return (
                typeof source.sourceId === "string" &&
                source.sourceId.length > 0 &&
                source.sourceId.length <= 256
            );
        default:
            return false;
    }
}

function validPresentationMode(value: unknown): value is PresentationMode {
    if (!isRecord(value)) {
        return false;
    }
    if (value.mode === "single" || value.mode === "tabs" || value.mode === "toggle") {
        return true;
    }
    return value.mode === "split" && (value.axis === "row" || value.axis === "column");
}

function validateV2(raw: Record<string, unknown>): PresentationDefinition | undefined {
    if (
        raw.schemaVersion !== PRESENTATION_SCHEMA_VERSION ||
        !Number.isInteger(raw.revision) ||
        typeof raw.authoredForPlanRevision !== "string" ||
        typeof raw.registryVersion !== "string" ||
        !isRecord(raw.results) ||
        !Array.isArray(raw.results.sections) ||
        !Array.isArray(raw.results.widgets) ||
        !isRecord(raw.results.layout) ||
        !Array.isArray(raw.derivedSources)
    ) {
        return undefined;
    }

    const sectionIds = new Set<string>();
    for (const section of raw.results.sections) {
        if (
            !isRecord(section) ||
            typeof section.id !== "string" ||
            typeof section.role !== "string" ||
            !SECTION_ROLES.has(section.role) ||
            !Number.isFinite(section.order) ||
            !["collapse", "show-empty-state", "reserve"].includes(String(section.whenEmpty)) ||
            sectionIds.has(section.id)
        ) {
            return undefined;
        }
        sectionIds.add(section.id);
    }

    const widgetIds = new Set<string>();
    for (const widget of raw.results.widgets) {
        if (
            !isRecord(widget) ||
            typeof widget.id !== "string" ||
            widgetIds.has(widget.id) ||
            !validSource(widget.source) ||
            !Array.isArray(widget.views) ||
            widget.views.length === 0 ||
            typeof widget.defaultViewId !== "string" ||
            typeof widget.sectionId !== "string" ||
            typeof widget.authoredContract !== "string" ||
            typeof widget.authoredContractFingerprint !== "string" ||
            !isRecord(widget.provenance) ||
            !PROVENANCE_KINDS.has(String(widget.provenance.by)) ||
            !validPresentationMode(widget.presentation)
        ) {
            return undefined;
        }
        const viewIds = new Set<string>();
        for (const view of widget.views) {
            if (
                !isRecord(view) ||
                typeof view.id !== "string" ||
                viewIds.has(view.id) ||
                !isViewKind(view.kind) ||
                !isRecord(view.props)
            ) {
                return undefined;
            }
            viewIds.add(view.id);
        }
        if (!viewIds.has(widget.defaultViewId)) {
            return undefined;
        }
        widgetIds.add(widget.id);
    }

    if (raw.derivedSources.length > MAX_DERIVED_SOURCES) {
        return undefined;
    }
    const derivedIds = new Set<string>();
    const derivedById = new Map<string, DerivedSourceDefinition>();
    for (const source of raw.derivedSources) {
        if (
            !isRecord(source) ||
            typeof source.id !== "string" ||
            source.id.length === 0 ||
            source.id.length > 256 ||
            derivedIds.has(source.id) ||
            !validSource(source.from) ||
            !validateTransformPipeline(source.pipeline) ||
            typeof source.authoredContract !== "string" ||
            source.authoredContract.length === 0 ||
            !isRecord(source.provenance) ||
            !PROVENANCE_KINDS.has(String(source.provenance.by))
        ) {
            return undefined;
        }
        derivedIds.add(source.id);
        derivedById.set(source.id, source as unknown as DerivedSourceDefinition);
    }
    for (const widget of raw.results.widgets) {
        const source = (widget as unknown as WidgetBinding).source;
        if (source.kind === "derived" && !derivedIds.has(source.sourceId)) {
            return undefined;
        }
    }
    const visiting = new Set<string>();
    const composedStepCounts = new Map<string, number>();
    const visitDerived = (id: string): number | undefined => {
        if (visiting.has(id)) {
            return undefined;
        }
        const knownCount = composedStepCounts.get(id);
        if (knownCount !== undefined) {
            return knownCount;
        }
        const source = derivedById.get(id);
        if (!source) {
            return undefined;
        }
        visiting.add(id);
        const parentCount = source.from.kind === "derived" ? visitDerived(source.from.sourceId) : 0;
        visiting.delete(id);
        if (parentCount === undefined) {
            return undefined;
        }
        const count = parentCount + source.pipeline.steps.length;
        if (count > MAX_COMPOSED_TRANSFORM_STEPS) {
            return undefined;
        }
        composedStepCounts.set(id, count);
        return count;
    };
    if ([...derivedIds].some((id) => visitDerived(id) === undefined)) {
        return undefined;
    }

    const layout = raw.results.layout;
    if (
        !Array.isArray(layout.breakpoints) ||
        typeof layout.overflowSectionId !== "string" ||
        !sectionIds.has(layout.overflowSectionId) ||
        !isRecord(layout.defaultSpan) ||
        (layout.sectionFlow !== "document" && layout.sectionFlow !== "dashboard") ||
        (layout.strategy !== undefined &&
            !["flow", "stacked", "grid"].includes(String(layout.strategy)))
    ) {
        return undefined;
    }
    const breakpointNames = new Set<string>();
    for (const breakpoint of layout.breakpoints) {
        if (
            !isRecord(breakpoint) ||
            !["compact", "medium", "wide"].includes(String(breakpoint.name)) ||
            breakpointNames.has(String(breakpoint.name)) ||
            !Number.isFinite(breakpoint.minWidth) ||
            !Number.isInteger(breakpoint.columns) ||
            Number(breakpoint.columns) < 1 ||
            !Number.isFinite(breakpoint.gap)
        ) {
            return undefined;
        }
        breakpointNames.add(String(breakpoint.name));
    }
    return raw as unknown as PresentationDefinition;
}

/** Validate and normalize a persisted definition. V1 is migrated in memory;
 * malformed or future versions return undefined so callers derive a visible
 * default rather than blanking Results. */
export function validatePresentationDefinition(raw: unknown): PresentationDefinition | undefined {
    if (!isRecord(raw)) {
        return undefined;
    }
    if (raw.schemaVersion === 1) {
        const legacy = validateLegacy(raw);
        return legacy ? migrateLegacyPresentationDefinition(legacy) : undefined;
    }
    return validateV2(raw);
}

export function resolvePresentation(
    definition: PresentationDefinition | undefined,
    snapshot: RunbookRunSnapshot | undefined,
): ResolvedPresentation {
    if (!definition) {
        return deriveFromSnapshot(snapshot);
    }
    const nodesById = new Map((snapshot?.nodes ?? []).map((node) => [node.nodeId, node]));
    const knownSectionIds = new Set(definition.results.sections.map((section) => section.id));
    const overflowSectionId = knownSectionIds.has(definition.results.layout.overflowSectionId)
        ? definition.results.layout.overflowSectionId
        : definition.results.sections.find((section) => section.role === "overflow")?.id;

    const widgetsBySection = new Map<string, ResolvedWidget[]>();
    const boundOutputs = new Set<string>();
    for (const binding of definition.results.widgets) {
        if (binding.source.kind === "activity-output") {
            boundOutputs.add(`${binding.source.nodeId}\u0000${binding.source.slot}`);
        }
        if (!visibilityAllows(binding, definition, snapshot, nodesById)) {
            continue;
        }
        if (
            binding.source.kind === "activity-output" &&
            nodesById.get(binding.source.nodeId)?.branchNotTaken === true
        ) {
            continue;
        }
        const sectionId = knownSectionIds.has(binding.sectionId)
            ? binding.sectionId
            : (overflowSectionId ?? binding.sectionId);
        const resolved = resolveBinding(binding, sectionId, definition, snapshot, nodesById);
        const widgets = widgetsBySection.get(sectionId) ?? [];
        widgets.push(resolved);
        widgetsBySection.set(sectionId, widgets);
    }
    // Plan evolution can add outputs after a presentation was authored. They
    // must remain visible and flow to Overflow rather than silently vanish.
    if (overflowSectionId) {
        const overflowWidgets = widgetsBySection.get(overflowSectionId) ?? [];
        for (const node of snapshot?.nodes ?? []) {
            for (const [outputIndex, output] of (node.outputs ?? []).entries()) {
                const slot =
                    output.slot ?? (outputIndex === 0 ? "primary" : `legacy:${outputIndex}`);
                if (boundOutputs.has(`${node.nodeId}\u0000${slot}`)) {
                    continue;
                }
                overflowWidgets.push(
                    resolvedUnboundOutput(
                        node,
                        output,
                        slot,
                        overflowSectionId,
                        overflowWidgets.length,
                    ),
                );
            }
        }
        if (overflowWidgets.length > 0) {
            widgetsBySection.set(overflowSectionId, overflowWidgets);
        }
    }

    const sections: ResolvedSection[] = definition.results.sections
        .map(
            (section): ResolvedSection => ({
                id: section.id,
                title: section.label ?? section.id,
                role: section.role,
                order: section.order,
                whenEmpty: section.whenEmpty,
                widgets: (widgetsBySection.get(section.id) ?? []).sort(
                    (a, b) =>
                        (a.placement?.order ?? 0) - (b.placement?.order ?? 0) ||
                        a.id.localeCompare(b.id),
                ),
            }),
        )
        .filter((section) => section.widgets.length > 0 || section.whenEmpty !== "collapse")
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: definition.revision,
        derived: false,
        layout: definition.results.layout,
        ...(definition.results.emptyState
            ? { emptyState: { ...definition.results.emptyState } }
            : {}),
        sections,
    };
}

/** Payload-free visibility evaluation. Policies that depend on output data
 * use only durable handle metadata; an absent/expired handle or unknown row
 * count cannot be promoted to ready/non-empty by guesswork. */
function visibilityAllows(
    binding: WidgetBinding,
    definition: PresentationDefinition,
    snapshot: RunbookRunSnapshot | undefined,
    nodesById: Map<string, RunbookNodeSnapshot>,
): boolean {
    const policy = binding.visibility;
    if (!policy || policy.when === "always") {
        return true;
    }
    if (policy.when === "never") {
        return false;
    }
    if (policy.when === "run-complete") {
        return snapshot !== undefined && isTerminalRunState(snapshot.state);
    }
    if (policy.when === "verdict") {
        if (!snapshot?.verdict) {
            return false;
        }
        // The presentation grammar calls the third UI verdict "warn" while
        // the durable run model calls the same non-pass/non-fail state
        // "indeterminate". Keep that translation closed at this boundary.
        const verdict = snapshot.verdict === "indeterminate" ? "warn" : snapshot.verdict;
        return policy.values.includes(verdict);
    }
    if (binding.source.kind !== "activity-output") {
        if (binding.source.kind === "derived") {
            const derived = resolveDerivedSourcePlan(definition, binding.source.sourceId, snapshot);
            return policy.when === "source-ready" && derived.state === "ready";
        }
        if (binding.source.kind === "run-metric") {
            return resolveRunMetric(binding.source.key, snapshot).state === "ready";
        }
        if (binding.source.kind !== "run-field") {
            return false;
        }
        const runField = resolveRunField(binding.source.field, snapshot);
        return runField.state === "ready";
    }
    const node = nodesById.get(binding.source.nodeId);
    const output = node ? outputForSlot(node.outputs ?? [], binding.source.slot) : undefined;
    if (!output || output.expired) {
        return false;
    }
    return policy.when === "source-ready" || (output.rows !== undefined && output.rows > 0);
}

function resolvedUnboundOutput(
    node: RunbookNodeSnapshot,
    output: DataHandleRef,
    slot: string,
    sectionId: string,
    order: number,
): ResolvedWidget {
    const id = `overflow:${node.nodeId}:${slot}`;
    const kind = defaultViewFor(output.contract);
    const viewId = `${id}:${kind}`;
    return {
        id,
        title: node.nodeId,
        nodeId: node.nodeId,
        state: output.expired ? "expired" : "ready",
        view: kind,
        views: [{ id: viewId, kind }],
        presentation: { mode: "single" },
        defaultViewId: viewId,
        activeViewId: viewId,
        sectionId,
        placement: { order },
        provenance: { by: "default" },
        handleId: output.handleId,
        contract: output.contract,
        ...(output.rows !== undefined ? { rows: output.rows } : {}),
    };
}

function resolveBinding(
    binding: WidgetBinding,
    sectionId: string,
    definition: PresentationDefinition,
    snapshot: RunbookRunSnapshot | undefined,
    nodesById: Map<string, RunbookNodeSnapshot>,
): ResolvedWidget {
    const requested = defaultViewSpec(binding);
    const common = {
        id: binding.id,
        title: requested.title ?? binding.id,
        nodeId: binding.source.kind === "activity-output" ? binding.source.nodeId : binding.id,
        view: requested.kind,
        views: binding.views.map((view) => ({
            id: view.id,
            kind: view.kind,
            ...(view.title ? { title: view.title } : {}),
            ...(rendererSettingsOf(view) ? { settings: rendererSettingsOf(view) } : {}),
        })),
        presentation: binding.presentation,
        defaultViewId: binding.defaultViewId,
        activeViewId: requested.id,
        sectionId,
        ...(binding.placement ? { placement: binding.placement } : {}),
        provenance: binding.provenance,
    };
    if (binding.source.kind === "run-field") {
        return resolveRunFieldBinding(binding, binding.source.field, sectionId, snapshot);
    }
    if (binding.source.kind === "run-metric") {
        return resolveRunMetricBinding(binding, binding.source.key, sectionId, snapshot);
    }
    if (binding.source.kind === "derived") {
        const source = resolveDerivedSourcePlan(definition, binding.source.sourceId, snapshot);
        if (source.state !== "ready" && source.state !== "expired") {
            return { ...common, state: source.state };
        }
        const node = nodesById.get(source.nodeId);
        if (!node) {
            return { ...common, state: "sourceMissing" };
        }
        return {
            ...resolveWidgetWithOutput(binding, sectionId, node, {
                handleId: source.handleId,
                contract: source.contract,
                ...(source.state === "expired" ? { expired: true } : {}),
            }),
            nodeId: binding.id,
            derivedSourceId: binding.source.sourceId,
        };
    }
    if (binding.source.kind !== "activity-output") {
        return { ...common, state: "sourceMissing" };
    }
    const node = nodesById.get(binding.source.nodeId);
    if (!node) {
        return { ...common, state: "sourceMissing" };
    }
    const output = outputForSlot(node.outputs ?? [], binding.source.slot);
    if (!output) {
        return { ...common, state: isTerminalNodeState(node.state) ? "noOutput" : "pending" };
    }
    return resolveWidgetWithOutput(binding, sectionId, node, output);
}

export type ResolvedDerivedSourcePlan =
    | {
          state: "ready" | "expired";
          handleId: string;
          nodeId: string;
          contract: string;
          pipeline: TransformPipeline;
      }
    | { state: "pending" | "noOutput" | "sourceMissing" };

/** Resolve a derived source to one durable base handle plus a composed pure
 * pipeline. This is shared by presentation resolution and the controller's
 * page-request authorization; no payload is read here. */
export function resolveDerivedSourcePlan(
    definition: PresentationDefinition,
    sourceId: string,
    snapshot: RunbookRunSnapshot | undefined,
): ResolvedDerivedSourcePlan {
    if (!snapshot) {
        return { state: "sourceMissing" };
    }
    const sources = new Map(definition.derivedSources.map((source) => [source.id, source]));
    const nodes = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
    const resolve = (
        source: DerivedSourceDefinition,
        visiting: Set<string>,
    ): ResolvedDerivedSourcePlan => {
        if (visiting.has(source.id)) {
            return { state: "sourceMissing" };
        }
        const nextVisiting = new Set(visiting).add(source.id);
        if (source.from.kind === "derived") {
            const parent = sources.get(source.from.sourceId);
            if (!parent) {
                return { state: "sourceMissing" };
            }
            const resolved = resolve(parent, nextVisiting);
            return resolved.state === "ready" || resolved.state === "expired"
                ? {
                      ...resolved,
                      contract: source.authoredContract,
                      pipeline: {
                          steps: [...resolved.pipeline.steps, ...source.pipeline.steps],
                      },
                  }
                : resolved;
        }
        if (source.from.kind !== "activity-output") {
            return { state: "sourceMissing" };
        }
        const node = nodes.get(source.from.nodeId);
        if (!node) {
            return { state: "sourceMissing" };
        }
        const output = outputForSlot(node.outputs ?? [], source.from.slot);
        if (!output) {
            return { state: isTerminalNodeState(node.state) ? "noOutput" : "pending" };
        }
        return {
            state: output.expired ? "expired" : "ready",
            handleId: output.handleId,
            nodeId: node.nodeId,
            contract: source.authoredContract,
            pipeline: { steps: [...source.pipeline.steps] },
        };
    };
    const source = sources.get(sourceId);
    return source ? resolve(source, new Set()) : { state: "sourceMissing" };
}

function resolveRunMetric(
    key: string,
    snapshot: RunbookRunSnapshot | undefined,
):
    | { state: "ready"; value: string | number | boolean }
    | { state: "pending" | "noOutput" | "sourceMissing" } {
    if (!snapshot) {
        return { state: "sourceMissing" };
    }
    const value = snapshot.runMetrics?.[key];
    if (value !== undefined) {
        return { state: "ready", value };
    }
    return { state: isTerminalRunState(snapshot.state) ? "noOutput" : "pending" };
}

function resolveRunField(
    field: RunFieldName,
    snapshot: RunbookRunSnapshot | undefined,
):
    | { state: "ready"; value: string | number }
    | { state: "pending" | "noOutput" | "sourceMissing" } {
    if (!snapshot) {
        return { state: "sourceMissing" };
    }
    switch (field) {
        case "status":
            return { state: "ready", value: snapshot.state };
        case "verdict":
            return snapshot.verdict
                ? { state: "ready", value: snapshot.verdict }
                : { state: isTerminalRunState(snapshot.state) ? "noOutput" : "pending" };
        case "elapsedMs":
            return snapshot.startedEpochMs !== undefined && snapshot.endedEpochMs !== undefined
                ? {
                      state: "ready",
                      value: Math.max(0, snapshot.endedEpochMs - snapshot.startedEpochMs),
                  }
                : { state: isTerminalRunState(snapshot.state) ? "noOutput" : "pending" };
        case "completedNodeCount":
            return {
                state: "ready",
                value: snapshot.nodes.filter((node) => isTerminalNodeState(node.state)).length,
            };
        case "totalNodeCount":
            return { state: "ready", value: snapshot.nodes.length };
        case "warningCount":
        case "errorCount":
            // The durable snapshot does not yet own diagnostic counts. Zero
            // would falsely mean that diagnostics were measured and absent.
            return { state: "sourceMissing" };
    }
}

function resolveRunFieldBinding(
    binding: WidgetBinding,
    field: RunFieldName,
    sectionId: string,
    snapshot: RunbookRunSnapshot | undefined,
): ResolvedWidget {
    const contract = "scalarSet/1";
    const requested = defaultViewSpec(binding);
    const compatible = binding.views.filter((view) => isViewCompatible(contract, view.kind));
    const requestedCompatible = isViewCompatible(contract, requested.kind);
    const fallback = requestedCompatible
        ? undefined
        : (compatible[0] ?? createViewSpec(defaultViewFor(contract), `${binding.id}:fallback`));
    const active = requestedCompatible ? requested : fallback!;
    const views = [
        ...binding.views,
        ...(fallback && !binding.views.some((view) => view.id === fallback.id) ? [fallback] : []),
    ].map((view) => {
        const compatibleView = isViewCompatible(contract, view.kind);
        return {
            id: view.id,
            kind: view.kind,
            ...(view.title ? { title: view.title } : {}),
            ...(!compatibleView
                ? {
                      issue: {
                          viewId: view.id,
                          code: "CONTRACT_KIND_CHANGED" as const,
                          message: `Run field '${field}' is not compatible with ${view.kind}.`,
                          fallbackViewId: active.id,
                      },
                  }
                : {}),
            ...(rendererSettingsOf(view) ? { settings: rendererSettingsOf(view) } : {}),
        };
    });
    const value = resolveRunField(field, snapshot);
    return {
        id: binding.id,
        title: active.title ?? binding.id,
        nodeId: binding.id,
        state: value.state,
        view: active.kind,
        views,
        presentation: binding.presentation,
        defaultViewId: binding.defaultViewId,
        activeViewId: active.id,
        sectionId,
        ...(binding.placement ? { placement: binding.placement } : {}),
        provenance: binding.provenance,
        contract,
        ...(value.state === "ready" ? { runField: { field, value: value.value } } : {}),
        ...(!requestedCompatible
            ? { drift: { requestedView: requested.kind, reason: "contractIncompatible" as const } }
            : {}),
    };
}

function resolveRunMetricBinding(
    binding: WidgetBinding,
    key: string,
    sectionId: string,
    snapshot: RunbookRunSnapshot | undefined,
): ResolvedWidget {
    const contract = "scalarSet/1";
    const requested = defaultViewSpec(binding);
    const compatible = binding.views.filter((view) => isViewCompatible(contract, view.kind));
    const requestedCompatible = isViewCompatible(contract, requested.kind);
    const fallback = requestedCompatible
        ? undefined
        : (compatible[0] ?? createViewSpec(defaultViewFor(contract), `${binding.id}:fallback`));
    const active = requestedCompatible ? requested : fallback!;
    const views = [
        ...binding.views,
        ...(fallback && !binding.views.some((view) => view.id === fallback.id) ? [fallback] : []),
    ].map((view) => {
        const compatibleView = isViewCompatible(contract, view.kind);
        return {
            id: view.id,
            kind: view.kind,
            ...(view.title ? { title: view.title } : {}),
            ...(!compatibleView
                ? {
                      issue: {
                          viewId: view.id,
                          code: "CONTRACT_KIND_CHANGED" as const,
                          message: `Run metric '${key}' is not compatible with ${view.kind}.`,
                          fallbackViewId: active.id,
                      },
                  }
                : {}),
            ...(rendererSettingsOf(view) ? { settings: rendererSettingsOf(view) } : {}),
        };
    });
    const value = resolveRunMetric(key, snapshot);
    return {
        id: binding.id,
        title: active.title ?? binding.id,
        nodeId: binding.id,
        state: value.state,
        view: active.kind,
        views,
        presentation: binding.presentation,
        defaultViewId: binding.defaultViewId,
        activeViewId: active.id,
        sectionId,
        ...(binding.placement ? { placement: binding.placement } : {}),
        provenance: binding.provenance,
        contract,
        ...(value.state === "ready" ? { runMetric: { key, value: value.value } } : {}),
        ...(!requestedCompatible
            ? { drift: { requestedView: requested.kind, reason: "contractIncompatible" as const } }
            : {}),
    };
}

function outputForSlot(outputs: DataHandleRef[], slot: string): DataHandleRef | undefined {
    const named = outputs.find((output) => output.slot === slot);
    if (named) {
        return named;
    }
    // Compatibility for V1/current runtime records, which predate named
    // output handles. All installed activities currently expose one primary
    // output; legacy:N retains old nth-output identity through migration.
    if (slot === "primary") {
        return outputs[0];
    }
    const legacyIndex = /^legacy:(\d+)$/.exec(slot)?.[1];
    return legacyIndex === undefined ? undefined : outputs[Number(legacyIndex)];
}

function resolveWidgetWithOutput(
    binding: WidgetBinding,
    sectionId: string,
    node: RunbookNodeSnapshot,
    output: DataHandleRef,
): ResolvedWidget {
    const requested = defaultViewSpec(binding);
    const compatible = binding.views.filter((view) => isViewCompatible(output.contract, view.kind));
    const requestedCompatible = isViewCompatible(output.contract, requested.kind);
    let active = requestedCompatible ? requested : compatible[0];
    let fallback: ViewSpec | undefined;
    if (!active) {
        const kind = defaultViewFor(output.contract);
        fallback = createViewSpec(kind, `${binding.id}:fallback:${kind}`);
        active = fallback;
    }
    const issueFor = (view: ViewSpec): ViewIssue | undefined =>
        isViewCompatible(output.contract, view.kind)
            ? undefined
            : {
                  viewId: view.id,
                  code: "CONTRACT_KIND_CHANGED",
                  message: `The current ${output.contract} output is not compatible with ${view.kind}.`,
                  fallbackViewId: active.id,
              };
    const views = [...binding.views, ...(fallback ? [fallback] : [])].map((view) => {
        const issue = issueFor(view);
        return {
            id: view.id,
            kind: view.kind,
            ...(view.title ? { title: view.title } : {}),
            ...(issue ? { issue } : {}),
            ...(rendererSettingsOf(view) ? { settings: rendererSettingsOf(view) } : {}),
        };
    });
    const base = {
        id: binding.id,
        title: active.title ?? binding.id,
        nodeId: node.nodeId,
        view: active.kind,
        views,
        presentation: binding.presentation,
        defaultViewId: binding.defaultViewId,
        activeViewId: active.id,
        sectionId,
        ...(binding.placement ? { placement: binding.placement } : {}),
        provenance: binding.provenance,
        handleId: output.handleId,
        contract: output.contract,
        ...(output.rows !== undefined ? { rows: output.rows } : {}),
    };
    if (output.expired) {
        return { ...base, state: "expired" };
    }
    if (!requestedCompatible) {
        return {
            ...base,
            state: "ready",
            drift: { requestedView: requested.kind, reason: "contractIncompatible" },
        };
    }
    return { ...base, state: "ready" };
}

/** No persisted definition: derive one semantic section per node that has
 * outputs, one widget per output, in accepted plan order. */
function deriveFromSnapshot(snapshot: RunbookRunSnapshot | undefined): ResolvedPresentation {
    const sections: ResolvedSection[] = [];
    for (const [nodeIndex, node] of (snapshot?.nodes ?? []).entries()) {
        const outputs = node.outputs ?? [];
        if (outputs.length === 0) {
            continue;
        }
        const sectionId = `node:${node.nodeId}`;
        sections.push({
            id: sectionId,
            title: node.nodeId,
            role: "primary",
            order: nodeIndex,
            whenEmpty: "collapse",
            widgets: outputs.map((output, index): ResolvedWidget => {
                const widgetId = `derived:${node.nodeId}:${index}`;
                const kind = defaultViewFor(output.contract);
                const viewId = `${widgetId}:${kind}`;
                return {
                    id: widgetId,
                    title: node.nodeId,
                    nodeId: node.nodeId,
                    state: output.expired ? "expired" : "ready",
                    view: kind,
                    views: [{ id: viewId, kind }],
                    presentation: { mode: "single" },
                    defaultViewId: viewId,
                    activeViewId: viewId,
                    sectionId,
                    placement: { order: index },
                    provenance: { by: "default" },
                    handleId: output.handleId,
                    contract: output.contract,
                    ...(output.rows !== undefined ? { rows: output.rows } : {}),
                };
            }),
        });
    }
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: 0,
        derived: true,
        layout: DEFAULT_PRESENTATION_LAYOUT,
        sections,
    };
}

export { compatibleViews };
