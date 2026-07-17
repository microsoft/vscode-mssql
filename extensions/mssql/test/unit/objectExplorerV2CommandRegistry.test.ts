/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B25 (OE_V1_PARITY_PLAN K4): the OE v2 command registry — targeting matrix
 * (Backup on database nodes + DB-scoped top-level connections ONLY; Restore
 * on servers + databases), context-flag serialization, package.json
 * conformance (the manifest can never drift from the registry), and the
 * legacy-redirect library (classic handlers invoked with adapted nodes; OE
 * v2 never touches the v1 connection).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    commandFlagsFor,
    commandTargetFor,
    generateMenuContributions,
    OE_V2_COMMANDS,
} from "../../src/objectExplorer/v2/commands/oeV2CommandRegistry";
import { policiesForNode } from "../../src/objectExplorer/v2/commands/oeV2LegacyCommandPolicy";
import { redirectToClassic } from "../../src/objectExplorer/v2/legacy/oeV2LegacyRedirect";
import { OeV2ClassicHandoffService } from "../../src/objectExplorer/v2/legacy/oeV2ClassicHandoffService";
import { connectionNode, nodeContextValue } from "../../src/objectExplorer/v2/tree/oeV2NodeFactory";
import { NOT_APPLICABLE, OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";

function databaseNode(): OeV2Node {
    return {
        id: "oe2:database/c1/AppDb",
        path: { kind: "database", connectionId: "c1", database: "AppDb" },
        kind: "database",
        label: "AppDb",
        collapsible: true,
        connectionId: "c1",
        database: "AppDb",
        readiness: NOT_APPLICABLE,
        capabilities: {},
    };
}

function serverNode(database?: string): OeV2Node {
    const profile = {
        profileId: "c1",
        displayName: "srv",
        server: "srv",
        authKind: "integrated" as const,
        ...(database ? { database } : {}),
        stored: { server: "srv", ...(database ? { database } : {}) },
    };
    return connectionNode(profile, { state: "connected" });
}

suite("Object Explorer v2 command registry (B25)", () => {
    test("targeting matrix: backup needs a database identity, restore takes servers too", () => {
        expect(commandFlagsFor({ kind: "database", database: "AppDb" })).to.deep.equal([
            "oe2:cmd=backup",
            "oe2:cmd=restore",
            "oe2:cmd=profiler",
            "oe2:cmd=schemaCompare",
        ]);
        expect(commandFlagsFor({ kind: "connectedServer" })).to.deep.equal([
            "oe2:cmd=restore",
            "oe2:cmd=profiler",
        ]);
        expect(commandFlagsFor({ kind: "connectedServer", database: "AppDb" })).to.deep.equal([
            "oe2:cmd=backup",
            "oe2:cmd=restore",
            "oe2:cmd=profiler",
        ]);
        // Modify Table Structure targets TABLE objects only (dogfood #8).
        expect(commandFlagsFor({ kind: "object" })).to.deep.equal([]);
        expect(commandFlagsFor({ kind: "object", objectKind: "table" })).to.deep.equal([
            "oe2:cmd=editTable",
        ]);
        expect(commandFlagsFor({ kind: "object", objectKind: "view" })).to.deep.equal([]);
        expect(commandFlagsFor({ kind: "databaseFolder", database: "AppDb" })).to.deep.equal([]);
    });

    test("container commands target by container fact + node state (DOCK-2)", () => {
        // v1 gates: start on stopped, stop on connected, delete on both.
        expect(
            commandFlagsFor({ kind: "disconnectedConnection", isContainer: true }),
        ).to.deep.equal(["oe2:cmd=startContainer", "oe2:cmd=deleteContainer"]);
        expect(commandFlagsFor({ kind: "lostConnection", isContainer: true })).to.deep.equal([
            "oe2:cmd=startContainer",
            "oe2:cmd=deleteContainer",
        ]);
        expect(commandFlagsFor({ kind: "connectedServer", isContainer: true })).to.deep.equal([
            "oe2:cmd=restore",
            "oe2:cmd=profiler",
            "oe2:cmd=stopContainer",
            "oe2:cmd=deleteContainer",
        ]);
        // Non-container connections never see container commands.
        expect(commandFlagsFor({ kind: "disconnectedConnection" })).to.deep.equal([]);
    });

    test("container connections carry docker identity end-to-end (DOCK-2)", () => {
        const profile = {
            profileId: "c1",
            displayName: "box",
            server: "localhost,1450",
            authKind: "sql" as const,
            stored: { server: "localhost,1450", containerName: "sqlbox" },
        };
        const connected = connectionNode(profile as never, { state: "connected" });
        expect(connected.icon).to.equal("DockerContainer_green");
        expect(connected.containerName).to.equal("sqlbox");
        expect(nodeContextValue(connected)).to.contain("oe2:cmd=stopContainer");
        expect(nodeContextValue(connected)).to.contain("oe2:cmd=deleteContainer");
        expect(nodeContextValue(connected)).to.not.contain("oe2:cmd=startContainer");

        const stopped = connectionNode(profile as never, { state: "disconnected" });
        expect(stopped.icon).to.equal("DockerContainer_red");
        expect(nodeContextValue(stopped)).to.contain("oe2:cmd=startContainer");
        expect(nodeContextValue(stopped)).to.not.contain("oe2:cmd=stopContainer");

        // Docker activity text takes over the description while it runs.
        const busy = connectionNode(profile as never, {
            state: "disconnected",
            activityText: "Starting container…",
        });
        expect(busy.description).to.equal("Starting container…");
    });

    test("context values carry command flags from node facts", () => {
        const dbScoped = serverNode("AppDb");
        expect(nodeContextValue(dbScoped)).to.contain("oe2:cmd=backup");
        expect(nodeContextValue(dbScoped)).to.contain("oe2:cmd=restore");
        const serverScoped = serverNode();
        expect(nodeContextValue(serverScoped)).to.not.contain("oe2:cmd=backup");
        expect(nodeContextValue(serverScoped)).to.contain("oe2:cmd=restore");
        expect(nodeContextValue(databaseNode())).to.contain("oe2:cmd=backup");
    });

    test("package.json menus conform to generateMenuContributions (no drift)", () => {
        // Compiled tests run from out/test/unit — package.json is 3 up.
        const manifest = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
        ) as {
            contributes: {
                menus: { "view/item/context": { command: string; when: string; group: string }[] };
                commands: { command: string }[];
            };
        };
        const shipped = manifest.contributes.menus["view/item/context"];
        for (const expected of generateMenuContributions()) {
            const entry = shipped.find((item) => item.command === expected.command);
            expect(entry, expected.command).to.not.equal(undefined);
            expect(entry!.when, expected.command).to.equal(expected.when);
            expect(entry!.group, expected.command).to.equal(expected.group);
        }
        // every registry command is declared
        const declared = new Set(manifest.contributes.commands.map((c) => c.command));
        for (const def of OE_V2_COMMANDS) {
            expect(declared.has(def.id), def.id).to.equal(true);
        }
    });

    test("policiesForNode: database-scoped features need a DB-scoped connection node", () => {
        const onServer = policiesForNode("connectedServer").map((p) => p.feature);
        expect(onServer).to.not.include("backupDatabase");
        expect(onServer).to.include("restoreDatabase");
        const onDbScoped = policiesForNode("connectedServer", "AppDb").map((p) => p.feature);
        expect(onDbScoped).to.include("backupDatabase");
        expect(policiesForNode("database").map((p) => p.feature)).to.include("backupDatabase");
    });

    test("commandTargetFor extracts the full node identity", () => {
        const target = commandTargetFor({
            ...databaseNode(),
            schema: "dbo",
            objectName: "Orders",
        });
        expect(target.connectionId).to.equal("c1");
        expect(target.database).to.equal("AppDb");
        expect(target.schema).to.equal("dbo");
        expect(target.objectName).to.equal("Orders");
    });
});

suite("Object Explorer v2 legacy redirect (B25)", () => {
    let execute: sinon.SinonStub;

    setup(() => {
        execute = sinon.stub(vscode.commands, "executeCommand").resolves(undefined);
    });

    teardown(() => {
        execute.restore();
    });

    function fakeDeps(ownerUri: string | null = "oe2://handoff/abc") {
        return {
            facts: {
                handoffFacts: async () => ({
                    stored: { server: "srv", authenticationType: "Integrated" },
                    fingerprint: "sfp_test",
                }),
            },
            handoff: {
                ensureOwnerUri: async () => ownerUri ?? undefined,
            } as unknown as OeV2ClassicHandoffService,
        };
    }

    test("backup on a database node invokes the classic command with a database-scoped legacy node", async () => {
        const outcome = await redirectToClassic("backupDatabase", databaseNode(), fakeDeps());
        expect(outcome.ok).to.equal(true);
        sinon.assert.calledOnce(execute);
        const [command, arg] = execute.firstCall.args as [string, TreeNodeInfo];
        expect(command).to.equal("mssql.backupDatabase");
        expect(arg).to.be.instanceOf(TreeNodeInfo);
        expect(arg.nodeType).to.equal("Database");
        expect(arg.connectionProfile.database).to.equal("AppDb");
        expect(arg.sessionId).to.equal("oe2://handoff/abc");
    });

    test("backup on a DB-scoped top-level connection adapts as its database", async () => {
        const outcome = await redirectToClassic("backupDatabase", serverNode("AppDb"), fakeDeps());
        expect(outcome.ok).to.equal(true);
        const [, arg] = execute.firstCall.args as [string, TreeNodeInfo];
        expect(arg.nodeType).to.equal("Database");
        expect(arg.connectionProfile.database).to.equal("AppDb");
    });

    test("backup on a server-scoped connection is refused BEFORE any handoff", async () => {
        const deps = fakeDeps();
        const ensureSpy = sinon.spy(deps.handoff, "ensureOwnerUri");
        const outcome = await redirectToClassic("backupDatabase", serverNode(), deps);
        expect(outcome.ok).to.equal(false);
        expect(outcome.error).to.include("database");
        expect(ensureSpy.called).to.equal(false);
        sinon.assert.notCalled(execute);
    });

    test("restore on a server node rides the server-kind legacy node", async () => {
        const outcome = await redirectToClassic("restoreDatabase", serverNode(), fakeDeps());
        expect(outcome.ok).to.equal(true);
        const [command, arg] = execute.firstCall.args as [string, TreeNodeInfo];
        expect(command).to.equal("mssql.restoreDatabase");
        expect(arg.nodeType).to.equal("Server");
    });

    test("unavailable handoff is a quiet no-op; classic failure is a guarded error", async () => {
        const unavailable = await redirectToClassic(
            "backupDatabase",
            databaseNode(),
            fakeDeps(null),
        );
        expect(unavailable.ok).to.equal(false);
        expect(unavailable.error).to.equal(undefined);
        sinon.assert.notCalled(execute);

        execute.rejects(new Error("classic exploded"));
        const failed = await redirectToClassic("backupDatabase", databaseNode(), fakeDeps());
        expect(failed.ok).to.equal(false);
        expect(failed.error).to.include("classic exploded");
    });

    test("unknown feature and wrong node kind are refused without side effects", async () => {
        const unknown = await redirectToClassic("nonsense", databaseNode(), fakeDeps());
        expect(unknown.ok).to.equal(false);
        const wrongKind = await redirectToClassic(
            "backupDatabase",
            {
                ...databaseNode(),
                kind: "databaseFolder",
            },
            fakeDeps(),
        );
        expect(wrongKind.ok).to.equal(false);
        sinon.assert.notCalled(execute);
    });
});
