/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Readiness → child-node policy (oe_view_design §9.4/§13): ONLY `readyEmpty`
 * produces a no-items child. Loading, failed, stale, partial, permission
 * denied, unsupported, and data-plane-unavailable states each synthesize
 * their own explicit status/error child — failure is never emptiness.
 */

import { OeV2Node, OeV2Readiness } from "./oeV2Node";
import { encodePath } from "./oeV2Path";

export type ChildSynthesis =
    | { kind: "children" } // render the real children
    | { kind: "noItems" }
    | { kind: "loading" }
    | { kind: "status"; message: string; retryable: boolean }
    | { kind: "error"; message: string; retryable: boolean };

/** Decide what a container renders for a given readiness state. */
export function synthesizeChildren(readiness: OeV2Readiness, childCount: number): ChildSynthesis {
    switch (readiness.kind) {
        case "ready":
            return childCount === 0 ? { kind: "noItems" } : { kind: "children" };
        case "readyEmpty":
            return { kind: "noItems" };
        case "loading":
            return { kind: "loading" };
        case "stale":
        case "partial":
            // Render what we have; the container ALSO shows a status child.
            return { kind: "children" };
        case "failed":
            return {
                kind: "error",
                message: readiness.message ?? "Metadata failed to load.",
                retryable: readiness.retryable ?? true,
            };
        case "permissionDenied":
            return {
                kind: "status",
                message: readiness.message ?? "Permission denied.",
                retryable: false,
            };
        case "unsupported":
            return {
                kind: "status",
                message: readiness.message ?? "Not supported for this connection.",
                retryable: false,
            };
        case "dataPlaneUnavailable":
            return {
                kind: "status",
                message: readiness.message ?? "SQL Data Plane is disabled or unavailable.",
                retryable: true,
            };
        case "notApplicable":
        default:
            return { kind: "children" };
    }
}

/** Synthetic leaf nodes for the non-children syntheses. */
export function statusNode(scope: string, message: string, connectionId?: string): OeV2Node {
    const path = {
        kind: "status" as const,
        scope,
        ...(connectionId ? { connectionId } : {}),
    };
    return {
        id: encodePath(path),
        path,
        kind: "status",
        label: message,
        collapsible: false,
        readiness: { kind: "notApplicable" },
        capabilities: {},
    };
}

export function errorNode(
    scope: string,
    message: string,
    connectionId?: string,
    code?: string,
): OeV2Node {
    const path = {
        kind: "error" as const,
        scope,
        ...(connectionId ? { connectionId } : {}),
        ...(code ? { code } : {}),
    };
    return {
        id: encodePath(path),
        path,
        kind: "error",
        label: message,
        collapsible: false,
        readiness: { kind: "notApplicable" },
        capabilities: { canRefresh: true },
    };
}

export function loadingNode(scope: string, connectionId?: string): OeV2Node {
    const path = {
        kind: "status" as const,
        scope: `${scope}#loading`,
        ...(connectionId ? { connectionId } : {}),
    };
    return {
        id: encodePath(path),
        path,
        kind: "loading",
        label: "Loading…",
        collapsible: false,
        readiness: { kind: "notApplicable" },
        capabilities: {},
    };
}

export function noItemsNode(scope: string, connectionId?: string): OeV2Node {
    const path = {
        kind: "status" as const,
        scope: `${scope}#noItems`,
        ...(connectionId ? { connectionId } : {}),
    };
    return {
        id: encodePath(path),
        path,
        kind: "noItems",
        label: "No items",
        collapsible: false,
        readiness: { kind: "notApplicable" },
        capabilities: {},
    };
}
