/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OeV2TreeController (B17 scope): computes tree children from injected
 * sources — saved profiles/groups and the data-plane availability probe.
 * Pure module: no vscode, no data-plane singletons, NO classic OE anything.
 * Connect/browse arrives in B18 through the session registry seam; today a
 * connection node expands to an explicit connect hint (no auto-connect).
 *
 * The no-v1 rule is structural here: this module has no import path that
 * could reach ConnectionManager or classic OE RPCs.
 */

import {
    ConnectionProfileSource,
    OeV2ProfileTree,
    readProfileTree,
} from "../sessions/oeV2ProfileAdapter";
import { OeV2Node } from "./oeV2Node";
import { childrenOfGroup, rootChildren } from "./oeV2NodeFactory";
import { statusNode } from "./oeV2Readiness";

export interface DataPlaneProbe {
    enabled(): boolean;
    availabilityState(): "unknown" | "available" | "unavailable";
}

export interface OeV2TreeControllerDeps {
    readonly profiles: ConnectionProfileSource;
    readonly dataPlane: DataPlaneProbe;
}

export class OeV2TreeController {
    private tree: OeV2ProfileTree | undefined;
    private listeners = new Set<(node?: OeV2Node) => void>();

    constructor(private readonly deps: OeV2TreeControllerDeps) {}

    onDidChange(listener: (node?: OeV2Node) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Invalidate cached sources and notify the view (config/store change). */
    refresh(): void {
        this.tree = undefined;
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                /* listener isolation */
            }
        }
    }

    async children(node?: OeV2Node): Promise<OeV2Node[]> {
        if (!node) {
            return this.rootLevel();
        }
        switch (node.path.kind) {
            case "connectionGroup":
                return childrenOfGroup(await this.profileTree(), node.path.groupId);
            case "connection":
                // B18 replaces this with the session registry connect flow.
                return [
                    statusNode(
                        `connection/${node.path.connectionId}`,
                        "Use 'Connect' on this profile to browse (OE v2 preview).",
                        node.path.connectionId,
                    ),
                ];
            default:
                return [];
        }
    }

    private async rootLevel(): Promise<OeV2Node[]> {
        if (!this.deps.dataPlane.enabled()) {
            return [
                statusNode(
                    "dataPlane",
                    "Object Explorer v2 requires the SQL Data Plane. Enable mssql.sqlDataPlane.enabled, then reload.",
                ),
            ];
        }
        const tree = await this.profileTree();
        const children = rootChildren(tree);
        if (children.length === 0) {
            return [
                statusNode(
                    "root",
                    "No saved connection profiles. Create one with 'MS SQL: Add Connection'.",
                ),
            ];
        }
        return children;
    }

    private async profileTree(): Promise<OeV2ProfileTree> {
        if (!this.tree) {
            this.tree = await readProfileTree(this.deps.profiles);
        }
        return this.tree;
    }
}
