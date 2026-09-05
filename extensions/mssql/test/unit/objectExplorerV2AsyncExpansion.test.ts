/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dogfood 2026-07-10 ("async node expansion"): getChildren must never hang
 * and never resolve silent-empty, and one connection's stalled backend
 * (sleeping serverless resume) must not block another connection's
 * expansions. Coordinators are stubbed so the STALL ITSELF is simulated —
 * these tests fail by timeout if any bound regresses.
 */

import { expect } from "chai";
import { OeV2MetadataCoordinator } from "../../src/objectExplorer/v2/metadata/oeV2MetadataCoordinator";
import { OeV2SessionRegistry } from "../../src/objectExplorer/v2/sessions/oeV2SessionRegistry";
import { OeV2TreeController } from "../../src/objectExplorer/v2/tree/oeV2TreeController";
import { NOT_APPLICABLE, OeV2Node } from "../../src/objectExplorer/v2/tree/oeV2Node";

const NEVER = new Promise<never>(() => undefined);

function fakeSnapshot(objects: { objectId: number; schema: string; name: string; kind: string }[]) {
    return {
        readiness: { objects: "ready", synonyms: "ready", schemas: "ready" },
        listObjects: (schema?: string, kinds?: string[]) =>
            objects.filter(
                (o) =>
                    (schema === undefined || o.schema === schema) &&
                    (kinds === undefined || kinds.includes(o.kind)),
            ),
        listSchemas: () => [{ name: "dbo" }],
    };
}

/** A coordinator whose database work either answers instantly or stalls. */
function stubCoordinator(behavior: "fast" | "stalled") {
    const listeners = new Set<() => void>();
    return {
        onDidChange: (listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        ensureServer: async () => undefined,
        ensureServerFresh: () =>
            behavior === "fast" ? Promise.resolve({ freshness: "validated" }) : NEVER,
        serverStatus: () => undefined,
        serverView: () => undefined,
        serverAuxiliary: () => undefined,
        ensureAuxSection: async () => undefined,
        ensureDatabase: () => (behavior === "fast" ? Promise.resolve({}) : NEVER),
        ensureDatabaseFresh: () =>
            behavior === "fast" ? Promise.resolve({ freshness: "validated" }) : NEVER,
        ensureDatabaseAuxSection: () => (behavior === "fast" ? Promise.resolve() : NEVER),
        databaseStatus: () =>
            behavior === "fast" ? { readiness: "ready", generation: 1 } : undefined,
        databaseSnapshot: () =>
            behavior === "fast"
                ? fakeSnapshot([{ objectId: 1, schema: "dbo", name: "Orders", kind: "table" }])
                : undefined,
        databaseAuxiliary: () => undefined,
        refreshServer: async () => undefined,
        refreshDatabase: async () => undefined,
        dispose: () => undefined,
    } as unknown as OeV2MetadataCoordinator;
}

function stubSessions(connectBehavior: Record<string, "fast" | "stalled">) {
    const states = new Map<string, string>();
    const listeners = new Set<(id: string) => void>();
    return {
        registry: {
            onDidChange: (listener: (id: string) => void) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
            stateOf: (id: string) => states.get(id) ?? "disconnected",
            get: (id: string) =>
                states.get(id) === "connected" ? { state: "connected" } : undefined,
            connect: (id: string) => {
                states.set(id, "connecting");
                if (connectBehavior[id] === "stalled") {
                    return NEVER;
                }
                states.set(id, "connected");
                return Promise.resolve({ state: "connected" });
            },
            disconnect: async (id: string) => {
                states.set(id, "disconnected");
            },
        } as unknown as OeV2SessionRegistry,
        states,
    };
}

function harness(connectBehavior: Record<string, "fast" | "stalled">) {
    const { registry, states } = stubSessions(connectBehavior);
    const controller = new OeV2TreeController({
        profiles: {
            readAllConnections: async () => [
                { id: "pA", server: "srv-fast", authenticationType: "Integrated" },
                { id: "pB", server: "srv-sleepy", authenticationType: "Integrated" },
            ],
            readAllConnectionGroups: async () => [{ id: "ROOT", name: "ROOT" }],
        },
        dataPlane: { enabled: () => true, availabilityState: () => "available" },
        secrets: { lookupPassword: async () => undefined } as never,
        sessions: registry,
        coordinatorFactory: (prepared) =>
            stubCoordinator(prepared.profileRef.server.includes("sleepy") ? "stalled" : "fast"),
        settings: () => ({ groupBySchema: false, showSystemDatabases: true }),
        waits: { expandMs: 60, connectKickMs: 40 },
    });
    return { controller, states };
}

function tablesNode(connectionId: string): OeV2Node {
    return {
        id: `oe2:databaseFolder/${connectionId}/AppDb/tables`,
        path: { kind: "databaseFolder", connectionId, database: "AppDb", folder: "tables" },
        kind: "databaseFolder",
        label: "Tables",
        collapsible: true,
        connectionId,
        database: "AppDb",
        readiness: NOT_APPLICABLE,
        capabilities: {},
    };
}

async function connectionIds(controller: OeV2TreeController): Promise<Map<string, OeV2Node>> {
    const roots = await controller.children();
    const map = new Map<string, OeV2Node>();
    for (const node of roots) {
        if (node.connectionId) {
            map.set(node.label.includes("sleepy") ? "sleepy" : "fast", node);
        }
    }
    return map;
}

suite("Object Explorer v2 async expansion (dogfood)", () => {
    test("a stalled connection's folder expand renders LOADING within the bound — never hangs, never empty", async () => {
        const h = harness({});
        const roots = await connectionIds(h.controller);
        // connect both (stub coordinators: fast vs stalled)
        await h.controller.connectProfile(roots.get("fast")!.connectionId!);
        await h.controller.connectProfile(roots.get("sleepy")!.connectionId!);

        const started = Date.now();
        const stalled = await h.controller.children(tablesNode(roots.get("sleepy")!.connectionId!));
        expect(Date.now() - started).to.be.lessThan(2_000); // bound, not hang
        expect(stalled.length).to.be.greaterThan(0); // never silent-empty
        expect(stalled[0].kind).to.equal("loading"); // honest spinner
        h.controller.dispose();
    });

    test("independence: the stalled connection does not delay the fast one's expansion", async () => {
        const h = harness({});
        const roots = await connectionIds(h.controller);
        await h.controller.connectProfile(roots.get("fast")!.connectionId!);
        await h.controller.connectProfile(roots.get("sleepy")!.connectionId!);

        // Fire the stalled expand FIRST, then measure the fast one.
        const stalledExpand = h.controller.children(tablesNode(roots.get("sleepy")!.connectionId!));
        const started = Date.now();
        const fast = await h.controller.children(tablesNode(roots.get("fast")!.connectionId!));
        expect(Date.now() - started).to.be.lessThan(500);
        expect(fast.map((n) => n.label)).to.deep.equal(["dbo.Orders"]);
        await stalledExpand; // resolves via its own bound
        h.controller.dispose();
    });

    test("expanding a sleeping connection kicks the connect and shows the spinner", async () => {
        const h = harness({ pB: "stalled" });
        const roots = await connectionIds(h.controller);
        const sleepy = roots.get("sleepy")!;
        const started = Date.now();
        const children = await h.controller.children(sleepy);
        expect(Date.now() - started).to.be.lessThan(2_000);
        expect(children[0].kind).to.equal("loading");
        expect(h.states.get(sleepy.connectionId!)).to.equal("connecting"); // still working
        h.controller.dispose();
    });

    test("silent-empty tripwire: an expandable node that yields nothing says 'No items'", async () => {
        const h = harness({});
        // A collapsible node whose path resolves through the default branch
        // (yields []) must render the explicit no-items child, never
        // expanded-nothing.
        const oddball: OeV2Node = {
            id: "oe2:status/oddball",
            path: { kind: "status", scope: "oddball" },
            kind: "status",
            label: "oddball",
            collapsible: true,
            readiness: NOT_APPLICABLE,
            capabilities: {},
        };
        const children = await h.controller.children(oddball);
        expect(children).to.have.length(1);
        expect(children[0].kind).to.equal("noItems");
        h.controller.dispose();
    });
});
