/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * readGridStyle validation (classic mssql.resultsGrid.* parity): defaults,
 * the resultsFontSize → editor.fontSize fallback chain, showGridLines
 * whitelisting, and rejection of malformed values.
 */

import { expect } from "chai";
import { readGridStyle } from "../../src/queryStudio/gridStyle";

function reader(values: Record<string, unknown>) {
    return <T>(key: string): T | undefined => values[key] as T | undefined;
}

suite("Query Studio grid style", () => {
    test("defaults when nothing is configured (package.json defaults are null)", () => {
        const style = readGridStyle(
            reader({
                "mssql.resultsFontFamily": null,
                "mssql.resultsFontSize": null,
                "mssql.resultsGrid.rowPadding": null,
            }),
        );
        expect(style).to.deep.equal({
            alternatingRowColors: false,
            showGridLines: "both",
            inMemoryDataProcessingThreshold: 5000,
        });
        expect(style).to.not.have.property("fontFamily");
        expect(style).to.not.have.property("fontSize");
        expect(style).to.not.have.property("rowPadding");
    });

    test("resultsFontSize falls back to editor.fontSize when unset", () => {
        expect(readGridStyle(reader({ "editor.fontSize": 14 })).fontSize).to.equal(14);
        expect(
            readGridStyle(reader({ "mssql.resultsFontSize": null, "editor.fontSize": 14 }))
                .fontSize,
        ).to.equal(14);
    });

    test("resultsFontSize wins over editor.fontSize when set", () => {
        const style = readGridStyle(reader({ "mssql.resultsFontSize": 18, "editor.fontSize": 14 }));
        expect(style.fontSize).to.equal(18);
    });

    test("invalid font sizes are ignored", () => {
        expect(
            readGridStyle(reader({ "mssql.resultsFontSize": -3, "editor.fontSize": "big" }))
                .fontSize,
        ).to.equal(undefined);
        expect(readGridStyle(reader({ "mssql.resultsFontSize": NaN })).fontSize).to.equal(
            undefined,
        );
    });

    test("fontFamily kept when a non-empty string; blank/typed-wrong dropped", () => {
        expect(
            readGridStyle(reader({ "mssql.resultsFontFamily": "Consolas" })).fontFamily,
        ).to.equal("Consolas");
        expect(readGridStyle(reader({ "mssql.resultsFontFamily": "   " })).fontFamily).to.equal(
            undefined,
        );
        expect(readGridStyle(reader({ "mssql.resultsFontFamily": 12 })).fontFamily).to.equal(
            undefined,
        );
    });

    test("showGridLines is whitelisted with fallback to both", () => {
        for (const mode of ["both", "horizontal", "vertical", "none"] as const) {
            expect(
                readGridStyle(reader({ "mssql.resultsGrid.showGridLines": mode })).showGridLines,
            ).to.equal(mode);
        }
        expect(
            readGridStyle(reader({ "mssql.resultsGrid.showGridLines": "diagonal" })).showGridLines,
        ).to.equal("both");
        expect(readGridStyle(reader({})).showGridLines).to.equal("both");
    });

    test("alternatingRowColors only on boolean true", () => {
        expect(
            readGridStyle(reader({ "mssql.resultsGrid.alternatingRowColors": true }))
                .alternatingRowColors,
        ).to.equal(true);
        expect(
            readGridStyle(reader({ "mssql.resultsGrid.alternatingRowColors": "yes" }))
                .alternatingRowColors,
        ).to.equal(false);
    });

    test("inMemoryDataProcessingThreshold defaults to 5000 and accepts positive numbers", () => {
        expect(readGridStyle(reader({})).inMemoryDataProcessingThreshold).to.equal(5000);
        expect(
            readGridStyle(reader({ "mssql.resultsGrid.inMemoryDataProcessingThreshold": 10000 }))
                .inMemoryDataProcessingThreshold,
        ).to.equal(10000);
    });

    test("invalid inMemoryDataProcessingThreshold falls back to 5000", () => {
        for (const bad of [-1, 0, NaN, "many", null]) {
            expect(
                readGridStyle(reader({ "mssql.resultsGrid.inMemoryDataProcessingThreshold": bad }))
                    .inMemoryDataProcessingThreshold,
            ).to.equal(5000);
        }
    });

    test("rowPadding accepts non-negative numbers only", () => {
        expect(readGridStyle(reader({ "mssql.resultsGrid.rowPadding": 4 })).rowPadding).to.equal(4);
        expect(readGridStyle(reader({ "mssql.resultsGrid.rowPadding": 0 })).rowPadding).to.equal(0);
        expect(readGridStyle(reader({ "mssql.resultsGrid.rowPadding": -2 })).rowPadding).to.equal(
            undefined,
        );
        expect(
            readGridStyle(reader({ "mssql.resultsGrid.rowPadding": "thick" })).rowPadding,
        ).to.equal(undefined);
    });
});
