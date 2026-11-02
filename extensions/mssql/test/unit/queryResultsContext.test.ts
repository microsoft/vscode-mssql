/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-4: active-result context service (most-recent-wins resolution, context
 * keys, cleanup on source/snapshot removal) and the status document builder
 * (structural facts only — the canary must not survive rendering).
 */

import { expect } from "chai";
import { QueryResultContextService } from "../../src/queryResults/queryResultContextService";
import { renderQueryResultsStatus } from "../../src/queryResults/queryResultsStatus";

const CANARY = "CANARY_ctx_51ad";

suite("queryResults context service", () => {
    function makeService() {
        const keys: Record<string, unknown> = {};
        const service = new QueryResultContextService((key, value) => {
            keys[key] = value;
        });
        return { service, keys };
    }

    test("selection updates set the current context and context keys", () => {
        const { service, keys } = makeService();
        expect(service.current()).to.equal(undefined);
        service.updateFromQueryStudio("src1", {
            resultSetId: "rs1",
            active: { row: 3, column: 2 },
            selectedCellCount: 6,
            selectedRowCount: 2,
            reason: "selection",
        });
        const current = service.current()!;
        expect(current.kind).to.equal("queryStudio");
        expect(current.sourceId).to.equal("src1");
        expect(current.resultSetId).to.equal("rs1");
        expect(current.selectedCellCount).to.equal(6);
        expect(keys["mssql.queryResults.hasActiveSource"]).to.equal(true);
        expect(keys["mssql.queryResults.hasActiveSelection"]).to.equal(true);
        expect(keys["mssql.queryResults.activeSourceKind"]).to.equal("queryStudio");
    });

    test("most recent update wins across live and pinned surfaces", () => {
        const { service, keys } = makeService();
        service.updateFromQueryStudio("src1", {
            resultSetId: "rs1",
            selectedCellCount: 1,
            reason: "selection",
        });
        service.updateFromPinnedDocument("qsnap_a", {
            resultSetId: "rs2",
            selectedCellCount: 4,
            reason: "selection",
        });
        expect(service.current()!.kind).to.equal("pinnedSnapshot");
        expect(service.current()!.snapshotId).to.equal("qsnap_a");
        expect(keys["mssql.queryResults.activeSourceKind"]).to.equal("pinnedSnapshot");
    });

    test("spatial selection is contextual but never impersonates an active grid cell", () => {
        const { service, keys } = makeService();
        service.updateFromQueryStudio("src1", {
            resultSetId: "rs1",
            spatial: { row: 17, column: 3 },
            selectedCellCount: 1,
            selectedRowCount: 1,
            reason: "spatial",
        });
        expect(service.current()!.spatial).to.deep.equal({ row: 17, column: 3 });
        expect(service.current()!.active).to.equal(undefined);
        expect(keys["mssql.queryResults.hasActiveSelection"]).to.equal(true);
    });

    test("empty selection clears the selection key but keeps the source", () => {
        const { service, keys } = makeService();
        service.updateFromQueryStudio("src1", {
            resultSetId: "rs1",
            selectedCellCount: 0,
            selectedRowCount: 0,
            reason: "selection",
        });
        expect(keys["mssql.queryResults.hasActiveSource"]).to.equal(true);
        expect(keys["mssql.queryResults.hasActiveSelection"]).to.equal(false);
    });

    test("clearForSource / clearForSnapshot drop only matching contexts", () => {
        const { service, keys } = makeService();
        service.updateFromQueryStudio("src1", {
            resultSetId: "rs1",
            selectedCellCount: 1,
            reason: "selection",
        });
        service.clearForSource("other");
        expect(service.current()).to.not.equal(undefined);
        service.clearForSource("src1");
        expect(service.current()).to.equal(undefined);
        expect(keys["mssql.queryResults.hasActiveSource"]).to.equal(false);
        expect(keys["mssql.queryResults.activeSourceKind"]).to.equal("");

        service.updateFromPinnedDocument("qsnap_b", {
            resultSetId: "rs1",
            selectedCellCount: 2,
            reason: "focus",
        });
        service.clearForSnapshot("qsnap_b");
        expect(service.current()).to.equal(undefined);
    });
});

suite("queryResults status document", () => {
    test("renders structural facts and truncated ids; canary never survives", () => {
        const text = renderQueryResultsStatus({
            status: {
                liveSources: 2,
                snapshots: 1,
                leasesByOwnerKind: { pinnedDocument: 1 },
                retainedStores: 1,
                retainedMemoryBytes: 1024,
                retainedSpillBytes: 2048,
                lastSweep: { atEpochMs: Date.now(), swept: 0, expired: 0 },
            },
            snapshots: [
                {
                    snapshotId: `qsnap_${CANARY}FULLIDSHOULDNOTAPPEAR`,
                    purpose: "pinnedDocument",
                    resultSetCount: 2,
                    totalRows: 100,
                    leaseCount: 1,
                    createdEpochMs: Date.now() - 5000,
                },
            ],
            context: {
                kind: "queryStudio",
                sourceId: "src1",
                resultSetId: "rs1",
                selectedCellCount: 3,
                selectedRowCount: 1,
                updatedEpochMs: Date.now(),
            },
            paramsDigest: "abc123def456",
            overriddenKeys: ["snapshotTtlMinutes"],
        });
        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed["liveSources"]).to.equal(2);
        expect(text).to.include("abc123def456");
        expect(text).to.include("pinnedDocument");
        // Ids truncate to 12 chars + ellipsis — the full id (and anything
        // embedded past the prefix) must not appear.
        expect(text).to.not.include("FULLIDSHOULDNOTAPPEAR");
        // Context carries shape only.
        expect(text).to.not.include("sourceId");
    });
});
