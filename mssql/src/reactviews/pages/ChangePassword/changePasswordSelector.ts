/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangePasswordWebviewState } from "../../../sharedInterfaces/changePassword";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useChangePasswordSelector<T>(
    selector: (state: ChangePasswordWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ChangePasswordWebviewState, void, T>(selector, equals);
}
