/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Synthetic readiness/status leaves used by the OE v2 render paths. */

import { OeV2Node } from "./oeV2Node";
import { encodePath } from "./oeV2Path";
import { ObjectExplorerV2 } from "../../../constants/locConstants";

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
        label: ObjectExplorerV2.loading,
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
        label: ObjectExplorerV2.noItems,
        collapsible: false,
        readiness: { kind: "notApplicable" },
        capabilities: {},
    };
}
