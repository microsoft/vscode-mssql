/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useMemo, useRef } from "react";
import { Menu, MenuList, MenuItem, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { GridContextMenuAction } from "../../../../../sharedInterfaces/queryResult";

export interface GridContextMenuProps {
    x: number;
    y: number;
    open: boolean;
    onAction: (action: GridContextMenuAction) => void;
    onClose: () => void;
}

// Virtual element used by Fluent UI positioning to anchor the popover at an arbitrary point
function createVirtualElement(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
    return {
        getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
}

export const GridContextMenu: React.FC<GridContextMenuProps> = ({
    x,
    y,
    open,
    onAction,
    onClose,
}) => {
    const virtualTarget = useMemo(() => createVirtualElement(x, y), [x, y]);
    const popoverRef = useRef<HTMLDivElement | null>(null);

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
                    target: virtualTarget as any,
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
                        <MenuItem onClick={() => onAction(GridContextMenuAction.CopySelection)}>
                            {locConstants.queryResult.copy}
                        </MenuItem>
                        <MenuItem onClick={() => onAction(GridContextMenuAction.CopyWithHeaders)}>
                            {locConstants.queryResult.copyWithHeaders}
                        </MenuItem>
                        <MenuItem onClick={() => onAction(GridContextMenuAction.CopyHeaders)}>
                            {locConstants.queryResult.copyHeaders}
                        </MenuItem>
                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <MenuItem>{locConstants.queryResult.copyAs}</MenuItem>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem
                                        onClick={() => onAction(GridContextMenuAction.CopyAsCsv)}>
                                        {locConstants.queryResult.copyAsCsv}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() => onAction(GridContextMenuAction.CopyAsJson)}>
                                        {locConstants.queryResult.copyAsJson}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() =>
                                            onAction(GridContextMenuAction.CopyAsInsertInto)
                                        }>
                                        {locConstants.queryResult.copyAsInsertInto}
                                    </MenuItem>
                                    <MenuItem
                                        onClick={() =>
                                            onAction(GridContextMenuAction.CopyAsInClause)
                                        }>
                                        {locConstants.queryResult.copyAsInClause}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
};

export default GridContextMenu;
