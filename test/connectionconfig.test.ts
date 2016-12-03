import * as TypeMoq from 'typemoq';

import { ConnectionConfig } from '../src/connectionconfig/connectionconfig';
import { IConnectionProfile } from '../src/models/interfaces';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

import assert = require('assert');
import fs = require('fs');

const corruptJson =
`{
    mssql.connections: [
        {}
        corrupt!@#$%
    ]
}`;

const validJson =
`
{
    "mssql.connections": [
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

suite('ConnectionConfig tests', () => {
    test('error message is shown when reading corrupt config file', () => {
        let bufferMock = TypeMoq.Mock.ofType(Buffer, TypeMoq.MockBehavior.Loose, 0);
        bufferMock.setup(x => x.toString()).returns(() => corruptJson);

        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.readFileSync(TypeMoq.It.isAny())).returns(() => bufferMock.object);

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that reads a corrupt json file
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        config.readAndParseSettingsFile('settings.json');

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
        let parseResult = config.readAndParseSettingsFile('settings.json');
        let profiles: IConnectionProfile[] = config.getProfilesFromParsedSettingsFile(parseResult);

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

    test('error is thrown when config directory cannot be created', done => {
        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.mkdir(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((path, errorHandler) => {
                let error = {
                    code: 'EACCES'
                };
                errorHandler(error);
            });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that tries to create a config directory without appropriate permissions
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        config.createConfigFileDirectory().then(() => {
            done('Promise should not resolve successfully');
        }).catch(err => {
            // Expect an error to be thrown
            done();
        });
    });

    test('error is not thrown when config directory already exists', done => {
        let fsMock = TypeMoq.Mock.ofInstance(fs);
        fsMock.setup(x => x.mkdir(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((path, errorHandler) => {
                let error = {
                    code: 'EEXIST'
                };
                errorHandler(error);
            });

        let vscodeWrapperMock = TypeMoq.Mock.ofType(VscodeWrapper);

        // Given a connection config object that tries to create a config directory when it already exists
        let config = new ConnectionConfig(fsMock.object, vscodeWrapperMock.object);
        config.createConfigFileDirectory().then(() => {
            // Expect no error to be thrown
            done();
        }).catch(err => {
            done(err);
        });
    });
});
