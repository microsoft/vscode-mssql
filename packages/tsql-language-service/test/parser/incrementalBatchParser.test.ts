/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    IncrementalBatchAnalyzer,
    IncrementalBatchParser,
    partitionSqlBatches,
} from "../../src/parser/incremental/index.js";
import { Lexer, Parser } from "../../src/parser/saral/index.js";

describe("IncrementalBatchParser", () => {
    test("recognizes only line-isolated GO separators", () => {
        const sql = [
            "SELECT 'GO' AS Value;",
            "-- GO",
            "/* GO */",
            "GO 2 -- repeat the preceding batch",
            "SELECT [GO] FROM dbo.Items;",
        ].join("\n");

        const batches = partitionSqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]?.separator?.count).toBe(2);
        expect(batches[0]?.text).toContain("SELECT 'GO'");
        expect(batches[1]?.text).toContain("SELECT [GO]");
    });

    test("keeps GO offsets exact after a multi-line comment", () => {
        const sql = "SELECT 1;\n/* comment\n*/   GO\nSELECT 2;";

        const batches = partitionSqlBatches(sql);

        expect(batches).toHaveLength(2);
        expect(batches[0]?.separator?.start).toBe(sql.indexOf("GO"));
    });

    test("reuses unchanged parse products around an edited batch", () => {
        const parser = new IncrementalBatchParser();
        const original = "SELECT 1;\nGO\nSELECT 2;\nGO\nSELECT 3;";
        const first = parser.create(original, 1);
        const changed = original.replace("SELECT 2", "SELECT 200");

        const second = parser.update(first, changed, 2);

        expect(second.statistics).toMatchObject({
            parsedBatchCount: 1,
            reusedBatchCount: 2,
            totalBatchCount: 3,
        });
        expect(second.batches[0]?.artifact).toBe(first.batches[0]?.artifact);
        expect(second.batches[1]?.artifact).not.toBe(first.batches[1]?.artifact);
        expect(second.batches[2]?.artifact).toBe(first.batches[2]?.artifact);
        expect(first.text).toBe(original);
        expect(first.parseResult().ast.end).toBe(original.length);
        expect(second.parseResult().ast.end).toBe(changed.length);
    });

    test("moves materialized spans without mutating a reused relative AST", () => {
        const parser = new IncrementalBatchParser();
        const first = parser.create("SELECT 1;\nGO\nSELECT Missing;", 1);
        const relativeStart = first.batches[1]?.artifact.ast.body[0]?.start;
        const second = parser.update(first, `-- shifted\n${first.text}`, 2);
        const secondStatement = second
            .parseResult()
            .ast.body.find(
                (statement) => statement.type !== "BatchSeparatorStatement" && statement.start > 10,
            );

        expect(second.batches[1]?.artifact).toBe(first.batches[1]?.artifact);
        expect(second.batches[1]?.artifact.ast.body[0]?.start).toBe(relativeStart);
        expect(secondStatement?.start).toBeGreaterThan(first.parseResult().ast.body[0]!.start);
    });

    test("matches whole parsing after an edit adds a batch boundary", () => {
        const parser = new IncrementalBatchParser();
        const first = parser.create("SELECT 1;\nSELECT 2;", 1);
        const text = "SELECT 1;\nGO\nSELECT 2;";
        const incremental = parser.update(first, text, 2).parseResult();
        const whole = new Parser(new Lexer(text)).parse();

        expect(incremental.ast.body.map((statement) => statement.type)).toEqual(
            whole.ast.body.map((statement) => statement.type),
        );
        expect(incremental.issues?.map((issue) => issue.code)).toEqual(
            whole.issues?.map((issue) => issue.code),
        );
    });

    test("materializes recoverable error line numbers in whole-document coordinates", () => {
        const text = "SELECT 1;\nGO\nSELECT ( ;";
        const incremental = new IncrementalBatchParser().create(text).parseResult();
        const whole = new Parser(new Lexer(text)).parse();

        expect(incremental).toEqual(whole);
    });

    test("does not invalidate batch parses when only a GO separator changes", () => {
        const parser = new IncrementalBatchParser();
        const first = parser.create("SELECT 1;\nGO\nSELECT 2;", 1);
        const second = parser.update(first, "SELECT 1;\nGO 2\nSELECT 2;", 2);

        expect(second.statistics).toMatchObject({ parsedBatchCount: 0, reusedBatchCount: 2 });
        expect(second.batches[0]?.artifact).toBe(first.batches[0]?.artifact);
        expect(second.batches[1]?.artifact).toBe(first.batches[1]?.artifact);
        expect(second.parseResult().ast.body).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "BatchSeparatorStatement", count: 2 }),
            ]),
        );
    });

    test("analyzes a materialized program without invoking the parser again", () => {
        const analyzer = new IncrementalBatchAnalyzer();
        const snapshot = analyzer.create("SELECT 1;\nGO\nSELECT @Missing;", 1);
        const parseSpy = jest.spyOn(Parser.prototype, "parse");

        try {
            const analysis = snapshot.analysisResult();

            expect(parseSpy).not.toHaveBeenCalled();
            expect(analysis.ast).toBe(snapshot.parseResult().ast);
            expect(analysis.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: "semantic",
                        code: "VAR001",
                        message: "Variable is not declared",
                        start: snapshot.text.indexOf("@Missing"),
                    }),
                ]),
            );
            expect(snapshot.analysisResult()).toBe(analysis);
        } finally {
            parseSpy.mockRestore();
        }
    });

    test("reuses unaffected batches while refreshing whole-program analysis", () => {
        const analyzer = new IncrementalBatchAnalyzer();
        const first = analyzer.create("SELECT 1;\nGO\nSELECT @Missing;", 1);
        expect(first.analysisResult().diagnostics.some((item) => item.source === "semantic")).toBe(
            true,
        );

        const second = analyzer.update(first, "SELECT 1;\nGO\nSELECT 2;", 2);

        expect(second.statistics).toMatchObject({ parsedBatchCount: 1, reusedBatchCount: 1 });
        expect(second.batches[0]?.artifact).toBe(first.batches[0]?.artifact);
        expect(second.analysisResult().diagnostics.some((item) => item.source === "semantic")).toBe(
            false,
        );
    });
});
