/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { DocumentHighlightKind, FoldingRangeKind } = require("vscode-languageserver-types");
const {
    SaralSqlAnalysisEngine,
    createTsqlSqlLanguageServices,
    sqlSemanticTokenTypes,
} = require("../dist/index.js");

describe("parser-neutral SQL editor features", () => {
    const uri = "file:///editor-features.sql";

    it("narrows CTE navigation to identifier ranges", async () => {
        const sql = "WITH Recent AS (SELECT 1 AS Id)\nSELECT r.Id FROM Recent r;";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.lastIndexOf("Recent") + 2);

        const references = await services.lsp.ReferencesProvider.findReferences(uri, position);
        assert.deepEqual(
            references.map((reference) => textAt(document, reference.range)),
            ["Recent", "Recent"],
        );
        const definition = await services.lsp.DefinitionProvider.findDefinition(uri, position);
        assert.equal(definition?.uri, uri);
        assert.equal(textAt(document, definition.range), "Recent");

        const highlights = await services.lsp.DocumentHighlightProvider.getDocumentHighlights(
            uri,
            position,
        );
        assert.deepEqual(
            highlights?.map((highlight) => highlight.kind),
            [DocumentHighlightKind.Write, DocumentHighlightKind.Read],
        );
    });

    it("renames only an in-document identity and preserves bracket quoting", async () => {
        const sql = "WITH [Recent] AS (SELECT 1 AS Id) SELECT Id FROM [Recent];";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.lastIndexOf("Recent") + 2);

        const prepared = await services.lsp.RenameProvider.prepareRename(uri, position);
        assert.equal(textAt(document, prepared), "[Recent]");
        const edit = await services.lsp.RenameProvider.rename(uri, position, "UpdatedRecent");
        const changes = edit?.changes?.[uri] ?? [];
        assert.equal(changes.length, 2);
        assert.deepEqual(
            changes.map((change) => change.newText),
            ["[UpdatedRecent]", "[UpdatedRecent]"],
        );
    });

    it("does not offer document rename for a catalog table", async () => {
        const sql = "SELECT u.Id FROM dbo.Users u;";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.indexOf("Users") + 2);
        assert.equal(await services.lsp.RenameProvider.prepareRename(uri, position), undefined);
    });

    it("builds a CTE-centered document outline", async () => {
        const sql = "WITH Recent AS (\n SELECT 1 AS Id\n)\nSELECT Id FROM Recent;";
        const { document, services } = createFeatures(sql);
        const symbols = await services.lsp.DocumentSymbolProvider.getSymbols(uri);
        const recent = symbols.find((symbol) => symbol.name === "Recent");

        assert.ok(recent);
        assert.equal(textAt(document, recent.selectionRange), "Recent");
        assert.ok(recent.children?.some((child) => child.name === "Id"));
    });

    it("emits SQL-aware semantic tokens using the exported legend", async () => {
        const sql = "SELECT u.Id FROM dbo.Users u WHERE u.Id > 1;";
        const { services } = createFeatures(sql);
        const encoded = await services.lsp.SemanticTokenProvider.getSemanticTokens(uri);
        const types = decodeTokenTypes(encoded.data);

        for (const expected of ["keyword", "class", "property", "number", "operator"]) {
            assert.ok(types.includes(expected), `expected semantic token type ${expected}`);
        }
    });

    it("folds multiline comments, parentheses, statements, and BEGIN blocks", async () => {
        const sql = "/* note\n   note */\nBEGIN\n SELECT (\n  1 + 2\n );\nEND";
        const { services } = createFeatures(sql);
        const ranges = await services.lsp.FoldingRangeProvider.getFoldingRanges(uri);

        assert.ok(ranges.some((range) => range.kind === FoldingRangeKind.Comment));
        assert.ok(ranges.some((range) => range.startLine === 2 && range.endLine === 6));
        assert.ok(ranges.some((range) => range.startLine === 3 && range.endLine === 5));
    });

    it("returns a valid narrow-to-wide selection chain", async () => {
        const sql = "SELECT (u.Id + 1)\nFROM dbo.Users u;";
        const { document, services } = createFeatures(sql);
        const [selection] = await services.lsp.SelectionRangeProvider.getSelectionRanges(uri, [
            toPosition(document, sql.indexOf("Id") + 1),
        ]);
        const texts = [];
        for (let current = selection; current; current = current.parent) {
            texts.push(textAt(document, current.range));
            if (current.parent) {
                assert.ok(contains(current.parent.range, current.range));
            }
        }
        assert.equal(texts[0], "Id");
        assert.ok(texts.includes("(u.Id + 1)"));
        assert.equal(texts.at(-1), sql);
    });

    it("uses half-open token boundaries and clips recovery-only text", async () => {
        const sql = "DECLARE @x int; SELECT @x;";
        const first = createFeatures(sql);
        const afterDeclaration = sql.indexOf("@x") + "@x".length;
        assert.equal(
            await first.services.lsp.RenameProvider.prepareRename(
                uri,
                toPosition(first.document, afterDeclaration),
            ),
            undefined,
        );

        const editorText = "SELECT [unfinished";
        const recovered = createFeatures(editorText, `${editorText}]`);
        const [selection] = await recovered.services.lsp.SelectionRangeProvider.getSelectionRanges(
            uri,
            [{ line: 0, character: editorText.length }],
        );
        for (let current = selection; current; current = current.parent) {
            assert.equal(current.range.end.line, 0);
            assert.ok(current.range.end.character <= editorText.length);
        }
        const semantic = await recovered.services.lsp.SemanticTokenProvider.getSemanticTokens(uri);
        let character = 0;
        for (let index = 0; index < semantic.data.length; index += 5) {
            character = semantic.data[index] === 0 ? character + semantic.data[index + 1] : 0;
            assert.ok(character + semantic.data[index + 2] <= editorText.length);
        }
    });

    function createFeatures(sql, parseText = sql) {
        const services = createTsqlSqlLanguageServices({ engine: new SaralSqlAnalysisEngine() });
        const document = services.documents.update(
            { uri, languageId: "sql", version: 1, getText: () => sql },
            { parseText },
        );
        return { document, services };
    }
});

function toPosition(document, offset) {
    const position = document.analysis.positionAt(offset);
    return { line: position.line, character: position.character };
}

function textAt(document, range) {
    const start = document.analysis.offsetAt(range.start);
    const end = document.analysis.offsetAt(range.end);
    return document.textDocument.getText().slice(start, end);
}

function decodeTokenTypes(data) {
    const types = [];
    for (let index = 0; index < data.length; index += 5) {
        types.push(sqlSemanticTokenTypes[data[index + 3]]);
    }
    return types;
}

function contains(outer, inner) {
    return compare(outer.start, inner.start) <= 0 && compare(outer.end, inner.end) >= 0;
}

function compare(left, right) {
    return left.line - right.line || left.character - right.character;
}
