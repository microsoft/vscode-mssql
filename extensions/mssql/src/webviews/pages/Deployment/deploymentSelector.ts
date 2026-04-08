/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeploymentReducers, DeploymentWebviewState } from "../../../sharedInterfaces/deployment";
import { FabricProvisioningState } from "../../../sharedInterfaces/fabricProvisioning";
import { LocalContainersState } from "../../../sharedInterfaces/localContainers";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useDeploymentSelector<T>(
    selector: (state: DeploymentWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<DeploymentWebviewState, DeploymentReducers, T>(selector, equals);
}

export function useLocalContainersDeploymentSelector<T>(
    selector: (state: LocalContainersState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useDeploymentSelector(
        (state) => selector(state.deploymentTypeState as LocalContainersState),
        equals,
    );
}

export function useFabricDeploymentSelector<T>(
    selector: (state: FabricProvisioningState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useDeploymentSelector(
        (state) => selector(state.deploymentTypeState as FabricProvisioningState),
        equals,
    );
}
