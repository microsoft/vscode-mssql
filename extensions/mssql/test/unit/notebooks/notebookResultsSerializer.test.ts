/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { IDbColumn, DbCellValue } from "vscode-mssql";
import SqlToolsServerClient from "../../../src/languageservice/serviceclient";
import { SerializeStartRequest } from "../../../src/models/contracts";
import { saveNotebookResults } from "../../../src/notebooks/notebookResultsSerializer";

function makeColumn(name: string, dataType?: string): IDbColumn {
    return { columnName: name, dataType, dataTypeName: dataType } as IDbColumn;
}

function makeCell(value: string, isNull = false): DbCellValue {
    return { displayValue: value, isNull } as DbCellValue;
}

suite("notebookResultsSerializer", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServerClient>;
    let showSaveDialogStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlToolsServerClient);
        sandbox.stub(SqlToolsServerClient, "instance").get(() => mockClient);
        showSaveDialogStub = sandbox.stub(vscode.window, "showSaveDialog");
    });

    teardown(() => {
        sandbox.restore();
    });

    test("returns undefined and skips STS call when user cancels save dialog", async () => {
        showSaveDialogStub.resolves(undefined);

        const result = await saveNotebookResults({
            format: "csv",
            columnInfo: [makeColumn("id")],
            rows: [[makeCell("1")]],
            notebookBaseName: "test.ipynb",
            resultSetIndex: 0,
        });

        expect(result).to.be.undefined;
        expect(mockClient.sendRequest).to.not.have.been.called;
    });

    test("dispatches SerializeStartRequest with mapped columns, rows, and target path", async () => {
        const targetUri = vscode.Uri.file("/tmp/results.csv");
        showSaveDialogStub.resolves(targetUri);
        mockClient.sendRequest.resolves({ succeeded: true, messages: "" });

        const columns = [makeColumn("id", "int"), makeColumn("name", "nvarchar")];
        const rows = [
            [makeCell("1"), makeCell("Alice")],
            [makeCell("", true), makeCell("Bob")],
        ];

        const result = await saveNotebookResults({
            format: "csv",
            columnInfo: columns,
            rows,
            notebookBaseName: "test.ipynb",
            resultSetIndex: 0,
        });

        expect(result).to.equal(targetUri);
        expect(mockClient.sendRequest).to.have.been.calledOnce;

        const [requestType, params] = mockClient.sendRequest.firstCall.args;
        expect(requestType).to.equal(SerializeStartRequest.type);
        expect(params).to.deep.equal({
            saveFormat: "csv",
            filePath: targetUri.fsPath,
            rows: [
                [
                    { displayValue: "1", isNull: false },
                    { displayValue: "Alice", isNull: false },
                ],
                [
                    { displayValue: "", isNull: true },
                    { displayValue: "Bob", isNull: false },
                ],
            ],
            columns: [
                { name: "id", dataTypeName: "int" },
                { name: "name", dataTypeName: "nvarchar" },
            ],
            isLastBatch: true,
            includeHeaders: true,
        });
    });

    test("defaults dataTypeName to nvarchar when column has no type info", async () => {
        showSaveDialogStub.resolves(vscode.Uri.file("/tmp/results.json"));
        mockClient.sendRequest.resolves({ succeeded: true, messages: "" });

        await saveNotebookResults({
            format: "json",
            columnInfo: [makeColumn("untyped")],
            rows: [[makeCell("value")]],
            notebookBaseName: "test.ipynb",
            resultSetIndex: 0,
        });

        const params = mockClient.sendRequest.firstCall.args[1] as {
            columns: Array<{ name: string; dataTypeName: string }>;
        };
        expect(params.columns).to.deep.equal([{ name: "untyped", dataTypeName: "nvarchar" }]);
    });

    test("throws with STS error message when serialization fails", async () => {
        showSaveDialogStub.resolves(vscode.Uri.file("/tmp/results.csv"));
        mockClient.sendRequest.resolves({ succeeded: false, messages: "disk full" });

        try {
            await saveNotebookResults({
                format: "csv",
                columnInfo: [makeColumn("id")],
                rows: [[makeCell("1")]],
                notebookBaseName: "test.ipynb",
                resultSetIndex: 0,
            });
            expect.fail("expected saveNotebookResults to throw");
        } catch (err) {
            expect((err as Error).message).to.equal("disk full");
        }
    });

    test("throws default message when STS reports failure with no message", async () => {
        showSaveDialogStub.resolves(vscode.Uri.file("/tmp/results.csv"));
        mockClient.sendRequest.resolves({ succeeded: false, messages: "" });

        try {
            await saveNotebookResults({
                format: "csv",
                columnInfo: [makeColumn("id")],
                rows: [[makeCell("1")]],
                notebookBaseName: "test.ipynb",
                resultSetIndex: 0,
            });
            expect.fail("expected saveNotebookResults to throw");
        } catch (err) {
            expect((err as Error).message).to.equal("Serialization failed");
        }
    });

    test("save dialog uses sanitized basename, result-set suffix, and format-specific extension", async () => {
        showSaveDialogStub.resolves(undefined);

        await saveNotebookResults({
            format: "excel",
            columnInfo: [makeColumn("id")],
            rows: [[makeCell("1")]],
            notebookBaseName: "my report!.ipynb",
            resultSetIndex: 2,
        });

        expect(showSaveDialogStub).to.have.been.calledOnce;
        const options = showSaveDialogStub.firstCall.args[0] as vscode.SaveDialogOptions;
        expect(options.defaultUri?.fsPath).to.match(/my_report_resultset_3\.xlsx$/);
        expect(Object.values(options.filters ?? {})).to.deep.include(["xlsx"]);
    });
});
