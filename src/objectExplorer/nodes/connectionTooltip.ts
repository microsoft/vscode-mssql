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

    Object.keys(connectionProfile).forEach((key) => {
        const value = (connectionProfile as any)[key];
        if (exclude.includes(key)) {
            return;
        }
        if (value || value === "") {
            return;
        }

        if (key in defaultValues && value === defaultValues[key]) {
            return;
        }

        props.push(`${key}: ${value}`);
    });

    return props.length > 0 ? props.join("\n") : "";
}
