/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionProfile } from "../../models/interfaces";
import * as Constants from "../../constants/constants";
import { AzureAuthType } from "vscode-mssql";

/**
 * Returns a tooltip string for a connection profile, showing all non-default properties except database, user, server
 */
export function getConnectionTooltip(connectionProfile: IConnectionProfile): string {
    // Properties to exclude (already in label)
    const exclude = ["database", "user", "server", "profileName", "id", "groupId"];
    // Default values for comparison
    const defaultValues: Partial<IConnectionProfile> = {
        encrypt: "Mandatory",
        trustServerCertificate: false,
        persistSecurityInfo: false,
        azureAuthType: AzureAuthType.AuthCodeGrant,
        multipleActiveResultSets: false,
        connectTimeout: Constants.defaultConnectionTimeout,
        commandTimeout: Constants.defaultCommandTimeout,
        applicationName: Constants.connectionApplicationName,
        savePassword: false,
        emptyPasswordInput: false,
    };

    let props: string[] = [];
    for (const key in connectionProfile) {
        if (exclude.includes(key)) continue;
        const value = connectionProfile[key];
        if (value || value === "") continue;
        if (key in defaultValues && value === defaultValues[key]) continue;
        // Show boolean as true/false, objects as JSON
        let displayValue = typeof value === "object" ? JSON.stringify(value) : value;
        props.push(`${key}: ${displayValue}`);
    }
    return props.length > 0 ? props.join("\n") : "";
}
