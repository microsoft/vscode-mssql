/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OeV2Node (oe_view_design §9.1): the pure tree record. NOT a
 * vscode.TreeItem — the provider converts at the edge. Pure modules under
 * tree/ never import vscode, classic OE types, or data-plane singletons.
 */

import { OeV2Path } from "./oeV2Path";

export type OeV2NodeKind =
    | "root"
    | "connectionGroup"
    | "disconnectedConnection"
    | "connectingConnection"
    | "connectedServer"
    | "lostConnection"
    | "serverFolder"
    | "database"
    | "databaseFolder"
    | "schema"
    | "object"
    | "objectFolder"
    | "column"
    | "parameter"
    | "key"
    | "foreignKey"
    | "loading"
    | "status"
    | "error"
    | "unsupported"
    | "noItems";

export type OeV2ReadinessKind =
    | "notApplicable"
    | "loading"
    | "ready"
    | "readyEmpty"
    | "stale"
    | "partial"
    | "failed"
    | "permissionDenied"
    | "unsupported"
    | "dataPlaneUnavailable";

export interface OeV2Readiness {
    readonly kind: OeV2ReadinessKind;
    readonly message?: string;
    readonly generation?: number;
    readonly retryable?: boolean;
}

export const READY: OeV2Readiness = { kind: "ready" };
export const NOT_APPLICABLE: OeV2Readiness = { kind: "notApplicable" };

export interface OeV2NodeCapabilities {
    readonly canConnect?: boolean;
    readonly canDisconnect?: boolean;
    readonly canRefresh?: boolean;
    readonly canFilter?: boolean;
    readonly canSearch?: boolean;
    readonly canCopyName?: boolean;
    readonly canCopyQualifiedName?: boolean;
    readonly canOpenQuery?: boolean;
    readonly canSelectTop?: boolean;
    readonly canPreviewTable?: boolean;
    /** Legacy features reachable via explicit handoff (B20). */
    readonly legacyHandoff?: readonly string[];
}

export const NO_CAPABILITIES: OeV2NodeCapabilities = {};

export interface OeV2Node {
    /** Encoded path — the node's stable identity. */
    readonly id: string;
    readonly path: OeV2Path;
    readonly kind: OeV2NodeKind;
    readonly label: string;
    readonly description?: string;
    readonly tooltip?: string;
    readonly collapsible: boolean;
    readonly connectionId?: string;
    readonly database?: string;
    readonly schema?: string;
    readonly objectName?: string;
    readonly readiness: OeV2Readiness;
    readonly capabilities: OeV2NodeCapabilities;
    /** Icon name resolved against media/objectTypes at the vscode edge. */
    readonly icon?: string;
    /** Group accent color (connection groups only). */
    readonly color?: string;
}
