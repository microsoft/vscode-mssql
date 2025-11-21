/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { FirewallService } from "../../src/firewall/firewallService";
import { AccountService } from "../../src/azure/accountService";
import {
  HandleFirewallRuleRequest,
  IHandleFirewallRuleResponse,
  CreateFirewallRuleRequest,
  ICreateFirewallRuleResponse,
  ICreateFirewallRuleParams,
} from "../../src/models/contracts/firewall/firewallRequest";
import * as Constants from "../../src/constants/constants";

suite("Firewall Service Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
  let accountService: sinon.SinonStubbedInstance<AccountService>;
  let firewallService: FirewallService;

  setup(() => {
    sandbox = sinon.createSandbox();
    client = sandbox.createStubInstance(SqlToolsServiceClient);
    accountService = sandbox.createStubInstance(AccountService);

    sandbox.stub(accountService, "client").get(() => client);
    firewallService = new FirewallService(accountService);
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Handle Firewall Rule test", async () => {
    const mockResponse: IHandleFirewallRuleResponse = {
      result: true,
      ipAddress: "128.0.0.0",
    };
    client.sendResourceRequest.resolves(mockResponse);

    const handleResult = await firewallService.handleFirewallRule(
      12345,
      "firewall error!",
    );

    expect(handleResult).to.deep.equal(mockResponse);
    sinon.assert.calledOnceWithExactly(
      client.sendResourceRequest,
      HandleFirewallRuleRequest.type,
      {
        errorCode: 12345,
        errorMessage: "firewall error!",
        connectionTypeId: Constants.mssqlProviderName,
      },
    );
  });

  test("Create Firewall Rule Test", async () => {
    const mockResponse: ICreateFirewallRuleResponse = {
      result: true,
      errorMessage: "",
    };
    client.sendResourceRequest.resolves(mockResponse);

    const request = {
      account: { properties: { tenants: [] } },
      firewallRuleName: "Test Rule",
      startIpAddress: "1.2.3.1",
      endIpAddress: "1.2.3.255",
      serverName: "test_server",
      securityTokenMappings: {},
    } as ICreateFirewallRuleParams;

    const result = await firewallService.createFirewallRule(request);

    expect(result).to.deep.equal(mockResponse);
    sinon.assert.calledOnceWithExactly(
      client.sendResourceRequest,
      CreateFirewallRuleRequest.type,
      request,
    );
  });
});
