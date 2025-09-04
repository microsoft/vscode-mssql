/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as sinon from "sinon";
import { expect } from "chai";
import { MssqlProtocolHandler } from "../../src/mssqlProtocolHandler";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Uri } from "vscode";
import { mockGetCapabilitiesRequest } from "./mocks";
import { Logger } from "../../src/models/logger";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import MainController from "../../src/controllers/mainController";

suite("MssqlProtocolHandler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mssqlProtocolHandler: MssqlProtocolHandler;
    let sqlToolsServiceClientMock: TypeMoq.IMock<SqlToolsServiceClient>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;
    let openConnectionDialogStub: sinon.SinonStub;
    setup(() => {
        sandbox = sinon.createSandbox();
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = sandbox.createStubInstance(Logger);
        mockMainController = sandbox.createStubInstance(MainController);

        const outputChannel = sinon.stub({
            append: () => sinon.stub(),
            appendLine: () => sinon.stub(),
        }) as unknown as vscode.OutputChannel;

        sinon.stub(mockVscodeWrapper, "outputChannel").get(() => {
            return outputChannel;
        });

        sandbox.stub(Logger, "create").returns(mockLogger);

        sqlToolsServiceClientMock = TypeMoq.Mock.ofType(
            SqlToolsServiceClient,
            TypeMoq.MockBehavior.Loose,
        );

        mockGetCapabilitiesRequest(sqlToolsServiceClientMock);

        mssqlProtocolHandler = new MssqlProtocolHandler(
            mockVscodeWrapper,
            mockMainController,
            sqlToolsServiceClientMock.object,
        );

        openConnectionDialogStub = sandbox.stub(
            mssqlProtocolHandler as any,
            "openConnectionDialog",
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("handleUri - with no command and empty query - returns undefined", async () => {
        await mssqlProtocolHandler.handleUri(Uri.parse("vscode://ms-mssql.mssql/"));

        expect(openConnectionDialogStub.calledWith(undefined));
    });

    // test("handleUri - with connect command and no query - doesn't parse query and returns undefined", async () => {
    //     const connInfo = await mssqlProtocolHandler.handleUri(
    //         Uri.parse("vscode://ms-mssql.mssql/connect"),
    //     );

    //     assert.isUndefined(connInfo);
    // });

    // test("handleUri - with connect command and connection string - parses connection string and returns connection info object", async () => {
    //     const connInfo = await mssqlProtocolHandler.handleUri(
    //         Uri.parse(
    //             "vscode://ms-mssql.mssql/connect?connectionString=Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;",
    //         ),
    //     );

    //     assert.isDefined(connInfo);
    //     assert.equal(
    //         connInfo.connectionString,
    //         "Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword;",
    //     );
    // });

    // test("handleUri - with connect command and query - parses query and returns connection info object", async () => {
    //     let uri =
    //         "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&authenticationType=SqlLogin&connectTimeout=15&trustServerCertificate=true&user=testUser";

    //     let connInfo = await mssqlProtocolHandler.handleUri(Uri.parse(uri));

    //     assert.isDefined(connInfo);
    //     assert.equal(connInfo.server, "myServer");
    //     assert.equal(connInfo.database, "dbName");
    //     assert.equal(connInfo.authenticationType, "SqlLogin");
    //     assert.equal(connInfo.connectTimeout, 15);
    //     assert.equal(connInfo.user, "testUser");
    //     assert.equal(connInfo.password, undefined);
    //     assert.isTrue(connInfo.trustServerCertificate);
    //     assert.isFalse(connInfo.savePassword);

    //     uri += "&password=testPassword";
    //     connInfo = await mssqlProtocolHandler.handleUri(Uri.parse(uri));

    //     assert.equal(connInfo.password, "testPassword");
    //     assert.isTrue(connInfo.savePassword); // automatically set savePassword to true if password is provided
    // });

    // test("handleUri - with connect command and query with invalid bool value for trust server cert - trust server cert is false and parses valid params", async () => {
    //     const connInfo = await mssqlProtocolHandler.handleUri(
    //         Uri.parse(
    //             "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&trustServerCertificate=yes",
    //         ),
    //     );

    //     assert.isDefined(connInfo);
    //     assert.equal(connInfo.server, "myServer");
    //     assert.equal(connInfo.database, "dbName");
    //     assert.isFalse(connInfo.trustServerCertificate);
    // });

    // test("handleUri - with connect command and query with invalid numerical value for connect timeout - timeout is undefined and parses valid params", async () => {
    //     const connInfo = await mssqlProtocolHandler.handleUri(
    //         Uri.parse(
    //             "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&connectTimeout=twenty",
    //         ),
    //     );

    //     assert.isDefined(connInfo);
    //     assert.equal(connInfo.server, "myServer");
    //     assert.equal(connInfo.database, "dbName");
    //     assert.isUndefined(connInfo.connectTimeout);
    // });

    // test("handleUri - with connect command and query invalid parameter - invalid param is undefined", async () => {
    //     const connInfo = await mssqlProtocolHandler.handleUri(
    //         Uri.parse(
    //             "vscode://ms-mssql.mssql/connect?server=myServer&database=dbName&madeUpParam=great",
    //         ),
    //     );

    //     assert.isDefined(connInfo);
    //     assert.equal(connInfo.server, "myServer");
    //     assert.equal(connInfo.database, "dbName");

    //     const madeUpParam = "madeUpParam";
    //     assert.isUndefined(connInfo[madeUpParam]);
    // });
});
