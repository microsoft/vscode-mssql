'use strict';

import * as TypeMoq from 'typemoq';

import vscode = require('vscode');
import * as utils from '../src/models/utils';
import { TestExtensionContext, TestMemento } from './stubs';
import { IConnectionProfile } from '../src/models/interfaces';
import { CredentialStore } from '../src/credentialStore/credentialstore';
import { ConnectionProfile } from '../src/models/connectionProfile';
import { ConnectionStore } from '../src/models/connectionStore';

import assert = require('assert');

suite('ConnectionStore tests', () => {
    let defaultProfile: IConnectionProfile;
    setup(() => {
        defaultProfile = Object.assign(new ConnectionProfile(), {
            profileName: 'abc-bcd-cde',
            server: 'abc',
            database: 'bcd',
            user: 'cde',
            password: 'asdf!@#$'
        });
    });

    test('SaveConnection should not save password if SavePassword is false', () => {
        // Given
        let context: TypeMoq.Mock<vscode.ExtensionContext> = TypeMoq.Mock.ofType(TestExtensionContext);
        let globalstate: TypeMoq.Mock<vscode.Memento> = TypeMoq.Mock.ofType(TestMemento);
        context.object.globalState = globalstate.object;
        globalstate.setup(x => x.get(TypeMoq.It.isAny())).returns(key => []);

        let credsToSave: IConnectionProfile[];
        globalstate.setup(x => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyObject(Array)))
            .returns((id: string, profiles: IConnectionProfile[]) => {
                credsToSave = profiles;
                return Promise.resolve();
            });

        let credentialStore: TypeMoq.Mock<CredentialStore> = TypeMoq.Mock.ofType(CredentialStore);
        // credentialStore.setup(x => x.setCredential());
        let connectionStore = new ConnectionStore(context.object, credentialStore.object);

        // When SaveConnection is called with savePassword false
        let profile: IConnectionProfile = Object.assign(new ConnectionProfile(), defaultProfile, { savePassword: false });
        connectionStore.saveConnection(profile)
            .then(savedProfile => {
        // Then expect password not saved in either the context object or the credential store
                assert.ok(credsToSave !== undefined && credsToSave.length === 1);
                assert.ok(utils.isEmpty(credsToSave[0].password));

                credentialStore.verify(x => x.setCredential(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.never());
            });

    });
});

