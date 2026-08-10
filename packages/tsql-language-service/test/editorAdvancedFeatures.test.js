/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
    SaralSqlAnalysisEngine,
    SqlCompletionResolveProvider,
    SqlDiagnosticProvider,
    SqlInlayHintProvider,
    URI,
    createTsqlSqlLanguageServices,
} = require("../dist/index.js");

describe("advanced parser-neutral editor features", () => {
    const uri = "file:///advanced-editor-features.sql";

    it("returns full then unchanged pull diagnostics with vscode-mssql branding", async () => {
        const catalog = {
            version: 1,
            world: "closed",
            columnsFor: () => undefined,
            objectFor: () => undefined,
        };
        const { services } = createFeatures("SELECT * FROM dbo.Missing;", catalog);
        const first = await services.lsp.DiagnosticProvider.getDocumentDiagnostics(uri);

        assert.equal(first.kind, "full");
        assert.deepEqual(
            first.items.map((diagnostic) => ({
                code: diagnostic.code,
                source: diagnostic.source,
                message: diagnostic.message,
            })),
            [
                {
                    code: "MSSQL208",
                    source: "vscode-mssql",
                    message: "Invalid object name 'dbo.Missing'.",
                },
            ],
        );
        assert.deepEqual(
            await services.lsp.DiagnosticProvider.getDocumentDiagnostics(uri, first.resultId),
            { kind: "unchanged", resultId: first.resultId },
        );
    });

    it("does not mark every hint diagnostic as unnecessary", async () => {
        const provider = new SqlDiagnosticProvider({
            getDocument: () => ({
                uri,
                text: "SELECT 1",
                version: 1,
                analysis: {
                    version: 1,
                    syntaxDiagnostics: [],
                    semanticDiagnostics: [
                        {
                            kind: "semantic",
                            code: "hint",
                            message: "A useful hint",
                            span: { start: 0, end: 6 },
                            severity: "hint",
                        },
                    ],
                    positionAt: (offset) => ({ line: 0, character: offset }),
                },
            }),
        });

        const report = await provider.getDocumentDiagnostics(uri);
        assert.equal(report.kind, "full");
        assert.equal(report.items[0].severity, 4);
        assert.equal(report.items[0].tags, undefined);
    });

    it("formats indentation without rewriting SQL content", async () => {
        const sql = [
            "CREATE TABLE dbo.Items (",
            "Id int,",
            "Name nvarchar(20)",
            ")",
            "GO",
            "BEGIN",
            "SELECT (",
            "Id",
            ") FROM dbo.Items;",
            "END",
        ].join("\n");
        const { services } = createFeatures(sql);
        const [edit] = await services.lsp.FormattingProvider.formatDocument(uri, {
            tabSize: 4,
            insertSpaces: true,
        });

        assert.equal(
            edit.newText,
            [
                "CREATE TABLE dbo.Items (",
                "    Id int,",
                "    Name nvarchar(20)",
                ")",
                "GO",
                "BEGIN",
                "    SELECT (",
                "        Id",
                "    ) FROM dbo.Items;",
                "END",
            ].join("\n"),
        );
    });

    it("returns semantic-token deltas after an incremental document update", async () => {
        const first = createFeatures("SELECT 1 AS Value;");
        const full = await first.services.lsp.SemanticTokenProvider.getSemanticTokens(uri);
        first.services.documents.update({
            uri: URI.parse(uri),
            languageId: "sql",
            version: 2,
            getText: () => "SELECT 20 AS Value;",
        });
        const delta = await first.services.lsp.SemanticTokenProvider.getSemanticTokenEdits(
            uri,
            full.resultId,
        );

        assert.ok("edits" in delta);
        assert.ok(delta.resultId);
        assert.equal(delta.edits.length, 1);
        assert.ok(delta.edits[0].deleteCount > 0 || delta.edits[0].data.length > 0);
    });

    it("encodes range semantic tokens at their absolute document lines", async () => {
        const sql = "SELECT 1;\nSELECT 2 + 3;";
        const { services } = createFeatures(sql);
        const result = await services.lsp.SemanticTokenProvider.getSemanticTokens(uri, {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 13 },
        });

        const lines = [];
        let line = 0;
        for (let index = 0; index < result.data.length; index += 5) {
            line += result.data[index];
            lines.push(line);
        }
        assert.ok(lines.length > 0);
        assert.deepEqual([...new Set(lines)], [1]);
        assert.equal(result.resultId, undefined);
    });

    it("resolves deferred completion documentation from the current snapshot only", async () => {
        const accessor = {
            getDocument: () => ({
                uri,
                text: "SELECT COU",
                version: 4,
                analysis: {
                    completeAt: () => ({
                        items: [
                            {
                                label: "COUNT",
                                kind: "function",
                                detail: "aggregate function",
                                documentation: "Returns the number of input rows.",
                            },
                        ],
                    }),
                },
            }),
        };
        const provider = new SqlCompletionResolveProvider(accessor);
        const resolved = await provider.resolveCompletionItem({
            label: "COUNT",
            data: { uri, offset: 10, version: 4, label: "COUNT" },
        });
        const stale = await provider.resolveCompletionItem({
            label: "COUNT",
            data: { uri, offset: 10, version: 3, label: "COUNT" },
        });

        assert.equal(resolved.detail, "aggregate function");
        assert.equal(resolved.documentation, "Returns the number of input rows.");
        assert.equal(stale.detail, undefined);
    });

    it("emits conservative alias-target and inferred-output type hints", async () => {
        const symbols = [
            {
                kind: "alias",
                name: "u",
                span: { start: 10, end: 11 },
                frame: "0",
                modifiers: ["declaration"],
                source: { kind: "table", name: "dbo.Users", span: { start: 20, end: 29 } },
            },
            {
                kind: "column",
                name: "Total",
                span: { start: 2, end: 7 },
                frame: "0",
                modifiers: ["output", "declaration"],
                type: { kind: "scalar", name: "bigint", display: "bigint" },
            },
        ];
        const provider = new SqlInlayHintProvider({
            getDocument: () => ({
                uri,
                text: "  Total   u                   ",
                version: 1,
                analysis: {
                    symbols: () => symbols,
                    positionAt: (offset) => ({ line: 0, character: offset }),
                },
            }),
        });
        const hints = await provider.getInlayHints(uri, {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 30 },
        });

        assert.deepEqual(
            hints.map((hint) => hint.label),
            [": bigint", " → dbo.Users"],
        );
    });

    function createFeatures(sql, catalog) {
        const services = createTsqlSqlLanguageServices({
            engine: new SaralSqlAnalysisEngine(),
            ...(catalog
                ? { defaultCatalog: { provider: catalog, revision: catalog.version } }
                : {}),
        });
        const document = services.documents.update({
            uri: URI.parse(uri),
            languageId: "sql",
            version: 1,
            getText: () => sql,
        });
        return { document, services };
    }
});
