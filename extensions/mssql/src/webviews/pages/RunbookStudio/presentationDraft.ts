/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    OutputPresentationSummary,
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationLayoutStrategy,
    ResolvedPresentation,
} from "../../../sharedInterfaces/runbookPresentation";

export type PresentationLayoutConflictField =
    | "node"
    | "widgetId"
    | "defaultView"
    | "sectionId"
    | "hidden"
    | "placement.order"
    | "placement.span.compact"
    | "placement.span.medium"
    | "placement.span.wide"
    | "placement.minHeight"
    | "placement.priority"
    | "layout.strategy";

export interface PresentationLayoutConflict {
    nodeId: string;
    fields: PresentationLayoutConflictField[];
}

export interface PresentationLayoutRebase {
    edits: PresentationLayoutEdit[];
    conflicts: PresentationLayoutConflict[];
}

export interface PresentationLayoutPolicyRebase {
    policy?: PresentationLayoutPolicyEdit;
    conflict: boolean;
}

/** Normalize optional schema-v2 strategy metadata. Definitions written
 * before strategy authoring used document for flow and dashboard for grid. */
export function presentationLayoutStrategy(
    presentation: ResolvedPresentation | undefined,
): PresentationLayoutStrategy {
    return (
        presentation?.layout.strategy ??
        (presentation?.layout.sectionFlow === "dashboard" ? "grid" : "flow")
    );
}

/** Three-way merge the page-level layout policy independently from widget
 * fields. The local value is retained for an explicit conflict preview, but
 * callers must not persist it until the user confirms. */
export function rebasePresentationLayoutPolicy(
    baseline: PresentationLayoutStrategy,
    current: PresentationLayoutStrategy,
    local: PresentationLayoutPolicyEdit | undefined,
): PresentationLayoutPolicyRebase {
    if (!local || local.strategy === baseline) {
        return { conflict: false };
    }
    return {
        policy: local,
        conflict: current !== baseline && current !== local.strategy,
    };
}

/** Merge staged layout edits by their stable output-node identity. A later
 * edit replaces the complete intent for that node while retaining edits for
 * every other node, including both sides of an atomic reorder. */
export function mergePresentationLayoutEdits(
    current: PresentationLayoutEdit[],
    changes: PresentationLayoutEdit[],
): PresentationLayoutEdit[] {
    const byNode = new Map(current.map((edit) => [edit.nodeId, edit]));
    for (const edit of changes) {
        byNode.set(edit.nodeId, edit);
    }
    return [...byNode.values()];
}

/** Pointer convenience over the same atomic edit batch used by keyboard
 * ordering. The caller supplies siblings in rendered order; every affected
 * order is normalized in one batch so no intermediate duplicate order can
 * be persisted. Missing/cross-section identities are honest no-ops. */
export function pointerReorderPresentationLayoutEdits(
    siblings: PresentationLayoutEdit[],
    sourceNodeId: string,
    targetNodeId: string,
): PresentationLayoutEdit[] {
    const sourceIndex = siblings.findIndex((edit) => edit.nodeId === sourceNodeId);
    const targetIndex = siblings.findIndex((edit) => edit.nodeId === targetNodeId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return [];
    }
    const reordered = [...siblings];
    const [source] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, source);
    return reordered
        .map((edit, order) => ({
            ...edit,
            placement: { ...edit.placement, order },
        }))
        .filter(
            (edit) =>
                siblings.find((current) => current.nodeId === edit.nodeId)?.placement.order !==
                edit.placement.order,
        );
}

/** Capture the complete persisted/resolved layout intent without result
 * payloads. Persisted summaries win so hidden widgets remain part of the
 * merge base even though the resolver intentionally omits them. */
export function presentationLayoutSnapshot(
    presentation: ResolvedPresentation | undefined,
    summaries: Record<string, OutputPresentationSummary> = {},
): PresentationLayoutEdit[] {
    const byNode = new Map<string, PresentationLayoutEdit>();
    for (const section of presentation?.sections ?? []) {
        section.widgets.forEach((widget, index) => {
            byNode.set(widget.nodeId, {
                nodeId: widget.nodeId,
                widgetId: widget.id,
                defaultView: widget.view,
                sectionId: widget.sectionId,
                placement: widget.placement ?? { order: index },
                hidden: false,
            });
        });
    }
    for (const [nodeId, summary] of Object.entries(summaries)) {
        const resolved = byNode.get(nodeId);
        byNode.set(nodeId, {
            nodeId,
            widgetId: summary.widgetId,
            defaultView: summary.defaultView,
            sectionId: summary.sectionId,
            placement: summary.placement ?? resolved?.placement ?? { order: 0 },
            hidden: summary.hidden,
        });
    }
    return [...byNode.values()];
}

const REBASE_FIELDS: PresentationLayoutConflictField[] = [
    "widgetId",
    "defaultView",
    "sectionId",
    "hidden",
    "placement.order",
    "placement.span.compact",
    "placement.span.medium",
    "placement.span.wide",
    "placement.minHeight",
    "placement.priority",
];

function fieldValue(edit: PresentationLayoutEdit, field: PresentationLayoutConflictField) {
    switch (field) {
        case "widgetId":
        case "defaultView":
        case "sectionId":
        case "hidden":
            return edit[field];
        case "placement.order":
            return edit.placement.order;
        case "placement.span.compact":
            return edit.placement.span?.compact;
        case "placement.span.medium":
            return edit.placement.span?.medium;
        case "placement.span.wide":
            return edit.placement.span?.wide;
        case "placement.minHeight":
            return edit.placement.minHeight;
        case "placement.priority":
            return edit.placement.priority;
        case "layout.strategy":
            return undefined;
        case "node":
            return edit.nodeId;
    }
}

function withField(
    edit: PresentationLayoutEdit,
    field: PresentationLayoutConflictField,
    value: unknown,
): PresentationLayoutEdit {
    const next: PresentationLayoutEdit = {
        ...edit,
        placement: {
            ...edit.placement,
            ...(edit.placement.span ? { span: { ...edit.placement.span } } : {}),
        },
    };
    switch (field) {
        case "widgetId":
            if (value === undefined) {
                delete next.widgetId;
            } else {
                next.widgetId = value as string;
            }
            break;
        case "defaultView":
            next.defaultView = value as PresentationLayoutEdit["defaultView"];
            break;
        case "sectionId":
            next.sectionId = value as string;
            break;
        case "hidden":
            next.hidden = value as boolean;
            break;
        case "placement.order":
            next.placement.order = value as number;
            break;
        case "placement.minHeight":
            if (value === undefined) {
                delete next.placement.minHeight;
            } else {
                next.placement.minHeight = value as NonNullable<
                    PresentationLayoutEdit["placement"]["minHeight"]
                >;
            }
            break;
        case "placement.priority":
            if (value === undefined) {
                delete next.placement.priority;
            } else {
                next.placement.priority = value as NonNullable<
                    PresentationLayoutEdit["placement"]["priority"]
                >;
            }
            break;
        case "placement.span.compact":
        case "placement.span.medium":
        case "placement.span.wide": {
            const key = field.slice("placement.span.".length) as "compact" | "medium" | "wide";
            const span = { ...next.placement.span };
            if (value === undefined) {
                delete span[key];
            } else {
                span[key] = value as number;
            }
            if (Object.keys(span).length === 0) {
                delete next.placement.span;
            } else {
                next.placement.span = span;
            }
            break;
        }
        case "node":
        case "layout.strategy":
            break;
    }
    return next;
}

/** Reapply only the fields changed locally onto the current layout. A
 * conflict is reported when the same field changed upstream to a different
 * value. The returned candidate deliberately retains the local value for
 * conflicting fields so an explicit overwrite action can preview it; callers
 * must not persist that candidate until the user chooses that action. */
export function rebasePresentationLayoutEdits(
    baseline: PresentationLayoutEdit[],
    current: PresentationLayoutEdit[],
    localEdits: PresentationLayoutEdit[],
): PresentationLayoutRebase {
    const baselineByNode = new Map(baseline.map((edit) => [edit.nodeId, edit]));
    const currentByNode = new Map(current.map((edit) => [edit.nodeId, edit]));
    const conflicts: PresentationLayoutConflict[] = [];
    const edits = localEdits.map((local) => {
        const base = baselineByNode.get(local.nodeId);
        const latest = currentByNode.get(local.nodeId);
        if (base && !latest) {
            conflicts.push({ nodeId: local.nodeId, fields: ["node"] });
            return local;
        }
        if (!latest) {
            return local;
        }
        let merged = { ...latest, placement: { ...latest.placement } };
        const conflictFields: PresentationLayoutConflictField[] = [];
        for (const field of REBASE_FIELDS) {
            const baseValue = base ? fieldValue(base, field) : undefined;
            const latestValue = fieldValue(latest, field);
            const localValue = fieldValue(local, field);
            const localChanged = !Object.is(localValue, baseValue);
            const upstreamChanged = !Object.is(latestValue, baseValue);
            if (localChanged) {
                if (upstreamChanged && !Object.is(localValue, latestValue)) {
                    conflictFields.push(field);
                }
                merged = withField(merged, field, localValue);
            }
        }
        if (conflictFields.length > 0) {
            conflicts.push({ nodeId: local.nodeId, fields: conflictFields });
        }
        return merged;
    });
    return { edits, conflicts };
}
