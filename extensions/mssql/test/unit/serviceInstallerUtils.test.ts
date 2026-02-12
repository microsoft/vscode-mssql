/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { StubStatusView } from "../../src/languageservice/serviceInstallerUtil";
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
