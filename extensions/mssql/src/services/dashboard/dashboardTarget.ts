/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DashboardPlatform } from "../../sharedInterfaces/serverDashboard";

export function detectDashboardPlatform(serverName: string): DashboardPlatform {
    const normalizedServerName = serverName.toLowerCase();

    if (
        normalizedServerName.includes(".fabric.microsoft.com") ||
        normalizedServerName.includes(".datawarehouse.fabric.microsoft.com")
    ) {
        return "fabricSql";
    }

    if (
        normalizedServerName.includes(".database.windows.net") ||
        normalizedServerName.includes(".database.usgovcloudapi.net") ||
        normalizedServerName.includes(".database.chinacloudapi.cn")
    ) {
        return "azureSql";
    }

    return "sqlServer";
}
