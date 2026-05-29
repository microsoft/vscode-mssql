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
import { useVscodeWebview } from "../../../../common/vscodeWebviewProvider";
import { WebviewAction } from "../../../../../sharedInterfaces/webview";
import { useContextMenuStyles } from "../../../../common/styles";
import { HeaderContextMenuAction } from "./headerContextMenuTypes";

export { HeaderContextMenuAction };

export interface HeaderContextMenuProps {
    x: number;
    y: number;
    open: boolean;
    onAction: (action: HeaderContextMenuAction) => void;
    onClose: () => void;
    actions?: HeaderContextMenuAction[];
    freezeActionLabel?: string;
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
    actions,
    freezeActionLabel,
}) => {
    const styles = useContextMenuStyles();
    const virtualTarget = useMemo(() => createVirtualElement(x, y), [x, y]);
    // eslint-disable-next-line no-restricted-syntax
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const { keyBindings } = useVscodeWebview();
    const visibleActions = actions ?? [
        HeaderContextMenuAction.ToggleSort,
        HeaderContextMenuAction.Filter,
        HeaderContextMenuAction.Resize,
        HeaderContextMenuAction.CopyColumnName,
    ];
    const shouldShowAction = (action: HeaderContextMenuAction) => visibleActions.includes(action);

    return (
        <div
            data-vscode-context='{"preventDefaultContextMenuItems": true}'
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
                        {shouldShowAction(HeaderContextMenuAction.ToggleSort) && (
                            <MenuItem
                                className={styles.menuItem}
                                secondaryContent={
                                    keyBindings[WebviewAction.ResultGridToggleSort]?.label
                                }
                                onClick={() => onAction(HeaderContextMenuAction.ToggleSort)}>
                                {locConstants.queryResult.toggleSort}
                            </MenuItem>
                        )}
                        {shouldShowAction(HeaderContextMenuAction.Filter) && (
                            <MenuItem
                                className={styles.menuItem}
                                secondaryContent={
                                    keyBindings[WebviewAction.ResultGridOpenFilterMenu]?.label
                                }
                                onClick={() => onAction(HeaderContextMenuAction.Filter)}>
                                {locConstants.queryResult.filter}
                            </MenuItem>
                        )}
                        {shouldShowAction(HeaderContextMenuAction.Resize) && (
                            <MenuItem
                                className={styles.menuItem}
                                secondaryContent={
                                    keyBindings[WebviewAction.ResultGridChangeColumnWidth]?.label
                                }
                                onClick={() => onAction(HeaderContextMenuAction.Resize)}>
                                {locConstants.queryResult.resize}
                            </MenuItem>
                        )}
                        {shouldShowAction(HeaderContextMenuAction.CopyColumnName) && (
                            <MenuItem
                                className={styles.menuItem}
                                onClick={() => onAction(HeaderContextMenuAction.CopyColumnName)}>
                                {locConstants.queryResult.copyColumnName}
                            </MenuItem>
                        )}
                        {shouldShowAction(HeaderContextMenuAction.FreezeColumn) && (
                            <MenuItem
                                className={styles.menuItem}
                                onClick={() => onAction(HeaderContextMenuAction.FreezeColumn)}>
                                {freezeActionLabel ?? locConstants.slickGrid.freezeColumns}
                            </MenuItem>
                        )}
                        {shouldShowAction(HeaderContextMenuAction.UnfreezeColumn) && (
                            <MenuItem
                                className={styles.menuItem}
                                onClick={() => onAction(HeaderContextMenuAction.UnfreezeColumn)}>
                                {freezeActionLabel ?? locConstants.slickGrid.unfreezeColumns}
                            </MenuItem>
                        )}
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

export default HeaderContextMenu;
