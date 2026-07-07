/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conformance tests for the vendored central-store contract (central design
 * C0.4/C0.5, review addendum T-B4/T-B5 product half): the vendored projection
 * must produce byte-identical digests to perf-contracts on the golden
 * fixtures, the vendored RANK_ORDER must equal the product's redaction
 * ladder, and the classification taxonomy copies must not drift.
 */

import * as assert from "assert";

import {
    clsRank,
    projectDiagSession,
    projectPerfRun,
    RANK_ORDER as VENDORED_RANK_ORDER,
    RANK_TABLE_VERSION,
    UNION_VERSIONS,
    UPLOAD_POLICIES,
    type DiagSessionSource,
    type PerfRunSource,
} from "../../src/sharedInterfaces/centralContract";
import { RANK_ORDER as PRODUCT_RANK_ORDER } from "../../src/diagnostics/redaction";
import {
    GOLDEN_RUN_EXPECTED,
    GOLDEN_RUN_SOURCE,
    GOLDEN_SESSION_EXPECTED,
    GOLDEN_SESSION_SOURCE,
    PRIVACY_CANARY_SOURCE,
} from "./support/centralGoldenFixtures";

suite("central contract conformance (vendored copy vs product truth)", () => {
    test("vendored RANK_ORDER equals the product redaction ladder (cls-rank/1)", () => {
        assert.strictEqual(RANK_TABLE_VERSION, "cls-rank/1");
        assert.deepStrictEqual([...VENDORED_RANK_ORDER], [...PRODUCT_RANK_ORDER]);
        // The trap the ladder exists to avoid: lexicographic ordering.
        assert.ok(clsRank("secret") > clsRank("sql.text"));
    });

    test("envelope union copies match the product vocabulary version", () => {
        assert.strictEqual(UNION_VERSIONS.version, "diag-unions/1");
        assert.strictEqual(UNION_VERSIONS.process.length, 7);
        assert.strictEqual(UNION_VERSIONS.kind.length, 9);
        assert.strictEqual(UNION_VERSIONS.status.length, 6);
        assert.strictEqual(UNION_VERSIONS.timingClass.length, 5);
    });

    test("golden perf run projects to the locked cross-repo digests (T-B5)", () => {
        const projection = projectPerfRun(GOLDEN_RUN_SOURCE as unknown as PerfRunSource, {
            uploadPolicyId: "team-default.v1",
        });
        assert.strictEqual(projection.sourceDigest, GOLDEN_RUN_EXPECTED.sourceDigest);
        assert.strictEqual(projection.contentDigest, GOLDEN_RUN_EXPECTED.contentDigest);
        assert.strictEqual(projection.projectionDigest, GOLDEN_RUN_EXPECTED.projectionDigest);
        assert.strictEqual(projection.previewDigest, GOLDEN_RUN_EXPECTED.previewDigest);
        assert.deepStrictEqual(projection.preview.tables, GOLDEN_RUN_EXPECTED.tables);
    });

    test("golden diag session projects to the locked cross-repo digests (T-B5)", () => {
        const projection = projectDiagSession(
            GOLDEN_SESSION_SOURCE as unknown as DiagSessionSource,
            { uploadPolicyId: "team-default.v1" },
        );
        assert.strictEqual(projection.sourceDigest, GOLDEN_SESSION_EXPECTED.sourceDigest);
        assert.strictEqual(projection.contentDigest, GOLDEN_SESSION_EXPECTED.contentDigest);
        assert.strictEqual(projection.projectionDigest, GOLDEN_SESSION_EXPECTED.projectionDigest);
        assert.strictEqual(projection.previewDigest, GOLDEN_SESSION_EXPECTED.previewDigest);
    });

    test("privacy canaries never survive the vendored projection (T-B8 product half)", () => {
        const projection = projectDiagSession(
            PRIVACY_CANARY_SOURCE as unknown as DiagSessionSource,
            { uploadPolicyId: "team-default.v1" },
        );
        assert.ok(projection.preview.refused.some((r) => r.cls === "secret"));
        const surface = JSON.stringify(projection.items) + JSON.stringify(projection.preview);
        for (const canary of [
            "CANARY-PASSWORD-hunter2-XYZZY",
            "CANARY-CONN-PWD-123",
            "CANARY-TOKEN-eyJhbGciOi",
            "SELECT ssn, salary",
            "123-45-6789",
            "CANARY-SERVER.contoso.com",
            "CANARY-MACHINE-LABEL-7",
        ]) {
            assert.ok(!surface.includes(canary), `canary leaked: ${canary}`);
        }
    });

    test("every policy refuses secrets and drops credentials/SQL/rows", () => {
        for (const policy of Object.values(UPLOAD_POLICIES)) {
            assert.strictEqual(policy.rules.secret, "refuse", policy.policyId);
            assert.strictEqual(policy.rules["sql.text"], "drop", policy.policyId);
            assert.strictEqual(policy.rules["row.data"], "drop", policy.policyId);
            assert.strictEqual(policy.rules["connection.string"], "drop", policy.policyId);
            assert.strictEqual(policy.rules.token, "drop", policy.policyId);
        }
    });
});
