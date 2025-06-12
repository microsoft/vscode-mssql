/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as assert from "assert";
import * as vscode from "vscode";
import ServerProvider from "../../src/languageservice/server";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { Logger, LogLevel } from "../../src/models/logger";
import { PlatformInformation } from "../../src/models/platform";
import StatusView from "../../src/views/statusView";
import * as LanguageServiceContracts from "../../src/models/contracts/languageService";
import { IConfig } from "../../src/languageservice/interfaces";
import ExtConfig from "../../src/configurations/extConfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

interface IFixture {
    platformInfo: PlatformInformation;
    installedServerPath: string;
    downloadedServerPath: string;
}

suite("Service Client tests", () => {
    let testConfig: TypeMoq.IMock<IConfig>;
    let testServiceProvider: TypeMoq.IMock<ServerProvider>;
    let logger = new Logger((text) => console.log(text), LogLevel.Verbose, false);
    let testStatusView: TypeMoq.IMock<StatusView>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(() => {
        testConfig = TypeMoq.Mock.ofType(ExtConfig, TypeMoq.MockBehavior.Loose);
        testServiceProvider = TypeMoq.Mock.ofType(ServerProvider, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(StatusView);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
    });

    function setupMocks(fixture: IFixture): void {
        testServiceProvider
            .setup((x) => x.downloadServerFiles(fixture.platformInfo.runtimeId))
            .returns(() => {
                return Promise.resolve(fixture.downloadedServerPath);
            });
        testServiceProvider
            .setup((x) => x.getServerPath(fixture.platformInfo.runtimeId))
            .returns(() => {
                return Promise.resolve(fixture.installedServerPath);
            });
    }

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("initializeForPlatform should not install the service if already exists", (done) => {
        let fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation("win32", "x86_64", undefined),
        };

        setupMocks(fixture);
        let serviceClient = new SqlToolsServiceClient(
            testConfig.object,
            testServiceProvider.object,
            logger,
            testStatusView.object,
            vscodeWrapper.object,
        );

        void serviceClient.initializeForPlatform(fixture.platformInfo, undefined).then((result) => {
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.installedServerPath);
            assert.equal(result.installedBeforeInitializing, false);
        });
        done();
    });

    test.skip("initializeForPlatform should install the service if not exists", (done) => {
        let fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: "downloaded service",
            platformInfo: new PlatformInformation("win32", "x86_64", undefined),
        };

        setupMocks(fixture);
        let serviceClient = new SqlToolsServiceClient(
            testConfig.object,
            testServiceProvider.object,
            logger,
            testStatusView.object,
            vscodeWrapper.object,
        );

        void serviceClient.initializeForPlatform(fixture.platformInfo, undefined).then((result) => {
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.downloadedServerPath);
            assert.equal(result.installedBeforeInitializing, true);
        });
        done();
    });

    test("initializeForPlatform should fail given unsupported platform", () => {
        let fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation("invalid platform", "x86_64", undefined),
        };

        setupMocks(fixture);
        let serviceClient = new SqlToolsServiceClient(
            testConfig.object,
            testServiceProvider.object,
            logger,
            testStatusView.object,
            vscodeWrapper.object,
        );

        return serviceClient
            .initializeForPlatform(fixture.platformInfo, undefined)
            .catch((error) => {
                return assert.equal(error, "Invalid Platform");
            });
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("initializeForPlatform should set v1 given mac 10.11 or lower", (done) => {
        let platformInfoMock = TypeMoq.Mock.ofInstance(
            new PlatformInformation("darwin", "x86_64", undefined),
        );
        platformInfoMock.callBase = true;
        platformInfoMock
            .setup((x) => x.isMacVersionLessThan(TypeMoq.It.isAnyString()))
            .returns(() => true);

        let fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: platformInfoMock.object,
        };

        let serviceVersion = 0;
        testConfig
            .setup((x) => x.useServiceVersion(TypeMoq.It.isAnyNumber()))
            .callback((num) => (serviceVersion = num));

        setupMocks(fixture);
        let serviceClient = new SqlToolsServiceClient(
            testConfig.object,
            testServiceProvider.object,
            logger,
            testStatusView.object,
            vscodeWrapper.object,
        );

        void serviceClient.initializeForPlatform(fixture.platformInfo, undefined).then((result) => {
            assert.equal(serviceVersion, 1);
            platformInfoMock.verify(
                (x) => x.isMacVersionLessThan(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            testConfig.verify((x) => x.useServiceVersion(1), TypeMoq.Times.once());
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.installedServerPath);
            assert.equal(result.installedBeforeInitializing, false);
        });
        done();
    });

    test.skip("initializeForPlatform should ignore service version given mac 10.12 or higher", (done) => {
        let platformInfoMock = TypeMoq.Mock.ofInstance(
            new PlatformInformation("darwin", "x86_64", undefined),
        );
        platformInfoMock.callBase = true;
        platformInfoMock
            .setup((x) => x.isMacVersionLessThan(TypeMoq.It.isAnyString()))
            .returns(() => false);

        let fixture: IFixture = {
            installedServerPath: "already installed service",
            downloadedServerPath: undefined,
            platformInfo: platformInfoMock.object,
        };

        let serviceVersion = 0;
        testConfig
            .setup((x) => x.useServiceVersion(TypeMoq.It.isAnyNumber()))
            .callback((num) => (serviceVersion = num));

        setupMocks(fixture);
        let serviceClient = new SqlToolsServiceClient(
            testConfig.object,
            testServiceProvider.object,
            logger,
            testStatusView.object,
            vscodeWrapper.object,
        );

        void serviceClient.initializeForPlatform(fixture.platformInfo, undefined).then((result) => {
            assert.equal(serviceVersion, 0);
            platformInfoMock.verify(
                (x) => x.isMacVersionLessThan(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            testConfig.verify((x) => x.useServiceVersion(1), TypeMoq.Times.never());
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.installedServerPath);
            assert.equal(result.installedBeforeInitializing, false);
        });
        done();
    });

    test("handleLanguageServiceStatusNotification should change the UI status", (done) => {
        return new Promise((resolve, reject) => {
            let fixture: IFixture = {
                installedServerPath: "already installed service",
                downloadedServerPath: undefined,
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };
            const testFile = "file:///my/test/file.sql";
            const status = "new status";

            setupMocks(fixture);
            let serviceClient = new SqlToolsServiceClient(
                testConfig.object,
                testServiceProvider.object,
                logger,
                testStatusView.object,
                vscodeWrapper.object,
            );
            let statusChangeParams = new LanguageServiceContracts.StatusChangeParams();
            statusChangeParams.ownerUri = testFile;
            statusChangeParams.status = status;
            serviceClient
                .handleLanguageServiceStatusNotification()
                .call(serviceClient, statusChangeParams);
            testStatusView.verify(
                (x) => x.languageServiceStatusChanged(testFile, status),
                TypeMoq.Times.once(),
            );
            done();
        });
    });

    test("initializeLanguageConfiguration should exclude @ from word separators for T-SQL variables", () => {
        // Mock vscode.languages.setLanguageConfiguration to capture the call
        const mockSetLanguageConfiguration = TypeMoq.Mock.ofType<typeof vscode.languages.setLanguageConfiguration>();
        let capturedLanguageId: string;
        let capturedConfiguration: vscode.LanguageConfiguration;
        
        // Override the setLanguageConfiguration method to capture arguments
        const originalSetLanguageConfiguration = vscode.languages.setLanguageConfiguration;
        vscode.languages.setLanguageConfiguration = (languageId: string, configuration: vscode.LanguageConfiguration) => {
            capturedLanguageId = languageId;
            capturedConfiguration = configuration;
            return { dispose: () => {} } as vscode.Disposable;
        };

        try {
            let fixture: IFixture = {
                installedServerPath: "test service path",
                downloadedServerPath: undefined,
                platformInfo: new PlatformInformation("win32", "x86_64", undefined),
            };

            setupMocks(fixture);
            let serviceClient = new SqlToolsServiceClient(
                testConfig.object,
                testServiceProvider.object,
                logger,
                testStatusView.object,
                vscodeWrapper.object,
            );

            // Call the private method using reflection to test language configuration
            (serviceClient as any).initializeLanguageConfiguration();

            // Verify that setLanguageConfiguration was called with correct parameters
            assert.equal(capturedLanguageId, "sql", "Language ID should be 'sql'");
            assert.notEqual(capturedConfiguration, undefined, "Language configuration should be defined");
            assert.notEqual(capturedConfiguration.wordSeparators, undefined, "Word separators should be defined");
            
            // Verify that @ is not in the word separators (so it will be part of T-SQL variable names)
            assert.equal(capturedConfiguration.wordSeparators!.includes("@"), false, "@ should not be included in word separators for T-SQL variables");
            
            // Verify that other common separators are still included
            assert.equal(capturedConfiguration.wordSeparators!.includes(" "), true, "Space should still be a word separator");
            assert.equal(capturedConfiguration.wordSeparators!.includes(","), true, "Comma should still be a word separator");
            assert.equal(capturedConfiguration.wordSeparators!.includes("."), true, "Period should still be a word separator");
        } finally {
            // Restore the original method
            vscode.languages.setLanguageConfiguration = originalSetLanguageConfiguration;
        }
    });
});
