/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import { IAzureSession } from "../models/interfaces";
import * as Constants from "../constants/constants";
import { AzureController } from "./azureController";
import { AccountStore } from "./accountStore";
import { getCloudProviderSettings } from "./providerSettings";
import {
  AzureAuthType,
  IAccount,
  IAccountKey,
  ITenant,
  IToken,
} from "../models/contracts/azure";

export class AccountService {
  private _account: IAccount = undefined;
  private _isStale: boolean;
  protected readonly commonTenant: ITenant = {
    id: "common",
    displayName: "common",
  };

  constructor(
    private _client: SqlToolsServiceClient,
    private _accountStore: AccountStore,
    private _azureController: AzureController,
  ) {}

  public get account(): IAccount {
    return this._account;
  }

  public setAccount(account: IAccount): void {
    this._account = account;
  }

  public get client(): SqlToolsServiceClient {
    return this._client;
  }

  public convertToAzureAccount(azureSession: IAzureSession): IAccount {
    let tenant = {
      displayName: Constants.tenantDisplayName,
      id: azureSession.tenantId,
      userId: azureSession.userId,
    };
    let key: IAccountKey = {
      providerId: Constants.resourceProviderId,
      id: azureSession.userId,
    };
    let account: IAccount = {
      key: key,
      displayInfo: {
        userId: azureSession.userId,
        displayName: undefined,
        accountType: undefined,
        name: undefined,
      },
      properties: {
        tenants: [tenant],
        owningTenant: tenant,
        azureAuthType: AzureAuthType.AuthCodeGrant,
        providerSettings: getCloudProviderSettings(),
        isMsAccount: false,
      },
      isStale: this._isStale,
      isSignedIn: false,
    };
    return account;
  }

  /**
   * Creates access token mappings for user selected account and tenant.
   * @param account User account to fetch tokens for.
   * @param tenantId Tenant Id for which refresh token is needed
   * @returns Security token mappings
   */
  public async createSecurityTokenMapping(
    account: IAccount,
    tenantId: string,
  ): Promise<any> {
    // TODO: match type for mapping in mssql and sqltoolsservice
    let mapping = {};
    mapping[tenantId] = {
      token: (await this.refreshToken(account, tenantId)).token,
    };
    return mapping;
  }

  public async refreshToken(
    account: IAccount,
    tenantId: string,
  ): Promise<IToken> {
    return await this._azureController.refreshAccessToken(
      account,
      this._accountStore,
      tenantId,
      getCloudProviderSettings(account.key.providerId).settings.armResource,
    );
  }

  public getHomeTenant(account: IAccount): ITenant {
    // Home is defined by the API
    // Lets pick the home tenant - and fall back to commonTenant if they don't exist
    return (
      account.properties.tenants.find((t) => t.tenantCategory === "Home") ??
      account.properties.tenants[0] ??
      this.commonTenant
    );
  }
}
