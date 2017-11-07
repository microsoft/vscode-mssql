'use strict';
import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import * as connectionInfo from '../src/models/connectionInfo';
import * as Constants from '../src/constants/constants';
import * as stubs from './stubs';
import * as interfaces from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialstore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';
import { ConnectionConfig } from '../src/connectionconfig/connectionconfig';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import assert = require('assert');

suite('ConnectionStore tests', () => {
    let defaultNamedProfile: interfaces.IConnectionProfile;
    let defaultUnnamedProfile: interfaces.IConnectionProfile;
    let context: TypeMoq.IMock<vscode.ExtensionContext>;
    let globalstate: TypeMoq.IMock<vscode.Memento>;
    let credentialStore: TypeMoq.IMock<CredentialStore>;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let connectionConfig: TypeMoq.IMock<ConnectionConfig>;
    let workspaceConfiguration: vscode.WorkspaceConfiguration;

    setup(() => {
        defaultNamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultNamedProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: 'asdf!@#$'
        });

        defaultUnnamedProfile = Object.assign(new ConnectionProfile(), {
            profileName: undefined,
            server: 'unnamedServer',
            database: undefined,
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'aUser',
            password: 'asdf!@#$'
        });

        context = TypeMoq.Mock.ofType(stubs.TestExtensionContext);
        globalstate = TypeMoq.Mock.ofType(stubs.TestMemento);
        context.object.globalState = globalstate.object;
        credentialStore = TypeMoq.Mock.ofType(CredentialStore);
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        connectionConfig = TypeMoq.Mock.ofType(ConnectionConfig);

        // setup default behavior for vscodeWrapper
        // setup configuration to return maxRecent for the #MRU items
        let maxRecent = 5;
        let configResult: {[key: string]: any} = {};
        configResult[Constants.configMaxRecentConnections] = maxRecent;
        workspaceConfiguration = stubs.createWorkspaceConfiguration(configResult);
        vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
        .returns(x => {
            return workspaceConfiguration;
        });
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
        let profileType = 'Profile';

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
        let label = connectionInfo.getPicklistLabel(unnamedProfile, interfaces.CredentialsQuickPickItemType.Profile);
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
        let label = connectionInfo.getPicklistLabel(namedProfile, interfaces.CredentialsQuickPickItemType.Profile);
        assert.ok(label.endsWith(namedProfile.profileName));
    });

    test('SaveProfile should not save password if SavePassword is false', () => {
        // Given
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => []);

        let credsToSave: interfaces.IConnectionProfile[];
        connectionConfig.setup(x => x.addConnection(TypeMoq.It.isAny()))
             .returns((profile: interfaces.IConnectionProfile) => {
                credsToSave = [profile];
                return Promise.resolve();
            });

        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object);

        // When SaveProfile is called with savePassword false
        let profile: interfaces.IConnectionProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, { savePassword: false });
        return connectionStore.saveProfile(profile)
            .then(savedProfile => {
                // Then expect password not saved in either the context object or the credential store
                assert.ok(credsToSave !== undefined && credsToSave.length === 1);
                assert.ok(utils.isEmpty(credsToSave[0].password));

                credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
            }).catch(err => {
                return new Error(err);
            });
    });

    test('SaveProfile should save password using CredentialStore and not in the settings', (done) => {
        // Given
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => []);

        let credsToSave: interfaces.IConnectionProfile[];
        connectionConfig.setup(x => x.addConnection(TypeMoq.It.isAny()))
             .returns((profile: interfaces.IConnectionProfile) => {
                credsToSave = [profile];
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

        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object);

        // When SaveProfile is called with savePassword true
        let profile: interfaces.IConnectionProfile = Object.assign(new ConnectionProfile(), defaultNamedProfile, { savePassword: true });

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
        connectionConfig.setup(x => x.removeConnection(TypeMoq.It.isAny())).returns(p => Promise.resolve(p));

        let capturedCreds: any;
        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .callback((cred: string, user: string) => {
                capturedCreds = {
                    'credentialId': cred
                };
            })
            .returns(() => Promise.resolve(true));

        let expectedCredFormat: string = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);

        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAny())).returns(() => Promise.resolve());
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object);

        // When RemoveProfile is called for once profile

        connectionStore.removeProfile(profile)
            .then(success => {
                // Then expect that profile's password to be removed from the credential store
                assert.ok(success);
                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.once());

                assert.strictEqual(capturedCreds.credentialId, expectedCredFormat, 'Expect profiles password to have been removed');
                done();
            }).catch(err => done(new Error(err)));
    });

    test('RemoveProfile should not remove password from CredentialStore if keepCredentialStore is enabled', (done) => {
        testRemoveProfileWithKeepCredential(true, done);
    });

    test('RemoveProfile should remove password from CredentialStore if keepCredentialStore is disabled', (done) => {
        testRemoveProfileWithKeepCredential(false, done);
    });

    function testRemoveProfileWithKeepCredential(keepCredentialStore: boolean,  done: Function): void {
        // Given have 2 profiles
        let profile = Object.assign(new ConnectionProfile(), defaultNamedProfile, {
            profileName: 'otherServer-bcd-cde',
            server: 'otherServer',
            savePassword: true
        });
        connectionConfig.setup(x => x.removeConnection(TypeMoq.It.isAny())).returns(p => Promise.resolve(p));
        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny())).returns(() => Promise.resolve(true));

        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAny())).returns(() => Promise.resolve());
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object);

        // deleteCredential should never be called when keepCredentialStore is set to true
        connectionStore.removeProfile(profile, keepCredentialStore)
            .then(success => {
                // Then expect that profile's password to be removed from connectionConfig but kept in the credential store
                assert.ok(success);
                connectionConfig.verify(x => x.removeConnection(TypeMoq.It.isAny()), TypeMoq.Times.once());
                if (keepCredentialStore) {
                    credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.never());
                } else {
                    credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.once());
                }
                done();
            }).catch(err => done(new Error(err)));
    }


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

        workspaceConfiguration.update('connections', [defaultNamedProfile, unnamedProfile, namedProfile]);
        let updatedCredentials: interfaces.IConnectionProfile[];

        vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .returns(x => {
            return workspaceConfiguration;
        });

        let config = new ConnectionConfig(vscodeWrapper.object);

        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAny())).returns(() => Promise.resolve());
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, config);
        // When RemoveProfile is called for the profile
        connectionStore.removeProfile(unnamedProfile)
            .then(success => {
        // Then expect that profile to be removed from the store
                updatedCredentials = config.getConnections(false);
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

        workspaceConfiguration.update('connections', [defaultNamedProfile, unnamedProfile, namedProfile]);

        let updatedCredentials: interfaces.IConnectionProfile[];

        vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .returns(x => {
            return workspaceConfiguration;
        });

        let config = new ConnectionConfig(vscodeWrapper.object);

        credentialStore.setup(x => x.deleteCredential(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true));

        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAny())).returns(() => Promise.resolve());
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, config);
        // When RemoveProfile is called for the profile
        connectionStore.removeProfile(namedProfile)
            .then(success => {
        // Then expect that profile to be removed from the store
                updatedCredentials = config.getConnections(false);
                assert.ok(success);
                assert.strictEqual(2, updatedCredentials.length);
                assert.ok(updatedCredentials.every(p => p !== namedProfile), 'expect profile is removed from creds');
                credentialStore.verify(x => x.deleteCredential(TypeMoq.It.isAny()), TypeMoq.Times.atLeastOnce());
                done();
            }).catch(err => done(new Error(err)));
    });

    test('addRecentlyUsed should limit saves to the MaxRecentConnections amount ', (done) => {
        // Given 3 is the max # creds
        let numCreds = 4;
        let maxRecent = 3;

        // setup configuration to return maxRecent for the #MRU items - must override vscodeWrapper in this test
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);
        let configResult: {[key: string]: any} = {};
        configResult[Constants.configMaxRecentConnections] = maxRecent;
        let config = stubs.createWorkspaceConfiguration(configResult);
        config.update(Constants.configMaxRecentConnections, maxRecent);
        vscodeWrapper.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
        .returns(x => {
            return config;
        });

        // setup memento for MRU to return a list we have access to
        let creds: interfaces.IConnectionCredentials[] = [];
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => creds.slice(0, creds.length));
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, credsToSave: interfaces.IConnectionCredentials[]) => {
                creds = credsToSave;
                return Promise.resolve();
            });

        credentialStore.setup(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .returns(() => Promise.resolve(true));

        // When saving 4 connections
        // Then expect the only the 3 most recently saved connections to be returned as size is limited to 3
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, undefined, vscodeWrapper.object);

        let promise = Promise.resolve();
        for (let i = 0; i < numCreds; i++) {
            let cred = Object.assign({}, defaultNamedProfile, { profileName: defaultNamedProfile.profileName + i});
            promise = promise.then(() => {
                return connectionStore.addRecentlyUsed(cred);
            }).then(() => {
                if (i < maxRecent) {
                    assert.equal(creds.length, i + 1, 'expect all credentials to be saved when limit not reached');
                } else {
                    assert.equal(creds.length, maxRecent, `expect only top ${maxRecent} creds to be saved`);
                }
                assert.equal(creds[0].server, cred.server, 'Expect most recently saved item to be first in list');
                assert.ok(utils.isEmpty(creds[0].password));
            });
        }
        promise.then(() => {
            credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.exactly(numCreds));
            let recentConnections = connectionStore.getRecentlyUsedConnections();
            assert.equal(maxRecent, recentConnections.length);
            done();
        }, err => {
            // Must call done here so test indicates it's finished if errors occur
            done(err);
        });
    });

    test('addRecentlyUsed should add same connection exactly once', (done) => {
        // setup memento for MRU to return a list we have access to
        let creds: interfaces.IConnectionCredentials[] = [];
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => creds.slice(0, creds.length));
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, credsToSave: interfaces.IConnectionCredentials[]) => {
                creds = credsToSave;
                return Promise.resolve();
            });

        credentialStore.setup(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .returns(() => Promise.resolve(true));

        // Given we save the same connection twice
        // Then expect the only 1 instance of that connection to be listed in the MRU
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, undefined, vscodeWrapper.object);

        let promise = Promise.resolve();
        let cred = Object.assign({}, defaultNamedProfile, { profileName: defaultNamedProfile.profileName + 1});
        promise = promise.then(() => {
            return connectionStore.addRecentlyUsed(defaultNamedProfile);
        }).then(() => {
            return connectionStore.addRecentlyUsed(cred);
        }).then(() => {
            return connectionStore.addRecentlyUsed(cred);
        }).then(() => {
            assert.equal(creds.length, 2, 'expect 2 unique credentials to have been added');
            assert.equal(creds[0].server, cred.server, 'Expect most recently saved item to be first in list');
            assert.ok(utils.isEmpty(creds[0].password));
        }).then(() => done(), err => done(err));
    });

    test('addRecentlyUsed should save password to credential store', (done) => {
        // setup memento for MRU to return a list we have access to
        let creds: interfaces.IConnectionCredentials[] = [];
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => creds.slice(0, creds.length));
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, credsToSave: interfaces.IConnectionCredentials[]) => {
                creds = credsToSave;
                return Promise.resolve();
            });

        // Setup credential store to capture credentials sent to it
        let capturedCreds: any;
        credentialStore.setup(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
        .callback((cred: string, pass: any) => {
            capturedCreds = {
                'credentialId': cred,
                'password': pass
            };
        })
        .returns(() => Promise.resolve(true));

        // Given we save 1 connection with password and multiple other connections without
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, undefined, vscodeWrapper.object);
        let integratedCred = Object.assign({}, defaultNamedProfile, {
            server: defaultNamedProfile.server + 'Integrated',
            authenticationType: interfaces.AuthenticationTypes[interfaces.AuthenticationTypes.Integrated],
            user: '',
            password: '',
            profileName: 'integrated'
        });
        let noPwdCred = Object.assign({}, defaultNamedProfile, {
            server: defaultNamedProfile.server + 'NoPwd',
            password: '',
            profileName: 'noPwd'
        });

        let expectedCredCount = 0;
        let promise = Promise.resolve();
        promise = promise.then(() => {
            expectedCredCount++;
            return connectionStore.addRecentlyUsed(defaultNamedProfile);
        }).then(() => {
            // Then verify that since its password based we save the password
            credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.strictEqual(capturedCreds.password, defaultNamedProfile.password);
            let credId: string = capturedCreds.credentialId;
            assert.ok(credId.includes(ConnectionStore.CRED_MRU_USER), 'Expect credential to be marked as an MRU cred');
            assert.ok(utils.isEmpty(creds[0].password));
        }).then(() => {
            // When add integrated auth connection
            expectedCredCount++;
            return connectionStore.addRecentlyUsed(integratedCred);
        }).then(() => {
            // then expect no to have credential store called, but MRU count upped to 2
            credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(creds.length, expectedCredCount, `expect ${expectedCredCount} unique credentials to have been added`);
        }).then(() => {
            // When add connection without password
            expectedCredCount++;
            return connectionStore.addRecentlyUsed(noPwdCred);
        }).then(() => {
            // then expect no to have credential store called, but MRU count upped to 3
            credentialStore.verify(x => x.saveCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            assert.equal(creds.length, expectedCredCount, `expect ${expectedCredCount} unique credentials to have been added`);
        }).then(() => done(), err => done(err));
    });

    test('getPickListItems should display Recently Used then Profiles', (done) => {
        // Given 3 items in MRU and 2 in Profile list
        let recentlyUsed: interfaces.IConnectionCredentials[] = [];
        for (let i = 0; i < 3; i++) {
            recentlyUsed.push( Object.assign({}, defaultNamedProfile, { server: defaultNamedProfile.server + i}) );
        }
        globalstate.setup(x => x.get(Constants.configRecentConnections)).returns(key => recentlyUsed);

        let profiles: interfaces.IConnectionProfile[] = [defaultNamedProfile, defaultUnnamedProfile];
        connectionConfig.setup(x => x.getConnections(TypeMoq.It.isAny())).returns(() => profiles);

        // When we get the list of available connection items

        // Then expect MRU items first, then profile items
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object, vscodeWrapper.object);

        let items: interfaces.IConnectionCredentialsQuickPickItem[] = connectionStore.getPickListItems();
        let expectedCount = recentlyUsed.length + profiles.length;
        assert.equal(items.length, expectedCount);

        // Then expect recent items first
        let i = 0;
        for (let recentItem of recentlyUsed) {
            assert.equal(items[i].connectionCreds, recentItem);
            assert.equal(items[i].quickPickItemType, interfaces.CredentialsQuickPickItemType.Mru);
            i++;
        }
        // Then profile items (that aren't already in MRU)
        for (let profile of profiles) {
            if (profile.profileName === defaultNamedProfile.profileName) {
                continue;
            }
            assert.equal(items[i].connectionCreds, profile);
            assert.equal(items[i].quickPickItemType, interfaces.CredentialsQuickPickItemType.Profile);
            i++;
        }
        // then new connection
        assert.equal(items[i].quickPickItemType, interfaces.CredentialsQuickPickItemType.NewConnection);

        // Then test is complete
        done();
    });

    test('can clear recent connections list', (done) => {
        // Given 3 items in MRU
        let recentlyUsed: interfaces.IConnectionCredentials[] = [];
        for (let i = 0; i < 3; i++) {
            recentlyUsed.push( Object.assign({}, defaultNamedProfile, { server: defaultNamedProfile.server + i}) );
        }
        globalstate.setup(x => x.get(Constants.configRecentConnections)).returns(key => recentlyUsed);
        globalstate.setup(x => x.update(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((key, value) => {
                recentlyUsed = value;
                return Promise.resolve();
            });

        connectionConfig.setup(x => x.getConnections(TypeMoq.It.isAny())).returns(() => []);

        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object, vscodeWrapper.object);

        // When we clear the connections list and get the list of available connection items
        connectionStore.clearRecentlyUsed().then(() => {
            // Expect no connection items
            let items: interfaces.IConnectionCredentialsQuickPickItem[] = connectionStore.getPickListItems();
            let expectedCount = 1; // 1 for create connection profile
            assert.equal(items.length, expectedCount);

            // Then test is complete
            done();
        }, err => {
            done(err);
        });
    });

    test('addSavedPassword not lookup password if password already set', (done) => {
        // Given a profile with emptyPasswordInput set
        let passwordAlreadySetProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultNamedProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: 'asdf!@#$'
        });
        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object, vscodeWrapper.object);

        // When I check whether to add saved password
        let shouldSave = connectionStore.shouldLookupSavedPassword(passwordAlreadySetProfile);

        // Then should be false
        assert.equal(shouldSave, false);
        done();
    });

    test('addSavedPassword not lookup password if emptyPasswordInput is set', (done) => {
        // Given a profile with emptyPasswordInput set
        let emptyPasswordProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultNamedProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: '',
            emptyPasswordInput: true
        });

        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object, vscodeWrapper.object);

        // When I check whether to add saved password
        let shouldSave = connectionStore.shouldLookupSavedPassword(emptyPasswordProfile);

        // Then should be false
        assert.equal(shouldSave, false);
        done();
    });

    test('addSavedPassword not lookup password if password not set and emptyPasswordInput is false', (done) => {
        // Given a profile with emptyPasswordInput set
        let emptyPasswordProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'defaultNamedProfile',
            server: 'namedServer',
            database: 'bcd',
            authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
            user: 'cde',
            password: '',
            emptyPasswordInput: false
        });

        let connectionStore = new ConnectionStore(context.object, credentialStore.object, connectionConfig.object, vscodeWrapper.object);

        // When I check whether to add saved password
        let shouldSave = connectionStore.shouldLookupSavedPassword(emptyPasswordProfile);

        // Then should be false
        assert.equal(shouldSave, true);
        done();
    });

});

