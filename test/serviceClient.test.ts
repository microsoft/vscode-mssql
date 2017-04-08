import * as TypeMoq from 'typemoq';
import assert = require('assert');
import ServerProvider from '../src/languageservice/server';
import SqlToolsServiceClient from '../src/languageservice/serviceclient';
import {InitializationState} from '../src/languageservice/serviceclient';
import {Logger} from '../src/models/logger';
import {PlatformInformation} from '../src/models/platform';
import StatusView from './../src/views/statusView';
import * as LanguageServiceContracts from '../src/models/contracts/languageService';

interface IFixture {
    platformInfo: PlatformInformation;
    installedServerPath: string;
    downloadedServerPath: string;
}

suite('Service Client tests', () => {

    let testServiceProvider: TypeMoq.Mock<ServerProvider>;
    let logger = new Logger(text => console.log(text));
    let testStatusView: TypeMoq.Mock<StatusView>;

    setup(() => {
        testServiceProvider = TypeMoq.Mock.ofType(ServerProvider, TypeMoq.MockBehavior.Strict);
        testStatusView = TypeMoq.Mock.ofType(StatusView);
    });

    function setupMocks(fixture: IFixture): void {
        testServiceProvider.setup(x => x.downloadServerFiles(fixture.platformInfo.runtimeId)).returns(() => {
            return Promise.resolve(fixture.downloadedServerPath);
        });
        testServiceProvider.setup(x => x.getServerPath(fixture.platformInfo.runtimeId)).returns(() => {
            return Promise.resolve(fixture.installedServerPath);
        });
    }

    test('initializeWithPlatform should not install the service if already exists', () => {
        // Setup:
        // ... Create a fixture that mocks an already installed service
        let fixture: IFixture = {
            installedServerPath: 'already installed service',
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
        };
        setupMocks(fixture);

        // ... Create an initialization state object with the platform info
        let initState: InitializationState = new InitializationState(fixture.platformInfo);

        // If: I initialize a new tools service with valid state
        let serviceClient = new SqlToolsServiceClient(testServiceProvider.object, logger, testStatusView.object);
        return serviceClient.initializeWithPlatform(initState).then( result => {
            // Then:
            // ... A state object should be returned with a client obj, a result, and platform info
            assert.notEqual(result, undefined);
            assert.notEqual(result.client, undefined);
            assert.notEqual(result.clientResult, undefined);

            // ... The result must indicate that the client isn't running, was not installed
            assert.equal(result.clientResult.serverPath, fixture.installedServerPath);
            assert.equal(result.clientResult.installedBeforeInitializing, false);
            assert.equal(result.clientResult.isRunning, false);
        }).catch(error => {
            assert.fail(error, undefined, 'initialize promise was rejected');
        });
    });

    test('initializeWithPlatform should install the service if not exists', () => {
        // Setup:
        // ... Create a fixture that mocks a not installed service
        let fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: 'potential',
            platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
        };
        setupMocks(fixture);

        // ... Create an initialization state object with the platform info
        let initState: InitializationState = new InitializationState(fixture.platformInfo);

        // If: I initialize a new tools service with valid state
        let serviceClient = new SqlToolsServiceClient(testServiceProvider.object, logger, testStatusView.object);
        return serviceClient.initializeWithPlatform(initState).then( result => {
            // Then:
            // ... A state object should be returned with a client obj, a result, and platform info
            assert.notEqual(result, undefined);
            assert.notEqual(result.client, undefined);
            assert.notEqual(result.clientResult, undefined);

            // ... The result must indicate that the client isn't running, was installed
            assert.equal(result.clientResult.serverPath, fixture.downloadedServerPath);
            assert.equal(result.clientResult.installedBeforeInitializing, true);
            assert.equal(result.clientResult.isRunning, false);
        }).catch(error => {
            assert.fail(error, undefined, 'initialize promise was rejected');
        });
    });

    test('initalizeWithPlatform should throw on failed download', () => {
        // Setup:
        // ... Create a fixture that mocks an failed download (missing downloaded path and installed path)
        let fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
        };
        setupMocks(fixture);

        // ... Create an initialization state object with the platform info
        let initState: InitializationState = new InitializationState(fixture.platformInfo);

        // If: I initialize a new tools service client that will fail to return a server path
        let serviceClient = new SqlToolsServiceClient(testServiceProvider.object, logger, testStatusView.object);
        return serviceClient.initializeWithPlatform(initState).then(state => {
            // Then:
            // ... It should not have succeeded
            assert.fail(state, undefined, 'initialize promise was resolved');
        }, error => {
            // ... The error message should not be empty
            assert.notEqual(error, undefined);
            assert.equal(error.message.length > 0, true);
        });
    });

    test('initalizeWithPlatform should reject on invalid runtime', () => {
        // Setup:
        // ... Create a fixture that mocks an invalid runtime
        let fixture: IFixture = {
            installedServerPath: undefined,
            downloadedServerPath: undefined,
            platformInfo: new PlatformInformation('invalid platform', 'x86_64', undefined)
        };
        setupMocks(fixture);

        // ... Create an initialization state object with the platform info
        let initState: InitializationState = new InitializationState(fixture.platformInfo);

        // If: I initialize a new tools service client with invalid runtime
        let serviceClient = new SqlToolsServiceClient(testServiceProvider.object, logger, testStatusView.object);
        return serviceClient.initializeWithPlatform(initState).then(state => {
            // Then:
            // ... It should not have succeeded
            assert.fail(state, undefined, 'initialize promise was resolved');
        }, error => {
            // ... The error message should not be empty
            assert.notEqual(error, undefined);
            assert.equal(error.message.length > 0, true);
        });
    });

    test('handleLanguageServiceStatusNotification should change the UI status', (done) => {
        return new Promise((resolve, reject) => {
            let fixture: IFixture = {
                installedServerPath: 'already installed service',
                downloadedServerPath: undefined,
                platformInfo: new PlatformInformation('win32', 'x86_64', undefined)
            };
            const testFile = 'file:///my/test/file.sql';
            const status = 'new status';

            setupMocks(fixture);
            let serviceClient = new SqlToolsServiceClient(testServiceProvider.object, logger, testStatusView.object);
            let statusChangeParams = new LanguageServiceContracts.StatusChangeParams();
            statusChangeParams.ownerUri = testFile;
            statusChangeParams.status = status;
            serviceClient.handleLanguageServiceStatusNotification().call(serviceClient, statusChangeParams);
            testStatusView.verify(x => x.languageServiceStatusChanged(testFile, status), TypeMoq.Times.once());
            done();
        });
    });
});
