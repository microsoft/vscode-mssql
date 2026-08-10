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
    BetaSqlDiagnostics,
    BetaSqlHoverProvider,
    BetaSqlMetadataCatalog,
    BetaSqlSessionManager,
} from "../../../src/languageservice/betaSqlCompletionProvider";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";
import { PreviewFeature, previewService } from "../../../src/previews/previewService";
import { createStubLogger } from "../../unit/utils";

suite("Beta SQL local DDL and metadata regressions", () => {
    const connectionId = "local-ddl-metadata-regression";
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let catalog: BetaSqlMetadataCatalog;
    let sessions: BetaSqlSessionManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionManager.getConnectionInfo.returns(connectionInfo(connectionId));
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        client.sendRequest.resolves(emptyResult());
        sandbox
            .stub(previewService, "isFeatureEnabled")
            .withArgs(PreviewFeature.BetaLanguageService)
            .returns(true);
        catalog = new BetaSqlMetadataCatalog(client, createStubLogger(sandbox));
        catalog.setOwnerUri(connectionId, "file:///local-ddl-metadata-regression.sql");
        sessions = new BetaSqlSessionManager(connectionManager, catalog);
    });

    teardown(() => {
        sessions.dispose();
        catalog.dispose();
        sandbox.restore();
    });

    /**
     * A script-local qualified table remains visible across a GO batch boundary even when the
     * connected catalog has no matching objects. This is intentionally a closed catalog fixture.
     */
    test("keeps schema-qualified local DDL visible to SELECT and INSERT across GO", async () => {
        const sql = [
            "CREATE TABLE dbo.gbf (Id int NOT NULL, Description nvarchar(64) NULL);",
            "GO",
            "SELECT g.Id, g.Description FROM dbo.gbf AS g;",
            "INSERT INTO dbo.gbf (Id, Description) VALUES (1, N'created locally');",
        ].join("\n");
        const document = await openSqlDocument(sql);
        const { collection, diagnostics } = createDiagnostics(connectionManager, catalog, sessions);

        await diagnostics.update(document);

        expect(mssql208Diagnostics(collection.get(document.uri) ?? [])).to.be.empty;

        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);
        const idHover = await hoverProvider.provideHover(
            document,
            document.positionAt(sql.indexOf("g.Id") + "g.".length),
        );
        const descriptionHover = await hoverProvider.provideHover(
            document,
            document.positionAt(sql.indexOf("g.Description") + "g.".length),
        );

        expect(hoverText(idHover)).to.contain("g.Id: int");
        expect(hoverText(idHover)).to.contain("**Nullable:** No");
        expect(hoverText(descriptionHover)).to.contain("g.Description: nvarchar(64)");
        expect(hoverText(descriptionHover)).to.contain("**Nullable:** Yes");
        diagnostics.dispose();
    });

    /** Verifies the catalog row layout feeds relation kind, type, and nullability into hover. */
    test("maps catalog object kind and nullable column metadata into hover", async () => {
        client.sendRequest.callsFake((_request, params) =>
            Promise.resolve(metadataResponse((params as { queryString: string }).queryString)),
        );
        const sql = "SELECT g.Id, g.Description FROM dbo.gbf AS g;";
        const document = await openSqlDocument(sql);
        const hoverProvider = new BetaSqlHoverProvider(connectionManager, catalog, sessions);

        const objectHover = await hoverProvider.provideHover(
            document,
            document.positionAt(sql.indexOf("gbf") + 1),
        );
        const idHover = await hoverProvider.provideHover(
            document,
            document.positionAt(sql.indexOf("g.Id") + "g.".length),
        );
        const descriptionHover = await hoverProvider.provideHover(
            document,
            document.positionAt(sql.indexOf("g.Description") + "g.".length),
        );

        expect(hoverText(objectHover)).to.contain("dbo.gbf");
        expect(hoverText(objectHover)).to.contain("**Object type:** Table");
        expect(hoverText(idHover)).to.contain("g.Id: int");
        expect(hoverText(idHover)).to.contain("**Nullable:** No");
        expect(hoverText(descriptionHover)).to.contain("g.Description: nvarchar(64)");
        expect(hoverText(descriptionHover)).to.contain("**Nullable:** Yes");
    });

    /**
     * A closed catalog must still diagnose references outside the local DDL lifetime. The exact
     * offsets make this a regression for diagnostics being published against the wrong batch row.
     */
    test("reports MSSQL208 before CREATE, after DROP, and for an unknown INSERT target", async () => {
        const sql = [
            "SELECT * FROM dbo.gbf;",
            "GO",
            "CREATE TABLE dbo.gbf (Id int NOT NULL);",
            "GO",
            "SELECT Id FROM dbo.gbf;",
            "GO",
            "DROP TABLE dbo.gbf;",
            "GO",
            "SELECT * FROM dbo.gbf;",
            "INSERT dbo.hhh (Id) VALUES (1);",
        ].join("\n");
        const document = await openSqlDocument(sql);
        const { collection, diagnostics } = createDiagnostics(connectionManager, catalog, sessions);

        await diagnostics.update(document);

        const published = mssql208Diagnostics(collection.get(document.uri) ?? []);
        expect(published.map((diagnostic) => diagnostic.message)).to.deep.equal([
            "Invalid object name 'dbo.gbf'.",
            "Invalid object name 'dbo.gbf'.",
            "Invalid object name 'dbo.hhh'.",
        ]);
        expect(
            published.map((diagnostic) => document.offsetAt(diagnostic.range.start)),
        ).to.deep.equal([
            sql.indexOf("dbo.gbf"),
            sql.lastIndexOf("dbo.gbf"),
            sql.indexOf("dbo.hhh"),
        ]);
        diagnostics.dispose();
    });
});

function createDiagnostics(
    connectionManager: ConnectionManager,
    catalog: BetaSqlMetadataCatalog,
    sessions: BetaSqlSessionManager,
): { readonly collection: vscode.DiagnosticCollection; readonly diagnostics: BetaSqlDiagnostics } {
    const collection = vscode.languages.createDiagnosticCollection(
        "mssql-beta-local-ddl-regression",
    );
    const diagnostics = new BetaSqlDiagnostics(connectionManager, catalog, collection, sessions);
    return { collection, diagnostics };
}

function mssql208Diagnostics(
    diagnostics: readonly vscode.Diagnostic[],
): readonly vscode.Diagnostic[] {
    return diagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208");
}

function hoverText(hover: vscode.Hover | undefined): string {
    return (
        hover?.contents
            .map((content) =>
                content instanceof vscode.MarkdownString ? content.value : String(content),
            )
            .join("\n") ?? ""
    );
}

function metadataResponse(query: string): SimpleExecuteResult {
    if (!query.includes("WITH Requested(RequestKey")) {
        return emptyResult();
    }
    const request = /\(N'([^']*)',\s*N'dbo',\s*N'gbf'\)/i.exec(query);
    if (!request) {
        return emptyResult();
    }
    const requestKey = request[1];
    return result([
        [
            cell(requestKey),
            cell("dbo"),
            cell("gbf"),
            cell("table"),
            nullCell(),
            cell("Id"),
            cell("int"),
            cell("0"),
            cell("1"),
        ],
        [
            cell(requestKey),
            cell("dbo"),
            cell("gbf"),
            cell("table"),
            nullCell(),
            cell("Description"),
            cell("nvarchar(64)"),
            cell("1"),
            cell("1"),
        ],
    ]);
}

function emptyResult(): SimpleExecuteResult {
    return result([]);
}

function result(rows: SimpleExecuteResult["rows"]): SimpleExecuteResult {
    return { rowCount: rows.length, columnInfo: [], rows };
}

function cell(displayValue: string): SimpleExecuteResult["rows"][number][number] {
    return { displayValue, isNull: false };
}

function nullCell(): SimpleExecuteResult["rows"][number][number] {
    return { displayValue: "", isNull: true };
}

function connectionInfo(connectionId: string): ConnectionInfo {
    const connection = new ConnectionInfo();
    connection.connectionId = connectionId;
    return connection;
}

async function openSqlDocument(text: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: Constants.languageId, content: text });
}
