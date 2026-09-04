/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 native command primitives (B19): identifier bracket-quoting with
 * adversarial names and the shared stable profile id recipe that keys OE
 * nodes consistently with the metadata profile tree.
 */

import { expect } from "chai";
import {
    bracketQuote,
    qualifiedName,
} from "../../src/objectExplorer/v2/commands/sqlIdentifierFormatter";
import { stableProfileId } from "../../src/services/metadata/profileAuthAdapter";
import { readProfileTree } from "../../src/objectExplorer/v2/sessions/oeV2ProfileAdapter";
import { copyNameForNode } from "../../src/objectExplorer/v2/commands/oeV2NativeCommands";
import { OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";

suite("Object Explorer v2 command primitives (B19)", () => {
    test("bracketQuote: adversarial identifiers are contained", () => {
        expect(bracketQuote("Orders")).to.equal("[Orders]");
        expect(bracketQuote("evil]name")).to.equal("[evil]]name]");
        expect(bracketQuote("];DROP TABLE x;--")).to.equal("[]];DROP TABLE x;--]");
        expect(bracketQuote("with space")).to.equal("[with space]");
        expect(bracketQuote("select")).to.equal("[select]"); // keyword
        expect(bracketQuote("ünïcode")).to.equal("[ünïcode]");
        expect(qualifiedName("sales]x", "T")).to.equal("[sales]]x].[T]");
    });

    test("stableProfileId: saved id wins; derivation matches the OE profile tree", async () => {
        expect(stableProfileId({ id: "guid-1", server: "s" })).to.equal("guid-1");
        const derived = stableProfileId({
            server: "srv",
            database: "Db",
            user: "u",
            authenticationType: "SqlLogin",
        });
        expect(derived).to.equal('["srv","Db","u","","SqlLogin"]');
        // The OE v2 profile tree derives the SAME id (open-from-context key)
        const tree = await readProfileTree({
            readAllConnectionGroups: async () => [],
            readAllConnections: async () => [
                { server: "srv", database: "Db", user: "u", authenticationType: "SqlLogin" },
            ],
        });
        expect(tree.profiles[0].profileId).to.equal(derived);
    });

    test("group-less profiles surface at the root level (harness/settings-written)", async () => {
        const { rootChildren } = await import("../../src/objectExplorer/v2/tree/oeV2NodeFactory");
        const tree = await readProfileTree({
            readAllConnectionGroups: async () => [{ id: "ROOT", name: "ROOT" }],
            // no groupId — the shape the perf harness (and hand-edited
            // settings) produce; must not be invisible in the v2 tree
            readAllConnections: async () => [{ server: "srv", profileName: "NoGroup" }],
        });
        const roots = rootChildren(tree);
        expect(roots.map((n) => `${n.kind}:${n.label}`)).to.deep.equal([
            "disconnectedConnection:NoGroup",
        ]);
    });

    test("copy name uses the selected leaf label, not inherited parent identity", () => {
        const node = (kind: OeV2Node["kind"], label: string, objectName?: string) =>
            ({ kind, label, objectName }) as OeV2Node;

        expect(copyNameForNode(node("object", "dbo.Orders (External)", "Orders"))).to.equal(
            "Orders",
        );
        expect(copyNameForNode(node("databaseObject", "dbo.Audit", "Audit"))).to.equal("Audit");
        expect(copyNameForNode(node("column", "OrderId", "Orders"))).to.equal("OrderId");
        expect(copyNameForNode(node("parameter", "@customerId", "GetOrders"))).to.equal(
            "@customerId",
        );
        expect(copyNameForNode(node("key", "PK_Orders"))).to.equal("PK_Orders");
    });
});
