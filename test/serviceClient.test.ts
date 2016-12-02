import * as TypeMoq from 'typemoq';
import assert = require('assert');
import ServerProvider from '../src/languageservice/server';
import SqlToolsServiceClient from '../src/languageservice/serviceClient';
import {Logger} from '../src/models/logger';
import {PlatformInformation} from '../src/models/platform';

interface IFixture {
    platformInfo: PlatformInformation;
    installedServerPath: string;
    downloadedServerPath: string;
}

suite('Service Client tests', () => {

    let testServiceProvider: TypeMoq.Mock<ServerProvider>;
    let logger = new Logger(text => console.log(text));

    setup(() => {
        testServiceProvider = TypeMoq.Mock.ofType(ServerProvider, TypeMoq.MockBehavior.Strict);
    });

    function setupMocks(fixture: IFixture): void {
        testServiceProvider.setup(x => x.downloadServerFiles(fixture.platformInfo.runtimeId)).returns(() => {
            return Promise.resolve(fixture.downloadedServerPath);
        });
        testServiceProvider.setup(x => x.getServerPath(fixture.platformInfo.runtimeId)).returns(() => {
            return Promise.resolve(fixture.installedServerPath);
        });
    }

    test('initializeForPlatform should not install the service if already exists', () => {
        let fixture: IFixture = {
            installedServerPath: 'already installed service',
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
        };

        setupMocks(fixture);
        let serviceClinet = new SqlToolsServiceClient(testServiceProvider.object, logger);

        return serviceClinet.initializeForPlatform(fixture.platformInfo, undefined).then( result => {
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.installedServerPath);
            assert.equal(result.installedBeforeInitializing, false);
        });
    });

    test('initializeForPlatform should install the service if not exists', () => {
        let fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: 'downloaded service',
            platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
        };

        setupMocks(fixture);
        let serviceClinet = new SqlToolsServiceClient(testServiceProvider.object, logger);

        return serviceClinet.initializeForPlatform(fixture.platformInfo, undefined).then( result => {
            assert.notEqual(result, undefined);
            assert.equal(result.serverPath, fixture.downloadedServerPath);
            assert.equal(result.installedBeforeInitializing, true);
        });
    });

    test('initializeForPlatform should fails given unsupported platform', () => {
        let fixture: IFixture = {
            installedServerPath: 'already installed service',
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation('invalid platform', 'x86_64', undefined)
        };

        setupMocks(fixture);
        let serviceClinet = new SqlToolsServiceClient(testServiceProvider.object, logger);

        return serviceClinet.initializeForPlatform(fixture.platformInfo, undefined).catch( error => {
            return assert.equal(error, 'Invalid Platform');
        });
    });
});
