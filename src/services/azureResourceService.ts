/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as mssql from 'vscode-mssql';
import * as vscode from 'vscode';
import { AccountStore } from '../azure/accountStore';
import { AzureController } from '../azure/azureController';
import { AzureResourceController } from '../azure/azureResourceController';
import { Location } from '@azure/arm-subscriptions';
import { ResourceGroup } from '@azure/arm-resources';
import { Server } from '@azure/arm-sql';
import providerSettings from '../azure/providerSettings';

export class AzureResourceService implements mssql.IAzureResourceService {

	private _accountStore: AccountStore;
	constructor(
		private _azureController: AzureController,
		private _azureResourceController: AzureResourceController,
		private _context: vscode.ExtensionContext) {
		this._accountStore = new AccountStore(this._context);
	}

	/**
	 * Returns Azure locations for given subscription
	 */
	public async getLocations(session: mssql.IAzureAccountSession): Promise<Location[]> {
		await this.checkAndRefreshToken(session);
		return await this._azureResourceController.getLocations(session);
	}

	/**
	 * Returns Azure resource groups for given subscription
	 */
	public async getResourceGroups(session: mssql.IAzureAccountSession): Promise<ResourceGroup[]> {
		await this.checkAndRefreshToken(session);
		return await this._azureResourceController.getResourceGroups(session);
	}

	/**
	 * Creates or updates a Azure SQL server for given subscription, resource group and location
	 */
	public async createOrUpdateServer(
		session: mssql.IAzureAccountSession,
		resourceGroupName: string,
		serverName: string,
		parameters: Server): Promise<string | undefined> {
		await this.checkAndRefreshToken(session);
		return await this._azureResourceController.createOrUpdateServer(session.subscription.subscriptionId,
			resourceGroupName, serverName, parameters, session.token);
	}

	/**
	 * Verifies if the token still valid, refreshes the token for given account
	 * @param session
	 */
	private async checkAndRefreshToken(session: mssql.IAzureAccountSession): Promise<void> {
		const currentTime = new Date().getTime() / 1000;
		const maxTolerance = 2 * 60; // two minutes
		if (session.account && (!session.token || session.token.expiresOn - currentTime < maxTolerance)) {
			const token = await this._azureController.refreshToken(session.account, this._accountStore,
				providerSettings.resources.azureManagementResource);
			session.token = token;
		}
	}
}
