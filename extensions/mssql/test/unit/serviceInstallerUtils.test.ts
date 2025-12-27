/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import {
    StubStatusView,
    StubLogger,
    getServiceInstallDirectoryRoot,
    installService,
} from "../../src/languageservice/serviceInstallerUtil";
import * as sinon from "sinon";

chai.use(sinonChai);

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
        expect(logStub, "Should print expected output to console").to.have.been.calledWith("...");
    });

    test("Test service installed method", () => {
        stubStatusView.serviceInstalled();
        expect(logStub, "Should print expected output to console").to.have.been.calledWith(
            "Service installed",
        );
    });

    test("Test service installation failed method", () => {
        stubStatusView.serviceInstallationFailed();
        expect(logStub, "Should print expected output to console").to.have.been.calledWith(
            "Service installation failed",
        );
    });

    test("Test update service downloading progress method", () => {
        stubStatusView.updateServiceDownloadingProgress(100);
        expect(logStub, "Should print expected output to console").to.have.been.calledWith("100%");
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
        expect(logStub, "Should print expected output to console").to.have.been.calledWith("test");
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
        expect(logStub, "Should print expected output to console").to.have.been.calledWith("test");
    });

    test("Test appendLine method", () => {
        stubLogger.appendLine("test");
        expect(logStub, "Should print expected output to console").to.have.been.calledWith("test");
    });
});

suite("Test Service Installer Util functions", () => {
    test("Test getServiceInstallDirectoryRoot function", () => {
        let path = getServiceInstallDirectoryRoot();
        expect(path, "Service install directory root should not be null").to.not.be.null;
    });

    // test('Test getgetServiceInstallDirectory function', async () => {
    //     let dir = await getServiceInstallDirectory(undefined);
    //     expect(dir, 'Service install directory should not be null').to.not.be.null;
    // });

    test("Test installService function", async () => {
        let installedPath = await installService(undefined);
        expect(installedPath, "Service installed path should not be null").to.not.be.null;
    });
});
