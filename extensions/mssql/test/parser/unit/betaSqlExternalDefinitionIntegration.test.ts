/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { SimpleExecuteResult } from "vscode-mssql";
import * as Constants from "../../../src/constants/constants";
import ConnectionManager, { ConnectionInfo } from "../../../src/controllers/connectionManager";
import {
    BetaSqlDefinitionProvider,
    BetaSqlMetadataCatalog,
    BetaSqlSessionManager,
} from "../../../src/languageservice/betaSqlCompletionProvider";
import { ScriptingDefinitionProvider } from "../../../src/languageservice/scriptingDefinitionProvider";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";
import { PreviewFeature, previewService } from "../../../src/previews/previewService";
import { createStubLogger } from "../../unit/utils";

suite("Beta SQL external definition integration", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let catalog: BetaSqlMetadataCatalog;
    let sessions: BetaSqlSessionManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        const connection = new ConnectionInfo();
        connection.connectionId = "definition-integration";
        connectionManager.getConnectionInfo.returns(connection);
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        client.sendRequest.callsFake((_request, params) =>
            Promise.resolve(metadataResponse((params as { queryString: string }).queryString)),
        );
        sandbox
            .stub(previewService, "isFeatureEnabled")
            .withArgs(PreviewFeature.BetaLanguageService)
            .returns(true);
        catalog = new BetaSqlMetadataCatalog(client, createStubLogger(sandbox));
        sessions = new BetaSqlSessionManager(connectionManager, catalog);
    });

    teardown(() => {
        sessions.dispose();
        catalog.dispose();
        sandbox.restore();
    });

    test("delegates a catalog table to the Script As Create bridge", async () => {
        const document = await vscode.workspace.openTextDocument({
            language: Constants.languageId,
            content: "SELECT * FROM dbo.Users;",
        });
        const expected = new vscode.Location(
            vscode.Uri.parse("mssql-definition://definition-integration/master/dbo/table/Users"),
            new vscode.Range(0, 13, 0, 22),
        );
        const bridge = sandbox.createStubInstance(ScriptingDefinitionProvider);
        bridge.resolveDefinition.resolves(expected);
        const provider = new BetaSqlDefinitionProvider(
            connectionManager,
            catalog,
            sessions,
            bridge,
        );

        const actual = await provider.provideDefinition(
            document,
            document.positionAt(document.getText().indexOf("Users") + 1),
        );

        expect(actual).to.deep.equal(expected);
        expect(bridge.resolveDefinition).to.have.been.calledOnce;
        expect(bridge.resolveDefinition.firstCall.args[1]).to.deep.include({
            schema: "dbo",
            name: "Users",
            kind: "table",
        });
    });

    test("keeps an in-document definition local and avoids scripting", async () => {
        connectionManager.getConnectionInfo.returns(undefined);
        const sql = "WITH local_rows AS (SELECT 1 AS Id) SELECT * FROM local_rows;";
        const document = await vscode.workspace.openTextDocument({
            language: Constants.languageId,
            content: sql,
        });
        const bridge = sandbox.createStubInstance(ScriptingDefinitionProvider);
        const provider = new BetaSqlDefinitionProvider(
            connectionManager,
            catalog,
            sessions,
            bridge,
        );

        const actual = await provider.provideDefinition(
            document,
            document.positionAt(sql.lastIndexOf("local_rows") + 2),
        );

        expect(actual).to.be.instanceOf(vscode.Location);
        expect((actual as vscode.Location).uri.toString()).to.equal(document.uri.toString());
        expect(bridge.resolveDefinition).not.to.have.been.called;
    });
});

function metadataResponse(query: string): SimpleExecuteResult {
    if (!query.includes("WITH Requested(RequestKey")) {
        return { rowCount: 0, columnInfo: [], rows: [] };
    }
    const requestKey = /\(N'([^']*)',\s*N'dbo',\s*N'Users'\)/i.exec(query)?.[1];
    if (!requestKey) {
        return { rowCount: 0, columnInfo: [], rows: [] };
    }
    return {
        rowCount: 1,
        columnInfo: [],
        rows: [
            [
                cell(requestKey),
                cell("dbo"),
                cell("Users"),
                cell("table"),
                nullCell(),
                cell("Id"),
                cell("int"),
                cell("0"),
                cell("1"),
            ],
        ],
    };
}

function cell(displayValue: string): SimpleExecuteResult["rows"][number][number] {
    return { displayValue, isNull: false };
}

function nullCell(): SimpleExecuteResult["rows"][number][number] {
    return { displayValue: "", isNull: true };
}
