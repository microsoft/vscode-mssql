/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 explicit legacy handoff (B20): the policy table drives exposure,
 * the handoff service silently creates exactly one guarded classic
 * connection per v2 connection (secret-free owner URIs, idle TTL,
 * close-on-disconnect, failure isolation), and the H2 adapter synthesizes
 * classic nodes only for adaptable kinds.
 */

import { expect } from "chai";
import {
    LEGACY_COMMAND_POLICIES,
    policiesForNode,
} from "../../src/objectExplorer/v2/commands/oeV2LegacyCommandPolicy";
import {
    HandoffConnectionSeam,
    OeV2ClassicHandoffService,
} from "../../src/objectExplorer/v2/legacy/oeV2ClassicHandoffService";
import { toLegacyTreeNode } from "../../src/objectExplorer/v2/legacy/oeV2LegacyNodeAdapter";
import { IConnectionProfile } from "../../src/models/interfaces";
import { OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";
import { encodePath } from "../../src/objectExplorer/v2/tree/oeV2Path";
import { initializeIconUtils } from "./utils";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PROFILE = {
    server: "secret-server.example.internal",
    database: "AppDb",
    user: "user@example.com",
} as unknown as IConnectionProfile;

function seam(overrides?: Partial<HandoffConnectionSeam>) {
    const calls: { connect: string[]; disconnect: string[] } = { connect: [], disconnect: [] };
    const connections: HandoffConnectionSeam = {
        connect: async (ownerUri) => {
            calls.connect.push(ownerUri);
            return true;
        },
        disconnect: async (ownerUri) => {
            calls.disconnect.push(ownerUri);
            return true;
        },
        ...overrides,
    };
    return { connections, calls };
}

function databaseNode(): OeV2Node {
    const path = { kind: "database" as const, connectionId: "p1", database: "AppDb" };
    return {
        id: encodePath(path),
        path,
        kind: "database",
        label: "AppDb",
        collapsible: true,
        connectionId: "p1",
        database: "AppDb",
        readiness: { kind: "notApplicable" },
        capabilities: {},
    };
}

suite("Object Explorer v2 legacy handoff (B20)", () => {
    suiteSetup(() => {
        initializeIconUtils(); // TreeNodeInfo resolves icons in its ctor
    });

    test("policy table: exposure by node kind, H1/H2 levels only, no H3", () => {
        expect(policiesForNode("database").map((p) => p.feature)).to.deep.equal([
            "backupDatabase",
            "restoreDatabase",
            "profiler",
            "schemaCompare",
        ]);
        expect(policiesForNode("object").map((p) => p.feature)).to.deep.equal(["editTable"]);
        expect(policiesForNode("databaseFolder")).to.deep.equal([]);
        expect(policiesForNode("disconnectedConnection")).to.deep.equal([]);
        for (const policy of LEGACY_COMMAND_POLICIES) {
            expect(["h1", "h2"]).to.contain(policy.level);
        }
    });

    test("handoff: silent (no prompt), one connection per v2 connection, reuse, close", async () => {
        const { connections, calls } = seam();
        const service = new OeV2ClassicHandoffService(connections, {
            uriNonce: () => "nonce",
        });

        // handoff is silent — exactly one connection with a secret-free owner URI
        const ownerUri = await service.ensureOwnerUri(
            "p1",
            "sfp_abcdef123456",
            PROFILE,
            "profiler",
        );
        expect(ownerUri).to.equal("objectexplorerv2://handoff/sfp_abcdef12/nonce");
        expect(ownerUri).to.not.contain("secret-server");
        expect(ownerUri).to.not.contain("user@example.com");
        expect(calls.connect).to.deep.equal([ownerUri]);

        // second feature on the same connection REUSES (no second connect)
        const again = await service.ensureOwnerUri("p1", "sfp_abcdef123456", PROFILE, "backup");
        expect(again).to.equal(ownerUri);
        expect(calls.connect).to.have.length(1);

        expect(service.hasHandoff("p1")).to.equal(true);
        await service.close("p1");
        expect(service.hasHandoff("p1")).to.equal(false);
        expect(calls.disconnect).to.deep.equal([ownerUri]);
        service.dispose();
    });

    test("handoff: connect failure is isolated; idle TTL closes automatically", async () => {
        const failing = seam({
            connect: async () => {
                throw new Error("classic connect exploded");
            },
        });
        const service = new OeV2ClassicHandoffService(failing.connections, {});
        expect(await service.ensureOwnerUri("p1", "sfp_x", PROFILE, "profiler")).to.equal(
            undefined,
        );
        expect(service.hasHandoff("p1")).to.equal(false);

        const { connections, calls } = seam();
        const ttlService = new OeV2ClassicHandoffService(connections, { idleTtlMs: 5 });
        const uri = await ttlService.ensureOwnerUri("p1", "sfp_x", PROFILE, "profiler");
        expect(uri).to.not.equal(undefined);
        await sleep(30);
        expect(ttlService.hasHandoff("p1")).to.equal(false);
        expect(calls.disconnect).to.have.length(1);
        ttlService.dispose();
    });

    test("H2 adapter: adaptable kinds get classic identity; others refuse", () => {
        const adapted = toLegacyTreeNode(databaseNode(), "owner-uri", PROFILE)!;
        expect(adapted).to.not.equal(undefined);
        expect(adapted.nodeType).to.equal("Database");
        expect(adapted.sessionId).to.equal("owner-uri");
        expect((adapted.connectionProfile as { database?: string }).database).to.equal("AppDb");

        const folder: OeV2Node = {
            ...databaseNode(),
            kind: "databaseFolder",
        };
        expect(toLegacyTreeNode(folder, "owner-uri", PROFILE)).to.equal(undefined);
    });

    test("H2 adapter: object nodes get a synthetic parent Database node so classic database walks resolve", () => {
        const path = {
            kind: "object" as const,
            connectionId: "p1",
            database: "AppDb",
            schema: "dbo",
            name: "Suppliers",
            objectKind: "table" as const,
        };
        const node: OeV2Node = {
            id: encodePath(path),
            path,
            kind: "object",
            label: "dbo.Suppliers",
            collapsible: true,
            connectionId: "p1",
            database: "AppDb",
            schema: "dbo",
            objectName: "Suppliers",
            readiness: { kind: "notApplicable" },
            capabilities: {},
        };
        const adapted = toLegacyTreeNode(node, "owner-uri", PROFILE)!;
        expect(adapted.nodeType).to.equal("Table");
        expect(adapted.metadata?.schema).to.equal("dbo");
        expect(adapted.metadata?.name).to.equal("Suppliers");

        // Classic handlers (TableDesignerWebviewController.getDatabaseNameForNode,
        // ObjectExplorerUtils.getDatabaseName) walk parentNode until they find a
        // node whose metadata says "Database". Without a parent they silently
        // fall back to "master" and the Table Designer model targets the wrong
        // catalog.
        const parent = adapted.parentNode;
        expect(parent, "object node must carry a synthetic Database parent").to.not.equal(
            undefined,
        );
        expect(parent.nodeType).to.equal("Database");
        expect(parent.metadata?.metadataTypeName).to.equal("Database");
        expect(parent.metadata?.name).to.equal("AppDb");
        expect(parent.parentNode).to.equal(undefined);

        // Database-kind nodes are their own database context — no parent chain.
        expect(toLegacyTreeNode(databaseNode(), "owner-uri", PROFILE)!.parentNode).to.equal(
            undefined,
        );
    });
});
