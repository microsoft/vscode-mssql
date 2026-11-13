/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Durable observability identity (final plan WI-0.1 / addendum §3.2).
 *
 * Ring-local counter ids ("E-1") are display ordinals only — they collide
 * across restarts and imports. Everything that persists or crosses planes
 * uses a globally unique id from here. Timestamps are separate sort fields;
 * labels never encode uniqueness assumptions.
 */

import { randomUUID } from "crypto";
import {
    OBSERVABILITY_LINK_SCHEMA,
    ObservabilityEditorSurface,
    ObservabilityLinkV1,
} from "../../sharedInterfaces/observabilityLink";

/**
 * Short kind prefixes keep logs/greppability readable; uniqueness comes from
 * the UUID alone.
 */
export function newCaptureSessionId(): string {
    return `cs-${randomUUID()}`;
}

export function newCaptureEventId(): string {
    return `ce-${randomUUID()}`;
}

export function newReplayRunId(): string {
    return `rr-${randomUUID()}`;
}

export function newReplayItemId(): string {
    return `ri-${randomUUID()}`;
}

export function newBundleId(): string {
    return `ob-${randomUUID()}`;
}

export function newLeaseId(): string {
    return `vl-${randomUUID()}`;
}

export interface CreateObservabilityLinkInput {
    featureId: string;
    hostSessionId: string;
    captureSessionId: string;
    traceId?: string;
    causeEventId?: string;
    editorSurface?: ObservabilityEditorSurface;
}

/** Allocate a fresh logical event identity within a capture session. */
export function createObservabilityLink(input: CreateObservabilityLinkInput): ObservabilityLinkV1 {
    return {
        schema: OBSERVABILITY_LINK_SCHEMA,
        featureId: input.featureId,
        hostSessionId: input.hostSessionId,
        captureSessionId: input.captureSessionId,
        captureEventId: newCaptureEventId(),
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.causeEventId ? { causeEventId: input.causeEventId } : {}),
        ...(input.editorSurface ? { editorSurface: input.editorSurface } : {}),
    };
}
