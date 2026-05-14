/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import {
    normalizeQuickQueries,
    QuickQueryConnectionMode,
    QuickQueryExecutionMode,
    QuickQuerySlot,
} from "../../src/sharedInterfaces/shortcutsConfiguration";
import {
    QuickQueryRunResult,
    QuickQueryService,
    resolveQuickQueryConnectionOptions,
} from "../../src/quickQueries/quickQueryService";
import { ConnectionStrategy, NewQueryOptions } from "../../src/controllers/sqlDocumentService";

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
                connectionMode: QuickQueryConnectionMode.Prompt,
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
            connectionMode: QuickQueryConnectionMode.Prompt,
        });
        expect(quickQueries[1]).to.deep.equal({
            name: "Quick Query 2",
            query: "",
            executionMode: QuickQueryExecutionMode.Open,
            connectionMode: QuickQueryConnectionMode.Prompt,
        });
        expect(quickQueries[9].name).to.equal("Quick Query 10");
    });

    test("uses active connection when configured for activeOrPrompt", () => {
        const slot: QuickQuerySlot = {
            ...normalizeQuickQueries(undefined)[0],
            connectionMode: QuickQueryConnectionMode.ActiveOrPrompt,
        };
        const connectionInfo = { server: "localhost" };

        const result = resolveQuickQueryConnectionOptions(
            slot,
            connectionInfo as unknown as IConnectionInfo,
        );

        expect(result).to.deep.equal({
            connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
            connectionInfo,
        });
    });

    test("uses prompt connection strategy when configured for prompt", () => {
        const slot: QuickQuerySlot = {
            ...normalizeQuickQueries(undefined)[0],
            connectionMode: QuickQueryConnectionMode.Prompt,
        };

        const result = resolveQuickQueryConnectionOptions(slot, {
            server: "localhost",
        } as unknown as IConnectionInfo);

        expect(result).to.deep.equal({
            connectionStrategy: ConnectionStrategy.PromptForConnection,
        });
    });

    test("opens configuration for an empty slot", async () => {
        const openConfiguration = sandbox.stub();
        const service = new QuickQueryService({
            readQuickQueries: () => normalizeQuickQueries(undefined),
            openConfiguration,
            getActiveSqlEditorConnectionInfo: sandbox.stub(),
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
                        connectionMode: QuickQueryConnectionMode.ActiveOrPrompt,
                    },
                ]),
            openConfiguration: sandbox.stub(),
            getActiveSqlEditorConnectionInfo: () =>
                ({ server: "localhost" }) as unknown as IConnectionInfo,
            createSqlEditor,
            isSqlEditorConnected: sandbox.stub().returns(true),
            runSqlEditorQuery,
        });

        const result = await service.run(1);
        const options = createSqlEditor.firstCall.args[0] as NewQueryOptions;

        expect(result).to.equal(QuickQueryRunResult.Opened);
        expect(options.connectionStrategy).to.equal(ConnectionStrategy.CopyConnectionFromInfo);
        expect(runSqlEditorQuery.notCalled).to.equal(true);
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
                        connectionMode: QuickQueryConnectionMode.Prompt,
                    },
                ]),
            openConfiguration: sandbox.stub(),
            getActiveSqlEditorConnectionInfo: () =>
                ({ server: "localhost" }) as unknown as IConnectionInfo,
            createSqlEditor: sandbox.stub().resolves(editor),
            isSqlEditorConnected: sandbox.stub().returns(true),
            runSqlEditorQuery,
        });

        const result = await service.run(1);

        expect(result).to.equal(QuickQueryRunResult.OpenedAndRan);
        expect(runSqlEditorQuery).to.have.been.calledWith(editor);
    });
});
