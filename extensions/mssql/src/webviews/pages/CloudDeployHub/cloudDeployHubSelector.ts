/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CloudDeployHubReducers,
    CloudDeployHubState,
} from "../../../sharedInterfaces/cloudDeployHub";
import { useVscodeSelector } from "../../common/useVscodeSelector";

/**
 * Memoised selector hook bound to the hub's state shape. View components use
 * this to subscribe to a slice of state instead of the entire snapshot, which
 * keeps re-renders narrow when only one field (e.g. `runs`) changes.
 */
export function useCloudDeployHubSelector<T>(
    selector: (state: CloudDeployHubState) => T,
    equals?: (a: T, b: T) => boolean,
): T {
    return useVscodeSelector<CloudDeployHubState, CloudDeployHubReducers, T>(selector, equals);
}
