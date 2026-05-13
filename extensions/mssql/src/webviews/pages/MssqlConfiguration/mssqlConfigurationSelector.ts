/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    MssqlConfigurationReducers,
    MssqlConfigurationWebviewState,
} from "../../../sharedInterfaces/mssqlConfiguration";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useMssqlConfigurationSelector<T>(
    selector: (state: MssqlConfigurationWebviewState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<MssqlConfigurationWebviewState, MssqlConfigurationReducers, T>(
        selector,
        equals,
    );
}
