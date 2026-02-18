/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectManagementWebviewState } from "../../../sharedInterfaces/objectManagement";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useObjectManagementSelector<T, S>(
    selector: (state: ObjectManagementWebviewState<S>) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<ObjectManagementWebviewState<S>, void, T>(selector, equals);
}
