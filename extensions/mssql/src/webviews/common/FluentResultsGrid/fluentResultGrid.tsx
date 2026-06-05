/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FluentResultCommand } from "./fluentResultGridCommands";

export interface FluentResultGridProps {
    /** Commands contributed by the host for the command bar, menus, and keyboard. */
    commands?: FluentResultCommand[];
}
