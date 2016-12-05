import assert = require('assert');
import os = require('os');
import vscode = require('vscode');

import * as Extension from '../src/extension';
import ConnectionManager from '../src/controllers/connectionManager';
import MainController from '../src/controllers/mainController';
import Telemetry from '../src/models/telemetry';

function ensureExtensionIsActive(): Promise<any> {
    return new Promise((resolve, reject) => {
        waitForExtensionToBeActive(resolve);
    });
}

function waitForExtensionToBeActive(resolve): void {
    if (!vscode.extensions.getExtension('Microsoft.mssql').isActive) {
        setTimeout(waitForExtensionToBeActive.bind(this, resolve), 50);
    } else {
        resolve();
    }
}

suite('Initialization Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('Connection manager is initialized properly', function(done): void { // Note: this can't be an arrow function (=>), otherwise this.timeout() breaks
        this.timeout(10000); // Service installation usually takes a bit longer than the default 2000ms on a fresh install

        // Trigger extension activation by opening an empty SQL file
        let fileUri: vscode.Uri;
        if (os.platform() === 'win32') {
            fileUri = vscode.Uri.parse('untitled:%5Ctest.sql');
        } else {
            fileUri = vscode.Uri.parse('untitled:%2Ftest.sql');
        }
        vscode.workspace.openTextDocument(fileUri);

        // Wait for the extension to activate
        ensureExtensionIsActive().then(() => {
            // Verify that the connection manager was initialized properly
            let controller: MainController = Extension.getController();
            let connectionManager: ConnectionManager = controller.connectionManager;
            assert.notStrictEqual(undefined, connectionManager.client);
            done();
        });
    });
});
