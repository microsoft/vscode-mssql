/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";

import StatusView from "../../src/views/statusView";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { IServerInfo } from "vscode-mssql";
import { IConnectionGroup, IConnectionProfile } from "../../src/models/interfaces";
import { expect } from "chai";
import { ConnectionStore } from "../../src/models/connectionStore";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ConfigurationTarget } from "vscode";

suite("Status View Tests", () => {
    test("updateStatusMessage should not immediately update status message for definition request", async () => {
        let statusView = new StatusView();
        let newStatus = LocalizedConstants.definitionRequestedStatus;
        let currentStatus = "";
        let getCurrentStatus = () => {
            return currentStatus;
        };
        let actualStatusMessage = "";
        let expectedStatusMessage = LocalizedConstants.gettingDefinitionMessage;
        let updateMessage = (message: string) => {
            actualStatusMessage = message;
        };
        statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
        expect(actualStatusMessage).to.equal("");

        await new Promise((resolve) => {
            setTimeout(() => {
                expect(actualStatusMessage).to.equal(expectedStatusMessage);
                resolve(undefined);
            }, 600);
        });

        statusView.dispose();
    });

    test("updateStatusMessage should not update status message for definition request if already completed", async () => {
        let statusView = new StatusView();
        let newStatus = LocalizedConstants.definitionRequestedStatus;
        let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
        let getCurrentStatus = () => {
            return currentStatus;
        };
        let actualStatusMessage = "";
        let expectedStatusMessage = "";
        let updateMessage = (message: string) => {
            actualStatusMessage = message;
        };
        statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
        expect(actualStatusMessage).to.equal("");

        await new Promise((resolve) => {
            setTimeout(() => {
                expect(actualStatusMessage).to.equal(expectedStatusMessage);
                resolve(undefined);
            }, 600);
        });

        statusView.dispose();
    });

    test("updateStatusMessage should update status message for definition request completed", () => {
        let statusView = new StatusView();
        let newStatus = LocalizedConstants.definitionRequestCompletedStatus;
        let currentStatus = LocalizedConstants.definitionRequestCompletedStatus;
        let getCurrentStatus = () => {
            return currentStatus;
        };
        let actualStatusMessage = "";
        let expectedStatusMessage = "";
        let updateMessage = (message: string) => {
            actualStatusMessage = message;
        };
        statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
        expect(actualStatusMessage).to.equal(expectedStatusMessage);
        statusView.dispose();
    });

    test("updateStatusMessage should update status message for updating intelliSense", () => {
        let statusView = new StatusView();
        let newStatus = LocalizedConstants.updatingIntelliSenseStatus;
        let currentStatus = "";
        let getCurrentStatus = () => {
            return currentStatus;
        };
        let actualStatusMessage = "";
        let expectedStatusMessage = LocalizedConstants.updatingIntelliSenseLabel;
        let updateMessage = (message: string) => {
            actualStatusMessage = message;
        };
        statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
        expect(actualStatusMessage).to.equal(expectedStatusMessage);
        statusView.dispose();
    });

    test("updateStatusMessage should update status message for intelliSense updated status", () => {
        let statusView = new StatusView();
        let newStatus = LocalizedConstants.intelliSenseUpdatedStatus;
        let currentStatus = "";
        let getCurrentStatus = () => {
            return currentStatus;
        };
        let actualStatusMessage = "";
        let expectedStatusMessage = "";
        let updateMessage = (message: string) => {
            actualStatusMessage = message;
        };
        statusView.updateStatusMessage(newStatus, getCurrentStatus, updateMessage);
        expect(actualStatusMessage).to.equal(expectedStatusMessage);
        statusView.dispose();
    });

    suite("Colorization tests", () => {
        let sandbox: sinon.SinonSandbox;
        let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

        const testFileUri = "untitledFile";

        const testGroup: IConnectionGroup = {
            name: "Test Group",
            id: "test-group-id",
            color: "#FF0000",
            configSource: ConfigurationTarget.Global,
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
