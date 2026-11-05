/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext, useRef } from "react";

/**
 * Whether a results pane is the one keyboard shortcuts act on. The multi-results view shows
 * several panes at once, and only the focused one is active. A pane shown on its own is always
 * active.
 */
export const QueryResultPaneScopeContext = createContext<{ isActive: boolean }>({
    isActive: true,
});

/**
 * Returns a ref that document-level key handlers check before handling a key, so that only
 * the active pane responds.
 */
export function useIsActiveResultPaneRef() {
    const { isActive } = useContext(QueryResultPaneScopeContext);
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;
    return isActiveRef;
}
