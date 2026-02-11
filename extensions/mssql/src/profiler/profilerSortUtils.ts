/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export sort utilities from sharedInterfaces so existing extension-side consumers
// continue to work without changes.
export {
    profilerSortComparator,
    createDataViewSortFn,
    getNextSortState,
} from "../sharedInterfaces/profiler";
