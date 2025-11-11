/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import ServerProvider from "../../src/languageservice/server";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Logger, LogLevel } from "../../src/models/logger";
import { PlatformInformation } from "../../src/models/platform";
import StatusView from "../../src/views/statusView";
import * as LanguageServiceContracts from "../../src/models/contracts/languageService";
import ExtConfig from "../../src/configurations/extConfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

interface IFixture {
    platformInfo: PlatformInformation;
    installedServerPath: string | undefined;
    downloadedServerPath: string | undefined;
}

suite("Service Client tests", () => {
    let sandbox: sinon.SinonSandbox;
    let testConfig: sinon.SinonStubbedInstance<ExtConfig>;
    let testServiceProvider: sinon.SinonStubbedInstance<ServerProvider>;
    const logger = new Logger((text) => console.log(text), LogLevel.Verbose, false);
    let testStatusView: sinon.SinonStubbedInstance<StatusView>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();
        testConfig = sandbox.createStubInstance(ExtConfig);
        testServiceProvider = sandbox.createStubInstance(ServerProvider);
        testStatusView = sandbox.createStubInstance(StatusView);
        vscodeWrapper = stubVscodeWrapper(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    function createServiceClient(): SqlToolsServiceClient {
        return new SqlToolsServiceClient(
            testConfig,
            testServiceProvider,
            logger,
            testStatusView,
            vscodeWrapper,
        );
    }

    function setupMocks(fixture: IFixture): void {
        if (fixture.downloadedServerPath === undefined) {
            testServiceProvider.downloadServerFiles.rejects(
                new Error("downloadServerFiles should not be called"),
            );
        } else {
            testServiceProvider.downloadServerFiles.resolves(fixture.downloadedServerPath);
        }
        testServiceProvider.getServerPath.resolves(fixture.installedServerPath);
    }

    test.skip("initializeForPlatform should not install the service if already exists", async () => {
        const fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation("win32", "x86_64", undefined),
        };

        setupMocks(fixture);
        const serviceClient = createServiceClient();

        const result = await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

        expect(result).to.not.be.undefined;
        expect(result?.serverPath).to.equal(fixture.installedServerPath);
        expect(result?.installedBeforeInitializing).to.be.false;
    });

    test.skip("initializeForPlatform should install the service if not exists", async () => {
        const fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: "downloaded service",
            platformInfo: new PlatformInformation("win32", "x86_64", undefined),
        };

        setupMocks(fixture);
        const serviceClient = createServiceClient();

        const result = await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

        expect(result).to.not.be.undefined;
        expect(result?.serverPath).to.equal(fixture.downloadedServerPath);
        expect(result?.installedBeforeInitializing).to.be.true;
    });

    test("initializeForPlatform should fail given unsupported platform", async () => {
        const fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation("invalid platform", "x86_64", undefined),
        };

        setupMocks(fixture);
        const serviceClient = createServiceClient();

        try {
            await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);
            expect.fail("Expected initializeForPlatform to throw for an invalid platform");
        } catch (error) {
            expect(error).to.equal("Invalid Platform");
        }
    });

    test.skip("initializeForPlatform should set v1 given mac 10.11 or lower", async () => {
        const platformInfo = new PlatformInformation("darwin", "x86_64", undefined);
        const isMacVersionLessThan = sandbox
            .stub(platformInfo, "isMacVersionLessThan")
            .returns(true);

        const fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo,
        };

        setupMocks(fixture);
        const serviceClient = createServiceClient();

        const result = await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

        expect(isMacVersionLessThan).to.have.been.calledOnce;
        expect(testConfig.useServiceVersion).to.have.been.calledOnceWithExactly(1);
        expect(result).to.not.be.undefined;
        expect(result?.serverPath).to.equal(fixture.installedServerPath);
        expect(result?.installedBeforeInitializing).to.be.false;
    });

    test.skip("initializeForPlatform should ignore service version given mac 10.12 or higher", async () => {
        const platformInfo = new PlatformInformation("darwin", "x86_64", undefined);
        const isMacVersionLessThan = sandbox
            .stub(platformInfo, "isMacVersionLessThan")
            .returns(false);

        const fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo,
        };

        setupMocks(fixture);
        const serviceClient = createServiceClient();

        const result = await serviceClient.initializeForPlatform(fixture.platformInfo, undefined);

        expect(isMacVersionLessThan).to.have.been.calledOnce;
        expect(testConfig.useServiceVersion).to.not.have.been.called;
        expect(result).to.not.be.undefined;
        expect(result?.serverPath).to.equal(fixture.installedServerPath);
        expect(result?.installedBeforeInitializing).to.be.false;
    });

    test("handleLanguageServiceStatusNotification should change the UI status", () => {
        const fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation("win32", "x86_64", undefined),
        };
        const testFile = "file:///my/test/file.sql";
        const status = "new status";

        setupMocks(fixture);
        const serviceClient = createServiceClient();
        const statusChangeParams = new LanguageServiceContracts.StatusChangeParams();
        statusChangeParams.ownerUri = testFile;
        statusChangeParams.status = status;

        serviceClient
            .handleLanguageServiceStatusNotification()
            .call(serviceClient, statusChangeParams);

        expect(testStatusView.languageServiceStatusChanged).to.have.been.calledOnceWithExactly(
            testFile,
            status,
        );
    });
});
