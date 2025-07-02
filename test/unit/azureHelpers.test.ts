/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { AzureAccountService } from "../../src/extension/services/azureAccountService";
import * as sinon from "sinon";
import * as azureHelpers from "../../src/extension/connectionconfig/azureHelpers";
import { Logger } from "../../src/extension/models/logger";
import { IAccount } from "vscode-mssql";

suite("Azure Helpers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockAzureAccountService: AzureAccountService;
    let mockLogger: Logger;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockAzureAccountService = sandbox.createStubInstance(AzureAccountService);
        mockLogger = sandbox.createStubInstance(Logger);
    });

    teardown(() => {
        sandbox.restore();
    });
    test("getTenants handles error cases", async () => {
        const getAccountsStub = mockAzureAccountService.getAccounts as sinon.SinonStub;
        // undefined tenants
        getAccountsStub.resolves([
            {
                displayInfo: {
                    userId: "test-user-id",
                },
                properties: {
                    tenants: undefined,
                },
            } as IAccount,
        ]);

        let result = await azureHelpers.getTenants(
            mockAzureAccountService,
            "test-user-id",
            mockLogger,
        );
        expect(result).to.be.an("array").that.is.empty;
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined tenants"),
            "logger should have been called with 'undefined tenants'",
        ).to.be.true;

        // reset mocks for next case
        getAccountsStub.reset();
        (mockLogger.error as sinon.SinonStub).resetHistory();

        // undefined properties
        getAccountsStub.resolves([
            {
                displayInfo: {
                    userId: "test-user-id",
                },
                properties: undefined,
            } as IAccount,
        ]);

        result = await azureHelpers.getTenants(mockAzureAccountService, "test-user-id", mockLogger);
        expect(result).to.be.an("array").that.is.empty;
        expect(
            (mockLogger.error as sinon.SinonStub).calledWithMatch("undefined properties"),
            "logger should have been called with 'undefined properties'",
        ).to.be.true;
    });

    test("extractFromResourceId", () => {
        const resourceId =
            "subscriptions/test-subscription/resourceGroups/test-resource-group/providers/Microsoft.Sql/servers/test-server/databases/test-database";
        let result = azureHelpers.extractFromResourceId(resourceId, "servers");
        expect(result).to.equal("test-server");

        result = azureHelpers.extractFromResourceId(resourceId, "databases");
        expect(result).to.equal("test-database");

        result = azureHelpers.extractFromResourceId(resourceId, "fakeProperty");
        expect(result).to.be.undefined;
    });
});
