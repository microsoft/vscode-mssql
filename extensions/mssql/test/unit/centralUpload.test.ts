/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central upload service over the fake data plane (central design §8.3,
 * addendum C-11): begin→stage→commit protocol, resume skipping, cancel at
 * item boundaries (batch left resumable), abort on failure, pre-transport
 * policy refusal, and literal-encoding discipline on the wire text.
 */

import * as assert from "assert";

import {
    projectDiagSession,
    type DiagSessionSource,
} from "../../src/sharedInterfaces/centralContract";
import {
    CentralUploadError,
    CentralUploadService,
    type CentralUploadOptions,
} from "../../src/diagnostics/centralUpload";
import { FakeBackend, type FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import { GOLDEN_SESSION_SOURCE, PRIVACY_CANARY_SOURCE } from "./support/centralGoldenFixtures";

const BEGIN_COLUMNS = ["disposition", "upload_batch_id", "reason_code", "applied_items_json"];
const COMMIT_COLUMNS = [
    "upload_batch_id",
    "outcome",
    "reason_code",
    "source_kind",
    "natural_key",
    "upload_policy_id",
    "row_counts_json",
    "source_digest",
    "content_digest",
    "projection_digest",
    "preview_digest",
    "committed_at_utc",
];

function goldenProjection() {
    return projectDiagSession(GOLDEN_SESSION_SOURCE as unknown as DiagSessionSource, {
        uploadPolicyId: "team-default.v1",
    });
}

function options(overrides?: Partial<CentralUploadOptions>): CentralUploadOptions {
    return {
        uploadPolicyId: "team-default.v1",
        principalAlias: "unit@test",
        toolVersion: "0.0.0-test",
        ...overrides,
    };
}

function service(backend: FakeBackend): CentralUploadService {
    return new CentralUploadService(backend, {
        profileRef: {
            profileFingerprint: "pfp_central_test0000000",
            server: "localhost",
            authKind: "integrated",
        },
        database: "PerfCentral",
    });
}

function beginScript(
    disposition: string,
    batchId: number | null,
    applied = "[]",
    reason: string | null = null,
): FakeScript {
    return {
        match: (text) => text.includes("usp_begin_upload"),
        events: [
            {
                type: "resultSet",
                columns: BEGIN_COLUMNS,
                rows: [[disposition, batchId, reason, applied]],
            },
            { type: "complete", status: "succeeded" },
        ],
    };
}

function stageScript(seen: string[]): FakeScript {
    return {
        match: (text) => {
            if (text.includes("usp_stage_upload_item")) {
                seen.push(text);
                return true;
            }
            return false;
        },
        events: [
            {
                type: "resultSet",
                columns: ["item_status", "rows_inserted"],
                rows: [["applied", 1]],
            },
            { type: "complete", status: "succeeded" },
        ],
    };
}

function commitScript(outcome = "committed"): FakeScript {
    return {
        match: (text) => text.includes("usp_commit_upload"),
        events: [
            {
                type: "resultSet",
                columns: COMMIT_COLUMNS,
                rows: [
                    [
                        7,
                        outcome,
                        null,
                        "diagSession",
                        "sess-golden-0001",
                        "team-default.v1",
                        '[{"item_kind":"diag_sessions","rows":1}]',
                        "src_x",
                        "cnt_x",
                        "prj_x",
                        "pvw_x",
                        "2026-07-06T12:00:00Z",
                    ],
                ],
            },
            { type: "complete", status: "succeeded" },
        ],
    };
}

suite("central upload service (fake data plane)", () => {
    test("happy path: begin → stage all items → commit returns the receipt", async () => {
        const staged: string[] = [];
        const backend = new FakeBackend({
            scripts: [beginScript("proceed", 7), stageScript(staged), commitScript()],
        });
        const projection = goldenProjection();
        const progress: number[] = [];
        const result = await service(backend).upload(
            projection,
            options({ onProgress: (done) => progress.push(done) }),
        );
        assert.strictEqual(result.receipt?.outcome, "committed");
        assert.strictEqual(result.receipt?.uploadBatchId, 7);
        assert.strictEqual(staged.length, projection.items.length);
        assert.strictEqual(progress[progress.length - 1], projection.items.length);
        // Literal-encoding discipline on the wire: N-strings, doubled quotes
        // only inside literals, and no raw control characters.
        for (const text of staged) {
            assert.ok(text.includes("@payload = N'"), "payload rides as an N-string literal");
            assert.ok(!text.includes(String.fromCharCode(0)), "no NUL on the wire");
        }
    });

    test("alreadyPresent short-circuits without staging", async () => {
        const staged: string[] = [];
        const backend = new FakeBackend({
            scripts: [beginScript("alreadyPresent", null), stageScript(staged)],
        });
        const result = await service(backend).upload(goldenProjection(), options());
        assert.strictEqual(result.disposition.disposition, "alreadyPresent");
        assert.strictEqual(result.receipt, undefined);
        assert.strictEqual(staged.length, 0);
    });

    test("resume skips already-applied items", async () => {
        const projection = goldenProjection();
        const first = projection.items[0]!;
        const applied = JSON.stringify([
            {
                item_kind: first.item_kind,
                item_ordinal: first.item_ordinal,
                payload_digest: first.payload_digest,
            },
        ]);
        const staged: string[] = [];
        const backend = new FakeBackend({
            scripts: [beginScript("resume", 9, applied), stageScript(staged), commitScript()],
        });
        const result = await service(backend).upload(projection, options());
        assert.strictEqual(result.receipt?.outcome, "committed");
        assert.strictEqual(staged.length, projection.items.length - 1);
        assert.ok(!staged.some((t) => t.includes(`@item_ordinal = ${first.item_ordinal},`)));
    });

    test("policy refusal happens before any transport", async () => {
        const backend = new FakeBackend({
            failOpen: { code: "unreachable", message: "must not be called" },
        });
        const projection = projectDiagSession(
            PRIVACY_CANARY_SOURCE as unknown as DiagSessionSource,
            { uploadPolicyId: "team-default.v1" },
        );
        await assert.rejects(
            () => service(backend).upload(projection, options()),
            /refused by policy/,
        );
    });

    test("cancel lands at an item boundary and leaves the batch resumable (no abort)", async () => {
        const staged: string[] = [];
        const aborts: string[] = [];
        const backend = new FakeBackend({
            scripts: [
                beginScript("proceed", 11),
                stageScript(staged),
                {
                    match: (text) => {
                        if (text.includes("usp_abort_upload")) {
                            aborts.push(text);
                            return true;
                        }
                        return false;
                    },
                    events: [{ type: "complete", status: "succeeded" }],
                },
            ],
        });
        let canceled = false;
        await assert.rejects(
            () =>
                service(backend).upload(
                    goldenProjection(),
                    options({
                        isCanceled: () => canceled,
                        onProgress: () => {
                            canceled = true; // cancel after the first item lands
                        },
                    }),
                ),
            (error: Error) => error instanceof CentralUploadError && error.code === "canceled",
        );
        assert.strictEqual(staged.length, 1);
        assert.strictEqual(aborts.length, 0, "canceled uploads stay resumable");
    });

    test("a failing stage aborts the batch as failed", async () => {
        const aborts: string[] = [];
        const backend = new FakeBackend({
            scripts: [
                beginScript("proceed", 13),
                {
                    match: (text) => text.includes("usp_stage_upload_item"),
                    events: [
                        { type: "message", kind: "error", text: "boom (53007)" },
                        { type: "complete", status: "failed" },
                    ],
                },
                {
                    match: (text) => {
                        if (text.includes("usp_abort_upload")) {
                            aborts.push(text);
                            return true;
                        }
                        return false;
                    },
                    events: [{ type: "complete", status: "succeeded" }],
                },
            ],
        });
        await assert.rejects(
            () => service(backend).upload(goldenProjection(), options()),
            /central call failed/,
        );
        assert.strictEqual(aborts.length, 1);
        assert.ok(aborts[0]!.includes("@final_status = N'failed'"));
    });
});
