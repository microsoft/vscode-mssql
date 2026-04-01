/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from "react";

/**
 * Context that tracks whether the toolbar should render in compact (icon-only) mode.
 * When `isCompact` is true, buttons should hide their text labels and show only icons.
 */
export const SchemaDesignerToolbarContext = createContext<{ isCompact: boolean }>({
    isCompact: false,
});

/**
 * Hook to check if the toolbar is in compact mode.
 * @returns `true` when the toolbar lacks horizontal space and buttons should be icon-only.
 */
export function useIsToolbarCompact(): boolean {
    return useContext(SchemaDesignerToolbarContext).isCompact;
}
