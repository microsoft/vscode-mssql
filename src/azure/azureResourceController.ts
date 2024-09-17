/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceGroup } from "@azure/arm-resources";
import { Server } from "@azure/arm-sql";
import { Location } from "@azure/arm-subscriptions";
import * as mssql from "vscode-mssql";
import * as azureUtils from "./utils";

export class AzureResourceController {
  constructor(
    private _subscriptionClientFactory: azureUtils.SubscriptionClientFactory = azureUtils.defaultSubscriptionClientFactory,
    private _resourceManagementClientFactory: azureUtils.ResourceManagementClientFactory = azureUtils.defaultResourceManagementClientFactory,
    private _sqlManagementClientFactory: azureUtils.SqlManagementClientFactory = azureUtils.defaultSqlManagementClientFactory,
  ) {}

  /**
   * Returns Azure locations for given session
   * @param session Azure session
   * @returns List of locations
   */
  public async getLocations(
    session: mssql.IAzureAccountSession,
  ): Promise<Location[]> {
    const subClient = this._subscriptionClientFactory(session.token!);
    if (session.subscription?.subscriptionId) {
      const locationsPages = await subClient.subscriptions.listLocations(
        session.subscription.subscriptionId,
      );
      let locations = await azureUtils.getAllValues(locationsPages, (v) => v);
      return locations.sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      );
    } else {
      throw new Error("Invalid session");
    }
  }

  /**
   * Creates or updates a Azure SQL server for given subscription, resource group and location
   * @param subscriptionId subscription Id
   * @param resourceGroupName resource group name
   * @param serverName SQL server name
   * @param parameters parameters for the SQL server
   * @returns name of the SQL server
   */
  public async createOrUpdateServer(
    subscriptionId: string,
    resourceGroupName: string,
    serverName: string,
    parameters: Server,
    token: mssql.IToken,
  ): Promise<string | undefined> {
    if (subscriptionId && resourceGroupName) {
      const sqlClient = this._sqlManagementClientFactory(token, subscriptionId);
      if (sqlClient) {
        const result = await sqlClient.servers.beginCreateOrUpdateAndWait(
          resourceGroupName,
          serverName,
          parameters,
        );

        return result.fullyQualifiedDomainName;
      }
    }
    return undefined;
  }

  /**
   * Returns Azure resource groups for given subscription
   * @param session Azure session
   * @returns List of resource groups
   */
  public async getResourceGroups(
    session: mssql.IAzureAccountSession,
  ): Promise<ResourceGroup[]> {
    if (session.subscription?.subscriptionId) {
      const resourceGroupClient = this._resourceManagementClientFactory(
        session.token!,
        session.subscription.subscriptionId,
      );
      const newGroupsPages = await resourceGroupClient.resourceGroups.list();
      let groups = await azureUtils.getAllValues(newGroupsPages, (v) => v);
      return groups.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      throw new Error("Invalid session");
    }
  }
}
