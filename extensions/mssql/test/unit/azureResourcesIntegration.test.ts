/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";

import { AzureResourcesExtensionIntegration } from "../../src/integration/azureResourcesIntegration";
import { MssqlProtocolHandler } from "../../src/mssqlProtocolHandler";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import {
    mockAccounts,
    mockAzureResources,
    mockServerName,
    mockSubscriptions,
} from "./azureHelperStubs";

chai.use(sinonChai);

suite("AzureResourcesExtensionIntegration Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let protocolHandler: sinon.SinonStubbedInstance<MssqlProtocolHandler>;
    let integration: AzureResourcesExtensionIntegration;

    const dnsSuffix = ".database.windows.net";
    const accountId = mockAccounts.signedInAccount.id;
    const tenantId = mockSubscriptions[0].tenantId;

    const buildResourceNode = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resource: any = mockAzureResources.azureSqlDbServer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        subscriptionOverrides: any = {},
    ): unknown => {
        const subscription = {
            environment: { sqlServerHostnameSuffix: dnsSuffix },
            account: { id: accountId },
            tenantId,
            ...subscriptionOverrides,
        };

        return { resource: { ...resource, subscription } };
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        protocolHandler = sandbox.createStubInstance(MssqlProtocolHandler);
        protocolHandler.handleUri.resolves();

        integration = new AzureResourcesExtensionIntegration(protocolHandler);

        // Silence the internal logger to avoid writing to the output channel during tests.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (integration as any)._logger = {
            info: sandbox.stub(),
            error: sandbox.stub(),
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("ignores nodes that are not Azure resource nodes", async () => {
        await integration["invokeForAzureSqlResource"](undefined);
        await integration["invokeForAzureSqlResource"]({});
        await integration["invokeForAzureSqlResource"]("not a node");

        expect(protocolHandler.handleUri).to.not.have.been.called;
    });

    test("builds a connect URI for a server-only resource", async () => {
        await integration["invokeForAzureSqlResource"](
            buildResourceNode(mockAzureResources.azureSqlDbServer),
        );

        const uri = protocolHandler.handleUri.firstCall.args[0];
        expect(uri.scheme).to.equal(vscode.env.uriScheme);
        expect(uri.authority).to.equal("ms-mssql.mssql");
        expect(uri.path).to.equal("/connect");

        const params = new URLSearchParams(uri.query);
        expect(params.get("server")).to.equal(`${mockServerName}${dnsSuffix}`);
        expect(params.get("authenticationType")).to.equal(AuthenticationType.AzureMFA);
        expect(params.get("profileName")).to.equal(mockServerName);
        expect(params.get("source")).to.equal("vscode-azureresourcegroups");
        expect(params.has("database")).to.be.false;
    });

    test("includes database details when the resource is a database", async () => {
        const database = mockAzureResources.azureSqlDbDatabase2;

        await integration["invokeForAzureSqlResource"](buildResourceNode(database));

        const params = new URLSearchParams(protocolHandler.handleUri.firstCall.args[0].query);
        expect(params.get("server")).to.equal(`${mockServerName}${dnsSuffix}`);
        expect(params.get("database")).to.equal(database.name);
        expect(params.get("profileName")).to.equal(`${mockServerName}/${database.name}`);
    });

    test("falls back to the resource name when the id has no server segment", async () => {
        const resource = mockAzureResources.nonDatabaseResource;

        await integration["invokeForAzureSqlResource"](buildResourceNode(resource));

        const params = new URLSearchParams(protocolHandler.handleUri.firstCall.args[0].query);
        expect(params.get("server")).to.equal(`${resource.name}${dnsSuffix}`);
        expect(params.get("profileName")).to.equal(resource.name);
    });

    test("includes accountId and tenantId when present on the subscription", async () => {
        await integration["invokeForAzureSqlResource"](buildResourceNode());

        const params = new URLSearchParams(protocolHandler.handleUri.firstCall.args[0].query);
        expect(params.get("accountId")).to.equal(accountId);
        expect(params.get("tenantId")).to.equal(tenantId);
    });

    test("omits accountId and tenantId when they are absent", async () => {
        await integration["invokeForAzureSqlResource"](
            buildResourceNode(mockAzureResources.azureSqlDbServer, {
                account: undefined,
                tenantId: undefined,
            }),
        );

        const params = new URLSearchParams(protocolHandler.handleUri.firstCall.args[0].query);
        expect(params.has("accountId")).to.be.false;
        expect(params.has("tenantId")).to.be.false;
    });

    test("uses the subscription environment's sql hostname suffix", async () => {
        const customSuffix = ".database.usgovcloudapi.net";

        await integration["invokeForAzureSqlResource"](
            buildResourceNode(mockAzureResources.azureSqlDbServer, {
                environment: { sqlServerHostnameSuffix: customSuffix },
            }),
        );

        const params = new URLSearchParams(protocolHandler.handleUri.firstCall.args[0].query);
        expect(params.get("server")).to.equal(`${mockServerName}${customSuffix}`);
    });

    test("passes the built URI to the protocol handler", async () => {
        await integration["invokeForAzureSqlResource"](buildResourceNode());

        expect(protocolHandler.handleUri).to.have.been.calledOnce;
        const uri = protocolHandler.handleUri.firstCall.args[0];
        expect(uri).to.be.instanceOf(vscode.Uri);
    });
});
