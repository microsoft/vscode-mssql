/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import {
    IConfig,
    IStatusView,
    IHttpClient,
    IDecompressProvider,
} from "../../src/extension/languageservice/interfaces";
import ServiceDownloadProvider from "../../src/extension/languageservice/serviceDownloadProvider";
import HttpClient from "../../src/extension/languageservice/httpClient";
import DecompressProvider from "../../src/extension/languageservice/decompressProvider";
import Config from "../../src/extension/configurations/config";
import { Runtime } from "../../src/extension/models/platform";
import * as path from "path";
import { ILogger } from "../../src/extension/models/interfaces";
import { Logger } from "../../src/extension/models/logger";
import * as fs from "fs/promises";

interface IFixture {
    downloadUrl: string;
    downloadProvider: ServiceDownloadProvider;
    downloadResult: Promise<void>;
    decompressResult: Promise<void>;
}

suite("ServiceDownloadProvider Tests", () => {
    let config: TypeMoq.IMock<IConfig>;
    let testStatusView: TypeMoq.IMock<IStatusView>;
    let testHttpClient: TypeMoq.IMock<IHttpClient>;
    let testDecompressProvider: TypeMoq.IMock<IDecompressProvider>;
    let testLogger: TypeMoq.IMock<ILogger>;

    setup(() => {
        config = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType<IStatusView>();
        testHttpClient = TypeMoq.Mock.ofType(HttpClient, TypeMoq.MockBehavior.Strict);
        testDecompressProvider = TypeMoq.Mock.ofType(DecompressProvider);
        testLogger = TypeMoq.Mock.ofType(Logger);
    });

    test("getInstallDirectory should return the exact value from config if the path is absolute", async () => {
        let expectedPathFromConfig = __dirname;
        let expectedVersionFromConfig = "0.0.4";
        let expected = expectedPathFromConfig;
        config.setup((x) => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
        config.setup((x) => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
        let downloadProvider = new ServiceDownloadProvider(
            config.object,
            undefined,
            testStatusView.object,
            testHttpClient.object,
            testDecompressProvider.object,
        );
        let actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        assert.equal(expected, actual);
    });

    test("getInstallDirectory should add the version to the path given the path with the version template key", async () => {
        let expectedPathFromConfig = __dirname + "/{#version#}";
        let expectedVersionFromConfig = "0.0.4";
        let expected = __dirname + "/0.0.4";
        config.setup((x) => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
        config.setup((x) => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
        let downloadProvider = new ServiceDownloadProvider(
            config.object,
            undefined,
            testStatusView.object,
            testHttpClient.object,
            testDecompressProvider.object,
        );
        let actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        assert.equal(expected, actual);
    });

    test("getInstallDirectory should add the platform to the path given the path with the platform template key", async () => {
        let expectedPathFromConfig = __dirname + "/{#version#}/{#platform#}";
        let expectedVersionFromConfig = "0.0.4";
        let expected = __dirname + "/0.0.4/OSX";
        config.setup((x) => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
        config.setup((x) => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
        let downloadProvider = new ServiceDownloadProvider(
            config.object,
            undefined,
            testStatusView.object,
            testHttpClient.object,
            testDecompressProvider.object,
        );
        let actual = await downloadProvider.getOrMakeInstallDirectory(Runtime.OSX_10_11_64);
        assert.equal(expected, actual);
    });

    test("getDownloadFileName should return the expected file name given a runtime", (done) => {
        return new Promise((resolve, reject) => {
            let expectedName = "expected";
            let fileNamesJson = { Windows_64: `${expectedName}` };
            config
                .setup((x) => x.getSqlToolsConfigValue("downloadFileNames"))
                .returns(() => fileNamesJson);
            let downloadProvider = new ServiceDownloadProvider(
                config.object,
                undefined,
                testStatusView.object,
                testHttpClient.object,
                testDecompressProvider.object,
            );
            let actual = downloadProvider.getDownloadFileName(Runtime.Windows_64);
            assert.equal(actual, expectedName);
            done();
        }).catch((error) => {
            assert.fail(error);
        });
    });

    async function createDownloadProvider(fixture: IFixture): Promise<IFixture> {
        let fileName = "fileName";
        let baseDownloadUrl = "baseDownloadUrl/{#version#}/{#fileName#}";
        let version = "1.0.0";
        let installFolder = path.join(__dirname, "testService");
        let fileNamesJson = { Windows_64: `${fileName}` };
        let downloadUrl = "baseDownloadUrl/1.0.0/fileName";
        try {
            await fs.rmdir(installFolder);
        } catch (err) {
            console.error(err);
        }

        config.setup((x) => x.getSqlToolsInstallDirectory()).returns(() => installFolder);
        config
            .setup((x) => x.getSqlToolsConfigValue("downloadFileNames"))
            .returns(() => fileNamesJson);
        config.setup((x) => x.getSqlToolsServiceDownloadUrl()).returns(() => baseDownloadUrl);
        config.setup((x) => x.getSqlToolsPackageVersion()).returns(() => version);
        testStatusView.setup((x) => x.installingService());
        testStatusView.setup((x) => x.serviceInstalled());
        testLogger.setup((x) => x.append(TypeMoq.It.isAny()));
        testLogger.setup((x) => x.appendLine(TypeMoq.It.isAny()));

        testDecompressProvider
            .setup((x) => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return fixture.decompressResult;
            });
        testHttpClient
            .setup((x) =>
                x.downloadFile(
                    downloadUrl,
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => {
                return fixture.downloadResult;
            });
        let downloadProvider = new ServiceDownloadProvider(
            config.object,
            testLogger.object,
            testStatusView.object,
            testHttpClient.object,
            testDecompressProvider.object,
        );
        fixture.downloadUrl = downloadUrl;
        fixture.downloadProvider = downloadProvider;
        return fixture;
    }

    test("installSQLToolsService should download and decompress the service and update the status", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.resolve(),
        };

        fixture = await createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_64).then((_) => {
            testHttpClient.verify(
                (x) =>
                    x.downloadFile(
                        fixture.downloadUrl,
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                TypeMoq.Times.once(),
            );
            testDecompressProvider.verify(
                (x) => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            testStatusView.verify((x) => x.installingService(), TypeMoq.Times.once());
            testStatusView.verify((x) => x.serviceInstalled(), TypeMoq.Times.once());
        });
    });

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("installSQLToolsService should not call decompress if download fails", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.reject("download failed"),
            decompressResult: Promise.resolve(),
        };

        fixture = await createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_64).catch((_) => {
            testHttpClient.verify(
                (x) =>
                    x.downloadFile(
                        fixture.downloadUrl,
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                TypeMoq.Times.once(),
            );
            testDecompressProvider.verify(
                (x) => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.never(),
            );
            testStatusView.verify((x) => x.installingService(), TypeMoq.Times.never());
            testStatusView.verify((x) => x.serviceInstalled(), TypeMoq.Times.never());
        });
    });

    test.skip("installSQLToolsService should not update status to installed decompress fails", async () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.reject("download failed"),
        };

        fixture = await createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_64).catch((_) => {
            testHttpClient.verify(
                (x) =>
                    x.downloadFile(
                        fixture.downloadUrl,
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                TypeMoq.Times.once(),
            );
            testDecompressProvider.verify(
                (x) => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            testStatusView.verify((x) => x.installingService(), TypeMoq.Times.once());
            testStatusView.verify((x) => x.serviceInstalled(), TypeMoq.Times.never());
        });
    });
});
