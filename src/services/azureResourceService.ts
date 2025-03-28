/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { AccountStore } from "../azure/accountStore";
import { AzureController } from "../azure/azureController";
import { AzureResourceController } from "../azure/azureResourceController";
import { Location } from "@azure/arm-subscriptions";
import { ResourceGroup } from "@azure/arm-resources";
import { Server } from "@azure/arm-sql";

export class AzureResourceService implements mssql.IAzureResourceService {
    constructor(
        private _azureController: AzureController,
        private _azureResourceController: AzureResourceController,
        private _accountStore: AccountStore,
    ) {}

    /**
     * Returns Azure locations for given subscription
     */
    public async getLocations(session: mssql.IAzureAccountSession): Promise<Location[]> {
        await this._azureController.checkAndRefreshToken(session, this._accountStore);
        return await this._azureResourceController.getLocations(session);
    }

    /**
     * Returns Azure resource groups for given subscription
     */
    public async getResourceGroups(session: mssql.IAzureAccountSession): Promise<ResourceGroup[]> {
        await this._azureController.checkAndRefreshToken(session, this._accountStore);
        return await this._azureResourceController.getResourceGroups(session);
    }

    /**
     * Creates or updates a Azure SQL server for given subscription, resource group and location
     */
    public async createOrUpdateServer(
        session: mssql.IAzureAccountSession,
        resourceGroupName: string,
        serverName: string,
        parameters: Server,
    ): Promise<string | undefined> {
        await this._azureController.checkAndRefreshToken(session, this._accountStore);
        return await this._azureResourceController.createOrUpdateServer(
            session.subscription.subscriptionId,
            resourceGroupName,
            serverName,
            parameters,
            session.token,
        );
    }
}
