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

    test("package.json contributes the custom editor and activation event", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            activationEvents?: string[];
            contributes?: {
                customEditors?: Array<{
                    viewType: string;
                    selector: Array<{ filenamePattern?: string }>;
                    priority?: string;
                }>;
            };
        };
        expect(packageJson.activationEvents).to.include(
            `onCustomEditor:${PINNED_RESULTS_VIEW_TYPE}`,
        );
        const editor = packageJson.contributes?.customEditors?.find(
            (entry) => entry.viewType === PINNED_RESULTS_VIEW_TYPE,
        );
        expect(editor, "customEditors entry").to.not.equal(undefined);
        expect(editor!.selector.map((s) => s.filenamePattern)).to.include("*.mssqlresults");
        expect(editor!.priority).to.equal("default");
        // The scheme constant is what openPinnedResultsDocument mints — a
        // rename that forgets one side should fail here.
        expect(PINNED_RESULTS_SCHEME).to.equal("mssql-query-results-snapshot");
    });
});
