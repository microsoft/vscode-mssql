/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Redaction hard rules for the Debug Console diagnostics substrate. These are
 * the privacy invariants (M16.7): secrets/connection strings/tokens are NEVER
 * plaintext under ANY capture mode, off-mode omits, digests are salted and
 * stable within a session, and diagnostic metadata passes through plain.
 */

import { expect } from "chai";
import { CAPTURE_POLICIES, classify, classifyPayload } from "../../src/diagnostics/redaction";
import { CapturePolicy } from "../../src/sharedInterfaces/debugConsole";

suite("Debug Console redaction hard rules", () => {
    const allPolicies: Array<[string, CapturePolicy]> = [
        ["off", CAPTURE_POLICIES.off],
        ["redacted", CAPTURE_POLICIES.redacted],
        ["digest", CAPTURE_POLICIES.digest],
        ["full", CAPTURE_POLICIES.full("test", Date.now() + 60_000)],
    ];

    test("secrets, connection strings, and tokens are never plaintext in any mode", () => {
        const secret = "P@ssw0rd!SuperSecret";
        for (const [name, policy] of allPolicies) {
            for (const cls of ["secret", "connection.string", "token"] as const) {
                const value = classify(secret, cls, policy);
                expect(value.handling, `${cls} under ${name}`).to.equal("tokenized");
                expect(value.v, `${cls} under ${name} must carry no value`).to.equal(undefined);
                expect(
                    JSON.stringify(value),
                    `${cls} under ${name} leaks plaintext`,
                ).to.not.include(secret);
            }
        }
    });

    test("full mode never allows secrets even though it allows SQL text", () => {
        const full = CAPTURE_POLICIES.full("investigation", Date.now() + 60_000);
        expect(full.allowSecrets).to.equal(false);
        expect(full.allowSqlText).to.equal(true);
        const sql = classify("SELECT * FROM T", "sql.text", full);
        expect(sql.handling).to.equal("plain");
        const secret = classify("hunter2", "secret", full);
        expect(secret.handling).to.equal("tokenized");
    });

    test("off mode omits sensitive values entirely", () => {
        const value = classify("SELECT 1", "sql.text", CAPTURE_POLICIES.off);
        expect(value.handling).to.equal("omitted");
        expect(value.v).to.equal(undefined);
        expect(value.digest).to.equal(undefined);
    });

    test("redacted mode digests names (grouping works) but redacts free text", () => {
        const server = classify("prod-sql-01", "server.name", CAPTURE_POLICIES.redacted);
        expect(server.handling).to.equal("digest");
        expect(server.digest).to.match(/^srv:sha256:/);
        expect(JSON.stringify(server)).to.not.include("prod-sql-01");
        const text = classify("user typed this", "user.text", CAPTURE_POLICIES.redacted);
        expect(text.handling).to.equal("redacted");
        expect(JSON.stringify(text)).to.not.include("user typed");
    });

    test("digests are stable within a session (same value → same digest)", () => {
        const a = classify("MyDatabase", "database.name", CAPTURE_POLICIES.redacted);
        const b = classify("MyDatabase", "database.name", CAPTURE_POLICIES.digest);
        expect(a.digest).to.equal(b.digest);
        const c = classify("OtherDatabase", "database.name", CAPTURE_POLICIES.redacted);
        expect(c.digest).to.not.equal(a.digest);
    });

    test("diagnostic metadata passes through plain in every mode", () => {
        for (const [name, policy] of allPolicies) {
            const count = classify(10000, "diagnostic.metadata", policy);
            expect(count.handling, `metadata under ${name}`).to.equal("plain");
            expect(count.v, `metadata under ${name}`).to.equal(10000);
        }
    });

    test("unknown classification is treated as sensitive", () => {
        const value = classify("mystery", "unknown", CAPTURE_POLICIES.full("x", Date.now() + 1000));
        expect(value.handling).to.not.equal("plain");
        expect(JSON.stringify(value)).to.not.include("mystery");
    });

    test("classifyPayload counts redacted fields and tracks max classification", () => {
        const { payload, maxClassification, redactedFields } = classifyPayload(
            {
                rowCount: { raw: 42, cls: "diagnostic.metadata" },
                connStr: { raw: "Server=x;Password=y", cls: "connection.string" },
                server: { raw: "prod", cls: "server.name" },
            },
            CAPTURE_POLICIES.redacted,
        );
        expect(payload["rowCount"].handling).to.equal("plain");
        expect(payload["connStr"].handling).to.equal("tokenized");
        expect(redactedFields).to.equal(2);
        expect(maxClassification).to.equal("connection.string");
    });

    test("long plain values are truncated with honest length accounting", () => {
        const long = "x".repeat(5000);
        const full = CAPTURE_POLICIES.full("test", Date.now() + 60_000);
        const value = classify(long, "sql.text", full);
        expect(value.handling).to.equal("truncated");
        expect(String(value.v).length).to.equal(4096);
        expect(value.len).to.equal(5000);
    });
});
