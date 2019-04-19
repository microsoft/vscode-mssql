import assert = require('assert');
import Telemetry from '../src/models/telemetry';

suite('Telemetry Tests', () => {
    test('Path before /out/ is stripped', () => {
        let errorString = '/User/myuser/vscode/extensions/ms-mssql.mssql-0.1.5/out/src/controller/mainController.js:216.45';
        let expectedErrorString = 'src/controller/mainController.js:216.45';
        let actualErrorString = Telemetry.FilterErrorPath(errorString);
        assert.equal(actualErrorString, expectedErrorString);
    });

    test('Path without /out/ is retained', () => {
        let errorString = '/User/should/never/happen/src/controller/mainController.js:216.45';
        let actualErrorString = Telemetry.FilterErrorPath(errorString);
        assert.equal(actualErrorString, errorString);
    });
});
