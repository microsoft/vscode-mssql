/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProfilerReducers, ProfilerWebviewState } from "../../../sharedInterfaces/profiler";
import { useVscodeSelector } from "../../common/useVscodeSelector";

export function useProfilerSelector<T>(
    selector: (state: ProfilerWebviewState) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    return useVscodeSelector<ProfilerWebviewState, ProfilerReducers, T>(selector, equals);
}
