/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscodeMssql from "vscode-mssql";

export interface TestUtils {
    vscodeMssqlIExtension: sinon.SinonStubbedInstance<vscodeMssql.IExtension>;
}

/**
 * Creates a sinon-stubbed instance of vscodeMssql.IExtension.
 * Accepts an optional sandbox; falls back to bare sinon if none provided.
 */
export function createTestUtils(sandbox?: sinon.SinonSandbox): TestUtils {
    const s = sandbox ?? sinon;

    const dacFxStub = {
        exportBacpac: s.stub(),
        importBacpac: s.stub(),
        extractDacpac: s.stub(),
        createProjectFromDatabase: s.stub(),
        deployDacpac: s.stub(),
        generateDeployScript: s.stub(),
        generateDeployPlan: s.stub(),
        getOptionsFromProfile: s.stub(),
        validateStreamingJob: s.stub(),
        savePublishProfile: s.stub(),
        getDeploymentOptions: s.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscodeMssql.IDacFxService>;

    const sqlProjectsStub = {
        openProject: s.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscodeMssql.ISqlProjectsService>;

    const schemaCompareStub =
        {} as unknown as sinon.SinonStubbedInstance<vscodeMssql.ISchemaCompareService>;

    const azureAccountServiceStub = {
        addAccount: s.stub(),
        getAccounts: s.stub(),
        getAccountSecurityToken: s.stub(),
        getAccountSessions: s.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscodeMssql.IAzureAccountService>;

    const azureResourceServiceStub = {
        getLocations: s.stub(),
        getResourceGroups: s.stub(),
        createOrUpdateServer: s.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscodeMssql.IAzureResourceService>;

    const vscodeMssqlStub = {
        sqlToolsServicePath: "",
        dacFx: dacFxStub,
        sqlProjects: sqlProjectsStub,
        schemaCompare: schemaCompareStub,
        azureAccountService: azureAccountServiceStub,
        azureResourceService: azureResourceServiceStub,
        promptForFirewallRule: s.stub(),
        sendRequest: s.stub(),
        promptForConnection: s.stub(),
        connect: s.stub(),
        listDatabases: s.stub(),
        getDatabaseNameFromTreeNode: s.stub(),
        getConnectionString: s.stub(),
        createConnectionDetails: s.stub(),
        getServerInfo: s.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscodeMssql.IExtension>;

    return {
        vscodeMssqlIExtension: vscodeMssqlStub,
    };
}

// Mock test data
export const mockConnectionInfo: vscodeMssql.IConnectionInfo = {
    server: "Server",
    database: "Database",
    user: "User",
    password: "Placeholder",
    email: "test-email",
    accountId: "test-account-id",
    tenantId: "test-tenant-id",
    port: 1234,
    authenticationType: vscodeMssql.AuthenticationType.SqlLogin,
    azureAccountToken: "",
    expiresOn: 0,
    encrypt: false,
    trustServerCertificate: false,
    hostNameInCertificate: "",
    persistSecurityInfo: false,
    connectTimeout: 15,
    connectRetryCount: 0,
    connectRetryInterval: 0,
    applicationName: "vscode-mssql",
    workstationId: "test",
    applicationIntent: "",
    currentLanguage: "",
    pooling: true,
    maxPoolSize: 15,
    minPoolSize: 0,
    loadBalanceTimeout: 0,
    replication: false,
    attachDbFilename: "",
    failoverPartner: "",
    multiSubnetFailover: false,
    multipleActiveResultSets: false,
    packetSize: 8192,
    typeSystemVersion: "Latest",
    connectionString: "",
    commandTimeout: undefined,
};
