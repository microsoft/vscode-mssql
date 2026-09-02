/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    TsqlLanguageFeatureService,
    type FoldingRange,
} from "@vscode-mssql/tsql-language-service";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { createProductionLanguageServiceMiddleware } from "../../src/languageservice/preview/productionLanguageServiceIsolation";
import { toVscodeFoldingRanges } from "../../src/languageservice/preview/previewFoldingRanges";
import type { DocumentLineSource } from "../../src/languageservice/preview/previewSemanticTokens";

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

const uri = "file:///folding.sql";
const sql = [
    "-- #region report",
    "-- describes the report",
    "-- and its inputs",
    "CREATE PROCEDURE dbo.usp_Report",
    "AS",
    "BEGIN",
    "    SELECT",
    "        Id",
    "    FROM dbo.Orders;",
    "END",
    "-- #endregion",
].join("\n");

async function serviceFoldingRanges(text: string): Promise<readonly FoldingRange[]> {
    const metadata = new NullMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    await runtime.open(uri, 1, text);
    return new TsqlLanguageFeatureService(runtime, metadata).foldingRanges(uri, 1);
}

suite("Preview folding ranges", () => {
    test("converts offsets into the line pairs VS Code folds on", () => {
        const text = "SELECT\n    1,\n    2;\n";
        const ranges = toVscodeFoldingRanges([{ start: 0, end: 20 }], lineSource(text));
        expect(ranges).to.have.lengthOf(1);
        expect(ranges[0].start).to.equal(0);
        expect(ranges[0].end).to.equal(2);
        expect(ranges[0].kind).to.be.undefined;
    });

    test("maps comment and region kinds onto the editor kinds", () => {
        const text = "-- a\n-- b\n-- c\n";
        const ranges = toVscodeFoldingRanges(
            [
                { start: 0, end: 9, kind: "comment" },
                { start: 0, end: 14, kind: "region" },
            ],
            lineSource(text),
        );
        expect(ranges[0].kind).to.equal(vscode.FoldingRangeKind.Comment);
        expect(ranges[1].kind).to.equal(vscode.FoldingRangeKind.Region);
    });

    test("drops a range that does not span a line", () => {
        expect(
            toVscodeFoldingRanges([{ start: 0, end: 5 }], lineSource("SELECT 1;")),
        ).to.deep.equal([]);
    });

    test("publishes the regions the preview language service derives", async () => {
        const ranges = toVscodeFoldingRanges(await serviceFoldingRanges(sql), lineSource(sql));
        expect(
            ranges.map((range) => `${range.start}-${range.end} ${range.kind ?? "code"}`),
        ).to.deep.equal([
            `0-10 ${vscode.FoldingRangeKind.Region}`,
            `1-2 ${vscode.FoldingRangeKind.Comment}`,
            "3-9 code",
            "5-9 code",
            "6-8 code",
        ]);
    });

    test("production folding stays suppressed while preview owns it", async () => {
        const document = {
            languageId: "sql",
            uri: vscode.Uri.parse("file:///preview.sql"),
        } as vscode.TextDocument;
        const cancellation = new vscode.CancellationTokenSource();
        const next = sinon.stub().resolves([new vscode.FoldingRange(0, 1)]);
        const middleware = createProductionLanguageServiceMiddleware({
            isPreviewEnabled: () => true,
        });

        const result = await middleware.provideFoldingRanges?.(
            document,
            {},
            cancellation.token,
            next,
        );

        expect(result).to.be.undefined;
        expect(next).not.to.have.been.called;
        cancellation.dispose();
    });
});
