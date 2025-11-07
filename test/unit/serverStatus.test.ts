/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServerStatusView } from "../../src/languageservice/serverStatus";
import { expect } from "chai";
import * as Constants from "../../src/constants/constants";

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
                expect(statusBarItem.command, "Status Bar Item command should be undefined").to.be
                    .undefined;
                let installingServiceText = "$(desktop-download) " + Constants.serviceInstalling;
                expect(
                    statusBarItem.text.includes(installingServiceText),
                    "Status Bar Item text should be updated",
                ).to.be.true;
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
        expect(
            statusBarItem.text,
            "Status bar item text should show the correct progress percentage",
        ).to.equal(progressText);
        serverStatusView.dispose();
    });

    test("Test service installed status", () => {
        serverStatusView.serviceInstalled();
        let statusBarItem = serverStatusView.statusBarItem;
        expect(statusBarItem.command, "Status Bar Item command should be undefined").to.be
            .undefined;
        expect(statusBarItem.text, "Status Bar Item text should show installed").to.equal(
            Constants.serviceInstalled,
        );
        serverStatusView.dispose();
    });

    test("Test service installation failed status", () => {
        serverStatusView.serviceInstallationFailed();
        let statusBarItem = serverStatusView.statusBarItem;
        expect(statusBarItem.command, "Status Bar Item command should be undefined").to.be
            .undefined;
        expect(
            statusBarItem.text,
            "Status Bar Item text should show installation failure",
        ).to.equal(Constants.serviceInstallationFailed);
        serverStatusView.dispose();
    });
});
