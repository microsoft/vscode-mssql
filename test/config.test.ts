/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import assert = require('assert');

import Config from  '../src/configurations/config';
import Telemetry from '../src/models/telemetry';

suite('Config Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('getSqlToolsServiceDownloadUrl should return valid value', (done) => {
        return new Promise((resolve, reject) => {
            let config = new Config();
            let serviceDownloawUrl = config.getSqlToolsServiceDownloadUrl;
            assert.notEqual(serviceDownloawUrl, undefined);
            done();
         });
    });
});
