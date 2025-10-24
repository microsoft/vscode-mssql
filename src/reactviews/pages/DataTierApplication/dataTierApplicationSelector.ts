/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataTierApplicationWebviewState } from "../../../sharedInterfaces/dataTierApplication";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useDataTierApplicationSelector<T>(
    selector: (state: DataTierApplicationWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<DataTierApplicationWebviewState, void, T>(selector, equals);
}
