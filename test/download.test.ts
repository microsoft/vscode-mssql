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


    test('getDownloadFileName should return the expected file name given a runtime 2', (done) => {

             let fileName = 'fileName';
             let baseDownloadUrl = 'baseDownloadUrl/{#version#}/{#fileName#}';
             let downloadUrl = 'baseDownloadUrl/1.0.0/fileName#';
             let version = '1.0.0';
             let fileNamesJson = {Windows_7_64: `${fileName}`};
             config.setup(x => x.getSqlToolsConfigValue('downloadFileNames')).returns(() => fileNamesJson);
             config.setup(x => x.getSqlToolsServiceDownloadUrl()).returns(() => baseDownloadUrl);
             config.setup(x => x.getSqlToolsPackageVersion()).returns(() => version);
             testLogger.setup(x => x.append(TypeMoq.It.isAny()));
             testLogger.setup(x => x.appendLine(TypeMoq.It.isAny()));

             testDecompressProvider.setup(x => x.decompress(TypeMoq.It.isAny(), testLogger.object, testStatusView.object))
             .returns(() => { return Promise.resolve(); });
             testHttpClient.setup(x => x.downloadFile(downloadUrl, TypeMoq.It.isAny(), testLogger.object, testStatusView.object, undefined, undefined))
             .returns(() => { return Promise.resolve(); });


             let downloadProvider = new ServiceDownloadProvider(config.object, testLogger.object, testStatusView.object,
             testHttpClient.object, testDecompressProvider.object);
             return downloadProvider.installSQLToolsService(Runtime.Windows_7_64).then(_ => {
                testHttpClient.verify(x => x.downloadFile(downloadUrl, TypeMoq.It.isAny(), testLogger.object, testStatusView.object, undefined, undefined),
                TypeMoq.Times.once());

                testDecompressProvider.verify(x => x.decompress(TypeMoq.It.isAny(), testLogger.object, testStatusView.object),
                TypeMoq.Times.once());

            }).catch( error => {
                assert.fail(error);
            });
    });
});
