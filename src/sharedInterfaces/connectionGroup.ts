/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewContextProps } from "./webview";

/**
 * State for the Connection Group webview
 */
export interface ConnectionGroupState {
    existingGroupName?: string;
    name: string;
    description?: string;
    color?: string;
    message?: string;
}

/**
 * Reducers for the Connection Group webview - to be implemented later
 */
export interface ConnectionGroupReducers {
    saveConnectionGroup: {
        name: string;
        description?: string;
        color?: string;
    };

    closeDialog: {};
}

/**
 * Context props for the Connection Group webview
 */
export interface ConnectionGroupContextProps extends WebviewContextProps<ConnectionGroupState> {
    closeDialog: () => void;
    saveConnectionGroup: (connectionGroupSpec: ConnectionGroupSpec) => void;
}

export interface ConnectionGroupSpec {
    name: string;
    description?: string;
    color?: string;
}
