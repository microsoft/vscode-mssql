/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useMemo, useRef } from "react";
import {
    Menu,
    MenuList,
    MenuItem,
    MenuPopover,
    PositioningVirtualElement,
} from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { useVscodeWebview2 } from "../../../../common/vscodeWebviewProvider2";
import { WebviewAction } from "../../../../../sharedInterfaces/webview";
import { useContextMenuStyles } from "../../../../common/styles";

export enum HeaderContextMenuAction {
    SortAscending = "sortAscending",
    SortDescending = "sortDescending",
    Filter = "filter",
    Resize = "resize",
}

export interface HeaderContextMenuProps {
    x: number;
    y: number;
    open: boolean;
    onAction: (action: HeaderContextMenuAction) => void;
    onClose: () => void;
}

// Virtual element used by Fluent UI positioning to anchor the popover at an arbitrary point
function createVirtualElement(x: number, y: number): PositioningVirtualElement {
    return {
        getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
}

export const HeaderContextMenu: React.FC<HeaderContextMenuProps> = ({
    x,
    y,
    open,
    onAction,
    onClose,
}) => {
    const styles = useContextMenuStyles();
    const virtualTarget = useMemo(() => createVirtualElement(x, y), [x, y]);
    // eslint-disable-next-line no-restricted-syntax
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const { keyBindings } = useVscodeWebview2();

    return (
        <div
            // Prevent the browser default context menu if user right-clicks during menu open
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            style={{ position: "fixed", inset: 0, zIndex: 100000 }}>
            <Menu
                open={open}
                positioning={{
                    target: virtualTarget,
                    position: "below",
                    align: "start",
                    offset: 4,
                    overflowBoundary: document.body,
                    flipBoundary: document.body,
                }}
                onOpenChange={(_, data) => {
                    if (!data.open) {
                        onClose();
                    }
                }}>
                <MenuPopover onClick={(e) => e.stopPropagation()} ref={popoverRef}>
                    <MenuList>
                        <MenuItem
                            className={styles.menuItem}
                            secondaryContent={
                                keyBindings[WebviewAction.ResultGridToggleSort]?.label
                            }
                            onClick={() => onAction(HeaderContextMenuAction.SortAscending)}>
                            {locConstants.queryResult.sortAscending}
                        </MenuItem>
                        <MenuItem
                            className={styles.menuItem}
                            secondaryContent={
                                keyBindings[WebviewAction.ResultGridToggleSort]?.label
                            }
                            onClick={() => onAction(HeaderContextMenuAction.SortDescending)}>
                            {locConstants.queryResult.sortDescending}
                        </MenuItem>
                        <MenuItem
                            className={styles.menuItem}
                            secondaryContent={
                                keyBindings[WebviewAction.ResultGridOpenFilterMenu]?.label
                            }
                            onClick={() => onAction(HeaderContextMenuAction.Filter)}>
                            {locConstants.queryResult.filter}
                        </MenuItem>
                        <MenuItem
                            className={styles.menuItem}
                            secondaryContent={
                                keyBindings[WebviewAction.ResultGridChangeColumnWidth]?.label
                            }
                            onClick={() => onAction(HeaderContextMenuAction.Resize)}>
                            {locConstants.queryResult.resize}
                        </MenuItem>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

export default HeaderContextMenu;
