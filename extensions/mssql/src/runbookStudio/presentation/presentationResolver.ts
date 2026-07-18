/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure presentation resolver (RBS2-9 keystone; rendering-spec invariants):
 *   - deterministic: same definition + snapshot -> same resolved model;
 *   - total: EVERY widget resolves to an explicit state, never dropped,
 *     never blank;
 *   - zero model calls; zero payload copies (handles only);
 *   - drift degrades visibly: an incompatible pinned view falls back to the
 *     contract's default view with the drift recorded;
 *   - with no persisted definition, a layout is DERIVED from the snapshot's
 *     typed outputs (one section per node with outputs).
 * No vscode imports — unit-testable and shared with a future headless host.
 */

import {
    compatibleViews,
    defaultViewFor,
    isViewCompatible,
    PresentationDefinition,
    PRESENTATION_SCHEMA_VERSION,
    ResolvedPresentation,
    ResolvedSection,
    ResolvedWidget,
    ViewKind,
} from "../../sharedInterfaces/runbookPresentation";
import {
    DataHandleRef,
    RunbookNodeSnapshot,
    RunbookRunSnapshot,
} from "../../sharedInterfaces/runbookStudio";
import { isTerminalNodeState } from "../runbookRunModel";

/**
 * Pin (or clear) a node's output view in the definition — pure. Creates the
 * definition/section on first pin; clearing removes the widget only when it
 * was pin-created (id prefix), never a hand-authored layout entry. Bumps the
 * revision so patches remain atomically versioned.
 */
export function upsertOutputPin(
    definition: PresentationDefinition | undefined,
    nodeId: string,
    view: ViewKind | undefined,
): PresentationDefinition {
    const base: PresentationDefinition = definition ?? {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: 0,
        sections: [],
    };
    const pinId = `pin-${nodeId}`;
    const sections = base.sections.map((section) => ({
        ...section,
        widgets: section.widgets
            .map((widget) => {
                if (widget.source.nodeId !== nodeId || (widget.source.outputIndex ?? 0) !== 0) {
                    return widget;
                }
                if (view === undefined) {
                    // Clearing: drop pin-created widgets, unpin authored ones.
                    return widget.id === pinId ? undefined : { ...widget, pinnedByUser: false };
                }
                return { ...widget, view, pinnedByUser: true };
            })
            .filter((w): w is NonNullable<typeof w> => w !== undefined),
    }));
    const hasWidget = sections.some((s) =>
        s.widgets.some((w) => w.source.nodeId === nodeId && (w.source.outputIndex ?? 0) === 0),
    );
    if (view !== undefined && !hasWidget) {
        const primary = sections.find((s) => s.id === "primary");
        const widget = {
            id: pinId,
            source: { nodeId },
            view,
            pinnedByUser: true,
        };
        if (primary) {
            primary.widgets = [...primary.widgets, widget];
        } else {
            sections.push({ id: "primary", widgets: [widget] });
        }
    }
    return { ...base, revision: base.revision + 1, sections };
}

/** Pinned views by node id — the webview's "Set by you" markers. */
export function pinnedViewsOf(
    definition: PresentationDefinition | undefined,
): Record<string, ViewKind> {
    const pins: Record<string, ViewKind> = {};
    for (const section of definition?.sections ?? []) {
        for (const widget of section.widgets) {
            if (widget.pinnedByUser && (widget.source.outputIndex ?? 0) === 0) {
                pins[widget.source.nodeId] = widget.view;
            }
        }
    }
    return pins;
}

/** Validate a persisted definition; returns undefined when unusable (the
 *  caller derives instead — an invalid persisted layout must not blank the
 *  results surface, it degrades to the derived default). */
export function validatePresentationDefinition(raw: unknown): PresentationDefinition | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return undefined;
    }
    const candidate = raw as Partial<PresentationDefinition>;
    if (candidate.schemaVersion !== PRESENTATION_SCHEMA_VERSION) {
        return undefined;
    }
    if (typeof candidate.revision !== "number" || !Array.isArray(candidate.sections)) {
        return undefined;
    }
    const widgetIds = new Set<string>();
    for (const section of candidate.sections) {
        if (typeof section?.id !== "string" || !Array.isArray(section.widgets)) {
            return undefined;
        }
        for (const widget of section.widgets) {
            if (
                typeof widget?.id !== "string" ||
                typeof widget.view !== "string" ||
                typeof widget.source?.nodeId !== "string"
            ) {
                return undefined;
            }
            if (widgetIds.has(widget.id)) {
                return undefined;
            }
            widgetIds.add(widget.id);
        }
    }
    return candidate as PresentationDefinition;
}

export function resolvePresentation(
    definition: PresentationDefinition | undefined,
    snapshot: RunbookRunSnapshot | undefined,
): ResolvedPresentation {
    if (!definition) {
        return deriveFromSnapshot(snapshot);
    }
    const nodesById = new Map((snapshot?.nodes ?? []).map((node) => [node.nodeId, node]));
    const sections: ResolvedSection[] = definition.sections.map((section) => ({
        id: section.id,
        title: section.title ?? section.id,
        widgets: section.widgets.map((widget): ResolvedWidget => {
            const node = nodesById.get(widget.source.nodeId);
            if (!node) {
                return {
                    id: widget.id,
                    title: widget.title ?? widget.id,
                    nodeId: widget.source.nodeId,
                    state: "sourceMissing",
                    view: widget.view,
                };
            }
            const output = (node.outputs ?? [])[widget.source.outputIndex ?? 0];
            if (!output) {
                return {
                    id: widget.id,
                    title: widget.title ?? widget.id,
                    nodeId: node.nodeId,
                    state: isTerminalNodeState(node.state) ? "noOutput" : "pending",
                    view: widget.view,
                };
            }
            return resolveWidgetWithOutput(
                widget.id,
                widget.title ?? widget.id,
                node,
                output,
                widget.view,
            );
        }),
    }));
    return {
        schemaVersion: PRESENTATION_SCHEMA_VERSION,
        revision: definition.revision,
        derived: false,
        sections,
    };
}

function resolveWidgetWithOutput(
    id: string,
    title: string,
    node: RunbookNodeSnapshot,
    output: DataHandleRef,
    requestedView: ViewKind,
): ResolvedWidget {
    const base = {
        id,
        title,
        nodeId: node.nodeId,
        handleId: output.handleId,
        contract: output.contract,
        ...(output.rows !== undefined ? { rows: output.rows } : {}),
    };
    if (output.expired) {
        return { ...base, state: "expired", view: requestedView };
    }
    if (!isViewCompatible(output.contract, requestedView)) {
        // Drift: the output's contract no longer supports the chosen view.
        // Degrade VISIBLY to the contract default; the pin itself survives
        // in the persisted definition (never rewritten by resolution).
        return {
            ...base,
            state: "ready",
            view: defaultViewFor(output.contract),
            drift: { requestedView, reason: "contractIncompatible" },
        };
    }
    return { ...base, state: "ready", view: requestedView };
}

/** No persisted definition: derive one section per node that has outputs,
 *  one widget per output at the contract's default view. Deterministic in
 *  plan/node order (snapshot node order is the accepted plan order). */
function deriveFromSnapshot(snapshot: RunbookRunSnapshot | undefined): ResolvedPresentation {
    const sections: ResolvedSection[] = [];
    for (const node of snapshot?.nodes ?? []) {
        const outputs = node.outputs ?? [];
        if (outputs.length === 0) {
            continue;
        }
        sections.push({
            id: `node:${node.nodeId}`,
            title: node.nodeId,
            widgets: outputs.map((output, index): ResolvedWidget => {
                const widgetId = `derived:${node.nodeId}:${index}`;
                if (output.expired) {
                    return {
                        id: widgetId,
                        title: node.nodeId,
                        nodeId: node.nodeId,
                        state: "expired",
                        view: defaultViewFor(output.contract),
                        handleId: output.handleId,
                        contract: output.contract,
                    };
                }
                return {
                    id: widgetId,
                    title: node.nodeId,
                    nodeId: node.nodeId,
                    state: "ready",
                    view: defaultViewFor(output.contract),
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
        sections,
    };
}

export { compatibleViews };
