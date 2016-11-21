import assert = require('assert');
import * as TypeMoq from 'typemoq';
import {IConfig} from '../src/languageservice/interfaces';
import ServiceDownloadProvider from '../src/languageservice/download';
import Config from  '../src/configurations/config';
import * as Platform from '../src/models/platform';
import * as path from 'path';

suite('ServiceDownloadProvider Tests', () => {
    let config: TypeMoq.Mock<IConfig>;

    setup(() => {
        config = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
    });

    test('getInstallDirectory should return the exact value from config if the path is absolute', (done) => {
        return new Promise((resolve, reject) => {
            let expectedPathFromConfig = __dirname;
            let expectedVersionFromConfig = '0.0.4';
            let expected = expectedPathFromConfig;
            config.setup(x => x.getSqlToolsInstallDirectory()).returns(() => expectedPathFromConfig);
            config.setup(x => x.getSqlToolsPackageVersion()).returns(() => expectedVersionFromConfig);
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined);
            let actual = downloadProvider.getInstallDirectory(Platform.Runtime.OSX_10_11_64);
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
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined);
            let actual = downloadProvider.getInstallDirectory(Platform.Runtime.OSX_10_11_64);
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
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined);
            let actual = downloadProvider.getInstallDirectory(Platform.Runtime.OSX_10_11_64);
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
            let downloadProvider = new ServiceDownloadProvider(config.object, undefined);
            let actual = downloadProvider.getInstallDirectory(Platform.Runtime.OSX_10_11_64);
            assert.equal(expected, actual);
            done();
         });
    });

});
