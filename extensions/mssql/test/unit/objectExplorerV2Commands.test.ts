/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 native command primitives (B19): identifier bracket-quoting with
 * adversarial names, SELECT TOP generation + clamping, and the shared
 * stable profile id recipe that keys OE nodes to the Query Studio
 * open-from-context path.
 */

import { expect } from "chai";
import {
    bracketQuote,
    qualifiedName,
    selectTopSql,
} from "../../src/objectExplorer/v2/commands/sqlIdentifierFormatter";
import { stableProfileId } from "../../src/services/metadata/profileAuthAdapter";
import { readProfileTree } from "../../src/objectExplorer/v2/sessions/oeV2ProfileAdapter";

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

    test("selectTopSql: clamped limits, escaped identifiers, no interpolation leaks", () => {
        expect(selectTopSql("dbo", "Orders", 1000)).to.equal(
            "SELECT TOP (1000) *\nFROM [dbo].[Orders];\n",
        );
        expect(selectTopSql("dbo", "T", 0)).to.contain("TOP (1000)"); // invalid → default
        expect(selectTopSql("dbo", "T", 3.5)).to.contain("TOP (1000)");
        expect(selectTopSql("dbo", "T", 999_999)).to.contain("TOP (100000)"); // ceiling
        const hostile = selectTopSql("dbo", "x]; SHUTDOWN; --", 10);
        expect(hostile).to.contain("[x]]; SHUTDOWN; --]");
        expect(hostile).to.not.match(/FROM \[dbo\]\.\[x\];/);
    });

    test("stableProfileId: saved id wins; derivation matches the OE profile tree", async () => {
        expect(stableProfileId({ id: "guid-1", server: "s" })).to.equal("guid-1");
        const derived = stableProfileId({
            server: "srv",
            database: "Db",
            user: "u",
            authenticationType: "SqlLogin",
        });
        expect(derived).to.equal("srv|Db|u|SqlLogin");
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
});
