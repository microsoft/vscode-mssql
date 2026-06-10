/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode } from "react";
import type {
    FluentResultGridCommandConfiguration,
    FluentResultGridKeyBindingMap,
} from "../types/fluentResultGridCommands";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";
import type { FluentResultGridTheme } from "../types/fluentResultGridTheme";
import type {
    FluentResultGridActiveOverlayState,
    FluentResultGridOverlayState,
} from "./fluentResultGridOverlays";

export interface FluentResultGridCloseOverlayOptions {
    /**
     * Controls whether a dismissible overlay's onDismiss callback runs while closing.
     *
     * Successful submit paths usually close without dismiss notification.
     */
    notifyDismiss?: boolean;
}

export interface FluentResultGridProviderProps {
    children: ReactNode;
    strings: FluentResultGridStrings;
    keyBindings?: FluentResultGridKeyBindingMap;
    theme?: FluentResultGridTheme;

    /**
     * Defaults inherited by child grids.
     */
    defaultCommands?: FluentResultGridCommandConfiguration;
}

export interface FluentResultGridProviderContextValue {
    strings: FluentResultGridStrings;
    keyBindings: FluentResultGridKeyBindingMap;
    theme?: FluentResultGridTheme;
    defaultCommands?: FluentResultGridCommandConfiguration;
    overlay: FluentResultGridOverlayState;
    openOverlay: (overlay: FluentResultGridActiveOverlayState) => void;
    closeOverlay: (options?: FluentResultGridCloseOverlayOptions) => void;
}
