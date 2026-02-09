/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeploymentReducers, DeploymentWebviewState } from "../../../sharedInterfaces/deployment";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useDeploymentSelector<T>(
    selector: (state: DeploymentWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<DeploymentWebviewState, DeploymentReducers, T>(selector, equals);
}
