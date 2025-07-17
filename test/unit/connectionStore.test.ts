/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ICredentialStore } from "../../src/credentialstore/icredentialstore";
import { Logger } from "../../src/models/logger";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { expect } from "chai";
import * as sinon from "sinon";

suite("ConnectionStore Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStore: ConnectionStore;

    let mockContext: sinon.SinonStubbedInstance<vscode.ExtensionContext>;
    let mockLogger: sinon.SinonStubbedInstance<Logger>;
    let mockCredentialStore: sinon.SinonStubbedInstance<ICredentialStore>;
    let mockConnectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(async () => {
        sandbox = sinon.createSandbox();

        // Create stub for vscode.ExtensionContext (interface)
        mockContext = {} as sinon.SinonStubbedInstance<vscode.ExtensionContext>;

        // Create stub instances for classes
        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockLogger = sandbox.createStubInstance(Logger);
        mockConnectionConfig = sandbox.createStubInstance(ConnectionConfig);

        // Create stub for ICredentialStore (interface)
        mockCredentialStore = {} as sinon.SinonStubbedInstance<ICredentialStore>;

        // Set up the getConnections method to return an empty array
        mockConnectionConfig.getConnections.resolves([]);

        // Set up the initialized property to return a resolved promise
        const resolvedDeferred = {
            promise: Promise.resolve(),
            resolve: () => {},
            reject: () => {},
            then: (onfulfilled?: () => void) => {
                if (onfulfilled) {
                    onfulfilled();
                }
                return Promise.resolve();
            },
        };
        
        // Use Object.defineProperty to define the initialized property on the mock instance
        Object.defineProperty(mockConnectionConfig, 'initialized', {
            get: () => resolvedDeferred,
            enumerable: true,
            configurable: true
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Initializes correctly", async () => {
        expect(() => {
            connectionStore = new ConnectionStore(
                mockContext,
                mockCredentialStore,
                mockLogger,
                mockConnectionConfig,
                mockVscodeWrapper,
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
