/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ProfilerDetailsPanelState,
    ProfilerDetailsPanelReducers,
} from "../../../sharedInterfaces/profiler";
import { useVscodeSelector } from "../../common/useVscodeSelector";

/**
 * Selector hook for profiler details panel state.
 * Uses useSyncExternalStore for efficient, memoized state access.
 *
 * @param selector Function to select a portion of the state
 * @param equals Optional equality function for memoization (defaults to Object.is)
 * @returns The selected portion of the state
 */
export function useProfilerDetailsPanelSelector<T>(
    selector: (state: ProfilerDetailsPanelState) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    return useVscodeSelector<ProfilerDetailsPanelState, ProfilerDetailsPanelReducers, T>(
        selector,
        equals,
    );
}
