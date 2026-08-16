/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../dist/index.js");

/** Runs public syntax and semantic analysis against one immutable metadata provider. */
async function analyzeSql(sql, provider = createMetadata(), options = {}) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(options.uri ?? "file:///semantic-diagnostics.sql", 1, sql);
    if (!options.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return options.snapshot ? snapshot : snapshot.semantics.diagnostics;
}

/** Creates stable analyze/open helpers for one diagnostic domain without duplicating runtime setup. */
function createSemanticHarness(options = {}) {
    const provider = options.provider ?? createMetadata(options.metadata);
    const uri = options.uri ?? "file:///semantic-diagnostics.sql";
    return Object.freeze({
        analyze(sql, runOptions = {}) {
            return analyzeSql(sql, provider, { ...runOptions, uri });
        },
        open(sql) {
            return analyzeSql(sql, provider, {
                allowSyntaxDiagnostics: true,
                snapshot: true,
                uri,
            });
        },
        provider,
    });
}

/** Builds the standard complete, case-insensitive database catalog used by diagnostic tests. */
function createMetadata(input = {}) {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        ...input,
    });
}

function table(id, schema, name, database = "db") {
    return { ref: { id, database }, database, schema, name, kind: "table" };
}

function messages(diagnostics) {
    return diagnostics.map(({ message }) => message);
}

module.exports = { analyzeSql, createMetadata, createSemanticHarness, messages, table };
