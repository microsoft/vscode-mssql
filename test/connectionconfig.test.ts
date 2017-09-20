import * as TypeMoq from 'typemoq';

import { ConnectionConfig } from '../src/connectionconfig/connectionconfig';
import { IConnectionProfile } from '../src/models/interfaces';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
import * as Constants from '../src/constants/constants';
import * as interfaces from '../src/models/interfaces';
import { ConnectionProfile } from '../src/models/connectionProfile';
import * as utils from '../src/models/utils';

import assert = require('assert');
import vscode = require('vscode');
import * as stubs from './stubs';

let connections: ConnectionProfile[] = [
    Object.assign(new ConnectionProfile(), {
        server: 'my-server',
        database: 'my_db',
        authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin),
        user: 'sa',
        password: '12345678'
    }),
    Object.assign(new ConnectionProfile(), {
        server: 'my-other-server',
        database: 'my_other_db',
        user: 'sa',
        password: 'qwertyuiop',
        authenticationType: utils.authTypeToString(interfaces.AuthenticationTypes.SqlLogin)
    })
];

suite('ConnectionConfig tests', () => {

    test('no error message is shown when reading valid config file', () => {
        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);
        let workspaceConfiguration: vscode.WorkspaceConfiguration;
        let configResult: {[key: string]: any} = {};
        configResult[Constants.connectionsArrayName] = connections;
        workspaceConfiguration = stubs.createWorkspaceConfiguration(configResult);
        vscodeWrapperMock.setup(x => x.getConfiguration(TypeMoq.It.isAny()))
        .returns(x => {
            return workspaceConfiguration;
        });
        // Given a connection config object that reads a valid json file
        let config = new ConnectionConfig(vscodeWrapperMock.object);
        let profiles: IConnectionProfile[] = config.getProfilesFromSettings();

        // Verify that the profiles were read correctly
        assert.strictEqual(profiles.length, 2);
        assert.strictEqual(profiles[0].server, 'my-server');
        assert.strictEqual(profiles[0].database, 'my_db');
        assert.strictEqual(profiles[0].user, 'sa');
        assert.strictEqual(profiles[0].password, '12345678');
        assert.strictEqual(profiles[1].server, 'my-other-server');
        assert.strictEqual(profiles[1].database, 'my_other_db');
        assert.strictEqual(profiles[1].user, 'sa');
        assert.strictEqual(profiles[1].password, 'qwertyuiop');

        // Verify that no error message was displayed to the user
        vscodeWrapperMock.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.never());
    });
});
