import assert = require('assert');
import * as TypeMoq from 'typemoq';
import {IConfig, IStatusView, IHttpClient, IDecompressProvider} from '../src/languageservice/interfaces';
import ServiceDownloadProvider from '../src/languageservice/serviceDownloadProvider';
import HttpClient from '../src/languageservice/httpClient';
import DecompressProvider from '../src/languageservice/decompressProvider';
import Config from  '../src/configurations/config';
import {ServerStatusView} from '../src/languageservice/serverStatus';
import {Runtime} from '../src/models/platform';
import * as path from 'path';
import  {ILogger} from '../src/models/interfaces';
import {Logger} from '../src/models/logger';
let fse = require('fs-extra');

interface IFixture {
    downloadUrl: string;
    downloadProvider: ServiceDownloadProvider;
    downloadResult: Promise<void>;
    decompressResult: Promise<void>;
}

suite('ServiceDownloadProvider Tests', () => {
    let config: TypeMoq.Mock<IConfig>;
    let testStatusView: TypeMoq.Mock<IStatusView>;
    let testHttpClient: TypeMoq.Mock<IHttpClient>;
    let testDecompressProvider: TypeMoq.Mock<IDecompressProvider>;
    let testLogger: TypeMoq.Mock<ILogger>;

    setup(() => {
        config = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(ServerStatusView, TypeMoq.MockBehavior.Strict);
        testHttpClient = TypeMoq.Mock.ofType(HttpClient, TypeMoq.MockBehavior.Strict);
        testDecompressProvider = TypeMoq.Mock.ofType(DecompressProvider);
        testLogger = TypeMoq.Mock.ofType(Logger);
    });

    test('getInstallDirectory should return the exact value from config if the path is absolute', (done) => {
        return new Promise((resolve, reject) => {
            let expectedPathFromConfig = __dirname;
            let expectedVersionFromConfig = '0.0.4';
            let expected = expectedPathFromConfig;
            config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
            config.setup(x => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined, testStatusView.object,
            testHttpClient.object, testDecompressProvider.object);
            let actual = downloadProvider.getInstallDirectory(Runtime.OSX_10_11_64);
            assert.equal(expected, actual);
            done();
         });
    });

    test('getInstallDirectory should add the version to the path given the path with the version template key', (done) => {
        return new Promise((resolve, reject) => {
            let expectedPathFromConfig = __dirname + '/{#version#}';
            let expectedVersionFromConfig = '0.0.4';
            let expected =  __dirname + '/0.0.4';
            config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
            config.setup(x => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined, testStatusView.object,
            testHttpClient.object, testDecompressProvider.object);
            let actual = downloadProvider.getInstallDirectory(Runtime.OSX_10_11_64);
            assert.equal(expected, actual);
            done();
         });
    });

    test('getInstallDirectory should add the platform to the path given the path with the platform template key', (done) => {
        return new Promise((resolve, reject) => {
            let expectedPathFromConfig = __dirname + '/{#version#}/{#platform#}';
            let expectedVersionFromConfig = '0.0.4';
            let expected = __dirname + '/0.0.4/OSX';
            config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
            config.setup(x => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined, testStatusView.object,
            testHttpClient.object, testDecompressProvider.object);
            let actual = downloadProvider.getInstallDirectory(Runtime.OSX_10_11_64);
            assert.equal(expected, actual);
            done();
         });
    });

    test('getInstallDirectory should add the platform to the path given the path with the platform template key', (done) => {
        return new Promise((resolve, reject) => {
            let expectedPathFromConfig = '../service/{#version#}/{#platform#}';
            let expectedVersionFromConfig = '0.0.4';
            let expected = path.join(__dirname, '../../service/0.0.4/OSX');
            config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
            config.setup(x => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined, testStatusView.object,
            testHttpClient.object, testDecompressProvider.object);
            let actual = downloadProvider.getInstallDirectory(Runtime.OSX_10_11_64);
            assert.equal(expected, actual);
            done();
         });
    });


    test('getDownloadFileName should return the expected file name given a runtime', (done) => {
         return new Promise((resolve, reject) => {
             let expectedName = 'expected';
             let fileNamesJson = {Windows_7_64: `${expectedName}`};
             config.setup(x => x.getSqlToolsConfigValue('downloadFileNames')).returns(() => fileNamesJson);
             let downloadProvider = new ServiceDownloadProvider(config.object, undefined, testStatusView.object,
             testHttpClient.object, testDecompressProvider.object);
             let actual = downloadProvider.getDownloadFileName(Runtime.Windows_7_64);
             assert.equal(actual, expectedName);
             done();
         }).catch( error => {
             assert.fail(error);
         });
    });

    function createDownloadProvider(fixture: IFixture): IFixture {
             let fileName = 'fileName';
             let baseDownloadUrl = 'baseDownloadUrl/{#version#}/{#fileName#}';
             let version = '1.0.0';
             let installFolder = path.join(__dirname, 'testService');
             let fileNamesJson = {Windows_7_64: `${fileName}`};
             let downloadUrl = 'baseDownloadUrl/1.0.0/fileName';
             fse.remove(installFolder, function(err): void {
                if (err) {
                    return console.error(err);
                }
             });

             config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => installFolder);
             config.setup(x => x.getSqlToolsConfigValue('downloadFileNames')).returns(() => fileNamesJson);
             config.setup(x => x.getSqlToolsServiceDownloadUrl()).returns(() => baseDownloadUrl);
             config.setup(x => x.getSqlToolsPackageVersion()).returns(() => version);
             config.setup(x => x.getWorkspaceConfig('http.proxy')).returns(() => <any>'proxy');
             config.setup(x => x.getWorkspaceConfig('http.proxyStrictSSL', true)).returns(() => <any>true);
             config.setup(x => x.getWorkspaceConfig('http.proxyAuthorization')).returns(() => '');
             testStatusView.setup(x => x.installingService());
             testStatusView.setup(x => x.serviceInstalled());
             testLogger.setup(x => x.append(TypeMoq.It.isAny()));
             testLogger.setup(x => x.appendLine(TypeMoq.It.isAny()));

             testDecompressProvider.setup(x => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
             .returns(() => { return fixture.decompressResult; });
             testHttpClient.setup(x => x.downloadFile(downloadUrl, TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(),
             TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
             .returns(() => { return fixture.downloadResult; });
             let downloadProvider = new ServiceDownloadProvider(config.object, testLogger.object, testStatusView.object,
             testHttpClient.object, testDecompressProvider.object);
             fixture.downloadUrl = downloadUrl;
             fixture.downloadProvider = downloadProvider;
             return fixture;
    }

    test('installSQLToolsService should download and decompress the service and update the status', () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.resolve()
        };

        fixture = createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_7_64).then(_ => {
            testHttpClient.verify(x => x.downloadFile(fixture.downloadUrl, TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(),
            TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once());
            testDecompressProvider.verify(x => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once());
            testStatusView.verify(x => x.installingService(), TypeMoq.Times.once());
            testStatusView.verify(x => x.serviceInstalled(), TypeMoq.Times.once());
        });
    });

    test('installSQLToolsService should not call decompress if download fails', () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.reject('download failed'),
            decompressResult: Promise.resolve()
        };

        fixture = createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_7_64).catch(_ => {
            testHttpClient.verify(x => x.downloadFile(fixture.downloadUrl, TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(),
            TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once());
            testDecompressProvider.verify(x => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never());
            testStatusView.verify(x => x.installingService(), TypeMoq.Times.never());
            testStatusView.verify(x => x.serviceInstalled(), TypeMoq.Times.never());
        });
    });

    test('installSQLToolsService should not update status to installed decompress fails', () => {
        let fixture: IFixture = {
            downloadUrl: undefined,
            downloadProvider: undefined,
            downloadResult: Promise.resolve(),
            decompressResult: Promise.reject('download failed')
        };

        fixture = createDownloadProvider(fixture);
        return fixture.downloadProvider.installSQLToolsService(Runtime.Windows_7_64).catch(_ => {
            testHttpClient.verify(x => x.downloadFile(fixture.downloadUrl, TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(),
            TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once());
            testDecompressProvider.verify(x => x.decompress(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once());
            testStatusView.verify(x => x.installingService(), TypeMoq.Times.once());
            testStatusView.verify(x => x.serviceInstalled(), TypeMoq.Times.never());
        });
    });
});
