import * as TypeMoq from 'typemoq';
import assert = require('assert');
import ServiceDownloadProvider from '../src/languageservice/download';
import ServerProvider from '../src/languageservice/server';
import StatusView from './../src/views/statusView';
import Config from './../src/configurations/config';
import {ExtensionWrapper} from '../src/languageservice/extUtil';
import * as path from 'path';
import {Runtime} from '../src/models/platform';
import {IConfig, IStatusView, IExtensionWrapper} from '../src/languageservice/interfaces';

suite('Server tests', () => {

    let testDownloadProvider: TypeMoq.Mock<ServiceDownloadProvider>;
    let testStatusView: TypeMoq.Mock<IStatusView>;
    let testConfig: TypeMoq.Mock<IConfig>;
    let testVsCode: TypeMoq.Mock<IExtensionWrapper>;

    setup(() => {
        testDownloadProvider = TypeMoq.Mock.ofType(ServiceDownloadProvider, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(StatusView, TypeMoq.MockBehavior.Strict);
        testConfig = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
        testVsCode = TypeMoq.Mock.ofType(ExtensionWrapper, TypeMoq.MockBehavior.Strict);
    });

    test('findServerPath should return error given a folder with no installed service', () => {
        let installDir = __dirname;
        const platform = Runtime.Windows_7_64;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', 'exeFile2']);
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.findServerPath(installDir).then( result => {
            assert.equal(result, undefined);
        });
    });

    test('findServerPath should return the file path given a file that exists', () => {
        let installDir = __dirname;
        let fileName = path.join(installDir, __filename);
        const platform = Runtime.Windows_7_64;
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(result, fileName);
        });
    });

    test('findServerPath should not return the given file path if doesn not exist', () => {
        let installDir = __dirname;
        let fileName = path.join(installDir, __filename);
        const platform = Runtime.Windows_7_64;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', 'exeFile2']);
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(fileName, undefined);
        });
    });

    test('findServerPath should return a valid file path given a folder with installed service', () => {
        let installDir = __dirname;
        let fileName = __filename;
        const platform = Runtime.Windows_7_64;
        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => ['exeFile1', fileName]);
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');
        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.findServerPath(fileName).then( result => {
            assert.equal(result, path.join(installDir, fileName));
        });
    });

    test('getServerPath should download the service if not exist and return the valid service file path', () => {
        let installDir = __dirname;
        let fileName: string = __filename.replace(installDir, '');
        const platform = Runtime.Windows_7_64;
        let executables: string[]  = ['exeFile1'];

        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => executables);
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testStatusView.setup(x => x.serviceInstalled(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.installingService(TypeMoq.It.isAny()));
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');
        testDownloadProvider.setup(x => x.go(platform)).callback(() => {
            executables = [fileName];

        }).returns(() => { return Promise.resolve(true); });

        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.getServerPath(platform).then( result => {
            assert.equal(result, path.join(installDir, fileName));
        });
    });

    test('getServerPath should not download the service if already exist', () => {
        let installDir = __dirname;
        let fileName: string = __filename.replace(installDir, '');
        const platform = Runtime.Windows_7_64;
        let executables: string[]  = [fileName];

        testConfig.setup(x => x.getSqlToolsExecutableFiles()).returns(() => executables);
        testDownloadProvider.setup(x => x.getInstallDirectory(platform)).returns(() => installDir);
        testStatusView.setup(x => x.serviceInstalled(TypeMoq.It.isAny()));
        testStatusView.setup(x => x.installingService(TypeMoq.It.isAny()));
        testVsCode.setup(x => x.getActiveTextEditorUri()).returns(() => 'test');

        let server = new ServerProvider(testDownloadProvider.object, testConfig.object, testStatusView.object, testVsCode.object);

        server.getServerPath(platform).then( result => {
             assert.equal(result, path.join(installDir, fileName));
        });
    });
});
