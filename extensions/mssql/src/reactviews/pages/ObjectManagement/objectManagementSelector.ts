/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectManagementWebviewState } from "../../../sharedInterfaces/objectManagement";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useObjectManagementSelector<T>(
    selector: (state: ObjectManagementWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ObjectManagementWebviewState, void, T>(selector, equals);
}
