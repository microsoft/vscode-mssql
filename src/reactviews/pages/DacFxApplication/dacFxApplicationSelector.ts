/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DacFxApplicationWebviewState } from "../../../sharedInterfaces/dacFxApplication";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useDacFxApplicationSelector<T>(
    selector: (state: DacFxApplicationWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<DacFxApplicationWebviewState, void, T>(selector, equals);
}
