import assert = require('assert');

import * as Extension from '../src/extension';
import ConnectionManager from '../src/controllers/connectionManager';
import MainController from '../src/controllers/controller';
import Telemetry from '../src/models/telemetry';

suite('Initialization Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('Connection manager is initialized properly', () => {
        // Verify that the connection manager was initialized properly
        let controller: MainController = Extension.getController();
        let connectionManager: ConnectionManager = controller.connectionManager;
        assert.notStrictEqual(undefined, connectionManager.client);
    });
});
