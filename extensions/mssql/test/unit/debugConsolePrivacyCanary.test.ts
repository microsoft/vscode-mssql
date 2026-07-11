/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Privacy canary corpus (Chunk 2). Distinctive sentinel values are pushed
 * through the classification choke point, the session store's on-disk
 * journal, and the harness wire queue — and must never surface as plaintext
 * where policy forbids it. Secrets/connection strings/tokens are NEVER
 * plaintext, in ANY mode, including full.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { classifyPayload, CAPTURE_POLICIES } from "../../src/diagnostics/redaction";
import { PerfModeSink, SessionDiagSink } from "../../src/diagnostics/sinks";
import { diagnosticErrorClass } from "../../src/diagnostics/diagnosticsCore";
import { DIAG_SCHEMA_VERSION, DiagEvent } from "../../src/sharedInterfaces/debugConsole";

const CANARY = {
    password: "CANARY-password-7f3a9",
    connectionString: "Server=canaryhost;Password=CANARY-connstr-2b8c1;",
    token: "CANARY-token-eyJhbGciOi-5d4e2",
    sqlText: "SELECT canary_column FROM CANARY_TABLE_91x WHERE secret = 'CANARY-sql-6a1f0'",
    rowData: "CANARY-row-cell-value-3c7d9",
    providerMessage: "Login failed for user 'CANARY-provider-8e2b4'",
};

const CANARY_FIELDS = {
    password: { raw: CANARY.password, cls: "secret" as const },
    connStr: { raw: CANARY.connectionString, cls: "connection.string" as const },
    token: { raw: CANARY.token, cls: "token" as const },
    sql: { raw: CANARY.sqlText, cls: "sql.text" as const },
    row: { raw: CANARY.rowData, cls: "row.data" as const },
    provider: { raw: CANARY.providerMessage, cls: "user.text" as const },
};

function assertNoCanary(haystack: string, allowed: string[] = []) {
    for (const [name, value] of Object.entries(CANARY)) {
        if (allowed.includes(name)) {
            continue;
        }
        expect(haystack.includes(value), `canary '${name}' leaked as plaintext`).to.equal(false);
    }
}

suite("Privacy canary corpus", () => {
    test("diagnostic error classes reject provider-controlled code and name text", () => {
        const error = new Error(CANARY.providerMessage);
        error.name = CANARY.providerMessage;
        (error as Error & { code: string }).code = CANARY.token;
        expect(diagnosticErrorClass(error)).to.equal("UnknownError");
        expect(
            diagnosticErrorClass(
                Object.assign(new Error("safe UI message"), { code: "SqlDataPlane.Auth" }),
            ),
        ).to.equal("SqlDataPlane.Auth");
    });

    test("digest and redacted modes: no canary survives classification", () => {
        for (const policy of [CAPTURE_POLICIES.digest, CAPTURE_POLICIES.redacted]) {
            const { payload } = classifyPayload(CANARY_FIELDS, policy);
            assertNoCanary(JSON.stringify(payload));
        }
    });

    test("full capture: secrets/connection strings/tokens STILL never plaintext", () => {
        const policy = CAPTURE_POLICIES.full("canary test", Date.now() + 60_000);
        const { payload } = classifyPayload(CANARY_FIELDS, policy);
        const serialized = JSON.stringify(payload);
        // sql/row/provider text may be plain under governed full capture;
        // the hard rule is secrets NEVER are.
        assertNoCanary(serialized, ["sqlText", "rowData", "providerMessage"]);
        expect(serialized.includes(CANARY.password)).to.equal(false);
        expect(serialized.includes(CANARY.connectionString)).to.equal(false);
        expect(serialized.includes(CANARY.token)).to.equal(false);
    });

    test("session store journal on disk carries no canaries (redacted mode)", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-canary-"));
        try {
            const policy = CAPTURE_POLICIES.redacted;
            const { payload, maxClassification, redactedFields } = classifyPayload(
                CANARY_FIELDS,
                policy,
            );
            const sink = new SessionDiagSink(root, "sess_canary", "redacted", policy.policyId, {
                product: "test",
            } as never);
            const event: DiagEvent = {
                schemaVersion: DIAG_SCHEMA_VERSION,
                eventId: "evt_canary",
                sessionId: "sess_canary",
                seq: 1,
                epochMs: Date.now(),
                process: "extensionHost",
                feature: "connection",
                kind: "event",
                type: "mssql.connection.failed",
                status: "error",
                cls: { max: maxClassification, redactedFields, policyId: policy.policyId },
                payload,
            };
            sink.tryWrite(event);
            sink.close();
            // Read EVERYTHING persisted for the session (segments + manifest).
            const sessionDir = path.join(root, "sessions", "sess_canary");
            let persisted = "";
            const walk = (dir: string) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(full);
                    } else {
                        persisted += fs.readFileSync(full, "utf8");
                    }
                }
            };
            walk(sessionDir);
            expect(persisted.length).to.be.greaterThan(0);
            assertNoCanary(persisted);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("harness wire (PerfModeSink) forwards only plain-handled fields", () => {
        const policy = CAPTURE_POLICIES.redacted;
        const { payload, maxClassification, redactedFields } = classifyPayload(
            CANARY_FIELDS,
            policy,
        );
        const sink = new PerfModeSink("http://127.0.0.1:1/unused", "tok", "run", 0, "scen");
        sink.tryWrite({
            schemaVersion: DIAG_SCHEMA_VERSION,
            eventId: "evt_wire",
            sessionId: "sess",
            seq: 2,
            epochMs: Date.now(),
            process: "extensionHost",
            feature: "connection",
            kind: "event",
            type: "mssql.connection.failed",
            status: "error",
            cls: { max: maxClassification, redactedFields, policyId: policy.policyId },
            tags: ["perfMarker", "phase:instant"],
            payload,
        });
        sink.tryWrite({
            schemaVersion: DIAG_SCHEMA_VERSION,
            eventId: "evt_token_wire",
            sessionId: "sess",
            seq: 3,
            epochMs: Date.now(),
            process: "extensionHost",
            feature: "sqlDataPlane",
            kind: "span",
            type: "sqlDataPlane.auth.token.end",
            status: "ok",
            durationMs: 12,
            cls: { max: maxClassification, redactedFields, policyId: policy.policyId },
            payload,
        });
        expect(sink.queuedCount).to.equal(2);
        // Serialize exactly what would go on the wire.
        const queued = (sink as unknown as { queue: unknown[] }).queue;
        assertNoCanary(JSON.stringify(queued));
    });

    test("store integrity: validateStore is clean on a healthy journal and flags a truncated one", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-integrity-"));
        try {
            const policy = CAPTURE_POLICIES.redacted;
            const sink = new SessionDiagSink(root, "sess_v", "redacted", policy.policyId, {
                product: "test",
            } as never);
            for (let seq = 1; seq <= 5; seq++) {
                sink.tryWrite({
                    schemaVersion: DIAG_SCHEMA_VERSION,
                    eventId: `evt_${seq}`,
                    sessionId: "sess_v",
                    seq,
                    epochMs: Date.now(),
                    process: "extensionHost",
                    feature: "system",
                    kind: "event",
                    type: "sessionDiag.enabled",
                    status: "ok",
                    cls: { max: "public", redactedFields: 0, policyId: policy.policyId },
                });
            }
            sink.close();
            const { SessionStore } = require("../../src/diagnostics/sessionStore");
            const store = new SessionStore(root);
            const clean = store.validateStore();
            expect(clean.issues, clean.issues.join("; ")).to.deep.equal([]);
            expect(clean.totalBytes).to.be.greaterThan(0);
            // Truncate the segment mid-line: integrity must flag it.
            const segFile = path.join(root, "sessions", "sess_v", "events", "segment-000001.jsonl");
            const content = fs.readFileSync(segFile, "utf8");
            fs.writeFileSync(segFile, content.slice(0, content.length - 10), "utf8");
            const dirty = store.validateStore();
            expect(dirty.issues.length).to.be.greaterThan(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
