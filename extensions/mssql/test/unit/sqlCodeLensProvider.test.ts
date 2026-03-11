/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { SqlCodeLensProvider } from "../../src/queryResult/sqlCodeLensProvider";

chai.use(sinonChai);

suite("SqlCodeLensProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let provider: SqlCodeLensProvider;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let document: vscode.TextDocument;

    setup(() => {
        sandbox = sinon.createSandbox();

        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: () => true,
        } as unknown as vscode.WorkspaceConfiguration);

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        (connectionManager as any).onConnectionsChanged = (_listener: () => void) =>
            new vscode.Disposable(() => {});

        document = {
            uri: vscode.Uri.parse("file:///test.sql"),
            languageId: Constants.languageId,
            lineCount: 100,
        } as vscode.TextDocument;

        provider = new SqlCodeLensProvider(connectionManager as unknown as ConnectionManager);
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test("shows connect code lens when no connection exists", () => {
        connectionManager.getConnectionInfo.returns(undefined);

        const lenses = provider.provideCodeLenses(
            document,
            {} as vscode.CancellationToken,
        ) as vscode.CodeLens[];

        expect(lenses).to.have.lengthOf(1);
        expect(lenses[0].command?.title).to.equal(LocalizedConstants.QueryEditor.codeLensConnect);
        expect(lenses[0].command?.command).to.equal(Constants.cmdConnect);
    });

    test("shows connecting code lens when connection is in progress", () => {
        connectionManager.getConnectionInfo.returns({
            connecting: true,
            credentials: {
                server: "localhost",
                database: "master",
            },
        } as ConnectionInfo);

        const lenses = provider.provideCodeLenses(
            document,
            {} as vscode.CancellationToken,
        ) as vscode.CodeLens[];

        expect(lenses).to.have.lengthOf(1);
        expect(lenses[0].command?.title).to.equal(
            `$(loading~spin) ${LocalizedConstants.StatusBar.connectingLabel}`,
        );
        expect(lenses[0].command?.command).to.equal(Constants.cmdDisconnect);
    });
});
