/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio diagnostics context (A2 §6.3): every command that starts,
 * cancels, approves, or persists creates a ROOT trace; a run keeps its trace
 * for its whole lifetime (including approval waits longer than the ambient
 * root window), and all async work carries the context EXPLICITLY —
 * `diag.withTrace` is only for synchronous scopes.
 */

import { diag, newTraceId, type RawField } from "../diagnostics/diagnosticsCore";
import type { DiagStatus } from "../sharedInterfaces/debugConsole";

export interface RunbookOperationContext {
    traceId: string;
    operationId: string;
    causeEventId?: string;
    runId?: string;
    nodeId?: string;
    activityInvocationId?: string;
    attempt?: number;
    replayTraceId?: string;
    replayRunId?: string;
    replayMatrixCellId?: string;
}

let operationCounter = 0;

function nextOperationId(): string {
    operationCounter++;
    return `rbsop_${Date.now().toString(36)}_${operationCounter.toString(36)}`;
}

/** Root context for a user-initiated Runbook Studio operation. */
export function newRunbookRootContext(hint: string): RunbookOperationContext {
    return { traceId: newTraceId(`rbs${hint}`), operationId: nextOperationId() };
}

/** Child context: same trace, fresh operation id, optional run/node focus. */
export function childRunbookContext(
    parent: RunbookOperationContext,
    overrides?: Partial<Pick<RunbookOperationContext, "runId" | "nodeId" | "attempt">>,
): RunbookOperationContext {
    return {
        ...parent,
        operationId: nextOperationId(),
        ...(overrides ?? {}),
    };
}

/** diagnostic.metadata field shorthand (counts, ids, enums — never content). */
export function metaField(raw: unknown): RawField {
    return { raw, cls: "diagnostic.metadata" };
}

function entityFor(context: RunbookOperationContext): { kind: string; id: string } | undefined {
    return context.runId ? { kind: "runbookRun", id: context.runId } : undefined;
}

function contextFields(context: RunbookOperationContext): Record<string, RawField> {
    const fields: Record<string, RawField> = {
        operationId: metaField(context.operationId),
    };
    if (context.runId) {
        fields.runId = metaField(context.runId);
    }
    if (context.nodeId) {
        fields.nodeId = metaField(context.nodeId);
    }
    if (context.attempt !== undefined) {
        fields.attempt = metaField(context.attempt);
    }
    if (context.activityInvocationId) {
        fields.activityInvocationId = metaField(context.activityInvocationId);
    }
    if (context.replayRunId) {
        fields.replayRunId = metaField(context.replayRunId);
    }
    return fields;
}

/** Instant runbookStudio diagnostic event carrying the explicit context. */
export function emitRunbookEvent(
    context: RunbookOperationContext,
    type: string,
    status: DiagStatus,
    fields?: Record<string, RawField>,
): void {
    if (!diag.anySinkActive) {
        return;
    }
    diag.emit({
        feature: "runbookStudio",
        kind: "event",
        type,
        status,
        traceId: context.traceId,
        ...(context.causeEventId ? { causeEventId: context.causeEventId } : {}),
        ...(entityFor(context) ? { entity: entityFor(context) } : {}),
        fields: { ...contextFields(context), ...(fields ?? {}) },
    });
}

export interface RunbookDiagSpan {
    end(status?: DiagStatus, fields?: Record<string, RawField>): void;
    fail(error: unknown): void;
}

const NOOP_SPAN: RunbookDiagSpan = { end: () => undefined, fail: () => undefined };

/** Span with the explicit run trace; near no-op when no sink is active. */
export function startRunbookSpan(
    context: RunbookOperationContext,
    type: string,
    fields?: Record<string, RawField>,
): RunbookDiagSpan {
    if (!diag.anySinkActive) {
        return NOOP_SPAN;
    }
    const span = diag.startSpan({
        feature: "runbookStudio",
        kind: "span",
        type,
        traceId: context.traceId,
        ...(entityFor(context) ? { entity: entityFor(context) } : {}),
        fields: { ...contextFields(context), ...(fields ?? {}) },
    });
    return {
        end: (status?: DiagStatus, endFields?: Record<string, RawField>) =>
            span.end(status ?? "ok", endFields),
        fail: (error: unknown) => span.fail(error),
    };
}
