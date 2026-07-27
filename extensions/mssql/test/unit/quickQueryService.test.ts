/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import {
    getQuickQueryCommandId,
    getQuickQuerySlotName,
    normalizeQuickQueries,
    QuickQuerySlot,
    quickQueryCount,
} from "../../src/sharedInterfaces/shortcutsConfiguration";
import {
    composeQuickQuery,
    hasQuickQueryArgument,
    QuickQueryExecutionDependencies,
    QuickQueryRunResult,
    QuickQueryService,
    quickQueryService,
    resolveQuickQueryConnectionOptions,
} from "../../src/quickQueries/quickQueryService";
import { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";

const { expect } = chai;
chai.use(sinonChai);

suite("Quick Query Service", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    function createEditor(selectedText = "", selectionCount = 1): vscode.TextEditor {
        const selection = new vscode.Selection(0, 0, 0, selectedText.length);
        const selections = Array.from({ length: selectionCount }, () => selection);
        return {
            document: {
                uri: vscode.Uri.parse("untitled:quick-query.sql"),
                fileName: "quick-query.sql",
                getText: sandbox.stub().returns(selectedText),
            },
            selection,
            selections,
        } as unknown as vscode.TextEditor;
    }

    function configureService(
        dependencies: Partial<QuickQueryExecutionDependencies>,
    ): QuickQueryService {
        quickQueryService.configure({
            readQuickQueries: () => normalizeQuickQueries(undefined),
            openConfiguration: sandbox.stub(),
            getActiveSqlEditor: sandbox.stub().returns(undefined),
            ensureSqlEditorConnected: sandbox.stub().resolves(true),
            runSqlEditorQueryString: sandbox.stub().resolves(),
            showMultipleSelectionsError: sandbox.stub(),
            showSelectedTextRequiredError: sandbox.stub(),
            createSqlEditor: sandbox.stub(),
            isSqlEditorConnected: sandbox.stub(),
            runSqlEditorQuery: sandbox.stub(),
            ...dependencies,
        });

        return quickQueryService;
    }

    test("normalizes Quick Query config to ten execution-only slots", () => {
        const quickQueries = normalizeQuickQueries([
            {
                name: "  Health Check  ",
                query: "select 1",
                executionMode: "open",
            },
            {
                name: "",
                query: 123,
                executionMode: "bad",
                connectionMode: "bad",
            },
        ]);

        expect(quickQueries).to.have.length(10);
        expect(quickQueries[0]).to.deep.equal({
            name: "Health Check",
            query: "select 1",
        });
        expect(quickQueries[1]).to.deep.equal({
            name: "Query 2",
            query: "",
        });
        expect(quickQueries[9].name).to.equal("Query 10");
    });

    test("composes explicit and appended Quick Query arguments literally", () => {
        expect(composeQuickQuery("select * from {arg}", "[dbo].[Orders]")).to.equal(
            "select * from [dbo].[Orders]",
        );
        expect(composeQuickQuery("select {arg}, {arg}", "$&Orders")).to.equal(
            "select $&Orders, $&Orders",
        );
        expect(composeQuickQuery("select * from ", "[dbo].[Orders]")).to.equal(
            "select * from [dbo].[Orders]",
        );
        expect(composeQuickQuery("select {arg}", "")).to.equal("select ");
    });

    test("supports only the {arg} Quick Query argument", () => {
        expect(hasQuickQueryArgument("select {arg}")).to.equal(true);
        expect(hasQuickQueryArgument("select {selected_text}")).to.equal(false);
        expect(hasQuickQueryArgument("select {selectedText}")).to.equal(false);
        expect(hasQuickQueryArgument("select ${selectedText}")).to.equal(false);
        expect(hasQuickQueryArgument("select 1")).to.equal(false);
    });

    test("uses prompt connection strategy for the fallback editor", () => {
        expect(resolveQuickQueryConnectionOptions()).to.deep.equal({
            connectionStrategy: ConnectionStrategy.PromptForConnection,
        });
    });

    test("returns the singleton instance", () => {
        expect(QuickQueryService.getInstance()).to.equal(quickQueryService);
    });

    test("opens configuration for an empty slot", async () => {
        const openConfiguration = sandbox.stub();
        const service = configureService({ openConfiguration });

        const result = await service.run(3);

        expect(result).to.equal(QuickQueryRunResult.OpenedConfiguration);
        expect(openConfiguration).to.have.been.calledWith(3);
    });

    test("executes the composed query without opening an editor when SQL is active", async () => {
        const editor = createEditor("[dbo].[Orders]");
        const createSqlEditor = sandbox.stub();
        const runSqlEditorQueryString = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () =>
                normalizeQuickQueries([{ name: "Rows", query: "select * from {arg}" }]),
            getActiveSqlEditor: sandbox.stub().returns(editor),
            createSqlEditor,
            runSqlEditorQueryString,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.Executed);
        expect(runSqlEditorQueryString).to.have.been.calledWith(
            editor,
            "select * from [dbo].[Orders]",
        );
        expect(createSqlEditor).to.not.have.been.called;
    });

    test("does not execute when the active editor connection is unavailable", async () => {
        const editor = createEditor();
        const runSqlEditorQueryString = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select 1" }]),
            getActiveSqlEditor: sandbox.stub().returns(editor),
            ensureSqlEditorConnected: sandbox.stub().resolves(false),
            runSqlEditorQueryString,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.ConnectionUnavailable);
        expect(runSqlEditorQueryString).to.not.have.been.called;
    });

    test("shows an error when an argument query has no selected editor text", async () => {
        const editor = createEditor();
        const showSelectedTextRequiredError = sandbox.stub();
        const runSqlEditorQueryString = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select {arg}" }]),
            getActiveSqlEditor: sandbox.stub().returns(editor),
            showSelectedTextRequiredError,
            runSqlEditorQueryString,
        });

        expect(await service.run(1)).to.equal(QuickQueryRunResult.SelectedTextRequired);
        expect(showSelectedTextRequiredError).to.have.been.calledOnce;
        expect(runSqlEditorQueryString).to.not.have.been.called;
    });

    test("shows an error instead of opening an argument query without an active SQL editor", async () => {
        const showSelectedTextRequiredError = sandbox.stub();
        const createSqlEditor = sandbox.stub();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select {arg}" }]),
            showSelectedTextRequiredError,
            createSqlEditor,
        });

        expect(await service.run(1)).to.equal(QuickQueryRunResult.SelectedTextRequired);
        expect(showSelectedTextRequiredError).to.have.been.calledOnce;
        expect(createSqlEditor).to.not.have.been.called;
    });

    test("rejects multiple editor selections", async () => {
        const editor = createEditor("table", 2);
        const showMultipleSelectionsError = sandbox.stub();
        const runSqlEditorQueryString = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select " }]),
            getActiveSqlEditor: sandbox.stub().returns(editor),
            showMultipleSelectionsError,
            runSqlEditorQueryString,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.MultipleSelectionsNotSupported);
        expect(showMultipleSelectionsError).to.have.been.called;
        expect(runSqlEditorQueryString).to.not.have.been.called;
    });

    test("opens and runs a connected fallback editor when SQL is not active", async () => {
        const editor = createEditor();
        const createSqlEditor = sandbox.stub().resolves(editor);
        const runSqlEditorQuery = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select 1" }]),
            createSqlEditor,
            isSqlEditorConnected: sandbox.stub().returns(true),
            runSqlEditorQuery,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.OpenedAndRan);
        expect(createSqlEditor).to.have.been.calledWithMatch({
            content: "select 1",
            connectionStrategy: ConnectionStrategy.PromptForConnection,
        });
        expect(runSqlEditorQuery).to.have.been.calledWith(editor);
    });

    test("leaves a disconnected fallback editor open without running", async () => {
        const editor = createEditor();
        const runSqlEditorQuery = sandbox.stub().resolves();
        const service = configureService({
            readQuickQueries: () => normalizeQuickQueries([{ name: "Run", query: "select 1" }]),
            createSqlEditor: sandbox.stub().resolves(editor),
            isSqlEditorConnected: sandbox.stub().returns(false),
            runSqlEditorQuery,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.OpenedWithoutConnection);
        expect(runSqlEditorQuery).to.not.have.been.called;
    });

    test("package Quick Query contributions match the execution-only slot model", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            contributes: {
                commands: { command: string }[];
                configuration: {
                    properties: Record<
                        string,
                        {
                            default?: QuickQuerySlot[];
                            items?: {
                                properties?: Record<string, unknown>;
                            };
                        }
                    >;
                };
            };
        };

        const commandIds = new Set(
            packageJson.contributes.commands.map((command) => command.command),
        );
        for (let slotNumber = 1; slotNumber <= quickQueryCount; slotNumber++) {
            expect(commandIds.has(getQuickQueryCommandId(slotNumber))).to.equal(true);
        }

        const quickQueryConfiguration =
            packageJson.contributes.configuration.properties["mssql.quickQueries"];
        expect(quickQueryConfiguration.default).to.have.length(quickQueryCount);
        for (let slotNumber = 1; slotNumber <= quickQueryCount; slotNumber++) {
            const defaultSlot = quickQueryConfiguration.default[slotNumber - 1];
            expect(defaultSlot.name).to.equal(getQuickQuerySlotName(slotNumber));
            expect(defaultSlot).to.not.have.property("executionMode");
        }
        expect(quickQueryConfiguration.items.properties).to.not.have.property("executionMode");
    });
});
