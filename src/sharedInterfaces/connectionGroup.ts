/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogProps } from "./connectionDialog";
import { WebviewContextProps } from "./webview";

/**
 * Identifier for creating a new connection group
 */
export const CREATE_NEW_GROUP_ID = "CREATE_NEW_GROUP";

/**
 * Represents a connection group in the system.
 * This interface defines the structure of a connection group, including its ID, name, parent ID,
 * color, and an optional description.
 */
export interface IConnectionGroup {
    id: string;
    name: string;
    parentId?: string;
    color?: string;
    description?: string;
}

/**
 * Props for the Create Connection Group dialog.
 */
export interface CreateConnectionGroupDialogProps extends IDialogProps {
    type: "createConnectionGroup";
    props: ConnectionGroupState;
}

/**
 * State for the Connection Group webview
 */
export interface ConnectionGroupState {
    existingGroupName?: string;
    name: string;
    description?: string;
    color?: string;
    message?: string;
    parentId?: string;
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
