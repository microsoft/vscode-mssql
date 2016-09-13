'use strict';

import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import * as connectionInfo from '../src/models/connectionInfo';
import { TestExtensionContext, TestMemento } from './stubs';
import { IConnectionProfile, CredentialsQuickPickItemType, AuthenticationTypes } from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';

import assert = require('assert');

suite('ConnectionStore tests', () => {
    let defaultNamedProfile: IConnectionProfile;
    let defaultUnnamedProfile: IConnectionProfile;
    let context: TypeMoq.Mock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.Mock<vscode.Memento>;
    let credentialStore: TypeMoq.Mock<CredentialStore>;

    setup(() => {
        defaultNamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'abc-bcd-cde',
            server: 'abc',
            database: 'bcd',
            authenticationType: utils.authTypeToString(AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: 'asdf!@#$'
        });

        defaultUnnamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: undefined,
            server: 'namedServer',
            database: undefined,
            authenticationType: utils.authTypeToString(AuthenticationTypes.SqlLogin),
            user: 'aUser',
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

    test('getPickListDetails - details are left empty', () => {
        assert.strictEqual(connectionInfo.getPicklistDetails(defaultNamedProfile), undefined);
    });

    test('getPickListLabel lists server name by default', () => {
        let unnamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: undefined,
            server: 'serverName',
            database: 'bcd',
            user: 'cde',
            password: 'asdf!@#$'
        });
        let label = connectionInfo.getPicklistLabel(unnamedProfile, CredentialsQuickPickItemType.Profile);
        assert.ok(label.endsWith(unnamedProfile.server));
    });

    test('getPickListLabel includes profile name if defined', () => {
        let namedProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'profile name',
            server: 'serverName',
            database: 'bcd',
            user: 'cde',
            password: 'asdf!@#$'
        });
        let label = connectionInfo.getPicklistLabel(namedProfile, CredentialsQuickPickItemType.Profile);
        assert.ok(label.endsWith(namedProfile.profileName));
    });

    test('getPickListLabel has different symbols for Profiles vs Recently Used', () => {
        let profileLabel: string = connectionInfo.getPicklistLabel(defaultNamedProfile, CredentialsQuickPickItemType.Profile);
        let mruLabel: string = connectionInfo.getPicklistLabel(defaultNamedProfile, CredentialsQuickPickItemType.Mru);

        assert.ok(mruLabel, 'expect value for label');
        assert.ok(profileLabel, 'expect value for label');
        assert.notEqual(profileLabel, mruLabel, 'expect different symbols for Profile vs MRU');
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
        let profile: IConnectionProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, { savePassword: false });
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

        let expectedCredFormat: string = ConnectionStore.formatCredentialId(defaultNamedProfile.server, defaultNamedProfile.database, defaultNamedProfile.user);

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);

        // When SaveProfile is called with savePassword true
        let profile: IConnectionProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, { savePassword: true });

        connectionStore.saveProfile(profile)
            .then(savedProfile => {
        // Then expect password saved in the credential store
                assert.ok(credsToSave !== undefined && credsToSave.length === 1);
                assert.ok(utils.isEmpty(credsToSave[0].password));

                credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());

                assert.strictEqual(capturedCreds.credentialId, expectedCredFormat);
                assert.strictEqual(capturedCreds.password, defaultNamedProfile.password);
                done();
            }).catch(err => done(new Error(err)));
    });

    test('RemoveProfile should remove password from CredentialStore', (done) => {
        // Given have 2 profiles
        let profile = Object.assign(new ConnectionProfile(), defaultNamedProfile, {
            profileName: 'otherServer-bcd-cde',
            server: 'otherServer',
            savePassword: true
        });
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => [defaultNamedProfile, profile]);

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
                assert.strictEqual(updatedCredentials[0].server, defaultNamedProfile.server, 'Expect only defaultProfile left');

                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.once());

                assert.strictEqual(capturedCreds.credentialId, expectedCredFormat, 'Expect profiles password to have been removed');
                done();
            }).catch(err => done(new Error(err)));
    });

    test('RemoveProfile finds and removes profile with no profile name', (done) => {
        // Given have 2 profiles
        let unnamedProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, {
            profileName: undefined,
            server: 'otherServer',
            savePassword: true
        });
        let namedProfile = Object.assign(new ConnectionProfile(), unnamedProfile, {
            profileName: 'named'
        });
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => [defaultNamedProfile, unnamedProfile, namedProfile]);

        let updatedCredentials: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                updatedCredentials = profiles;
                return Promise.resolve();
            });

        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);
        // When RemoveProfile is called for the profile
        connectionStore.removeProfile(unnamedProfile)
            .then(success => {
        // Then expect that profile to be removed from the store
                assert.ok(success);
                assert.strictEqual(2, updatedCredentials.length);
                assert.ok(updatedCredentials.every(p => p !== unnamedProfile), 'expect profile is removed from creds');
                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.once());
                done();
            }).catch(err => done(new Error(err)));
    });

    test('RemoveProfile finds and removes profile with a profile name', (done) => {
        // Given have 2 profiles
        let unnamedProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, {
            profileName: undefined,
            server: 'otherServer',
            savePassword: true
        });
        let namedProfile = Object.assign(new ConnectionProfile(), unnamedProfile, {
            profileName: 'named'
        });
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => [defaultNamedProfile, unnamedProfile, namedProfile]);

        let updatedCredentials: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                updatedCredentials = profiles;
                return Promise.resolve();
            });

        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        let connectionStore = new ConnectionStore(context.object, credentialStore.object);
        // When RemoveProfile is called for the profile
        connectionStore.removeProfile(namedProfile)
            .then(success => {
        // Then expect that profile to be removed from the store
                assert.ok(success);
                assert.strictEqual(2, updatedCredentials.length);
                assert.ok(updatedCredentials.every(p => p !== namedProfile), 'expect profile is removed from creds');
                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.atLeastOnce());
                done();
            }).catch(err => done(new Error(err)));
    });
});

