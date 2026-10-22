/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OverviewReducers, OverviewWebviewState } from "../../../sharedInterfaces/overview";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useOverviewSelector<T>(
    selector: (state: OverviewWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<OverviewWebviewState, OverviewReducers, T>(selector, equals);
}
