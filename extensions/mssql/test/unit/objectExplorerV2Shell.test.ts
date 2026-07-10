/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 shell (B17): structured path codec round-trips, pure node factory +
 * group hierarchy, readiness→child synthesis honesty, capability-driven
 * context values, controller root/unavailable behaviors — and the NO-V1
 * TRIPWIRE: browse operations never touch SqlToolsServiceClient requests or
 * ConnectionManager.connect (oe_view_design §7.5/§16.4).
 */

import { expect } from "chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import ConnectionManager from "../../src/controllers/connectionManager";
import { decodePath, encodePath, OeV2Path } from "../../src/objectExplorer/v2/tree/oeV2Path";
import {
    capabilitiesFor,
    contextValueFor,
} from "../../src/objectExplorer/v2/tree/oeV2Capabilities";
import { synthesizeChildren } from "../../src/objectExplorer/v2/tree/oeV2Readiness";
import { rootChildren } from "../../src/objectExplorer/v2/tree/oeV2NodeFactory";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import {
    ConnectionProfileSource,
    readProfileTree,
} from "../../src/objectExplorer/v2/sessions/oeV2ProfileAdapter";

const HOSTILE = `we|ird]name%2F with / and % and [brackets]`;

function fakeSource(overrides?: Partial<ConnectionProfileSource>): ConnectionProfileSource {
    return {
        readAllConnectionGroups: async () => [
            { id: "ROOT", name: "ROOT" },
            { id: "g1", name: "Team", parentId: "ROOT", color: "#ff0000" },
            { id: "g2", name: "Alpha", parentId: "ROOT" },
        ],
        readAllConnections: async () => [
            {
                id: "p2",
                server: "srv-b",
                profileName: "Beta",
                groupId: "ROOT",
                authenticationType: "SqlLogin",
                user: "u",
            },
            { id: "p1", server: "srv-a", profileName: "Aleph", groupId: "ROOT" },
            { id: "p3", server: "srv-c", database: "AppDb", groupId: "g1" },
        ],
        ...overrides,
    };
}

suite("Object Explorer v2 shell (B17)", () => {
    test("path codec: round-trips every kind incl. hostile identifiers", () => {
        const paths: OeV2Path[] = [
            { kind: "root" },
            { kind: "connectionGroup", groupId: HOSTILE },
            { kind: "connection", connectionId: "p1" },
            { kind: "serverFolder", connectionId: "p1", folder: "databases" },
            { kind: "database", connectionId: "p1", database: HOSTILE },
            { kind: "databaseFolder", connectionId: "p1", database: "Db", folder: "tables" },
            { kind: "schema", connectionId: "p1", database: "Db", schema: HOSTILE },
            {
                kind: "schemaFolder",
                connectionId: "p1",
                database: "Db",
                schema: "s",
                folder: "views",
            },
            {
                kind: "object",
                connectionId: "p1",
                database: "Db",
                schema: "dbo",
                name: HOSTILE,
                objectKind: "table",
            },
            {
                kind: "objectFolder",
                connectionId: "p1",
                database: "Db",
                schema: "dbo",
                name: "T",
                objectKind: "table",
                folder: "columns",
            },
            {
                kind: "column",
                connectionId: "p1",
                database: "Db",
                schema: "dbo",
                objectName: "T",
                column: HOSTILE,
            },
            {
                kind: "parameter",
                connectionId: "p1",
                database: "Db",
                schema: "dbo",
                objectName: "P",
                parameter: "@x",
                ordinal: 3,
            },
            { kind: "status", scope: "dataPlane" },
            { kind: "error", scope: "db/Db", connectionId: "p1", code: "E42" },
        ];
        for (const path of paths) {
            const encoded = encodePath(path);
            expect(encoded.startsWith("oe2:")).to.equal(true);
            expect(decodePath(encoded)).to.deep.equal(path);
        }
        // distinct ids for distinct paths
        expect(new Set(paths.map(encodePath)).size).to.equal(paths.length);
        // foreign/corrupt ids are rejected, not guessed
        expect(decodePath("metadata-v1:/server")).to.equal(undefined);
        expect(decodePath("oe2:nonsense")).to.equal(undefined);
        expect(decodePath("oe2:parameter/a/b/c/d/e/not-a-number")).to.equal(undefined);
    });

    test("profile tree + factory: groups-first alphabetical, ROOT hierarchy", async () => {
        const tree = await readProfileTree(fakeSource());
        const nodes = rootChildren(tree);
        expect(nodes.map((n) => `${n.kind}:${n.label}`)).to.deep.equal([
            "connectionGroup:Alpha",
            "connectionGroup:Team",
            "disconnectedConnection:Aleph",
            "disconnectedConnection:Beta",
        ]);
        expect(nodes[1].color).to.equal("#ff0000");
        // failure honesty: broken store reads yield empty tree, not a throw
        const broken = await readProfileTree({
            readAllConnectionGroups: async () => {
                throw new Error("settings unavailable");
            },
            readAllConnections: async () => {
                throw new Error("settings unavailable");
            },
        });
        expect(broken.groups).to.deep.equal([]);
        expect(broken.profiles).to.deep.equal([]);
    });

    test("readiness synthesis: only readyEmpty/ready-zero yield no-items", () => {
        expect(synthesizeChildren({ kind: "ready" }, 3).kind).to.equal("children");
        expect(synthesizeChildren({ kind: "ready" }, 0).kind).to.equal("noItems");
        expect(synthesizeChildren({ kind: "readyEmpty" }, 0).kind).to.equal("noItems");
        expect(synthesizeChildren({ kind: "loading" }, 0).kind).to.equal("loading");
        expect(synthesizeChildren({ kind: "failed", message: "boom" }, 0)).to.deep.include({
            kind: "error",
            message: "boom",
        });
        expect(synthesizeChildren({ kind: "permissionDenied" }, 0).kind).to.equal("status");
        expect(synthesizeChildren({ kind: "unsupported" }, 0).kind).to.equal("status");
        expect(synthesizeChildren({ kind: "dataPlaneUnavailable" }, 0).kind).to.equal("status");
        // partial renders what exists (status child is the container's job)
        expect(synthesizeChildren({ kind: "partial" }, 2).kind).to.equal("children");
    });

    test("capabilities: context values serialize flags, not classic type strings", () => {
        const caps = capabilitiesFor("disconnectedConnection");
        expect(caps.canConnect).to.equal(true);
        const context = contextValueFor("disconnectedConnection", caps);
        expect(context).to.contain("oe2:kind=disconnectedConnection");
        expect(context).to.contain("oe2:canConnect");
        expect(context).to.not.match(/\btype=/); // no classic context grammar
        const server = contextValueFor("connectedServer", capabilitiesFor("connectedServer"));
        expect(server).to.contain("oe2:canRefresh");
        expect(server).to.contain("oe2:canOpenQuery");
        const handoff = contextValueFor("connectedServer", {
            legacyHandoff: ["profiler", "backup"],
        });
        expect(handoff).to.contain("oe2:handoff=profiler");
        expect(handoff).to.contain("oe2:handoff=backup");
    });

    test("controller: unavailable data plane is explicit; roots come from the store; NO V1 calls", async () => {
        const sendRequest = sinon.spy(SqlToolsServiceClient.prototype, "sendRequest");
        const connect = sinon.spy(ConnectionManager.prototype, "connect");
        try {
            // data plane disabled → explicit status node, no classic fallback
            const disabled = new OeV2TreeController({
                profiles: fakeSource(),
                dataPlane: { enabled: () => false, availabilityState: () => "unknown" },
            });
            const unavailable = await disabled.children();
            expect(unavailable).to.have.length(1);
            expect(unavailable[0].kind).to.equal("status");
            expect(unavailable[0].label).to.contain("SQL Data Plane");

            // enabled → profile roots; group expansion; connect hint on expand
            const controller = new OeV2TreeController({
                profiles: fakeSource(),
                dataPlane: { enabled: () => true, availabilityState: () => "available" },
            });
            const roots = await controller.children();
            expect(roots.map((n) => n.label)).to.deep.equal(["Alpha", "Team", "Aleph", "Beta"]);
            const team = roots[1];
            const teamChildren = await controller.children(team);
            // K6 (B22): v1 label recipe — `server, database (auth)`.
            expect(teamChildren.map((n) => n.label)).to.deep.equal(["srv-c, AppDb (Integrated)"]);
            const hint = await controller.children(roots[2]);
            expect(hint[0].kind).to.equal("status");
            expect(hint[0].label).to.contain("Connect");

            // empty store → honest guidance, not an empty tree
            const empty = new OeV2TreeController({
                profiles: {
                    readAllConnectionGroups: async () => [],
                    readAllConnections: async () => [],
                },
                dataPlane: { enabled: () => true, availabilityState: () => "available" },
            });
            const emptyRoots = await empty.children();
            expect(emptyRoots[0].kind).to.equal("status");
            expect(emptyRoots[0].label).to.contain("No saved connection profiles");

            // refresh invalidates the cached tree and notifies
            let notified = 0;
            controller.onDidChange(() => notified++);
            controller.refresh();
            expect(notified).to.equal(1);

            // THE TRIPWIRE: none of the above touched STS v1 surfaces.
            sinon.assert.notCalled(sendRequest);
            sinon.assert.notCalled(connect);
        } finally {
            sendRequest.restore();
            connect.restore();
        }
    });
});
