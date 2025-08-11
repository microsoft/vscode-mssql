/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const msSessionProvider = "microsoft";
export const msSessionProviderPPE = "microsoft-sovereign-cloud";

export function getSessionProviderForEnvironment(/*env: FabricEnvironmentName*/): string {
    // switch (env) {
    //     case FabricEnvironmentName.MOCK:
    //     case FabricEnvironmentName.ONEBOX:
    //     case FabricEnvironmentName.EDOG:
    //     case FabricEnvironmentName.EDOGONEBOX:
    //         return msSessionProviderPPE;
    //     case FabricEnvironmentName.DAILY:
    //     case FabricEnvironmentName.DXT:
    //     case FabricEnvironmentName.MSIT:
    //     case FabricEnvironmentName.PROD:
    //         return msSessionProvider;
    //     default:
    //         throw new Error(`Unknown FabricEnvironment: ${env}`);
    // }

    return msSessionProvider;
}
