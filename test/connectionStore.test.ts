'use strict';

import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import { TestExtensionContext, TestMemento } from './stubs';
import { IConnectionProfile } from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';

import assert = require('assert');

suite('ConnectionStore tests', () => {
    let defaultProfile: IConnectionProfile;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.Mock<vscode.Memento>;
    let credentialStore: TypeMoq.Mock<CredentialStore>;

    setup(() => {
        defaultProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'abc-bcd-cde',
            server: 'abc',
            database: 'bcd',
            user: 'cde',
            password: 'asdf!@#$'
        });

        context = TypeMoq.Mock.ofType(TestExtensionContext);
        globalstate = TypeMoq.Mock.ofType(TestMemento);
        context.object.globalState = globalstate.object;
        credentialStore = TypeMoq.Mock.ofType(CredentialStore);
    });

    test('formatCredentialId should handle server, DB and username correctly', () => {
        try {
            ConnectionStore.formatCredentialId('', '', '');
            assert.fail('Expected exception to be thrown when server name missing');
        } catch (e) {
            // Expected
        }
        let serverName = 'myServer';
        let dbName = 'someDB';
        let userName = 'aUser';
        let profileType = 'profile';

        assert.strictEqual(ConnectionStore.formatCredentialId(serverName), `Microsoft.SqlTools|itemtype:${profileType}|server:${serverName}`);
        assert.strictEqual(ConnectionStore.formatCredentialId(serverName, dbName),
            `Microsoft.SqlTools|itemtype:${profileType}|server:${serverName}|db:${dbName}`);
        assert.strictEqual(ConnectionStore.formatCredentialId(serverName, dbName, userName),
            `Microsoft.SqlTools|itemtype:${profileType}|server:${serverName}|db:${dbName}|user:${userName}`);
    });

    test('SaveProfile should not save password if SavePassword is false', done => {
        // Given
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => []);

        let credsToSave: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                credsToSave = profiles;
                return Promise.resolve();
            });

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);

        // When SaveProfile is called with savePassword false
        let profile: IConnectionProfile = Object.assign(new ConnectionProfile(), defaultProfile, { savePassword: false });
        return connectionStore.saveProfile(profile)
            .then(savedProfile => {
        // Then expect password not saved in either the context object or the credential store
                assert.ok(credsToSave !== undefined && credsToSave.length === 1);
                assert.ok(utils.isEmpty(credsToSave[0].password));

                credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
                done();
            }).catch(err => done(new Error(err)));
    });

    test('SaveProfile should save password using CredentialStore and not in the settings', (done) => {
        // Given
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => []);

        let credsToSave: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                credsToSave = profiles;
                return Promise.resolve();
            });

        let capturedCreds: any;
        credentialStore.setup(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((cred: string, pass: any) => {
                capturedCreds = {
                    'credentialId': cred,
                    'password': pass
                };
            })
            .returns(() => Promise.resolve(true));

        let expectedCredFormat: string = ConnectionStore.formatCredentialId(defaultProfile.server, defaultProfile.database, defaultProfile.user);

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);

        // When SaveProfile is called with savePassword true
        let profile: IConnectionProfile = Object.assign(new ConnectionProfile(), defaultProfile, { savePassword: true });

        connectionStore.saveProfile(profile)
            .then(savedProfile => {
        // Then expect password saved in the credential store
                assert.ok(credsToSave !== undefined && credsToSave.length === 1);
                assert.ok(utils.isEmpty(credsToSave[0].password));

                credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

                assert.strictEqual(capturedCreds.credentialId, expectedCredFormat);
                assert.strictEqual(capturedCreds.password, defaultProfile.password);
                done();
            }).catch(err => done(new Error(err)));
    });

    test('RemoveProfile should save remove password from CredentialStore', (done) => {
        // Given have 2 profiles
        let profile = Object.assign(new ConnectionProfile(), defaultProfile, { profileName: 'otherServer-bcd-cde', server: 'otherServer', savePassword: true });
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => [defaultProfile, profile]);

        let updatedCredentials: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                updatedCredentials = profiles;
                return Promise.resolve();
            });

        let capturedCreds: any;
        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .callback((cred: string, user: string) => {
                capturedCreds = {
                    'credentialId': cred
                };
            })
            .returns(() => Promise.resolve(true));

        let expectedCredFormat: string = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);

        // When RemoveProfile is called for once profile

        connectionStore.removeProfile(profile)
            .then(success => {
        // Then expect that profile to be removed from the store
                assert.ok(success);
                assert.strictEqual(1, updatedCredentials.length);
                assert.strictEqual(updatedCredentials[0].server, defaultProfile.server, 'Expect only defaultProfile left');

                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.once());

                assert.strictEqual(capturedCreds.credentialId, expectedCredFormat, 'Expect profiles password to have been removed');
                done();
            }).catch(err => done(new Error(err)));
    });
});

