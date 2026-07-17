/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C2D-2/3: pinned results contribution + URI contract. The custom editor's
 * interactive behavior (openWith on the virtual scheme, grid rendering) is
 * validated by dogfood + perftest scenarios; these tests pin down the static
 * contract the pieces agree on.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
    PINNED_RESULTS_SCHEME,
    PINNED_RESULTS_VIEW_TYPE,
    isPinnedResultsState,
    pinnedResultsUriParts,
} from "../../src/sharedInterfaces/queryResultsSnapshot";

suite("queryResults pinned document contract", () => {
    test("URI query round-trips the snapshot id", () => {
        expect(pinnedResultsUriParts({ query: "sid=qsnap_abc-123_XY" })).to.deep.equal({
            snapshotId: "qsnap_abc-123_XY",
        });
        expect(pinnedResultsUriParts({ query: "other=1&sid=qsnap_x" })).to.deep.equal({
            snapshotId: "qsnap_x",
        });
        expect(pinnedResultsUriParts({ query: "" })).to.equal(undefined);
        expect(pinnedResultsUriParts({ query: "sid=" })).to.equal(undefined);
        // Injection shapes clamp at the first non-id character: ids are
        // strictly [A-Za-z0-9_-], so path fragments never ride through.
        expect(pinnedResultsUriParts({ query: "sid=../../etc" })).to.equal(undefined);
        expect(pinnedResultsUriParts({ query: "sid=ok..evil" })).to.deep.equal({
            snapshotId: "ok",
        });
    });

    test("state guard accepts only pinned-results state", () => {
        expect(
            isPinnedResultsState({
                kind: "queryResultsSnapshot",
                expired: false,
                resultSets: [],
                totalRows: 0,
                messageCount: 0,
                errorCount: 0,
                hasLocalMessages: false,
            }),
        ).to.equal(true);
        expect(isPinnedResultsState({ kind: "queryStudio" })).to.equal(false);
        expect(isPinnedResultsState(undefined)).to.equal(false);
    });

    test("pinned results are a WebviewPanel, NOT a custom editor (breadcrumb regression)", () => {
        // Dogfood 2026-07-10: file-like custom-editor resources get a
        // breadcrumbs row that just repeats the tab title for our virtual
        // single-segment path. The surface is a plain WebviewPanel now —
        // this pins the contribution's ABSENCE so it cannot quietly return.
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            activationEvents?: string[];
            contributes?: {
                customEditors?: Array<{ viewType: string }>;
            };
        };
        expect(packageJson.activationEvents).to.not.include(
            `onCustomEditor:${PINNED_RESULTS_VIEW_TYPE}`,
        );
        const editor = packageJson.contributes?.customEditors?.find(
            (entry) => entry.viewType === PINNED_RESULTS_VIEW_TYPE,
        );
        expect(editor, "customEditors entry must stay absent").to.equal(undefined);
        // The scheme constant survives as the lease-owner/context identity —
        // a rename that forgets one side should fail here.
        expect(PINNED_RESULTS_SCHEME).to.equal("mssql-query-results-snapshot");
    });

    test("pinned basemap parity (D-0035): same RPC surface and resource root as live QS", () => {
        const sourceRoot = path.join(__dirname, "..", "..", "..", "src");
        const pinned = fs.readFileSync(
            path.join(sourceRoot, "queryResults", "pinnedResultsController.ts"),
            "utf8",
        );
        const live = fs.readFileSync(
            path.join(sourceRoot, "queryStudio", "queryStudioController.ts"),
            "utf8",
        );
        const app = fs.readFileSync(
            path.join(sourceRoot, "webviews", "pages", "QueryResultsSnapshot", "app.tsx"),
            "utf8",
        );
        // Every basemap RPC live QS answers, the pinned controller answers too.
        for (const rpc of [
            "QsSpatialBasemapListRequest.type",
            "QsSpatialBasemapOpenRequest.type",
            "QsSpatialBasemapTileRequest.type",
            "QsSpatialBasemapCloseRequest.type",
        ]) {
            expect(live, `live registers ${rpc}`).to.include(`this.onRequest(${rpc}`);
            expect(pinned, `pinned registers ${rpc}`).to.include(`this.onRequest(${rpc}`);
        }
        // Both surfaces admit the tile cache as a local resource root via the
        // context-derived helper (never the host singleton — restore order).
        expect(pinned).to.include("spatialBasemapCacheRoot(context)");
        expect(live).to.include("spatialBasemapCacheRoot(context)");
        // Config changes reach a mounted pane: epoch in state, prop in app.
        expect(pinned).to.include("this.spatialBasemapEpoch++");
        expect(app).to.include("basemapEpoch={state.spatialBasemapEpoch ?? 0}");
    });

    test("hidden pinned Vector work is suspended in both host and renderer", () => {
        const sourceRoot = path.join(__dirname, "..", "..", "..", "src");
        const controller = fs.readFileSync(
            path.join(sourceRoot, "queryResults", "pinnedResultsController.ts"),
            "utf8",
        );
        const app = fs.readFileSync(
            path.join(sourceRoot, "webviews", "pages", "QueryResultsSnapshot", "app.tsx"),
            "utf8",
        );
        expect(controller).to.include("this.panel.onDidChangeViewState");
        expect(controller).to.include("this.suspendVectorWorkbench()");
        expect(app).to.include('document.addEventListener("visibilitychange"');
        expect(app).to.include('active={panelVisible && visibleActiveTab === "vector"}');
        expect(app).to.include("panelVisible={panelVisible}");
    });
});
