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
    QuickQueryExecutionMode,
    QuickQuerySlot,
    quickQueryCount,
} from "../../src/sharedInterfaces/shortcutsConfiguration";
import {
    QuickQueryRunResult,
    QuickQueryService,
    resolveQuickQueryConnectionOptions,
} from "../../src/quickQueries/quickQueryService";
import { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";

const { expect } = chai;
chai.use(sinonChai);

suite("Quick Query Service", () => {
    let sandbox: sinon.SinonSandbox;
    const editor = {
        document: {
            uri: vscode.Uri.parse("untitled:quick-query.sql"),
            fileName: "quick-query.sql",
        },
    } as vscode.TextEditor;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("normalizes Quick Query config to ten slots", () => {
        const quickQueries = normalizeQuickQueries([
            {
                name: "  Health Check  ",
                query: "select 1",
                executionMode: QuickQueryExecutionMode.Open,
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
            executionMode: QuickQueryExecutionMode.Open,
        });
        expect(quickQueries[1]).to.deep.equal({
            name: "Query 2",
            query: "",
            executionMode: QuickQueryExecutionMode.Open,
        });
        expect(quickQueries[9].name).to.equal("Query 10");
    });

    test("normalizes legacy connectionMode out of Quick Query config", () => {
        const quickQueries = normalizeQuickQueries([
            {
                name: "Legacy Active",
                query: "select 1",
                executionMode: QuickQueryExecutionMode.Open,
                connectionMode: "activeOrPrompt",
            },
        ]);

        expect(quickQueries[0]).to.deep.equal({
            name: "Legacy Active",
            query: "select 1",
            executionMode: QuickQueryExecutionMode.Open,
        });
    });

    test("uses prompt connection strategy", () => {
        const result = resolveQuickQueryConnectionOptions();

        expect(result).to.deep.equal({
            connectionStrategy: ConnectionStrategy.PromptForConnection,
        });
    });

    test("opens configuration for an empty slot", async () => {
        const openConfiguration = sandbox.stub();
        const service = new QuickQueryService({
            readQuickQueries: () => normalizeQuickQueries(undefined),
            openConfiguration,
            createSqlEditor: sandbox.stub(),
            isSqlEditorConnected: sandbox.stub(),
            runSqlEditorQuery: sandbox.stub(),
        });

        const result = await service.run(3);

        expect(result).to.equal(QuickQueryRunResult.OpenedConfiguration);
        expect(openConfiguration).to.have.been.calledWith(3);
    });

    test("opens without running when execution mode is open", async () => {
        const createSqlEditor = sandbox.stub().resolves(editor);
        const runSqlEditorQuery = sandbox.stub().resolves();
        const service = new QuickQueryService({
            readQuickQueries: () =>
                normalizeQuickQueries([
                    {
                        name: "Open Only",
                        query: "select 1",
                        executionMode: QuickQueryExecutionMode.Open,
                        connectionMode: "activeOrPrompt",
                    },
                ]),
            openConfiguration: sandbox.stub(),
            createSqlEditor,
            isSqlEditorConnected: sandbox.stub().returns(true),
            runSqlEditorQuery,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.Opened);
        expect(createSqlEditor).to.have.been.calledWithMatch({
            connectionStrategy: ConnectionStrategy.PromptForConnection,
        });
        expect(runSqlEditorQuery).to.not.have.been.called;
    });

    test("runs when execution mode is openAndRun and editor is connected", async () => {
        const runSqlEditorQuery = sandbox.stub().resolves();
        const service = new QuickQueryService({
            readQuickQueries: () =>
                normalizeQuickQueries([
                    {
                        name: "Run",
                        query: "select 1",
                        executionMode: QuickQueryExecutionMode.OpenAndRun,
                    },
                ]),
            openConfiguration: sandbox.stub(),
            createSqlEditor: sandbox.stub().resolves(editor),
            isSqlEditorConnected: sandbox.stub().returns(true),
            runSqlEditorQuery,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.OpenedAndRan);
        expect(runSqlEditorQuery).to.have.been.calledWith(editor);
    });

    test("package Quick Query command contributions match the shared slot count", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
            contributes: {
                commands: { command: string }[];
                configuration: { properties: Record<string, { default?: QuickQuerySlot[] }> };
            };
        };

        const commandIds = new Set(
            packageJson.contributes.commands.map((command) => command.command),
        );
        for (let slotNumber = 1; slotNumber <= quickQueryCount; slotNumber++) {
            expect(commandIds.has(getQuickQueryCommandId(slotNumber))).to.equal(true);
        }

        const quickQueryDefaults =
            packageJson.contributes.configuration.properties["mssql.quickQueries"].default;
        expect(quickQueryDefaults).to.have.length(quickQueryCount);
        for (let slotNumber = 1; slotNumber <= quickQueryCount; slotNumber++) {
            expect(quickQueryDefaults[slotNumber - 1].name).to.equal(
                getQuickQuerySlotName(slotNumber),
            );
        }
    });
});
