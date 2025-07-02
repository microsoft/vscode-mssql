/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerStatusView } from "../../src/extension/languageservice/serverStatus";
import { assert } from "chai";
import * as Constants from "../../src/extension/constants/constants";

suite("Server Status View Tests", () => {
    let serverStatusView: ServerStatusView;

    setup(() => {
        serverStatusView = new ServerStatusView();
    });

    test("Test installing service status", (done) => {
        serverStatusView.installingService();
        let p = new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                let statusBarItem = serverStatusView.statusBarItem;
                assert.isUndefined(
                    statusBarItem.command,
                    "Status Bar Item command should be undefined",
                );
                let installingServiceText = "$(desktop-download) " + Constants.serviceInstalling;
                assert.isTrue(
                    statusBarItem.text.includes(installingServiceText),
                    "Status Bar Item text should be updated",
                );
                serverStatusView.dispose();
                resolve();
            }, 300);
        });
        void p.then(() => done());
    });

    test("Test update service download progress status", () => {
        serverStatusView.updateServiceDownloadingProgress(50);
        let statusBarItem = serverStatusView.statusBarItem;
        let progressText = "$(cloud-download) " + `${Constants.serviceDownloading} ... 50%`;
        assert.equal(
            statusBarItem.text,
            progressText,
            "Status bar item text should show the correct progress percentage",
        );
        serverStatusView.dispose();
    });

    test("Test service installed status", () => {
        serverStatusView.serviceInstalled();
        let statusBarItem = serverStatusView.statusBarItem;
        assert.isUndefined(statusBarItem.command, "Status Bar Item command should be undefined");
        assert.equal(
            statusBarItem.text,
            Constants.serviceInstalled,
            "Status Bar Item text should show installed",
        );
        serverStatusView.dispose();
    });

    test("Test service installation failed status", () => {
        serverStatusView.serviceInstallationFailed();
        let statusBarItem = serverStatusView.statusBarItem;
        assert.isUndefined(statusBarItem.command, "Status Bar Item command should be undefined");
        assert.equal(
            statusBarItem.text,
            Constants.serviceInstallationFailed,
            "Status Bar Item text should show installation failure",
        );
        serverStatusView.dispose();
    });
});
