/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { NotebookCodeLensProvider } from "../../src/notebooks/notebookCodeLensProvider";
import { NotebookConnectionManager } from "../../src/notebooks/notebookConnectionManager";

suite("NotebookCodeLensProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let connections: Map<string, NotebookConnectionManager>;
    let provider: NotebookCodeLensProvider;

    const notebookUri = "vscode-notebook://test-notebook";
    const cellUri = "vscode-notebook-cell://test-notebook#cell1";

    function makeCellDocument(uri: string): vscode.TextDocument {
        return {
            uri: vscode.Uri.parse(uri),
        } as unknown as vscode.TextDocument;
    }

    function makeMockMgr(connected: boolean, label?: string): NotebookConnectionManager {
        return {
            isConnected: sinon.stub().returns(connected),
            getConnectionLabel: sinon.stub().returns(label ?? "test-server / TestDB"),
        } as unknown as NotebookConnectionManager;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        connections = new Map();
        provider = new NotebookCodeLensProvider(connections);

        // Stub vscode.workspace.notebookDocuments to return our test notebook
        const mockNotebook = {
            uri: vscode.Uri.parse(notebookUri),
            getCells: () => [
                {
                    document: { uri: vscode.Uri.parse(cellUri) },
                },
            ],
        };
        sandbox.stub(vscode.workspace, "notebookDocuments").value([mockNotebook]);
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test("returns empty array for non-notebook documents", () => {
        const doc = makeCellDocument("file:///test.sql");
        const result = provider.provideCodeLenses(doc, {} as vscode.CancellationToken);
        expect(result).to.deep.equal([]);
    });

    test("returns empty array when notebook not found", () => {
        const doc = makeCellDocument("vscode-notebook-cell://unknown-notebook#cell1");
        const result = provider.provideCodeLenses(doc, {} as vscode.CancellationToken);
        expect(result).to.deep.equal([]);
    });

    test("shows connection label when connected", () => {
        connections.set(notebookUri, makeMockMgr(true, "myserver / MyDB"));
        const doc = makeCellDocument(cellUri);
        const lenses = provider.provideCodeLenses(doc, {} as vscode.CancellationToken);

        expect(lenses).to.have.length(1);
        expect(lenses[0].command!.title).to.include("myserver / MyDB");
        expect(lenses[0].command!.command).to.equal(Constants.cmdNotebooksChangeDatabase);
    });

    test("shows connect prompt when not connected", () => {
        connections.set(notebookUri, makeMockMgr(false));
        const doc = makeCellDocument(cellUri);
        const lenses = provider.provideCodeLenses(doc, {} as vscode.CancellationToken);

        expect(lenses).to.have.length(1);
        expect(lenses[0].command!.command).to.equal(Constants.cmdNotebooksChangeConnection);
    });

    test("shows connect prompt when no connection manager exists", () => {
        // connections map is empty
        const doc = makeCellDocument(cellUri);
        const lenses = provider.provideCodeLenses(doc, {} as vscode.CancellationToken);

        expect(lenses).to.have.length(1);
        expect(lenses[0].command!.command).to.equal(Constants.cmdNotebooksChangeConnection);
    });

    test("refresh fires onDidChangeCodeLenses event", () => {
        const listener = sandbox.stub();
        provider.onDidChangeCodeLenses(listener);
        provider.refresh();
        expect(listener).to.have.been.calledOnce;
    });
});
