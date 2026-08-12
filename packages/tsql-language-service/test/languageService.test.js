/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    SaralSqlAnalysisEngine,
    StaleTsqlDocumentError,
    TsqlLanguageService,
    createTsqlLanguageService,
} = require("../dist/index.js");

const catalog = {
    version: 1,
    world: "closed",
    columnsFor(parts) {
        return parts.join(".").toLowerCase() === "dbo.users"
            ? [
                  { name: "Id", type: "int", nullable: false },
                  { name: "DisplayName", type: "nvarchar", nullable: true },
              ]
            : undefined;
    },
    tableCandidates(parts) {
        return parts.at(-1)?.toLowerCase() === "users" ? [["dbo", "Users"]] : [];
    },
    tables() {
        return ["Users"];
    },
};

describe("T-SQL language service package", () => {
    it("uses the package-owned incremental engine by default", () => {
        const service = createTsqlLanguageService();

        assert.equal(service.engine.id, "saralsql");
        assert.equal(service.engine.capabilities.mutationTargets.level, "partial");
    });

    it("loads synchronously from CommonJS and exposes honest engine capabilities", () => {
        const service = createTsqlLanguageService();

        assert.equal(service.engine.id, "saralsql");
        assert.equal(service.engine.capabilities.incrementalUpdate.level, "partial");
        assert.equal(service.engine.capabilities.mutationTargets.level, "partial");
    });

    it("normalizes parser analysis and advances immutable snapshots", () => {
        const service = new TsqlLanguageService(new SaralSqlAnalysisEngine());
        const first = service.analyze({
            text: "SELECT Id FROM dbo.Users",
            uri: "file:///query.sql",
            catalog,
        });
        const second = service.analyze(
            {
                text: "SELECT DisplayName FROM dbo.Users",
                uri: "file:///query.sql",
                catalog,
            },
            first,
        );

        assert.equal(first.version, 1);
        assert.equal(second.version, 2);
        assert.equal(first.text, "SELECT Id FROM dbo.Users");
        assert.equal(second.text, "SELECT DisplayName FROM dbo.Users");
        assert.deepEqual(first.syntaxDiagnostics, []);
        assert.deepEqual(first.semanticDiagnostics, []);
        assert.equal(
            first.symbols().some((symbol) => symbol.kind === "column"),
            true,
        );
        assert.equal(first.externalReferences()[0].name, "dbo.Users");
    });

    it("binds analysis to document generations and rejects stale work", async () => {
        const service = createTsqlLanguageService({
            defaultCatalog: { provider: catalog, revision: 1 },
        });
        const first = service.documents.update(source("SELECT Id FROM dbo.Users", 1));
        const second = service.documents.update(source("SELECT DisplayName FROM dbo.Users", 2));

        assert.equal(service.documents.isCurrent(first), false);
        assert.equal(service.documents.isCurrent(second), true);
        assert.equal(second.analysis.version, first.analysis.version + 1);
        await assert.rejects(
            service.documents.compute(first, "stale", () => 1),
            StaleTsqlDocumentError,
        );
    });

    it("keeps editor text separate from recovery parser text", () => {
        const service = createTsqlLanguageService();
        const editorText = "SELECT 'unfinished";
        const document = service.documents.update(source(editorText, 1), {
            parseText: `${editorText}'`,
        });

        assert.equal(document.textDocument.getText(), editorText);
        assert.equal(document.analysis.text, `${editorText}'`);
        assert.equal(document.textDocument.getText().length, editorText.length);
    });
});

function source(text, version) {
    return {
        uri: "file:///package-test.sql",
        languageId: "sql",
        version,
        getText: () => text,
    };
}
