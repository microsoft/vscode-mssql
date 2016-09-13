import * as TypeMoq from 'typemoq';
import assert = require('assert');
import ServiceDownloadProvider from '../src/languageservice/download';
import ServerProvider from '../src/languageservice/server';
import StatusView from './../src/views/statusView';
import Config from './../src/configurations/config';
import * as path from 'path';
import {getCurrentPlatform} from '../src/models/platform';

suite('Server tests', () => {

    let testDownloadProvider: TypeMoq.Mock<ServiceDownloadProvider>;
    let testStatusView: TypeMoq.Mock<StatusView>;
    let testConfig: TypeMoq.Mock<Config>;

    setup(() => {
        testDownloadProvider = TypeMoq.Mock.ofType(ServiceDownloadProvider, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Strict);
        testConfig = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
    });

    test('findServerPath should return error given a folder with no installed service', () => {
        let installDir = __dirname;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', 'exeFile2']);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.findServerPath(installDir).then( result => {
            assert.equal(result, undefined);
        });
    });

    test('findServerPath should return error given a folder with no installed service', () => {
        let installDir = __dirname;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', 'exeFile2']);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.findServerPath(installDir).then( result => {
            assert.equal(result, undefined);
        });
    });

    test('findServerPath should return the file path given a file that exists', () => {
        let installDir = __dirname;
        let fileName = path.join(installDir, __filename);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(result, fileName);
        });
    });

    test('findServerPath should not return the given file path if doesn not exist', () => {
        let installDir = __dirname;
        let fileName = path.join(installDir, __filename);
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', 'exeFile2']);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(fileName, undefined);
        });
    });

    test('findServerPath should return a valid file path given a folder with installed service', () => {
        let installDir = __dirname;
        let fileName = __filename;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', fileName]);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(result, path.join(installDir, fileName));
        });
    });

    test('getServerPath should download the service if not exist and return the valid service file path', () => {
        let installDir = __dirname;
        let fileName: string = __filename.replace(installDir, '');
        const platform = getCurrentPlatform();
        let executables: string[]  = ['exeFile1'];

        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => executables);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        testStatusView.setup(x => x.serviceInstalled(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.installingService(TypeMoq.It.isAny()));
        testDownloadProvider.setup(x => x.go(platform)).callback(() => {
            executables = [fileName];

        }).returns(() => { return Promise.resolve(true); });

        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.getServerPath().then( result => {
            assert.equal(result, path.join(installDir, fileName));
        });
    });

    test('getServerPath should not download the service if already exist', () => {
        let installDir = __dirname;
        let fileName: string = __filename.replace(installDir, '');
        let executables: string[]  = [fileName];

        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => executables);
        testDownloadProvider.setup(x => x.getInstallDirectory()).returns(() => installDir);
        testStatusView.setup(x => x.serviceInstalled(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.installingService(TypeMoq.It.isAny()));

        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object);

        server.getServerPath().then( result => {
             assert.equal(result, path.join(installDir, fileName));
        });
    });
});
