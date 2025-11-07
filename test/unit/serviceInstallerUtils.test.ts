/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
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
        expect(logStub.calledWith("..."), "Should print expected output to console").to.be.true;
    });

    test("Test service installed method", () => {
        stubStatusView.serviceInstalled();
        expect(logStub.calledWith("Service installed"), "Should print expected output to console")
            .to.be.true;
    });

    test("Test service installation failed method", () => {
        stubStatusView.serviceInstallationFailed();
        expect(
            logStub.calledWith("Service installation failed"),
            "Should print expected output to console",
        ).to.be.true;
    });

    test("Test update service downloading progress method", () => {
        stubStatusView.updateServiceDownloadingProgress(100);
        expect(logStub.calledWith("100%"), "Should print expected output to console").to.be.true;
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
        expect(logStub.calledWith("test"), "Should print expected output to console").to.be.true;
    });

    test("Test increaseIndent method", () => {
        stubLogger.increaseIndent();
        expect(logStub.notCalled, "Should not have printed anything to console").to.be.true;
    });

    test("Test decreaseIndent method", () => {
        stubLogger.decreaseIndent();
        expect(logStub.notCalled, "Should not have printed anything to console").to.be.true;
    });

    test("Test append method", () => {
        stubLogger.append("test");
        expect(logStub.calledWith("test"), "Should print expected output to console").to.be.true;
    });

    test("Test appendLine method", () => {
        stubLogger.appendLine("test");
        expect(logStub.calledWith("test"), "Should print expected output to console").to.be.true;
    });
});

suite("Test Service Installer Util functions", () => {
    test("Test getServiceInstallDirectoryRoot function", () => {
        let path = getServiceInstallDirectoryRoot();
        expect(path, "Service install directory root should not be null").to.not.be.null;
    });

    // test('Test getgetServiceInstallDirectory function', async () => {
    //     let dir = await getServiceInstallDirectory(undefined);
    //     assert.isNotNull(dir, 'Service install directory should not be null');
    // });

    test("Test installService function", async () => {
        let installedPath = await installService(undefined);
        expect(installedPath, "Service installed path should not be null").to.not.be.null;
    });
});
