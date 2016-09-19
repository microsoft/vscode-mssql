import * as TypeMoq from 'typemoq';

import { ConnectionConfig } from '../src/connectionconfig/connectionconfig';
import { IConnectionProfile } from '../src/models/interfaces';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import assert = require('assert');
import fs = require('fs');

const corruptJson =
`{
    vscode-mssql.connections: [
        {}
        corrupt!@#$%
    ]
}`;

const validJson =
`
{
    "vscode-mssql.connections": [
        {
            "server": "my-server",
            "database": "my_db",
            "user": "sa",
            "password": "12345678"
        },
        {
            "server": "my-other-server",
            "database": "my_other_db",
            "user": "sa",
            "password": "qwertyuiop"
        }
    ]
}
`;

const arrayTitleMissingJson =
`
[
    {
        "server": "my-server",
        "database": "my_db",
        "user": "sa",
        "password": "12345678"
    }
]
`;

suite('ConnectionConfig tests', () => {
    test('error message is shown when reading corrupt config file', () => {
        let bufferMock = TypeMoq.Mock.ofType(Buffer, TypeMoq.MockBehavior.Loose, 0);
        bufferMock.setup(x => x.toString()).returns(() => corruptJson);

        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.readFileSync(TypeMoq.It.isAny())).returns(() => bufferMock.object);

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that reads a corrupt json file
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        config.readConnectionsFromConfigFile();

        // Verify that an error message was displayed to the user
        vscodeWrapperMock.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test('no error message is shown when reading valid config file', () => {
        let bufferMock = TypeMoq.Mock.ofType(Buffer, TypeMoq.MockBehavior.Loose, 0);
        bufferMock.setup(x => x.toString()).returns(() => validJson);

        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.readFileSync(TypeMoq.It.isAny())).returns(() => bufferMock.object);

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that reads a valid json file
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        let profiles: IConnectionProfile[] = config.readConnectionsFromConfigFile();

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

    test('error message is shown when config file is missing array title', () => {
        let bufferMock = TypeMoq.Mock.ofType(Buffer, TypeMoq.MockBehavior.Loose, 0);
        bufferMock.setup(x => x.toString()).returns(() => arrayTitleMissingJson);

        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.readFileSync(TypeMoq.It.isAny())).returns(() => bufferMock.object);

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that reads a json file with the array title missing
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        config.readConnectionsFromConfigFile();

        // Verify that an error message was shown to the user
        vscodeWrapperMock.verify(x => x.showErrorMessage(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });
});
