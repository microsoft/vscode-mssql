/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import {
  IConnectionInfo,
  IExtension,
  IServerInfo,
  ITreeNodeInfo,
} from "vscode-mssql";
import MainController from "../../src/controllers/mainController";
import * as Extension from "../../src/extension";
import { activateExtension } from "./utils";
import { ConnectionStore } from "../../src/models/connectionStore";
import {
  CredentialsQuickPickItemType,
  IConnectionCredentialsQuickPickItem,
} from "../../src/models/interfaces";
import { ConnectionUI } from "../../src/views/connectionUI";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";
import { RequestType } from "vscode-languageclient";

const { expect } = chai;

chai.use(sinonChai);

suite("Extension API Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let vscodeMssql: IExtension;
  let mainController: MainController;
  let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
  let connectionStoreStub: sinon.SinonStubbedInstance<ConnectionStore>;
  let connectionUiStub: sinon.SinonStubbedInstance<ConnectionUI>;
  let originalConnectionManager: ConnectionManager;

  setup(async () => {
    sandbox = sinon.createSandbox();
    vscodeMssql = await activateExtension();
    mainController = await Extension.getController();

    connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
    connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
    connectionUiStub = sandbox.createStubInstance(ConnectionUI);

    sandbox
      .stub(connectionManagerStub, "connectionStore")
      .get(() => connectionStoreStub);
    sandbox
      .stub(connectionManagerStub, "connectionUI")
      .get(() => connectionUiStub);

    // the Extension class doesn't reinitialize the controller for each test,
    // so we need to save the original properties we swap here and restore then after each test.
    originalConnectionManager = mainController.connectionManager;
    mainController.connectionManager = connectionManagerStub;
  });

  teardown(() => {
    // restore mocked properties
    mainController.connectionManager = originalConnectionManager;
    sandbox.restore();
  });

  test("Gets sqlToolsServicePath", async () => {
    expect(vscodeMssql.sqlToolsServicePath).to.not.be.null;
  });

  test("promptForConnection", async () => {
    const testConnInfo: IConnectionInfo = {
      server: "testServer",
      database: "testDb",
    } as IConnectionInfo;

    const testQuickpickItem: IConnectionCredentialsQuickPickItem = {
      label: "test",
      connectionCreds: testConnInfo,
      quickPickItemType: CredentialsQuickPickItemType.Profile,
    } as IConnectionCredentialsQuickPickItem;

    connectionStoreStub.getPickListItems.resolves([testQuickpickItem]);
    connectionUiStub.promptForConnection.resolves(testConnInfo);

    const result = await vscodeMssql.promptForConnection(
      true /* ignoreFocusOut */,
    );
    expect(result.server).to.equal(testConnInfo.server);
    expect(
      connectionUiStub.promptForConnection,
    ).to.have.been.calledOnceWithExactly([testQuickpickItem], true);
  });

  /**
   * Since the runtime for the extension is using the esbuild version, we cannot correctly mock or
   * spy on the connect method of the MainController as the tests are executed on the tsc version.
   * For this reason, we skip this test for now.
   */
  test.skip("connect", async () => {
    const testConnInfo: IConnectionInfo = {
      server: "testServer",
      database: "testDb",
    } as IConnectionInfo;

    const mockMainController = sandbox.createStubInstance(MainController);

    // the Extension class doesn't reinitialize the controller for each test,
    // so we need to save the original controller here and restore it after the test.
    const originalMainController = Extension.controller;

    try {
      let passedUri: string | undefined;

      mockMainController.connect.callsFake(
        (
          uri: string,
          _connectionInfo: IConnectionInfo,
          _saveConnection?: boolean,
        ) => {
          passedUri = uri;
          return Promise.resolve(true);
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Extension as any).controller = mockMainController;

      const returnedUri = await vscodeMssql.connect(
        testConnInfo,
        false /* saveConnection */,
      );

      expect(returnedUri).to.equal(passedUri);
    } finally {
      // restore the Extension's original MainController for other tests
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Extension as any).controller = originalMainController;
    }
  });

  test("listDatabases", async () => {
    const testDatabaseList = ["AdventureWorks", "WideWorldImporters"];

    connectionManagerStub.listDatabases.resolves(testDatabaseList);

    const result = await vscodeMssql.listDatabases("test-uri");

    expect(
      connectionManagerStub.listDatabases,
    ).to.have.been.calledOnceWithExactly("test-uri");

    expect(result).to.deep.equal(testDatabaseList);
  });

  test.skip("getDatabaseNameFromTreeNode", () => {
    // Mock the ITreeNodeInfo object
    const mockTreeNode: ITreeNodeInfo = {
      nodeType: "Database",
      label: "TestDatabase",
    } as ITreeNodeInfo;

    const getDatabaseNameStub = sandbox
      .stub(ObjectExplorerUtils, "getDatabaseName")
      .withArgs(mockTreeNode)
      .returns("MockDatabase");

    try {
      const result = vscodeMssql.getDatabaseNameFromTreeNode(mockTreeNode);

      expect(result).to.equal("MockDatabase");
    } finally {
      getDatabaseNameStub.restore();
    }
  });

  test("getConnectionString", async () => {
    const mockConnectionString = "testConnectionString";

    connectionManagerStub.getConnectionString.resolves(mockConnectionString);

    const result = await vscodeMssql.getConnectionString(
      "test-uri",
      true,
      false,
    );

    expect(
      connectionManagerStub.getConnectionString,
    ).to.have.been.calledOnceWithExactly("test-uri", true, false);

    expect(result).to.equal(mockConnectionString);
  });

  test("createConnectionDetails", async () => {
    const testConnInfo: IConnectionInfo = {
      server: "testServer",
      database: "testDb",
    } as IConnectionInfo;

    connectionManagerStub.createConnectionDetails.returns({
      options: {
        server: "testServer",
        database: "testDb",
      },
    });

    const result = vscodeMssql.createConnectionDetails(testConnInfo);

    expect(
      connectionManagerStub.createConnectionDetails,
    ).to.have.been.calledOnceWithExactly(testConnInfo);

    expect(result.options.server).to.equal("testServer");
    expect(result.options.database).to.equal("testDb");
  });

  test("sendRequest", async () => {
    type TestParams = { testParam: string };
    type TestResponse = { success: boolean };
    const mockRequestType = {} as RequestType<
      TestParams,
      TestResponse,
      void,
      void
    >;
    const mockParams: TestParams = { testParam: "testValue" };
    const mockResponse: TestResponse = { success: true };

    connectionManagerStub.sendRequest.resolves(mockResponse);

    const result = await vscodeMssql.sendRequest(mockRequestType, mockParams);

    expect(
      connectionManagerStub.sendRequest,
    ).to.have.been.calledOnceWithExactly(mockRequestType, mockParams);

    expect(result).to.deep.equal(mockResponse);
  });

  test("getServerInfo", () => {
    const testConnInfo = {
      server: "testServer",
      database: "testDb",
    } as IConnectionInfo;

    const mockServerInfo = {
      serverVersion: "170",
      serverEdition: "Test Edition",
    } as IServerInfo;

    connectionManagerStub.getServerInfo.returns(mockServerInfo);

    const result = vscodeMssql.getServerInfo(testConnInfo);

    expect(
      connectionManagerStub.getServerInfo,
    ).to.have.been.calledOnceWithExactly(testConnInfo);

    expect(result.serverVersion).to.equal(mockServerInfo.serverVersion);
    expect(result.serverEdition).to.equal(mockServerInfo.serverEdition);
  });
});
