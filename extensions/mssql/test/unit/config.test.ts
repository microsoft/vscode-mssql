/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import ConfigUtils from "../../src/configurations/configUtils";

suite("Config Tests", () => {
    test("getSqlToolsServiceDownloadUrl should return valid value", (done) => {
        return new Promise((resolve, reject) => {
            let config = new ConfigUtils();
            let serviceDownloawUrl = config.getSqlToolsServiceDownloadUrl;
            expect(serviceDownloawUrl).to.not.be.undefined;
            done();
        });
    });
});
