/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FabricEnvironmentSettings = {
    env: FabricEnvironmentName;
    clientId: string;
    scopes: string[];
    sharedUri: string;
    portalUri: string;
};

/* eslint-disable @typescript-eslint/naming-convention */
export enum FabricEnvironmentName {
    MOCK = "MOCK",
    ONEBOX = "ONEBOX",
    EDOG = "EDOG",
    EDOGONEBOX = "EDOGONEBOX",
    DAILY = "DAILY",
    DXT = "DXT",
    MSIT = "MSIT",
    PROD = "PROD",
}
