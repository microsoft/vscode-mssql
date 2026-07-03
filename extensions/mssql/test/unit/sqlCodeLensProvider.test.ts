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
    let getConnectionById: sinon.SinonStub;
    let document: vscode.TextDocument;

    setup(() => {
        sandbox = sinon.createSandbox();

        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: () => true,
        } as unknown as vscode.WorkspaceConfiguration);

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        (connectionManager as any).onConnectionsChanged = (_listener: () => void) =>
            new vscode.Disposable(() => {});

        getConnectionById = sandbox.stub().resolves(undefined);
        (connectionManager as any).connectionStore = {
            connectionConfig: { getConnectionById },
        };

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

    test("shows connect code lens when no connection exists", async () => {
        connectionManager.getConnectionInfo.returns(undefined);

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(1);
        expect(lenses[0].command?.title).to.equal(LocalizedConstants.QueryEditor.codeLensConnect);
        expect(lenses[0].command?.command).to.equal(Constants.cmdConnect);
    });

    test("shows connecting code lens when connection is in progress", async () => {
        connectionManager.getConnectionInfo.returns({
            connecting: true,
            credentials: {
                server: "localhost",
                database: "master",
            },
        } as ConnectionInfo);

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(1);
        expect(lenses[0].command?.title).to.equal(
            `$(loading~spin) ${LocalizedConstants.StatusBar.connectingLabel}`,
        );
        expect(lenses[0].command?.command).to.equal(Constants.cmdDisconnect);
    });

    test("shows server and database code lenses when connected without a matching profile", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                server: "localhost",
                database: "master",
            },
        } as ConnectionInfo);

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(2);
        expect(lenses[0].command?.command).to.equal(Constants.cmdConnect);
        expect(lenses[1].command?.command).to.equal(Constants.cmdChooseDatabase);
    });

    test("prepends profile code lens as leftmost item when the connection matches a profile", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                id: "profile-1",
                server: "localhost",
                database: "master",
            },
        } as unknown as ConnectionInfo);
        getConnectionById.resolves({
            id: "profile-1",
            profileName: "My Profile",
            server: "localhost",
            database: "master",
        });

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(3);
        expect(lenses[0].command?.title).to.equal("$(star-full) My Profile");
        expect(lenses[0].command?.tooltip).to.equal(
            LocalizedConstants.QueryEditor.codeLensProfileTooltip("My Profile"),
        );
        expect(lenses[0].command?.command).to.equal(Constants.cmdConnect);
        expect(lenses[1].command?.command).to.equal(Constants.cmdConnect);
        expect(lenses[2].command?.command).to.equal(Constants.cmdChooseDatabase);
    });

    test("does not show profile code lens when the credentials have no profile id", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                server: "localhost",
                database: "master",
            },
        } as ConnectionInfo);

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(2);
        expect(getConnectionById).to.not.have.been.called;
    });

    test("does not show profile code lens when no matching profile is found", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                id: "profile-1",
                server: "localhost",
                database: "master",
            },
        } as unknown as ConnectionInfo);
        getConnectionById.resolves(undefined);

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(2);
    });

    test("does not show profile code lens when the server no longer matches the profile", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                id: "profile-1",
                server: "otherserver",
                database: "master",
            },
        } as unknown as ConnectionInfo);
        getConnectionById.resolves({
            id: "profile-1",
            profileName: "My Profile",
            server: "localhost",
            database: "master",
        });

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(2);
    });

    test("does not show profile code lens when the database no longer matches the profile", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                id: "profile-1",
                server: "localhost",
                database: "AdventureWorks",
            },
        } as unknown as ConnectionInfo);
        getConnectionById.resolves({
            id: "profile-1",
            profileName: "My Profile",
            server: "localhost",
            database: "master",
        });

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(2);
    });

    test("shows profile code lens when the profile does not pin a database, regardless of active database", async () => {
        connectionManager.getConnectionInfo.returns({
            connectionId: "conn-1",
            credentials: {
                id: "profile-1",
                server: "localhost",
                database: "AdventureWorks",
            },
        } as unknown as ConnectionInfo);
        getConnectionById.resolves({
            id: "profile-1",
            profileName: "My Profile",
            server: "localhost",
            database: "",
        });

        const lenses = await provider.provideCodeLenses(document, {} as vscode.CancellationToken);

        expect(lenses).to.have.lengthOf(3);
        expect(lenses[0].command?.title).to.equal("$(star-full) My Profile");
    });
});
