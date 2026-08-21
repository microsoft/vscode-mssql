/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { suite, test } from "node:test";

import { diagnosticCatalog, type DiagnosticRole } from "./diagnosticCatalog.ts";
import { diagnosticEvidence } from "./diagnosticEvidence.ts";

const nonDiagnosticRoles = new Map<string, DiagnosticRole>([
    ["ParseResultsShouldNotContainNullElement", "api-precondition"],
    ["CommaOr", "message-fragment"],
    ["Expecting", "message-fragment"],
    ["EndOfFile", "message-fragment"],
    ["Comma", "message-fragment"],
    ["Period", "message-fragment"],
    ["ExtendedStoredProceduresNotSupported", "signature-help-text"],
    ["StoredProceduresAlwaysReturnInt", "signature-help-text"],
]);
const supported: readonly string[] = diagnosticEvidence.flatMap(({ diagnostics }) => diagnostics);

suite("T-SQL diagnostic coverage inventory", () => {
    // Locks the reviewed scanner, parser, and binder inventory independently of implementation progress.
    test("contains the reviewed diagnostic inventory", () => {
        assert.equal(diagnosticCatalog.length, 265);
        assert.deepEqual(
            Object.fromEntries(
                ["scanner", "parser", "binder"].map((category) => [
                    category,
                    diagnosticCatalog.filter((entry) => entry.category === category).length,
                ]),
            ),
            { scanner: 1, parser: 14, binder: 250 },
        );
        assert.equal(
            new Set(diagnosticCatalog.map(({ name }) => name)).size,
            diagnosticCatalog.length,
        );
    });

    // Only reviewed API preconditions and message fragments stay outside the product denominator.
    test("excludes only the reviewed non-diagnostic entries", () => {
        const roleEntries = diagnosticCatalog.filter((entry) => entry.role !== undefined);
        assert.deepEqual(
            roleEntries.map(({ name, role }) => [name, role]).sort(),
            [...nonDiagnosticRoles].sort(),
        );
        assert.equal(roleEntries.length, nonDiagnosticRoles.size);
    });

    // Every supported family points to a checked-in focused behavior suite instead of a bare count.
    test("links every supported family to executable behavior evidence", () => {
        const testRoot = path.resolve(__dirname, "..", "..", "..");
        for (const group of diagnosticEvidence) {
            assert.ok(group.diagnostics.length > 0, group.test);
            assert.equal(typeof group.suite, "string", group.test);
            assert.ok(group.suite.length > 0, group.test);
            assert.match(group.test, /\.test\.ts$/u);
            assert.equal(group.test.includes("integration/"), false, group.test);
            const evidencePath = path.join(testRoot, group.test);
            assert.equal(existsSync(evidencePath), true, group.test);
            const source = readFileSync(evidencePath, "utf8");
            assert.ok(source.includes(`suite("${group.suite}"`), `${group.test}: ${group.suite}`);
            assert.match(source, /\btest\s*\(/u, group.test);
        }
    });

    // Duplicate evidence, unknown names, and excluded message fragments cannot inflate coverage.
    test("keeps diagnostic evidence unique and inside the product inventory", () => {
        assert.equal(new Set(supported).size, supported.length);
        const targetNames = new Set(diagnosticCatalog.map(({ name }) => name));
        assert.deepEqual(
            supported.filter((name) => !targetNames.has(name)),
            [],
        );
        assert.deepEqual(
            supported.filter((name) => nonDiagnosticRoles.has(name)),
            [],
        );
    });

    // Keeps the headline gap reproducible from the evidence manifest rather than a second set here.
    test("reports supported and remaining product families from evidence", () => {
        const productDiagnostics = diagnosticCatalog.filter((entry) => entry.role === undefined);
        assert.equal(productDiagnostics.length, 257);
        assert.equal(supported.length, 257);
        assert.equal(productDiagnostics.length - supported.length, 0);
    });
});
