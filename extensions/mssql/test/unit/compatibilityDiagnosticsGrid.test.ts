/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    SlickGrid,
    SlickDataView,
    SlickHybridSelectionModel,
    SlickRange,
} from "@slickgrid-universal/common";
import { getFluentSlickGridSelectionText } from "../../src/webviews/common/FluentSlickGrid/fluentSlickGridCopy";
import { serializeCompatibilityDiagnostics } from "../../src/webviews/pages/Deployment/AzureSqlDatabase/compatibilityDiagnosticsExport";

suite("Compatibility diagnostics grid actions", () => {
    let sandbox: sinon.SinonSandbox;
    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => sandbox.restore());

    test("copies selected values and headers in current column order without changing ordinary copy", () => {
        const grid = sandbox.createStubInstance(SlickGrid);
        const dataView = sandbox.createStubInstance(SlickDataView);
        const selection = sandbox.createStubInstance(SlickHybridSelectionModel);
        grid.getVisibleColumns.returns([
            { id: "message", field: "message", name: "Warning text" },
            { id: "code", field: "code", name: "Warning code" },
        ]);
        grid.getSelectionModel.returns(selection);
        selection.getSelectedRanges.returns([new SlickRange(1, 0, 0, 1)]);
        dataView.getItem.withArgs(0).returns({ message: 'A "quoted", warning', code: "SQL1" });
        dataView.getItem.withArgs(1).returns({ message: "Other warning", code: "SQL2" });
        const instance = { slickGrid: grid, dataView };
        expect(getFluentSlickGridSelectionText(instance)).to.equal(
            'A "quoted", warning\tSQL1\nOther warning\tSQL2',
        );
        expect(getFluentSlickGridSelectionText(instance, { headersOnly: true })).to.equal(
            "Warning text\tWarning code",
        );
        expect(getFluentSlickGridSelectionText(instance, { includeHeaders: true })).to.equal(
            'Warning text\tWarning code\nA "quoted", warning\tSQL1\nOther warning\tSQL2',
        );
    });

    test("copies active-cell headers and preserves empty values", () => {
        const grid = sandbox.createStubInstance(SlickGrid);
        const dataView = sandbox.createStubInstance(SlickDataView);
        grid.getVisibleColumns.returns([{ id: "location", field: "location", name: "Source" }]);
        grid.getActiveCell.returns({ row: 0, cell: 0 });
        grid.getSelectionModel.returns(undefined);
        dataView.getItem.withArgs(0).returns({ location: "" });
        const instance = { slickGrid: grid, dataView };
        expect(getFluentSlickGridSelectionText(instance)).to.equal("");
        expect(getFluentSlickGridSelectionText(instance, { includeHeaders: true })).to.equal(
            "Source\n",
        );
        expect(getFluentSlickGridSelectionText(instance, { headersOnly: true })).to.equal("Source");
    });

    test("exports CSV with headers, commas, quotes, Unicode, and multiline diagnostics intact", () => {
        expect(
            serializeCompatibilityDiagnostics(
                ["Warning code", "Warning text", "Source"],
                [
                    ["SQL1", 'First, "quoted"\r\nsecond line', "dbo.caf\u00e9.sql:12"],
                    ["SQL2", "", ""],
                ],
                "csv",
            ),
        ).to.equal(
            '"Warning code","Warning text","Source"\r\n"SQL1","First, ""quoted""\r\nsecond line","dbo.caf\u00e9.sql:12"\r\n"SQL2","",""\r\n',
        );
    });

    test("escapes spreadsheet formula prefixes in headers and values", () => {
        const values = [
            "=1+1",
            "+sum(A1)",
            "-2+3",
            "@command",
            "\tformula",
            "\rformula",
            "\nformula",
        ];
        const content = serializeCompatibilityDiagnostics(
            ["=header"],
            values.map((value) => [value]),
            "csv",
        );
        expect(content).to.equal(
            ['"\'=header"', ...values.map((value) => `"\'${value}"`)].join("\r\n") + "\r\n",
        );
    });

    test("exports JSON with displayed headers and values, excluding internal row IDs", () => {
        const rows = [
            ["SQL1", "First\nsecond"],
            ["SQL2", ""],
        ];
        expect(
            JSON.parse(serializeCompatibilityDiagnostics(["Code", "Message"], rows, "json")),
        ).to.deep.equal([
            { Code: "SQL1", Message: "First\nsecond" },
            { Code: "SQL2", Message: "" },
        ]);
        expect(serializeCompatibilityDiagnostics(["Code"], [], "csv")).to.equal('"Code"\r\n');
        expect(serializeCompatibilityDiagnostics(["Code"], [], "json")).to.equal("[]");
    });
});
