/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Virtual runbook URI mapping (D-0014 step c): the pure assetId <-> path
 * projections behind the mssql-runbook: FileSystemProvider. The provider
 * itself is a thin vscode.workspace.fs pass-through to the library stash;
 * the mapping is where correctness lives (round-trips, honest rejection of
 * paths the stash could never contain).
 */

import { expect } from "chai";
import * as vscode from "vscode";
import { sanitizeAssetId, STASH_FILE_SUFFIX } from "../../src/runbookStudio/libraryStash";
import {
    assetIdFromVirtualPath,
    RUNBOOK_FS_SCHEME,
    runbookVirtualPath,
    runbookVirtualUri,
    stashNameFromVirtualPath,
} from "../../src/runbookStudio/runbookFileSystem";

suite("runbookFileSystem uri mapping", () => {
    suite("runbookVirtualPath", () => {
        test("projects a filesystem-safe id to a root-level stash name", () => {
            expect(runbookVirtualPath("rb-1")).to.equal("/rb-1.runbook.json");
        });

        test("sanitizes unsafe ids exactly like the stash file name does", () => {
            expect(runbookVirtualPath("a b/c")).to.equal(
                `/${sanitizeAssetId("a b/c")}${STASH_FILE_SUFFIX}`,
            );
            expect(runbookVirtualPath("a b/c")).to.equal("/a_b_c.runbook.json");
        });
    });

    suite("runbookVirtualUri", () => {
        test("uses the mssql-runbook scheme with the virtual path", () => {
            const uri = runbookVirtualUri("rb-1");
            expect(uri.scheme).to.equal(RUNBOOK_FS_SCHEME);
            expect(uri.path).to.equal("/rb-1.runbook.json");
            expect(uri.authority).to.equal("");
        });

        test("survives a toString/parse round-trip (hot-exit tab identity)", () => {
            const uri = runbookVirtualUri("runbook-abc123");
            const reparsed = vscode.Uri.parse(uri.toString());
            expect(reparsed.scheme).to.equal(uri.scheme);
            expect(reparsed.path).to.equal(uri.path);
            expect(reparsed.toString()).to.equal(uri.toString());
        });
    });

    suite("stashNameFromVirtualPath", () => {
        test("accepts a root-level stash-shaped name", () => {
            expect(stashNameFromVirtualPath("/rb-1.runbook.json")).to.equal("rb-1.runbook.json");
        });

        test("rejects paths without a leading slash", () => {
            expect(stashNameFromVirtualPath("rb-1.runbook.json")).to.equal(undefined);
        });

        test("rejects the root and an empty stem", () => {
            expect(stashNameFromVirtualPath("/")).to.equal(undefined);
            expect(stashNameFromVirtualPath("")).to.equal(undefined);
            expect(stashNameFromVirtualPath("/.runbook.json")).to.equal(undefined);
        });

        test("rejects nested paths and traversal in either separator", () => {
            expect(stashNameFromVirtualPath("/sub/rb-1.runbook.json")).to.equal(undefined);
            expect(stashNameFromVirtualPath("/../rb-1.runbook.json")).to.equal(undefined);
            expect(stashNameFromVirtualPath("/..\\rb-1.runbook.json")).to.equal(undefined);
        });

        test("rejects names outside the stash's sanitized alphabet", () => {
            expect(stashNameFromVirtualPath("/a b.runbook.json")).to.equal(undefined);
            expect(stashNameFromVirtualPath("/a%20b.runbook.json")).to.equal(undefined);
        });

        test("rejects names without the runbook suffix", () => {
            expect(stashNameFromVirtualPath("/rb-1.json")).to.equal(undefined);
            expect(stashNameFromVirtualPath("/rb-1")).to.equal(undefined);
        });
    });

    suite("assetIdFromVirtualPath", () => {
        test("round-trips a filesystem-safe id exactly", () => {
            expect(assetIdFromVirtualPath(runbookVirtualPath("runbook-m5x"))).to.equal(
                "runbook-m5x",
            );
        });

        test("round-trips any id to its sanitized projection", () => {
            const id = "a b/c:d";
            expect(assetIdFromVirtualPath(runbookVirtualPath(id))).to.equal(sanitizeAssetId(id));
        });

        test("returns undefined for invalid virtual paths", () => {
            expect(assetIdFromVirtualPath("/sub/x.runbook.json")).to.equal(undefined);
            expect(assetIdFromVirtualPath("/x.json")).to.equal(undefined);
            expect(assetIdFromVirtualPath("x.runbook.json")).to.equal(undefined);
        });
    });
});
