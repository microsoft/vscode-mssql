/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R8 handoff state machine + replay (addendum §8, §6.5–§6.7, §17.4):
 * exact v1 request sequences per path, same-session report→publish, token
 * gating (edit/drift/fingerprint invalidation), resolver failure creates
 * no session, credentials never outlive session creation, EVERY created
 * session disposed exactly once (leak ledger), publish-success +
 * refresh-failure reported separately, and replay correctness (verbatim
 * untouched entities, fresh UUIDs, explicit OnAction mapping — never a
 * numeric cast). All against a recording fake v1 port — no vscode, no
 * server.
 */

import { expect } from "chai";
import {
    CatalogBuilder,
    CatalogSection,
    SectionState,
} from "../../src/services/metadata/catalogModel";
import { buildVisualizerModel } from "../../src/schemaVisualizer/model/catalogToVisualizerModel";
import { SchemaVisualizerCatalogModel } from "../../src/schemaVisualizer/model/schemaVisualizerModel";
import { SchemaVisualizerEditOp } from "../../src/schemaVisualizer/model/schemaVisualizerEdit";
import {
    replayEditsToLegacySchema,
    toOnAction,
} from "../../src/schemaVisualizer/handoff/replayEditsToLegacySchema";
import {
    LegacySchemaDesignerPort,
    SchemaVisualizerHandoff,
} from "../../src/schemaVisualizer/handoff/schemaVisualizerHandoff";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

const READY_ALL: Partial<Record<CatalogSection, SectionState>> = {
    schemas: "ready",
    objects: "ready",
    synonyms: "ready",
    types: "ready",
    columns: "ready",
    keys: "ready",
    foreignKeys: "ready",
    parameters: "ready",
    descriptions: "ready",
};

const INT_DETAIL = {
    typeName: "int",
    typeSchema: "sys",
    baseTypeName: "int",
    systemTypeId: 56,
    userTypeId: 56,
    isUserDefined: false,
    isAssemblyType: false,
    maxLengthBytes: 4,
    precision: 10,
    scale: 0,
};

/** Catalog model with a mutable extra-table knob (fingerprint drift). */
function catalogModel(extraTable = false): SchemaVisualizerCatalogModel {
    const b = new CatalogBuilder();
    b.setEnvironment({ defaultSchema: "dbo", caseSensitive: false });
    b.addSchema(1, "dbo");
    b.addObject(101, 1, "Orders", "table");
    b.addColumn(101, "OrderId", "int", false, false, false, 1, INT_DETAIL);
    if (extraTable) {
        b.addObject(150, 1, "Drifted", "table");
        b.addColumn(150, "Id", "int", false, false, false, 1, INT_DETAIL);
    }
    return buildVisualizerModel(b.build(1, READY_ALL, "full"), {
        serverFingerprint: "sfp_test",
        database: "Db1",
    });
}

function legacyColumn(id: string, name: string): SchemaDesigner.Column {
    return {
        id,
        name,
        dataType: "int",
        maxLength: "",
        precision: 10,
        scale: 0,
        isPrimaryKey: false,
        isIdentity: false,
        identitySeed: 0,
        identityIncrement: 0,
        isNullable: false,
        defaultValue: "",
        isComputed: false,
        computedFormula: "",
        computedPersisted: false,
    };
}

function legacyBaseline(): SchemaDesigner.Schema {
    return {
        tables: [
            {
                id: "11111111-1111-1111-1111-111111111111",
                name: "Orders",
                schema: "dbo",
                columns: [legacyColumn("22222222-2222-2222-2222-222222222222", "OrderId")],
                foreignKeys: [],
            },
        ],
    };
}

class RecordingLegacyPort implements LegacySchemaDesignerPort {
    calls: string[] = [];
    sessions = 0;
    failGetReport = false;
    failPublish = false;
    async createSession(input: { database: string }) {
        this.calls.push("createSession");
        this.sessions++;
        void input;
        return { sessionId: `sess-${this.sessions}`, schema: legacyBaseline() };
    }
    async getReport(input: { sessionId: string; updatedSchema: SchemaDesigner.Schema }) {
        this.calls.push(`getReport:${input.sessionId}`);
        if (this.failGetReport) {
            throw new Error("report boom");
        }
        return {
            hasSchemaChanged: true,
            dacReport: {
                requireTableRecreation: false,
                possibleDataLoss: false,
                hasWarnings: false,
                reports: [],
            },
        } as unknown as SchemaDesigner.GetReportResponse;
    }
    async publishSession(input: { sessionId: string }) {
        this.calls.push(`publishSession:${input.sessionId}`);
        if (this.failPublish) {
            throw new Error("publish boom");
        }
    }
    async disposeSession(input: { sessionId: string }) {
        this.calls.push(`disposeSession:${input.sessionId}`);
    }
}

function harness(options?: { resolverFails?: boolean }) {
    const legacy = new RecordingLegacyPort();
    let credentialDisposals = 0;
    let refreshCount = 0;
    let driftAfter: number | undefined;
    let failRefreshAfterPublish = false;
    let idCounter = 0;
    const machine = new SchemaVisualizerHandoff({
        resolver: {
            resolve: async () => {
                if (options?.resolverFails) {
                    throw new Error("no classic route");
                }
                return {
                    connectionString: "Server=x;Database=Db1",
                    dispose: () => credentialDisposals++,
                };
            },
        },
        legacy,
        baseline: {
            refreshLive: async () => {
                refreshCount++;
                if (
                    failRefreshAfterPublish &&
                    legacy.calls.some((c) => c.startsWith("publishSession"))
                ) {
                    throw new Error("post-publish refresh boom");
                }
                const drifted = driftAfter !== undefined && refreshCount > driftAfter;
                return { model: catalogModel(drifted), complete: true };
            },
        },
        database: "Db1",
        newId: () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, "0")}`,
    });
    return {
        legacy,
        machine,
        credentialDisposals: () => credentialDisposals,
        setDriftAfter: (n: number) => (driftAfter = n),
        setFailRefreshAfterPublish: () => (failRefreshAfterPublish = true),
    };
}

let opCounter = 0;
function renameOp(newName: string): SchemaVisualizerEditOp {
    return {
        version: 1,
        operationId: `op-${++opCounter}`,
        kind: "renameTable",
        table: { kind: "existing", objectId: 101, baselineSchema: "dbo", baselineName: "Orders" },
        newName,
    };
}

function missingTableOp(): SchemaVisualizerEditOp {
    return {
        version: 1,
        operationId: `op-${++opCounter}`,
        kind: "renameTable",
        table: { kind: "existing", objectId: 9, baselineSchema: "dbo", baselineName: "Ghost" },
        newName: "Nope",
    };
}

suite("Schema Visualizer handoff (SV-R8)", () => {
    test("successful publish: EXACT §8.6 sequence, same session throughout, ledger balanced", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([renameOp("SalesOrders")]);
        expect(preview.ok, JSON.stringify(preview)).to.equal(true);
        if (preview.ok === false) {
            return;
        }
        expect(h.machine.currentState()).to.equal("awaitingConfirmation");
        expect(h.credentialDisposals()).to.equal(1); // creds gone post-create
        const publish = await h.machine.publish(preview.token);
        expect(publish.ok).to.equal(true);
        expect(h.legacy.calls).to.deep.equal([
            "createSession",
            "getReport:sess-1",
            "publishSession:sess-1",
            "disposeSession:sess-1",
        ]);
        expect(h.machine.createdSessions).to.equal(1);
        expect(h.machine.disposedSessions).to.equal(1);
        expect(h.machine.currentState()).to.equal("idle");
    });

    test("canceled preview: create → getReport → dispose; no publish", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(true);
        await h.machine.cancelPreview();
        expect(h.legacy.calls).to.deep.equal([
            "createSession",
            "getReport:sess-1",
            "disposeSession:sess-1",
        ]);
        expect(h.machine.disposedSessions).to.equal(1);
    });

    test("correlation failure: create → dispose, typed conflict, no report", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([missingTableOp()]);
        expect(preview.ok).to.equal(false);
        if (preview.ok === false) {
            // The rebase against live metadata catches it BEFORE any v1 call.
            expect(preview.code).to.equal("rebaseConflict");
        }
        expect(h.legacy.calls).to.deep.equal([]);
        expect(h.machine.createdSessions).to.equal(0);
    });

    test("v1-baseline correlation failure: create → dispose (§8.6), no report", async () => {
        // Metadata sees Orders (rebase passes) but the fresh DacFx baseline
        // does not — the drift window between the two truth sources.
        const h = harness();
        h.legacy.createSession = async () => {
            h.legacy.calls.push("createSession");
            h.legacy.sessions++;
            return { sessionId: `sess-${h.legacy.sessions}`, schema: { tables: [] } };
        };
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(false);
        if (preview.ok === false) {
            expect(preview.code).to.equal("correlationNotFound");
        }
        expect(h.legacy.calls).to.deep.equal(["createSession", "disposeSession:sess-1"]);
        expect(h.machine.createdSessions).to.equal(1);
        expect(h.machine.disposedSessions).to.equal(1);
    });

    test("report failure disposes the session and blocks publish", async () => {
        const h = harness();
        h.legacy.failGetReport = true;
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(false);
        if (preview.ok === false) {
            expect(preview.code).to.equal("reportFailed");
        }
        expect(h.legacy.calls).to.deep.equal([
            "createSession",
            "getReport:sess-1",
            "disposeSession:sess-1",
        ]);
        expect(h.machine.createdSessions).to.equal(1);
        expect(h.machine.disposedSessions).to.equal(1);
    });

    test("edit after report invalidates the preview (publish refused, session disposed)", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(true);
        if (preview.ok === false) {
            return;
        }
        await h.machine.notifyEdited();
        const publish = await h.machine.publish(preview.token);
        expect(publish.ok).to.equal(false);
        if (publish.ok === false) {
            expect(publish.code).to.equal("previewInvalidated");
        }
        expect(h.machine.disposedSessions).to.equal(1);
        expect(h.legacy.calls.filter((c) => c.startsWith("publishSession"))).to.deep.equal([]);
    });

    test("catalog drift between report and publish: §6.7 fingerprint check refuses", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(true);
        if (preview.ok === false) {
            return;
        }
        // Preview consumed refresh #1; drift lands before the publish check.
        h.setDriftAfter(1);
        const publish = await h.machine.publish(preview.token);
        expect(publish.ok).to.equal(false);
        if (publish.ok === false) {
            expect(publish.code).to.equal("previewInvalidated");
        }
        expect(h.legacy.calls.filter((c) => c.startsWith("publishSession"))).to.deep.equal([]);
        expect(h.machine.disposedSessions).to.equal(1);
    });

    test("resolver failure creates NO session", async () => {
        const h = harness({ resolverFails: true });
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(false);
        if (preview.ok === false) {
            expect(preview.code).to.equal("classicHandoffUnavailable");
        }
        expect(h.legacy.calls).to.deep.equal([]);
        expect(h.machine.createdSessions).to.equal(0);
    });

    test("a second preview replaces the first (first session disposed)", async () => {
        const h = harness();
        const first = await h.machine.previewChanges([renameOp("A")]);
        expect(first.ok).to.equal(true);
        const second = await h.machine.previewChanges([renameOp("B")]);
        expect(second.ok).to.equal(true);
        expect(h.machine.createdSessions).to.equal(2);
        expect(h.machine.disposedSessions).to.equal(1);
        await h.machine.dispose();
        expect(h.machine.disposedSessions).to.equal(2);
    });

    test("publish failure (last-instant DDL race) disposes and stays retryable", async () => {
        const h = harness();
        h.legacy.failPublish = true;
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(true);
        if (preview.ok === false) {
            return;
        }
        const publish = await h.machine.publish(preview.token);
        expect(publish.ok).to.equal(false);
        if (publish.ok === false) {
            expect(publish.code).to.equal("publishFailed");
        }
        expect(h.machine.disposedSessions).to.equal(1);
        expect(h.machine.currentState()).to.equal("failed");
    });

    test("publish succeeds but post-publish refresh fails: reported SEPARATELY (§15)", async () => {
        const h = harness();
        const preview = await h.machine.previewChanges([renameOp("X")]);
        expect(preview.ok).to.equal(true);
        if (preview.ok === false) {
            return;
        }
        h.setFailRefreshAfterPublish();
        const publish = await h.machine.publish(preview.token);
        expect(publish.ok).to.equal(true);
        if (publish.ok) {
            expect(publish.refreshFailed).to.equal(true);
        }
        expect(h.legacy.calls.filter((c) => c.startsWith("publishSession")).length).to.equal(1);
    });
});

suite("Schema Visualizer replay (SV-R8)", () => {
    test("OnAction mapping is explicit — the 0/1 swap hazard is pinned", () => {
        expect(toOnAction("CASCADE")).to.equal(SchemaDesigner.OnAction.CASCADE);
        expect(toOnAction("NO_ACTION")).to.equal(SchemaDesigner.OnAction.NO_ACTION);
        expect(toOnAction("SET_NULL")).to.equal(SchemaDesigner.OnAction.SET_NULL);
        expect(toOnAction("SET_DEFAULT")).to.equal(SchemaDesigner.OnAction.SET_DEFAULT);
        // The enum values that make a numeric cast catastrophic:
        expect(SchemaDesigner.OnAction.CASCADE).to.equal(0);
        expect(SchemaDesigner.OnAction.NO_ACTION).to.equal(1);
    });

    test("untouched entities are copied VERBATIM; new entities get fresh GUID-shaped ids", () => {
        const baseline: SchemaDesigner.Schema = {
            tables: [
                ...legacyBaseline().tables,
                {
                    id: "33333333-3333-3333-3333-333333333333",
                    name: "Untouched",
                    schema: "dbo",
                    columns: [legacyColumn("44444444-4444-4444-4444-444444444444", "Id")],
                    foreignKeys: [],
                },
            ],
        };
        let n = 0;
        const result = replayEditsToLegacySchema(
            baseline,
            [
                {
                    version: 1,
                    operationId: "op-a",
                    kind: "addTable",
                    table: {
                        localId: "t1",
                        schema: "dbo",
                        name: "Regions",
                        columns: [
                            {
                                localId: "c1",
                                name: "RegionId",
                                type: { displayText: "int", typeName: "int" },
                                nullable: false,
                            },
                        ],
                    },
                },
                {
                    version: 1,
                    operationId: "op-b",
                    kind: "addForeignKey",
                    foreignKey: {
                        localId: "fk1",
                        name: "FK_Regions_Orders",
                        fromTable: { kind: "new", localId: "t1" },
                        toTable: {
                            kind: "existing",
                            objectId: 101,
                            baselineSchema: "dbo",
                            baselineName: "Orders",
                        },
                        columnPairs: [
                            {
                                fromColumn: { kind: "new", localId: "c1" },
                                toColumn: {
                                    kind: "existing",
                                    columnId: 1,
                                    baselineName: "OrderId",
                                },
                            },
                        ],
                        onDelete: "SET_NULL",
                        onUpdate: "NO_ACTION",
                    },
                },
            ],
            { caseSensitive: false, newId: () => `id-${++n}` },
        );
        expect(result.ok, JSON.stringify(result)).to.equal(true);
        if (result.ok === false) {
            return;
        }
        // Verbatim copy: untouched table byte-equal to the baseline entry.
        const untouched = result.schema.tables.find((t) => t.name === "Untouched");
        expect(untouched).to.deep.equal(baseline.tables[1]);
        // New table + FK ride minted ids and correlated v1 ids.
        const regions = result.schema.tables.find((t) => t.name === "Regions")!;
        expect(regions.id).to.equal("id-1");
        const fk = regions.foreignKeys[0];
        expect(fk.referencedTableId).to.equal("11111111-1111-1111-1111-111111111111");
        expect(fk.referencedColumnsIds).to.deep.equal(["22222222-2222-2222-2222-222222222222"]);
        expect(fk.onDeleteAction).to.equal(SchemaDesigner.OnAction.SET_NULL);
    });

    test("rename correlates via BASELINE name and applies onto the v1 entity", () => {
        const result = replayEditsToLegacySchema(legacyBaseline(), [renameOp("SalesOrders")], {
            caseSensitive: false,
            newId: () => "unused",
        });
        expect(result.ok).to.equal(true);
        if (result.ok === false) {
            return;
        }
        const table = result.schema.tables[0];
        expect(table.name).to.equal("SalesOrders");
        expect(table.id).to.equal("11111111-1111-1111-1111-111111111111"); // v1 id preserved
    });

    test("case-insensitive fallback works on CI databases and is REFUSED on CS databases", () => {
        const baseline = legacyBaseline();
        baseline.tables[0].name = "ORDERS"; // server-side rename case-only
        const ci = replayEditsToLegacySchema(baseline, [renameOp("X")], {
            caseSensitive: false,
            newId: () => "unused",
        });
        expect(ci.ok).to.equal(true);
        const cs = replayEditsToLegacySchema(baseline, [renameOp("X")], {
            caseSensitive: true,
            newId: () => "unused",
        });
        expect(cs.ok).to.equal(false);
        if (cs.ok === false) {
            expect(cs.conflict.code).to.equal("correlationNotFound");
        }
    });
});
