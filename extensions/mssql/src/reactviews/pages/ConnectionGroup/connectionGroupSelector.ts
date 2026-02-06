/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ConnectionGroupReducers,
    ConnectionGroupState,
} from "../../../sharedInterfaces/connectionGroup";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useConnectionGroupSelector<T>(
    selector: (state: ConnectionGroupState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ConnectionGroupState, ConnectionGroupReducers, T>(selector, equals);
}
