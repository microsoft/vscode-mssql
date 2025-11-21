/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from "chai";
import {
  StubStatusView,
  StubLogger,
  getServiceInstallDirectoryRoot,
  installService,
} from "../../src/languageservice/serviceInstallerUtil";
import * as sinon from "sinon";

suite("Stub Status View tests", function (): void {
  let stubStatusView: StubStatusView;
  let logStub: sinon.SinonSpy;

  this.beforeAll(function (): void {
    logStub = sinon.stub();
    stubStatusView = new StubStatusView(logStub);
  });

  this.afterAll(function (): void {
    sinon.restore();
  });

  test("Test installing service method", () => {
    stubStatusView.installingService();
    assert.isTrue(
      logStub.calledWith("..."),
      "Should print expected output to console",
    );
  });

  test("Test service installed method", () => {
    stubStatusView.serviceInstalled();
    assert.isTrue(
      logStub.calledWith("Service installed"),
      "Should print expected output to console",
    );
  });

  test("Test service installation failed method", () => {
    stubStatusView.serviceInstallationFailed();
    assert.isTrue(
      logStub.calledWith("Service installation failed"),
      "Should print expected output to console",
    );
  });

  test("Test update service downloading progress method", () => {
    stubStatusView.updateServiceDownloadingProgress(100);
    assert.isTrue(
      logStub.calledWith("100%"),
      "Should print expected output to console",
    );
  });
});

suite("Stub Logger tests", function (): void {
  let stubLogger: StubLogger;
  let logStub: sinon.SinonSpy;

  this.beforeEach(function (): void {
    logStub = sinon.stub();
    stubLogger = new StubLogger(logStub);
  });

  this.afterEach(function (): void {
    sinon.restore();
  });

  test("Test logdebug method", () => {
    stubLogger.logDebug("test");
    assert.isTrue(
      logStub.calledWith("test"),
      "Should print expected output to console",
    );
  });

  test("Test increaseIndent method", () => {
    stubLogger.increaseIndent();
    assert.isTrue(
      logStub.notCalled,
      "Should not have printed anything to console",
    );
  });

  test("Test decreaseIndent method", () => {
    stubLogger.decreaseIndent();
    assert.isTrue(
      logStub.notCalled,
      "Should not have printed anything to console",
    );
  });

  test("Test append method", () => {
    stubLogger.append("test");
    assert.isTrue(
      logStub.calledWith("test"),
      "Should print expected output to console",
    );
  });

  test("Test appendLine method", () => {
    stubLogger.appendLine("test");
    assert.isTrue(
      logStub.calledWith("test"),
      "Should print expected output to console",
    );
  });
});

suite("Test Service Installer Util functions", () => {
  test("Test getServiceInstallDirectoryRoot function", () => {
    let path = getServiceInstallDirectoryRoot();
    assert.isNotNull(path, "Service install directory root should not be null");
  });

  // test('Test getgetServiceInstallDirectory function', async () => {
  //     let dir = await getServiceInstallDirectory(undefined);
  //     assert.isNotNull(dir, 'Service install directory should not be null');
  // });

  test("Test installService function", async () => {
    let installedPath = await installService(undefined);
    assert.isNotNull(
      installedPath,
      "Service installed path should not be null",
    );
  });
});
