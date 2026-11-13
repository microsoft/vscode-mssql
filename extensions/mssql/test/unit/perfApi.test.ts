/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import { Perf } from "../../src/perf/perfTelemetry";
import { registerPerfApi } from "../../src/perf/perfApi";

suite("Performance driver probes", () => {
    const sandbox = sinon.createSandbox();
    let commands: Map<string, (...args: any[]) => unknown>;
    let context: vscode.ExtensionContext;

    setup(() => {
        commands = new Map();
        context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        sandbox.stub(vscode.commands, "registerCommand").callsFake((name, callback) => {
            commands.set(name, callback);
            return new vscode.Disposable(() => commands.delete(name));
        });
    });

    teardown(() => {
        context.subscriptions.forEach((disposable) => disposable.dispose());
        sandbox.restore();
    });

    test("probe commands do not register outside PERF_MODE", () => {
        sandbox.stub(Perf, "enabled").value(false);
        registerPerfApi(context);
        expect(commands.size).to.equal(0);
    });

    test("grid state reports actual product result counts", () => {
        sandbox.stub(Perf, "enabled").value(true);
        const getQueryResultState = sandbox.stub().returns({
            isExecuting: false,
            resultSetSummaries: { 0: { 0: { rowCount: 10000, columnInfo: [{}, {}] } } },
        });
        registerPerfApi(context, {
            getController: () => ({
                _outputContentProvider: { queryResultWebviewController: { getQueryResultState } },
            }),
        });
        expect(commands.get("mssql.perf.gridState")!("file:///fixture.sql")).to.include({
            uri: "file:///fixture.sql",
            isExecuting: false,
            totalRows: 10000,
            maxColumns: 2,
        });
        expect(getQueryResultState.calledWith("file:///fixture.sql")).to.equal(true);
    });

    test("window probe uses the real row request path and reports returned rows", async () => {
        sandbox.stub(Perf, "enabled").value(true);
        const rowRequestHandler = sandbox
            .stub()
            .resolves({ rows: [[{ displayValue: "42" }], [{ displayValue: "43" }]] });
        registerPerfApi(context, {
            getController: () => ({ _outputContentProvider: { rowRequestHandler } }),
        });
        const result = await commands.get("mssql.perf.gridFetchWindow")!({
            uri: "file:///fixture.sql",
            rowStart: 41,
            numberOfRows: 2,
        });
        expect(result).to.deep.equal({
            rowStart: 41,
            rowsReturned: 2,
            firstRow: ["42"],
            lastRow: ["43"],
        });
        expect(rowRequestHandler.calledWith("file:///fixture.sql", 0, 0, 41, 2)).to.equal(true);
    });

    test("missing product state is reported as an error", () => {
        sandbox.stub(Perf, "enabled").value(true);
        registerPerfApi(context);
        expect(commands.get("mssql.perf.gridState")!()).to.have.property("error");
        expect(commands.get("mssql.perf.oeSnapshot")!()).to.have.property("error");
    });
});
