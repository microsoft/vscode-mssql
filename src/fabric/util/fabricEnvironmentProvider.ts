/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Logger } from "../../models/logger";
import { FabricEnvironmentName, FabricEnvironmentSettings } from "./fabricEnvironments";

const vsCodeFabricClientIdPPE = "5bc58d85-1abe-45e0-bdaf-f487e3ce7bfb"; //  NON-PROD-vscode-fabric (PPE)
const vsCodeFabricClientIdPROD = "02fe4832-64e1-42d2-a605-d14958774a2e"; // PROD-vscode-fabric (PROD)

const theScopesPPE = ["https://analysis.windows-int.net/powerbi/api/.default"];
const theScopesPROD = ["https://analysis.windows.net/powerbi/api/.default"];

export const FABRIC_ENVIRONMENTS: { [key in FabricEnvironmentName]: FabricEnvironmentSettings } = {
    [FabricEnvironmentName.MOCK]: {
        env: FabricEnvironmentName.MOCK,
        clientId: "00000000-0000-0000-0000-000000000000",
        scopes: [],
        sharedUri: "",
        portalUri: "",
    },
    [FabricEnvironmentName.ONEBOX]: {
        env: FabricEnvironmentName.ONEBOX,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: "https://onebox-redirect.analysis.windows-int.net",
        portalUri: "portal.analysis.windows-int.net",
    },
    [FabricEnvironmentName.EDOG]: {
        env: FabricEnvironmentName.EDOG,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: "https://powerbiapi.analysis-df.windows.net",
        portalUri: "edog.analysis-df.windows.net",
    },
    [FabricEnvironmentName.EDOGONEBOX]: {
        env: FabricEnvironmentName.EDOGONEBOX,
        clientId: vsCodeFabricClientIdPPE,
        scopes: theScopesPPE,
        sharedUri: "https://powerbiapi.analysis-df.windows.net",
        portalUri: "edog.analysis-df.windows.net",
    },
    [FabricEnvironmentName.DAILY]: {
        env: FabricEnvironmentName.DAILY,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: "https://dailyapi.fabric.microsoft.com",
        portalUri: "daily.fabric.microsoft.com",
    },
    [FabricEnvironmentName.DXT]: {
        env: FabricEnvironmentName.DXT,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: "https://dxtapi.fabric.microsoft.com",
        portalUri: "dxt.fabric.microsoft.com",
    },
    [FabricEnvironmentName.MSIT]: {
        env: FabricEnvironmentName.MSIT,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: "https://msitapi.fabric.microsoft.com",
        portalUri: "msit.fabric.microsoft.com",
    },
    [FabricEnvironmentName.PROD]: {
        env: FabricEnvironmentName.PROD,
        clientId: vsCodeFabricClientIdPROD,
        scopes: theScopesPROD,
        sharedUri: "https://api.fabric.microsoft.com",
        portalUri: "app.fabric.microsoft.com",
    },
};

export function getFabricEnvironment(env: string, logger?: Logger): FabricEnvironmentSettings {
    const envString = env.toUpperCase() as FabricEnvironmentName;
    if (!Object.values(FabricEnvironmentName).includes(envString)) {
        logger?.log(`Invalid environment setting: ${envString}` /*, LogImportance.high*/);
        logger?.log(`Using default environment setting: ${FabricEnvironmentName.PROD}`);
        return FABRIC_ENVIRONMENTS[FabricEnvironmentName.PROD];
    }
    return FABRIC_ENVIRONMENTS[envString];
}
