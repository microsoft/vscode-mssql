/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B26 (OE_V1_PARITY_PLAN K5): group management from OE v2 — the drag-drop
 * semantics over the SHARED classic storage (connection→group, group
 * re-parent with the cycle guard, root drops) and the descendant walk
 * itself. Dialog/delete flows reuse classic pieces and are covered by the
 * classic suites; what's OURS is the routing and the guards.
 */

import { expect } from "chai";
import * as vscode from "vscode";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import {
    OeV2DragAndDropController,
    wouldCreateCycle,
} from "../../src/objectExplorer/v2/commands/oeV2GroupCommands";
import { NOT_APPLICABLE, OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";
import { stableProfileId } from "../../src/services/metadata/profileAuthAdapter";

interface FakeGroup {
    id: string;
    name: string;
    parentId?: string;
}

interface FakeProfile {
    id?: string;
    server: string;
    groupId?: string;
}

function fakeConfig(groups: FakeGroup[], connections: FakeProfile[]) {
    const updates: { kind: string; value: unknown }[] = [];
    const config = {
        getGroups: async () => groups,
        getConnections: async () => connections,
        updateConnection: async (profile: FakeProfile) => {
            updates.push({ kind: "connection", value: profile });
        },
        updateGroup: async (group: FakeGroup) => {
            updates.push({ kind: "group", value: group });
        },
        removeGroup: async (id: string, mode: string) => {
            updates.push({ kind: "remove", value: { id, mode } });
        },
    };
    return { config: config as unknown as ConnectionConfig, updates };
}

function groupNode(groupId: string): OeV2Node {
    return {
        id: `oe2:connectionGroup/${groupId}`,
        path: { kind: "connectionGroup", groupId },
        kind: "connectionGroup",
        label: groupId,
        collapsible: true,
        readiness: NOT_APPLICABLE,
        capabilities: {},
    };
}

function connectionNodeFor(profile: FakeProfile): OeV2Node {
    const connectionId = stableProfileId(profile);
    return {
        id: `oe2:connection/${connectionId}`,
        path: { kind: "connection", connectionId },
        kind: "disconnectedConnection",
        label: profile.server,
        collapsible: true,
        connectionId,
        readiness: NOT_APPLICABLE,
        capabilities: {},
    };
}

async function drag(controller: OeV2DragAndDropController, node: OeV2Node) {
    const transfer = new vscode.DataTransfer();
    controller.handleDrag([node], transfer);
    return transfer;
}

suite("Object Explorer v2 groups (B26)", () => {
    const GROUPS: FakeGroup[] = [
        { id: "ROOT", name: "ROOT" },
        { id: "g1", name: "Team", parentId: "ROOT" },
        { id: "g2", name: "Prod", parentId: "g1" },
        { id: "g3", name: "Other", parentId: "ROOT" },
    ];

    test("cycle guard: self, descendant, and deep chains refuse; siblings allow", () => {
        expect(wouldCreateCycle(GROUPS, "g1", "g1")).to.equal(true); // self
        expect(wouldCreateCycle(GROUPS, "g1", "g2")).to.equal(true); // child
        expect(wouldCreateCycle(GROUPS, "ROOT", "g2")).to.equal(true); // deep
        expect(wouldCreateCycle(GROUPS, "g2", "g3")).to.equal(false);
        expect(wouldCreateCycle(GROUPS, "g3", "g1")).to.equal(false);
    });

    test("drop: connection onto a group updates its groupId (shared storage)", async () => {
        const profile: FakeProfile = { id: "p1", server: "srv", groupId: "ROOT" };
        const { config, updates } = fakeConfig(GROUPS, [profile]);
        const dnd = new OeV2DragAndDropController(() => config);
        const transfer = await drag(dnd, connectionNodeFor(profile));
        await dnd.handleDrop(groupNode("g2"), transfer);
        expect(updates).to.have.length(1);
        expect(updates[0].kind).to.equal("connection");
        expect((updates[0].value as FakeProfile).groupId).to.equal("g2");
    });

    test("drop: connection onto empty space moves it to the root group", async () => {
        const profile: FakeProfile = { id: "p1", server: "srv", groupId: "g2" };
        const { config, updates } = fakeConfig(GROUPS, [profile]);
        const dnd = new OeV2DragAndDropController(() => config);
        const transfer = await drag(dnd, connectionNodeFor(profile));
        await dnd.handleDrop(undefined, transfer);
        expect((updates[0].value as FakeProfile).groupId).to.equal("ROOT");
    });

    test("drop: group re-parents; cycle drops are refused without writes", async () => {
        const { config, updates } = fakeConfig(GROUPS, []);
        const dnd = new OeV2DragAndDropController(() => config);
        const okTransfer = await drag(dnd, groupNode("g3"));
        await dnd.handleDrop(groupNode("g1"), okTransfer);
        expect(updates).to.have.length(1);
        expect(updates[0].kind).to.equal("group");
        expect((updates[0].value as FakeGroup).parentId).to.equal("g1");

        const cycleTransfer = await drag(dnd, groupNode("g1"));
        await dnd.handleDrop(groupNode("g2"), cycleTransfer); // g2 is g1's child
        expect(updates).to.have.length(1); // no second write
    });

    test("drop onto a non-group node is a no-op; same-place drops write nothing", async () => {
        const profile: FakeProfile = { id: "p1", server: "srv", groupId: "g2" };
        const { config, updates } = fakeConfig(GROUPS, [profile]);
        const dnd = new OeV2DragAndDropController(() => config);
        const transfer = await drag(dnd, connectionNodeFor(profile));
        await dnd.handleDrop(connectionNodeFor({ id: "p2", server: "other" }), transfer);
        expect(updates).to.have.length(0);
        await dnd.handleDrop(groupNode("g2"), transfer); // already there
        expect(updates).to.have.length(0);
    });

    test("drag: only connections and groups are draggable", async () => {
        const { config } = fakeConfig(GROUPS, []);
        const dnd = new OeV2DragAndDropController(() => config);
        const folder: OeV2Node = {
            id: "oe2:serverFolder/c1/databases",
            path: { kind: "serverFolder", connectionId: "c1", folder: "databases" },
            kind: "serverFolder",
            label: "Databases",
            collapsible: true,
            readiness: NOT_APPLICABLE,
            capabilities: {},
        };
        const transfer = await drag(dnd, folder);
        expect(transfer.get(OeV2DragAndDropController.MIME)).to.equal(undefined);
    });
});
