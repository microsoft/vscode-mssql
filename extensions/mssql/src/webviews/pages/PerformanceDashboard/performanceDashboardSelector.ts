/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function usePerformanceDashboardSelector<T>(
    selector: (state: PerformanceDashboardState) => T,
    equals?: (a: T, b: T) => boolean,
) {
    return useVscodeSelector<PerformanceDashboardState, PerformanceDashboardReducers, T>(
        selector,
        equals,
    );
}
