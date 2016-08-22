import assert = require('assert');
import * as TypeMoq from 'typemoq';
import {ExtensionContext, Memento} from 'vscode';
import SqlToolsServiceClient from './../src/languageservice/serviceclient';

import { IQuestion, IPrompter, IPromptCallback } from '../src/prompts/question';

import ConnectionManager from '../src/controllers/connectionManager';
import { IConnectionCredentials } from '../src/models/interfaces';
import * as Contracts from '../src/models/contracts';
import StatusView from '../src/views/statusView';
import Telemetry from '../src/models/telemetry';
import * as Utils from '../src/models/utils';

// Dummy implementation to simplify mocking
class TestPrompter implements IPrompter {
    public promptSingle<T>(question: IQuestion): Promise<T> {
        return Promise.resolve(undefined);
    }
    public prompt<T>(questions: IQuestion[]): Promise<{[key: string]: T}> {
        return Promise.resolve(undefined);
    }
    public promptCallback(questions: IQuestion[], callback: IPromptCallback): void {
        callback({});
    }
}

// Bare mock of the extension context for vscode
class TestExtensionContext implements ExtensionContext {
        subscriptions: { dispose(): any }[];
        workspaceState: Memento;
        globalState: Memento;
        extensionPath: string;
        asAbsolutePath(relativePath: string): string {
            return undefined;
        }
}

function createTestConnectionResult(): Contracts.ConnectionResult {
    let result = new Contracts.ConnectionResult();
    result.connectionId = Utils.generateGuid();
    result.messages = '';
    return result;
}

function createTestCredentials(): IConnectionCredentials {
    const creds: IConnectionCredentials = {
        server: 'my-server',
        database: 'my_db',
        authenticationType: 'SQL Authentication',
        user: 'sa',
        password: '12345678',
        connectionTimeout: 30000,
        requestTimeout: 30000,
        options: { encrypt: false, appName: 'vscode-mssql' }
    };
    return creds;
}

function createTestConnectionManager(serviceClient: SqlToolsServiceClient): ConnectionManager {
    let contextMock: TypeMoq.Mock<ExtensionContext> = TypeMoq.Mock.ofType(TestExtensionContext);
    let statusViewMock: TypeMoq.Mock<StatusView> = TypeMoq.Mock.ofType(StatusView);
    let prompterMock: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
    return new ConnectionManager(contextMock.object, statusViewMock.object, prompterMock.object, serviceClient);
}

suite('Per File Connection Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('Can create two separate connections for two files', done => {
        const testFile1 = 'file:///my/test/file.sql';
        const testFile2 = 'file:///my/test/file2.sql';

        // Setup mocking
        let serviceClientMock: TypeMoq.Mock<SqlToolsServiceClient> = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Strict);
        serviceClientMock.setup(x => x.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                            .returns(() => Promise.resolve(createTestConnectionResult()));

        let manager: ConnectionManager = createTestConnectionManager(serviceClientMock.object);

        // Create two different connections using the connection manager
        let connectionCreds = createTestCredentials();
        let connectionCreds2 = createTestCredentials();
        connectionCreds2.database = 'my_other_db';

        manager.connect(testFile1, connectionCreds).then( result => {
            assert.equal(result, true);
            manager.connect(testFile2, connectionCreds).then( result2 => {
                assert.equal(result2, true);

                // Check that two connections were established
                assert.equal(manager.connectionCount, 2);
                assert.equal(manager.isConnected(testFile1), true);
                assert.equal(manager.isConnected(testFile2), true);
                done();
            }).catch(err => {
                assert.fail(err);
            });
        }).catch(err => {
            assert.fail(err);
        });
    });

    test('Can disconnect one file while another file stays connected', done => {
        const testFile1 = 'file:///my/test/file.sql';
        const testFile2 = 'file:///my/test/file2.sql';

        // Setup mocking
        let serviceClientMock: TypeMoq.Mock<SqlToolsServiceClient> = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Strict);
        serviceClientMock.setup(x => x.sendRequest(TypeMoq.It.isValue(Contracts.ConnectionRequest.type), TypeMoq.It.isAny()))
                            .returns(() => Promise.resolve(createTestConnectionResult()));
        serviceClientMock.setup(x => x.sendRequest(TypeMoq.It.isValue(Contracts.DisconnectRequest.type), TypeMoq.It.isAny()))
                            .returns(() => Promise.resolve(true));

        let manager: ConnectionManager = createTestConnectionManager(serviceClientMock.object);

        // Create two different connections using the connection manager
        let connectionCreds = createTestCredentials();
        let connectionCreds2 = createTestCredentials();
        connectionCreds2.database = 'my_other_db';

        manager.connect(testFile1, connectionCreds).then( result => {
            assert.equal(result, true);
            manager.connect(testFile2, connectionCreds).then( result2 => {
                assert.equal(result2, true);

                // Check that two connections were established
                assert.equal(manager.connectionCount, 2);
                assert.equal(manager.isConnected(testFile1), true);
                assert.equal(manager.isConnected(testFile2), true);

                // Disconnect one of the files
                manager.disconnect(testFile2).then( result3 => {
                    assert.equal(result3, true);

                    // Check that only the second file disconnected
                    assert.equal(manager.connectionCount, 1);
                    assert.equal(manager.isConnected(testFile1), true);
                    assert.equal(manager.isConnected(testFile2), false);

                    done();
                }).catch(err => {
                    assert.fail(err);
                });
            }).catch(err => {
                assert.fail(err);
            });
        }).catch(err => {
            assert.fail(err);
        });
    });

    test('Can disconnect and reconnect one file while another file stays connected', done => {
        const testFile1 = 'file:///my/test/file.sql';
        const testFile2 = 'file:///my/test/file2.sql';

        // Setup mocking
        let serviceClientMock: TypeMoq.Mock<SqlToolsServiceClient> = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Strict);
        serviceClientMock.setup(x => x.sendRequest(TypeMoq.It.isValue(Contracts.ConnectionRequest.type), TypeMoq.It.isAny()))
                            .returns(() => Promise.resolve(createTestConnectionResult()));
        serviceClientMock.setup(x => x.sendRequest(TypeMoq.It.isValue(Contracts.DisconnectRequest.type), TypeMoq.It.isAny()))
                            .returns(() => Promise.resolve(true));

        let manager: ConnectionManager = createTestConnectionManager(serviceClientMock.object);

        // Create two different connections using the connection manager
        let connectionCreds = createTestCredentials();
        let connectionCreds2 = createTestCredentials();
        connectionCreds2.database = 'my_other_db';

        manager.connect(testFile1, connectionCreds).then( result => {
            assert.equal(result, true);
            manager.connect(testFile2, connectionCreds).then( result2 => {
                assert.equal(result2, true);

                // Check that two connections were established
                assert.equal(manager.connectionCount, 2);
                assert.equal(manager.isConnected(testFile1), true);
                assert.equal(manager.isConnected(testFile2), true);

                // Disconnect one of the files
                manager.disconnect(testFile2).then( result3 => {
                    assert.equal(result3, true);

                    // Check that only the second file disconnected
                    assert.equal(manager.connectionCount, 1);
                    assert.equal(manager.isConnected(testFile1), true);
                    assert.equal(manager.isConnected(testFile2), false);

                    // Reconnect the second file
                    manager.connect(testFile2, connectionCreds2).then( result4 => {
                        assert.equal(result4, true);

                        // Check that two connections are estabilished
                        assert.equal(manager.connectionCount, 2);
                        assert.equal(manager.isConnected(testFile1), true);
                        assert.equal(manager.isConnected(testFile2), true);

                        done();
                    }).catch(err => {
                        assert.fail(err);
                    });
                }).catch(err => {
                    assert.fail(err);
                });
            }).catch(err => {
                assert.fail(err);
            });
        }).catch(err => {
            assert.fail(err);
        });
    });
});
