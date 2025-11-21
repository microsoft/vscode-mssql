/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import {
  SubscriptionClient,
  Subscription,
  Subscriptions,
  Location,
} from "@azure/arm-subscriptions";
import { PagedAsyncIterableIterator } from "@azure/core-paging";
import {
  ResourceGroup,
  ResourceGroups,
  ResourceManagementClient,
} from "@azure/arm-resources";
import { AzureResourceController } from "../../src/azure/azureResourceController";
import { getCloudProviderSettings } from "../../src/azure/providerSettings";
import { IAzureAccountSession } from "vscode-mssql";
import { AzureAuthType, IAccount } from "../../src/models/contracts/azure";

chai.use(sinonChai);

suite("Azure SQL client", function (): void {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
  });

  teardown(() => {
    sandbox.restore();
  });

  test("Should return locations successfully", async function (): Promise<void> {
    const pages = createPagedIterator(mockLocations);
    const subscriptions: Subscriptions = {
      listLocations: sandbox.stub().returns(pages),
      list: sandbox.stub().returns(undefined),
      get: sandbox.stub().returns(undefined),
    };
    const subscriptionClient = {
      subscriptions,
    } as unknown as SubscriptionClient;
    const azureSqlClient = new AzureResourceController(
      () => subscriptionClient,
    );

    const result = await azureSqlClient.getLocations(primarySession);

    expect(subscriptions.listLocations).to.have.been.calledOnceWithExactly(
      primarySession.subscription?.subscriptionId,
    );
    expect(result).to.have.lengthOf(mockLocations.length);
  });

  test("Should return resource groups successfully", async function (): Promise<void> {
    const pages = createPagedIterator(mockGroups);
    const resourceGroups: ResourceGroups = {
      list: sandbox.stub().returns(pages),
      get: sandbox.stub().returns(undefined),
      beginDelete: sandbox.stub(),
      beginDeleteAndWait: sandbox.stub(),
      beginExportTemplate: sandbox.stub(),
      beginExportTemplateAndWait: sandbox.stub(),
      checkExistence: sandbox.stub(),
      createOrUpdate: sandbox.stub(),
      update: sandbox.stub(),
    };
    const resourceClient = {
      resourceGroups,
    } as unknown as ResourceManagementClient;
    const azureSqlClient = new AzureResourceController(
      undefined,
      () => resourceClient,
    );

    const result = await azureSqlClient.getResourceGroups(primarySession);

    expect(resourceGroups.list).to.have.been.calledOnceWithExactly();
    expect(result).to.have.lengthOf(mockGroups.length);
    expect(result[0].location).to.equal(mockGroups[0].location);
  });
});

const mockAccounts: IAccount[] = [
  {
    key: undefined!,
    displayInfo: undefined!,
    properties: {
      tenants: [
        {
          id: "",
          displayName: "",
        },
      ],
      azureAuthType: AzureAuthType.AuthCodeGrant,
      isMsAccount: false,
      owningTenant: {
        id: "",
        displayName: "",
      },
      providerSettings: getCloudProviderSettings(),
    },
    isStale: false,
    isSignedIn: true,
  },
];

const mockSubscriptions: Subscription[] = [
  { subscriptionId: "id1" },
  { subscriptionId: "id2" },
];
const mockLocations: Location[] = [{ id: "id1" }, { id: "id2" }];
const mockGroups: ResourceGroup[] = [
  { id: "id1", location: "l1" },
  { id: "id2", location: "l2" },
];

const primarySession: IAzureAccountSession = {
  account: mockAccounts[0],
  subscription: mockSubscriptions[0],
  tenantId: "tenantId",
  token: {
    key: "",
    token: "",
    tokenType: "",
  },
};

function createPagedIterator<T>(items: T[]): PagedAsyncIterableIterator<T> {
  let index = 0;
  const maxLength = items.length;

  return {
    next: async () => {
      if (index < maxLength) {
        return {
          done: false,
          value: items[index++],
        };
      }

      return { done: true, value: undefined };
    },
    byPage: () => undefined!,
    [Symbol.asyncIterator]: undefined!,
  };
}
