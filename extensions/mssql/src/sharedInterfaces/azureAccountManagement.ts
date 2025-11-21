/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IMssqlAzureAccount {
  accountId: string;
  displayName: string;
}

export interface IMssqlAzureTenant {
  tenantId: string;
  displayName: string;
}

export interface IMssqlAzureSubscription {
  subscriptionId: string;
  displayName: string;
}
