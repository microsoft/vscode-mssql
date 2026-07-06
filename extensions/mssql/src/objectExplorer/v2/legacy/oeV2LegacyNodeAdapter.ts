/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * H2 node adapter (oe_view_design §12.3): best-effort classic TreeNodeInfo
 * synthesized from an OeV2Node + a handoff owner URI, for classic commands
 * that expect a node argument. This module lives under legacy/** — the ONE
 * place OE v2 may import classic Object Explorer types (lint-enforced).
 * A synthetic node is an identity hint, not proof a classic/SMO path can
 * consume it — every consumer is policy-listed and failure-guarded.
 */

import * as vscode from "vscode";
import { IConnectionProfile } from "../../../models/interfaces";
import { TreeNodeInfo } from "../../../objectExplorer/nodes/treeNodeInfo";
import { OeV2Node } from "../tree/oeV2Node";

const NODE_TYPE_BY_KIND: Partial<Record<OeV2Node["kind"], string>> = {
    connectedServer: "Server",
    database: "Database",
    object: "Table", // policy limits object-kind handoff to tables (editTable)
};

export function toLegacyTreeNode(
    node: OeV2Node,
    ownerUri: string,
    profile: IConnectionProfile,
): TreeNodeInfo | undefined {
    const nodeType = NODE_TYPE_BY_KIND[node.kind];
    if (!nodeType) {
        return undefined;
    }
    const database = node.database ?? (profile as { database?: string }).database;
    // Classic profiles carry the database the command should target.
    const scopedProfile =
        database !== undefined ? ({ ...profile, database } as IConnectionProfile) : profile;
    const label =
        node.kind === "object" && node.schema && node.objectName
            ? `${node.schema}.${node.objectName}`
            : node.label;
    const nodePath = `oe2-handoff/${nodeType}/${label}`;
    return new TreeNodeInfo(
        label,
        {
            type: nodeType,
            subType: "",
            filterable: false,
            hasFilters: false,
        },
        vscode.TreeItemCollapsibleState.None,
        nodePath,
        "Online",
        nodeType,
        ownerUri,
        scopedProfile,
        undefined as unknown as TreeNodeInfo,
        [],
        "",
        node.kind === "object" && node.schema && node.objectName
            ? {
                  metadataType: 0,
                  metadataTypeName: "Table",
                  schema: node.schema,
                  name: node.objectName,
                  urn: "",
              }
            : undefined,
    );
}
