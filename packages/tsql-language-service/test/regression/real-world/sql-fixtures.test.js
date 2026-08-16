/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
} = require("../../../dist/index.js");

const fixtureRoot = path.join(__dirname, "..", "..", "fixtures", "real-world-sql");
const manifest = require("../../fixtures/real-world-sql/manifest.json");

suite("Real-world T-SQL regression fixtures", () => {
    // Locks the checked-in fixture inventory so new or missing scripts cannot silently escape coverage.
    test("manifest lists every organized SQL fixture exactly once", async () => {
        const actual = await discoverSqlFiles(fixtureRoot);
        const declared = manifest.files.map(({ path: fixturePath }) => fixturePath).sort();

        assert.equal(manifest.schemaVersion, 1);
        assert.equal(declared.length, 38);
        assert.equal(new Set(declared).size, declared.length);
        assert.deepEqual(actual, declared);
    });

    for (const category of categories()) {
        suite(category, () => {
            for (const fixture of manifest.files.filter(({ path: fixturePath }) =>
                fixturePath.startsWith(`${category}/`),
            )) {
                // Each script is a named test so failures identify the fixture directly in test output.
                test(path.basename(fixture.path), async () => {
                    const sql = await readFile(path.join(fixtureRoot, fixture.path), "utf8");
                    const runtime = new InProcessLanguageServiceRuntime(
                        new LezerSyntaxService(),
                        new CatalogSemanticBinder(),
                        new NullMetadataProvider(),
                    );
                    const snapshot = await runtime.open(
                        `fixture:///real-world-sql/${fixture.path}`,
                        1,
                        sql,
                    );

                    assert.deepEqual(
                        snapshot.syntax.diagnostics.map(({ code, message, range }) => ({
                            code,
                            message,
                            source: sql.slice(range.start, range.end),
                        })),
                        fixture.expectedSyntaxDiagnostics ?? [],
                    );
                    assert.equal(
                        snapshot.syntax.statistics.rawErrorNodeCount,
                        fixture.expectedRawErrorNodeCount ?? 0,
                    );
                    assert.deepEqual(
                        snapshot.semantics.diagnostics.map(({ code, message }) => ({
                            code,
                            message,
                        })),
                        fixture.expectedSemanticDiagnostics,
                    );
                });
            }
        });
    }
});

function categories() {
    return [
        ...new Set(manifest.files.map(({ path: fixturePath }) => fixturePath.split("/")[0])),
    ].sort();
}

async function discoverSqlFiles(directory, relative = "") {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            result.push(
                ...(await discoverSqlFiles(path.join(directory, entry.name), relativePath)),
            );
        } else if (entry.isFile() && entry.name.endsWith(".sql")) {
            result.push(relativePath.replaceAll("\\", "/"));
        }
    }
    return result.sort();
}
