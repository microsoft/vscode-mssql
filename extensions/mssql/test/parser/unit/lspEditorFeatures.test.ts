/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SaralSqlAnalysisEngine } from "@vscode-mssql/tsql-language-service/adapters";
import {
    createSqlEditorFeatureServices,
    sqlSemanticTokenTypes,
    type SqlFeatureDocument,
    type SqlFeatureDocumentAccessor,
} from "@vscode-mssql/tsql-language-service/lsp";
import { DocumentHighlightKind, FoldingRangeKind } from "vscode-languageserver-protocol";

suite("Package SQL editor features", () => {
    const uri = "file:///editor-features.sql";

    test("narrows CTE references and highlights to identifier ranges", async () => {
        const sql = "WITH Recent AS (SELECT 1 AS Id)\nSELECT r.Id FROM Recent r;";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.lastIndexOf("Recent") + 2);

        const references = await services.ReferencesProvider.findReferences(uri, position);
        expect(references.map((reference) => textAt(document, reference.range))).to.deep.equal([
            "Recent",
            "Recent",
        ]);

        const highlights = await services.DocumentHighlightProvider.getDocumentHighlights(
            uri,
            position,
        );
        expect(highlights?.map((highlight) => highlight.kind)).to.deep.equal([
            DocumentHighlightKind.Write,
            DocumentHighlightKind.Read,
        ]);
        expect(highlights?.map((highlight) => textAt(document, highlight.range))).to.deep.equal([
            "Recent",
            "Recent",
        ]);
    });

    test("renames only an in-document identity and preserves bracket quoting", async () => {
        const sql = "WITH [Recent] AS (SELECT 1 AS Id) SELECT Id FROM [Recent];";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.lastIndexOf("Recent") + 2);

        const prepared = await services.RenameProvider.prepareRename(uri, position);
        expect(prepared && textAt(document, prepared)).to.equal("[Recent]");

        const edit = await services.RenameProvider.rename(uri, position, "UpdatedRecent");
        const changes = edit?.changes?.[uri] ?? [];
        expect(changes).to.have.length(2);
        expect(changes.map((change) => change.newText)).to.deep.equal([
            "[UpdatedRecent]",
            "[UpdatedRecent]",
        ]);
        expect(changes.map((change) => textAt(document, change.range))).to.deep.equal([
            "[Recent]",
            "[Recent]",
        ]);
    });

    test("does not offer document rename for a catalog table", async () => {
        const sql = "SELECT u.Id FROM dbo.Users u;";
        const { document, services } = createFeatures(sql);
        const position = toPosition(document, sql.indexOf("Users") + 2);
        expect(await services.RenameProvider.prepareRename(uri, position)).to.be.undefined;
        expect(await services.RenameProvider.rename(uri, position, "Customers")).to.be.undefined;
    });

    test("builds a CTE-centered document outline", async () => {
        const sql = "WITH Recent AS (\n SELECT 1 AS Id\n)\nSELECT Id FROM Recent;";
        const { document, services } = createFeatures(sql);
        const symbols = await services.DocumentSymbolProvider.getSymbols(uri);
        const recent = symbols.find((symbol) => symbol.name === "Recent");

        expect(recent).to.not.be.undefined;
        expect(textAt(document, recent!.selectionRange)).to.equal("Recent");
        expect(recent!.children?.map((child) => child.name)).to.include("Id");
    });

    test("emits SQL-aware semantic tokens using the exported legend", async () => {
        const sql = "SELECT u.Id FROM dbo.Users u WHERE u.Id > 1;";
        const { services } = createFeatures(sql);
        const encoded = await services.SemanticTokenProvider.getSemanticTokens(uri);
        const types = decodeTokenTypes(encoded.data);

        expect(types).to.include("keyword");
        expect(types).to.include("class");
        expect(types).to.include("property");
        expect(types).to.include("number");
        expect(types).to.include("operator");
    });

    test("folds multiline comments, parentheses, statements, and BEGIN blocks", async () => {
        const sql = "/* note\n   note */\nBEGIN\n SELECT (\n  1 + 2\n );\nEND";
        const { services } = createFeatures(sql);
        const ranges = await services.FoldingRangeProvider.getFoldingRanges(uri);

        expect(ranges.some((range) => range.kind === FoldingRangeKind.Comment)).to.equal(true);
        expect(ranges.some((range) => range.startLine === 2 && range.endLine === 6)).to.equal(true);
        expect(ranges.some((range) => range.startLine === 3 && range.endLine === 5)).to.equal(true);
    });

    test("returns a valid narrow-to-wide selection chain for each position", async () => {
        const sql = "SELECT (u.Id + 1)\nFROM dbo.Users u;";
        const { document, services } = createFeatures(sql);
        const [selection] = await services.SelectionRangeProvider.getSelectionRanges(uri, [
            toPosition(document, sql.indexOf("Id") + 1),
        ]);

        const texts: string[] = [];
        for (let current = selection; current; current = current.parent!) {
            texts.push(textAt(document, current.range));
            if (current.parent) {
                expect(contains(current.parent.range, current.range)).to.equal(true);
            }
        }
        expect(texts[0]).to.equal("Id");
        expect(texts).to.include("(u.Id + 1)");
        expect(texts.at(-1)).to.equal(sql);
    });

    test("treats identifier ranges as half-open at token boundaries", async () => {
        const sql = "DECLARE @x int; SELECT @x;";
        const { document, services } = createFeatures(sql);
        const immediatelyAfterDeclaration = sql.indexOf("@x") + "@x".length;

        expect(
            await services.RenameProvider.prepareRename(
                uri,
                toPosition(document, immediatelyAfterDeclaration),
            ),
        ).to.be.undefined;
    });

    test("never exposes parser recovery characters in editor ranges", async () => {
        const editorText = "SELECT [unfinished";
        const { services } = createFeatures(editorText, `${editorText}]`);
        const selections = await services.SelectionRangeProvider.getSelectionRanges(uri, [
            { line: 0, character: editorText.length },
        ]);
        const semantic = await services.SemanticTokenProvider.getSemanticTokens(uri);

        for (let selection = selections[0]; selection; selection = selection.parent!) {
            expect(selection.range.end.line).to.equal(0);
            expect(selection.range.end.character).to.be.at.most(editorText.length);
            if (!selection.parent) {
                break;
            }
        }
        let character = 0;
        for (let index = 0; index < semantic.data.length; index += 5) {
            character = semantic.data[index] === 0 ? character + semantic.data[index + 1] : 0;
            expect(character + semantic.data[index + 2]).to.be.at.most(editorText.length);
        }
    });

    function createFeatures(
        sql: string,
        parseText = sql,
    ): {
        document: SqlFeatureDocument;
        services: ReturnType<typeof createSqlEditorFeatureServices>;
    } {
        const document: SqlFeatureDocument = {
            uri,
            version: 1,
            text: sql,
            analysis: new SaralSqlAnalysisEngine().createSnapshot({ text: parseText, uri }),
        };
        const accessor: SqlFeatureDocumentAccessor = {
            getDocument: (requestedUri) => (requestedUri === uri ? document : undefined),
        };
        return { document, services: createSqlEditorFeatureServices(accessor) };
    }

    function toPosition(
        document: SqlFeatureDocument,
        offset: number,
    ): {
        line: number;
        character: number;
    } {
        return document.analysis.positionAt(offset);
    }

    function textAt(
        document: SqlFeatureDocument,
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        },
    ): string {
        const start = document.analysis.offsetAt(range.start);
        const end = document.analysis.offsetAt(range.end);
        return document.analysis.text.slice(start, end);
    }

    function decodeTokenTypes(data: number[]): string[] {
        const types: string[] = [];
        for (let index = 0; index < data.length; index += 5) {
            types.push(sqlSemanticTokenTypes[data[index + 3]]);
        }
        return types;
    }

    function contains(
        outer: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        },
        inner: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        },
    ): boolean {
        return compare(outer.start, inner.start) <= 0 && compare(outer.end, inner.end) >= 0;
    }

    function compare(
        left: { line: number; character: number },
        right: { line: number; character: number },
    ): number {
        return left.line - right.line || left.character - right.character;
    }
});
