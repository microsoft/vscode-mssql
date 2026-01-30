/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    GlobalSearchReducers,
    GlobalSearchWebViewState,
} from "../../../sharedInterfaces/globalSearch";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useGlobalSearchSelector<T>(
    selector: (state: GlobalSearchWebViewState) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    return useVscodeSelector<GlobalSearchWebViewState, GlobalSearchReducers, T>(selector, equals);
}
