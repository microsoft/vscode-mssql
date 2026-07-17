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
    disconnectedConnection: "disconnectedServer",
    database: "Database",
    object: "Table", // policy limits object-kind handoff to tables (editTable)
};

/**
 * Minimal SMO-style database URN. Classic nodes carry STS-produced URNs like
 * `Server[@Name='HOST']/Database[@Name='X']`; the true SMO server NetName is
 * unknowable here, so the server segment stays unnamed and resolves against
 * the connected server (rename/drop handlers pass it through to SMO).
 */
function databaseUrn(database: string): string {
    return `Server/Database[@Name='${database.replace(/'/g, "''")}']`;
}

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
        syntheticDatabaseParent(node, nodeType, database, ownerUri, scopedProfile),
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
            : nodeType === "Database" && database !== undefined
              ? {
                    // Classic handlers read metadata.name for the database and
                    // metadata.urn for SMO-addressed operations (rename/drop).
                    metadataType: 0,
                    metadataTypeName: "Database",
                    schema: "",
                    name: database,
                    urn: databaseUrn(database),
                }
              : undefined,
    );
}

/**
 * Classic command handlers resolve the target database by walking the node's
 * parentNode chain until they hit a node whose metadata says "Database"
 * (TableDesignerWebviewController.getDatabaseNameForNode,
 * ObjectExplorerUtils.getDatabaseName). A synthetic node with no parent makes
 * those walks come up empty and the handlers silently fall back to "master" —
 * the Table Designer then builds its DacFx model against the wrong catalog and
 * fails with "could not be found in the model". Give object-kind nodes a
 * minimal parent Database node so the classic walks land on the real database.
 */
function syntheticDatabaseParent(
    node: OeV2Node,
    nodeType: string,
    database: string | undefined,
    ownerUri: string,
    scopedProfile: IConnectionProfile,
): TreeNodeInfo {
    if (nodeType === "Database" || node.kind !== "object" || database === undefined) {
        return undefined as unknown as TreeNodeInfo;
    }
    return new TreeNodeInfo(
        database,
        {
            type: "Database",
            subType: "",
            filterable: false,
            hasFilters: false,
        },
        vscode.TreeItemCollapsibleState.None,
        `oe2-handoff/Database/${database}`,
        "Online",
        "Database",
        ownerUri,
        scopedProfile,
        undefined as unknown as TreeNodeInfo,
        [],
        "",
        {
            metadataType: 0,
            metadataTypeName: "Database",
            schema: "",
            name: database,
            urn: databaseUrn(database),
        },
    );
}
