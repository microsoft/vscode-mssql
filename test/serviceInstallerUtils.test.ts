/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { assert } from 'chai';
import { StubStatusView, StubLogger, getServiceInstallDirectoryRoot, getServiceInstallDirectory, installService } from '../src/languageservice/serviceInstallerUtil';

function setupConsole(): string[] {
    let logs = [];
    console.log = (message) => {
        logs.push(message);
    };
    return logs;
}

function setupStdOut(): string[] {
    let stdOut = [];
    process.stdout.write = (message, callback) => {
        stdOut.push(message);
        return true;
    };
    return stdOut;
}

suite('Stub Status View tests', () => {

    let stubStatusView: StubStatusView = new StubStatusView();

    test('Test installing service method', () => {
        let logs = setupConsole();
        stubStatusView.installingService();
        let log = logs[0];
        assert.equal(log, '...');
    });

    test('Test service installed method', () => {
        let logs = setupConsole();
        stubStatusView.serviceInstalled();
        let log = logs[0];
        assert.equal(log, 'Service installed');
    });

    test('Test service installation failed method', () => {
        let logs = setupConsole();
        stubStatusView.serviceInstallationFailed();
        let log = logs[0];
        assert.equal(log, 'Service installation failed');
    });

    test('Test update service downloading progress method', () => {
        let stdOut = setupStdOut();
        stubStatusView.updateServiceDownloadingProgress(100);
        let output = stdOut[0];
        assert.equal(output, '100%');
    });
});

suite('Stub Logger tests', () => {

    let stubLogger: StubLogger = new StubLogger();

    test('Test logdebug method', () => {
        let logs = setupConsole();
        stubLogger.logDebug('test');
        let log = logs[0];
        assert.equal(log, 'test');
    });

    test('Test increaseIndent method', () => {
        let logs = setupConsole();
        stubLogger.increaseIndent();
        let log = logs[0];
        assert.equal(log, 'increaseIndent');
    });

    test('Test decreaseIndent method', () => {
        let logs = setupConsole();
        stubLogger.decreaseIndent();
        let log = logs[0];
        assert.equal(log, 'decreaseIndent');
    });

    test('Test append method', () => {
        let stdOut = setupStdOut();
        stubLogger.append('test');
        let output = stdOut[0];
        assert.equal(output, 'test');
    });

    test('Test appendLine method', () => {
        let logs = setupConsole();
        stubLogger.appendLine('test');
        let log = logs[0];
        assert.equal(log, 'test');
    });
});

suite('Test Service Installer Util functions', () => {

    test('Test getServiceInstallDirectoryRoot function', () => {
        let path = getServiceInstallDirectoryRoot();
        assert.isNotNull(path, 'Service install directory root should not be null');
    });

    // test('Test getgetServiceInstallDirectory function', async () => {
    //     let dir = await getServiceInstallDirectory(undefined);
    //     assert.isNotNull(dir, 'Service install directory should not be null');
    // });

    test('Test installService function', async () => {
        let installedPath = await installService(undefined);
        assert.isNotNull(installedPath, 'Service installed path should not be null');
    });
});



