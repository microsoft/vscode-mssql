/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InProcessLanguageServiceRuntime,
    TsqlColorizationService,
    sqlColorizationLegend,
    type ColorizedToken,
    type SqlColorTokenModifier,
    type SqlColorTokenType,
} from "@vscode-mssql/tsql-language-service";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { createProductionLanguageServiceMiddleware } from "../../src/languageservice/preview/productionLanguageServiceIsolation";
import {
    applyColorizationEdits,
    encodeSemanticTokens,
    encodeSemanticTokensEdits,
    previewSemanticTokensLegend,
    type DocumentLineSource,
} from "../../src/languageservice/preview/previewSemanticTokens";

chai.use(sinonChai);

/** A line view over plain text, matching what a VS Code document reports. */
function lineSource(text: string): DocumentLineSource {
    const lines = text.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }
    return {
        lineAt(target: number) {
            let line = 0;
            while (line + 1 < starts.length && starts[line + 1] <= target) line++;
            return { line, character: target - starts[line] };
        },
        lineLength(line: number) {
            return lines[line].length;
        },
    };
}

function token(
    start: number,
    end: number,
    tokenType: SqlColorTokenType,
    modifiers: readonly SqlColorTokenModifier[] = [],
): ColorizedToken {
    return { start, end, tokenType, modifiers };
}

function typeIndex(name: SqlColorTokenType): number {
    return previewSemanticTokensLegend.tokenTypes.indexOf(name);
}

function modifierBit(name: SqlColorTokenModifier): number {
    return 1 << previewSemanticTokensLegend.tokenModifiers.indexOf(name);
}

suite("Preview semantic tokens", () => {
    test("publishes the language service legend unchanged", () => {
        expect(previewSemanticTokensLegend.tokenTypes).to.deep.equal([
            ...sqlColorizationLegend.tokenTypes,
        ]);
        expect(previewSemanticTokensLegend.tokenModifiers).to.deep.equal([
            ...sqlColorizationLegend.tokenModifiers,
        ]);
    });

    test("encodes tokens relative to the previous token", () => {
        const text = "SELECT a\nFROM t;";
        const data = encodeSemanticTokens(
            [
                token(0, 6, "keyword"),
                token(7, 8, "column"),
                token(9, 13, "keyword"),
                token(14, 15, "table", ["quoted"]),
            ],
            lineSource(text),
        );

        expect([...data]).to.deep.equal([
            0,
            0,
            6,
            typeIndex("keyword"),
            0,
            0,
            7,
            1,
            typeIndex("column"),
            0,
            1,
            0,
            4,
            typeIndex("keyword"),
            0,
            0,
            5,
            1,
            typeIndex("table"),
            modifierBit("quoted"),
        ]);
    });

    test("combines every modifier into one bit set", () => {
        const data = encodeSemanticTokens(
            [token(0, 5, "table", ["declaration", "definition", "temporary"])],
            lineSource("abcde"),
        );
        expect(data[4]).to.equal(
            modifierBit("declaration") | modifierBit("definition") | modifierBit("temporary"),
        );
    });

    test("splits a token that spans lines, which the protocol forbids", () => {
        const text = "/* one\ntwo\nthree */ SELECT 1;";
        const data = encodeSemanticTokens([token(0, 19, "comment")], lineSource(text));
        expect([...data]).to.deep.equal([
            0,
            0,
            6,
            typeIndex("comment"),
            0,
            1,
            0,
            3,
            typeIndex("comment"),
            0,
            1,
            0,
            8,
            typeIndex("comment"),
            0,
        ]);
    });

    test("produces no edits when the encoding is unchanged", () => {
        const data = encodeSemanticTokens([token(0, 6, "keyword")], lineSource("SELECT"));
        expect(encodeSemanticTokensEdits(data, data)).to.deep.equal([]);
    });

    test("produces one aligned edit for a changed classification", () => {
        const text = "SELECT a, b;";
        const before = encodeSemanticTokens(
            [token(0, 6, "keyword"), token(7, 8, "column"), token(10, 11, "column")],
            lineSource(text),
        );
        const after = encodeSemanticTokens(
            [token(0, 6, "keyword"), token(7, 8, "column"), token(10, 11, "variable")],
            lineSource(text),
        );

        const edits = encodeSemanticTokensEdits(before, after);
        expect(edits).to.have.lengthOf(1);
        expect(edits[0].start % 5).to.equal(0);
        expect(edits[0].deleteCount % 5).to.equal(0);
        const rebuilt = [...before];
        rebuilt.splice(edits[0].start, edits[0].deleteCount, ...(edits[0].data ?? []));
        expect(rebuilt).to.deep.equal([...after]);
    });

    test("applies a language service token delta onto the cached tokens", () => {
        const previous = [token(0, 6, "keyword"), token(7, 8, "column")];
        const applied = applyColorizationEdits(previous, [
            { start: 1, deleteCount: 1, tokens: [token(7, 8, "variable")] },
        ]);
        expect(applied.map((entry) => entry.tokenType)).to.deep.equal(["keyword", "variable"]);
        expect(applyColorizationEdits(previous, [])).to.equal(previous);
    });

    test("encodes the classifications the preview language service produces", async () => {
        const sql = "SELECT c.Name FROM dbo.Customers AS c;";
        const runtime = new InProcessLanguageServiceRuntime();
        const snapshot = await runtime.open("file:///semantic-tokens.sql", 1, sql);
        const result = new TsqlColorizationService().provideDocumentColors(snapshot);
        const data = encodeSemanticTokens(result.tokens, lineSource(sql));

        expect(result.tokens.length).to.be.greaterThan(0);
        expect(data.length).to.equal(result.tokens.length * 5);
        expect(previewSemanticTokensLegend.tokenTypes[data[3]]).to.equal("keyword");
        const classified = result.tokens.map(
            (entry) => `${sql.slice(entry.start, entry.end)} ${entry.tokenType}`,
        );
        expect(classified).to.include("Customers table");
        expect(classified).to.include("dbo schema");
        expect(classified).to.include("Name column");
    });

    test("production semantic tokens stay suppressed while preview owns coloring", async () => {
        const document = {
            languageId: "sql",
            uri: vscode.Uri.parse("file:///preview.sql"),
        } as vscode.TextDocument;
        const cancellation = new vscode.CancellationTokenSource();
        const next = sinon.stub().resolves({ resultId: "production", data: new Uint32Array() });
        const middleware = createProductionLanguageServiceMiddleware({
            isPreviewEnabled: () => true,
        });

        const full = await middleware.provideDocumentSemanticTokens?.(
            document,
            cancellation.token,
            next,
        );
        const edits = await middleware.provideDocumentSemanticTokensEdits?.(
            document,
            "production",
            cancellation.token,
            next,
        );
        const ranged = await middleware.provideDocumentRangeSemanticTokens?.(
            document,
            new vscode.Range(0, 0, 1, 0),
            cancellation.token,
            next,
        );

        expect(full).to.be.undefined;
        expect(edits).to.be.undefined;
        expect(ranged).to.be.undefined;
        expect(next).not.to.have.been.called;
        cancellation.dispose();
    });
});
