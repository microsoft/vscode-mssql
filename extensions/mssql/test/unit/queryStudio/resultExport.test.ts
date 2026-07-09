/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QO-8 streaming export: the format generators emit bounded pieces (never one
 * accumulated string), preserve row counts and structure across chunk
 * boundaries, and honor selections. The Save-dialog entrypoint is exercised
 * manually/live; these tests pin the piece streams the writer consumes.
 */

import { expect } from "chai";
import { QsCellWindow, QsResultSetSummary } from "../../../src/sharedInterfaces/queryStudio";
import { exportPieces, normalizeExportRange } from "../../../src/queryStudio/resultExport";

const ROWS = 5000;

function summary(): QsResultSetSummary {
    return {
        resultSetId: "b0r0s0",
        batchOrdinal: 0,
        columnNames: ["id", "name"],
        rowCount: ROWS,
        complete: true,
    };
}

async function getRows(_id: string, start: number, count: number): Promise<QsCellWindow> {
    const end = Math.min(start + count, ROWS);
    return {
        resultSetId: "b0r0s0",
        start,
        rowCount: end - start,
        columns: [
            { name: "id", displayName: "id" },
            { name: "name", displayName: "name" },
        ],
        values: Array.from({ length: end - start }, (_, i) => [start + i, `row-${start + i}`]),
    };
}

async function drain(format: "csv" | "json" | "insert") {
    const options = {
        summary: summary(),
        format,
        getRows,
    } as Parameters<typeof exportPieces>[0];
    const range = normalizeExportRange(summary(), undefined);
    const pieces: Array<{ text: string; rows: number }> = [];
    for await (const piece of exportPieces(options, range)) {
        pieces.push(piece);
    }
    return pieces;
}

suite("Query Studio streaming export pieces", () => {
    test("csv streams one bounded piece per row plus a header, all rows covered", async () => {
        const pieces = await drain("csv");
        expect(pieces.reduce((total, piece) => total + piece.rows, 0)).to.equal(ROWS);
        expect(pieces[0].text).to.contain("id");
        expect(pieces[0].rows).to.equal(0); // header carries no data rows
        const maxPiece = Math.max(...pieces.map((piece) => piece.text.length));
        expect(maxPiece).to.be.lessThan(1024); // never one giant accumulated string
        expect(pieces[1].text).to.contain("row-0");
        expect(pieces[pieces.length - 1].text).to.contain(`row-${ROWS - 1}`);
    });

    test("json streams valid array structure across chunk boundaries", async () => {
        const pieces = await drain("json");
        expect(pieces.reduce((total, piece) => total + piece.rows, 0)).to.equal(ROWS);
        const text = pieces.map((piece) => piece.text).join("");
        expect(text.startsWith("[\n")).to.equal(true);
        expect(text.endsWith("\n]\n")).to.equal(true);
        const parsed = JSON.parse(text) as Array<Record<string, string>>;
        expect(parsed).to.have.length(ROWS);
        expect(parsed[0].id).to.equal("0");
        expect(parsed[ROWS - 1].name).to.equal(`row-${ROWS - 1}`);
    });

    test("insert streams complete batches with terminated statements", async () => {
        const pieces = await drain("insert");
        expect(pieces.reduce((total, piece) => total + piece.rows, 0)).to.equal(ROWS);
        for (const piece of pieces) {
            expect(piece.text).to.contain("INSERT INTO");
            expect(piece.text.trimEnd().endsWith(";")).to.equal(true);
        }
    });

    test("selection ranges bound the streamed rows", async () => {
        const options = {
            summary: summary(),
            format: "csv" as const,
            selection: [{ fromRow: 10, toRow: 14, fromCell: 0, toCell: 1 }],
            getRows,
        } as Parameters<typeof exportPieces>[0];
        const range = normalizeExportRange(summary(), [
            { fromRow: 10, toRow: 14, fromCell: 0, toCell: 1 },
        ]);
        let rows = 0;
        for await (const piece of exportPieces(options, range)) {
            rows += piece.rows;
        }
        expect(rows).to.equal(5);
    });
});
