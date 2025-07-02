/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { ConnectionStore } from "../../src/extension/models/connectionStore";
import { ICredentialStore } from "../../src/extension/credentialstore/icredentialstore";
import { Logger } from "../../src/extension/models/logger";
import { ConnectionConfig } from "../../src/extension/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import { expect } from "chai";
import * as sinon from "sinon";

suite("ConnectionStore Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: ConnectionStore;

    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockLogger: TypeMoq.IMock<Logger>;
    let mockCredentialStore: TypeMoq.IMock<ICredentialStore>;
    let mockConnectionConfig: TypeMoq.IMock<ConnectionConfig>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockLogger = TypeMoq.Mock.ofType<Logger>();
        mockCredentialStore = TypeMoq.Mock.ofType<ICredentialStore>();
        mockConnectionConfig = TypeMoq.Mock.ofType<ConnectionConfig>();

        mockConnectionConfig
            .setup((c) => c.getConnections(TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve([]);
            });
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Initializes correctly", async () => {
        expect(() => {
            connectionStore = new ConnectionStore(
                mockContext.object,
                mockCredentialStore.object,
                mockLogger.object,
                mockConnectionConfig.object,
                mockVscodeWrapper.object,
            );
        }).to.not.throw();

        await connectionStore.initialized; // Wait for initialization to complete
    });

    test("formatCredentialId", () => {
        const testServer = "localhost";
        const testDatabase = "TestDb";
        const testUser = "testUser";

        let credentialId = ConnectionStore.formatCredentialId(
            testServer,
            testDatabase,
            testUser,
            ConnectionStore.CRED_MRU_USER,
            false, // isConnectionString
        );

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Mru|server:localhost|db:TestDb|user:testUser",
        );

        credentialId = ConnectionStore.formatCredentialId(
            testServer,
            testDatabase,
            testUser,
            undefined, // itemType
            true, // isConnectionString
        );

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Profile|server:localhost|db:TestDb|user:testUser|isConnectionString:true",
        );

        credentialId = ConnectionStore.formatCredentialId(testServer, testDatabase);

        expect(credentialId).to.equal(
            "Microsoft.SqlTools|itemtype:Profile|server:localhost|db:TestDb",
        );

        credentialId = ConnectionStore.formatCredentialId(testServer);

        expect(credentialId).to.equal("Microsoft.SqlTools|itemtype:Profile|server:localhost");
    });
});
