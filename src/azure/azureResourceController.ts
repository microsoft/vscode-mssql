/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubscriptionClient, Location } from '@azure/arm-subscriptions';
import { ResourceManagementClient, ResourceGroup } from '@azure/arm-resources';
import { SqlManagementClient, Server } from '@azure/arm-sql';
import * as mssql from 'vscode-mssql';
import * as azureUtils from './utils';
import { TokenCredentialWrapper } from './credentialWrapper';

export class AzureResourceController {
	private _subscriptionClient: SubscriptionClient | undefined;
	private _resourceManagementClient: ResourceManagementClient | undefined;
	private _sqlManagementClient: SqlManagementClient | undefined;

	public set SubscriptionClient(v: SubscriptionClient) {
		this._subscriptionClient = v;
	}

	public set ResourceManagementClient(v: ResourceManagementClient) {
		this._resourceManagementClient = v;
	}

	public set SqlManagementClient(v: SqlManagementClient) {
		this._sqlManagementClient = v;
	}

	/**
	 * Returns Azure locations for given subscription
	 */
	public async getLocations(session: mssql.IAzureAccountSession): Promise<Location[]> {
		const subClient = this.getSubscriptionClient(session.token);
		if (!session?.subscription?.subscriptionId) {
			return [];
		}
		const locationsPages = await subClient.subscriptions.listLocations(session.subscription.subscriptionId);
		let locations = await azureUtils.getAllValues(locationsPages, (v) => v);
		return locations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	}

	/**
	 * Creates or updates a Azure SQL server for given subscription, resource group and location
	 */
	public async createOrUpdateServer(
		subscriptionId: string,
		resourceGroupName: string,
		serverName: string,
		parameters: Server,
		token: mssql.Token): Promise<string | undefined> {
		if (subscriptionId && resourceGroupName) {
			const sqlClient: SqlManagementClient = this.getSqlManagementClient(token, subscriptionId);
			if (sqlClient) {
				const result = await sqlClient.servers.beginCreateOrUpdateAndWait(resourceGroupName,
					serverName, parameters);

				return result.fullyQualifiedDomainName;
			}
		}
		return undefined;
	}

	/**
	 * Returns Azure resource groups for given subscription
	 */
	public async getResourceGroups(session: mssql.IAzureAccountSession): Promise<ResourceGroup[]> {
		if (session?.subscription?.subscriptionId) {
			const resourceGroupClient = this.getResourceManagementClient(session.token, session.subscription.subscriptionId);
			const newGroupsPages = await resourceGroupClient.resourceGroups.list();
			let groups = await azureUtils.getAllValues(newGroupsPages, (v) => v);
			return groups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
		}
		return [];
	}

	private getSubscriptionClient(token: mssql.Token): SubscriptionClient {
		if (this._subscriptionClient) {
			return this._subscriptionClient;
		}

		return new SubscriptionClient(new TokenCredentialWrapper(token));
	}

	private getResourceManagementClient(token: mssql.Token, subscriptionId: string): ResourceManagementClient {
		if (this._resourceManagementClient) {
			return this._resourceManagementClient;
		}

		return new ResourceManagementClient(new TokenCredentialWrapper(token), subscriptionId);
	}

	private getSqlManagementClient(token: mssql.Token, subscriptionId: string): SqlManagementClient {
		if (this._sqlManagementClient) {
			return this._sqlManagementClient;
		}

		return new SqlManagementClient(new TokenCredentialWrapper(token), subscriptionId);
	}
}
