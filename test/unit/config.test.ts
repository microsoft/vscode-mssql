/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";

import Config from "../../src/configurations/configUtils";

suite("Config Tests", () => {
    test("getSqlToolsServiceDownloadUrl should return valid value", (done) => {
        return new Promise((resolve, reject) => {
            let config = new Config();
            let serviceDownloawUrl = config.getSqlToolsServiceDownloadUrl;
            assert.notEqual(serviceDownloawUrl, undefined);
            done();
        });
    });
});
