/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as assert from "assert";

import StatusView from "../../src/views/statusView";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as Constants from "../../src/constants/constants";
import { IServerInfo } from "vscode-mssql";
import { IConnectionProfile } from "../../src/models/interfaces";
import { expect } from "chai";
import { ConnectionStore } from "../../src/models/connectionStore";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

suite("Status View Tests", () => {
    test("updateStatusMessage should not immediately update status message for definition request", (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = LocalizedConstants.definitionRequestedStatus;
            let currentStatus = "";
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = "";
            let expectedStatusMessage = LocalizedConstants.gettingDefinitionMessage;
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, "");
            setTimeout(() => {
                assert.equal(actualStatusMessage, expectedStatusMessage);
            }, 600);
            statusView.dispose();
            done();
        });
    });

    test("updateStatusMessage should not update status message for definition request if already completed", (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = LocalizedConstants.definitionRequestedStatus;
            let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = "";
            let expectedStatusMessage = "";
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, "");
            setTimeout(() => {
                assert.equal(actualStatusMessage, expectedStatusMessage);
            }, 600);
            statusView.dispose();
            done();
        });
    });

    test("updateStatusMessage should update status message for definition request completed", (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = LocalizedConstants.definitionRequestCompletedStatus;
            let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = "";
            let expectedStatusMessage = "";
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, expectedStatusMessage);
            statusView.dispose();
            done();
        });
    });

    test("updateStatusMessage should update status message for updating intelliSense", (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = LocalizedConstants.updatingIntelliSenseStatus;
            let currentStatus = "";
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = "";
            let expectedStatusMessage = LocalizedConstants.updatingIntelliSenseLabel;
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, expectedStatusMessage);
            statusView.dispose();
            done();
        });
    });

    test("updateStatusMessage should update status message for intelliSense updated status", (done) => {
        return new Promise((resolve, reject) => {
            let statusView = new StatusView();
            let newStatus = LocalizedConstants.intelliSenseUpdatedStatus;
            let currentStatus = "";
            let getCurrentStatus = () => {
                return currentStatus;
            };
            let actualStatusMessage = "";
            let expectedStatusMessage = "";
            let updateMessage = (message) => {
                actualStatusMessage = message;
            };
            statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
            assert.equal(actualStatusMessage, expectedStatusMessage);
            statusView.dispose();
            done();
        });
    });

    suite("Colorization tests", () => {
        let sandbox: sinon.SinonSandbox;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

        const testFileUri = "untitledFile";

        const testGroup = {
            name: "Test Group",
            id: "test-group-id",
            color: "#FF0000",
        };

        const testConn = {
            server: "testServer",
            database: "testDatabase",
            user: "testUser",
            id: "test-connection-id",
            groupId: testGroup.id,
        } as IConnectionProfile;

        const testServerInfo = {} as IServerInfo;

        setup(() => {
            sandbox = sinon.createSandbox();
            mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        });

        teardown(() => {
            sandbox.restore();
        });

        test("should not colorize if no connection store", async () => {
            mockVscodeWrapper.getConfiguration.returns({ get: () => false } as any);

            const statusView = new StatusView(mockVscodeWrapper);
            await statusView.connectSuccess(testFileUri, testConn, testServerInfo);

            expect(statusView["getStatusBar"](testFileUri).connectionId).to.equal(testConn.id);
            expect(statusView["getStatusBar"](testFileUri).statusConnection.color).to.equal(
                undefined,
            );
        });

        test("should not colorize if flag is disabled", async () => {
            mockVscodeWrapper.getConfiguration.returns({ get: () => false } as any);

            let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionStore.getGroupForConnectionId.resolves(testGroup);

            let statusView = new StatusView(mockVscodeWrapper);
            statusView.setConnectionStore(mockConnectionStore);

            await statusView.connectSuccess(testFileUri, testConn, testServerInfo);

            expect(statusView["getStatusBar"](testFileUri).connectionId).to.equal(testConn.id);
            expect(statusView["getStatusBar"](testFileUri).statusConnection.color).to.equal(
                undefined,
            );
        });

        test("should colorize by default when connection store is accessible and no flag is explicitly set", async () => {
            // Simulate default behavior - VS Code's configuration system will return true as the default
            // since we changed the default in package.json from false to true
            mockVscodeWrapper.getConfiguration.returns({
                get: (key: string) => {
                    if (key === Constants.configStatusBarEnableConnectionColor) {
                        return true; // This simulates VS Code using our new default value
                    }
                    return undefined;
                },
            } as any);

            let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionStore.getGroupForConnectionId.resolves(testGroup);

            const statusView = new StatusView(mockVscodeWrapper);
            statusView.setConnectionStore(mockConnectionStore);

            await statusView.connectSuccess(testFileUri, testConn, testServerInfo);
            expect(statusView["getStatusBar"](testFileUri).connectionId).to.equal(testConn.id);
            // With the new default (true), coloring should work by default
            expect(statusView["getStatusBar"](testFileUri).statusConnection.color).to.equal(
                testGroup.color,
            );
        });

        test("should colorize when connection store is accessible and flag is enabled", async () => {
            mockVscodeWrapper.getConfiguration.returns({ get: () => true } as any);

            let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
            mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
            mockConnectionStore.getGroupForConnectionId.resolves(testGroup);

            const statusView = new StatusView(mockVscodeWrapper);
            statusView.setConnectionStore(mockConnectionStore);

            await statusView.connectSuccess(testFileUri, testConn, testServerInfo);
            expect(statusView["getStatusBar"](testFileUri).connectionId).to.equal(testConn.id);
            expect(statusView["getStatusBar"](testFileUri).statusConnection.color).to.equal(
                testGroup.color,
            );
        });
    });
});
