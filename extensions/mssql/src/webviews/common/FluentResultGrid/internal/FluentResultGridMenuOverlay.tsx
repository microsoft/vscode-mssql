/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    tokens,
    type PositioningVirtualElement,
} from "@fluentui/react-components";
import { useMemo, type ReactNode } from "react";
import {
    resolveFluentResultGridCommands,
    toFluentResultGridReactElement,
    type FluentResultGridResolvedCommand,
} from "./fluentResultGridCommandResolution";
import type {
    FluentResultGridOverlayState,
    FluentResultGridMenuOverlayState,
} from "./fluentResultGridOverlays";
import {
    FluentResultGridCommandPlacement,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridKeyBindingMap,
} from "../types/fluentResultGridCommands";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";

const overlayZIndex = 100000;
const copyAsGroupId = "copyAs";

const useStyles = makeStyles({
    menuItem: {
        minHeight: "24px",
        height: "24px",
        padding: "0 8px",
        fontSize: tokens.fontSizeBase200,
        display: "flex",
        alignItems: "center",
        lineHeight: "24px",
    },
});

export interface FluentResultGridOverlayHostProps {
    overlay: FluentResultGridOverlayState;
    closeOverlay: () => void;
    strings: FluentResultGridStrings;
    keyBindings: FluentResultGridKeyBindingMap;
    defaultCommands?: FluentResultGridCommandConfiguration;
}

type FluentResultGridMenuEntry =
    | FluentResultGridResolvedCommand
    | {
          kind: "copyAs";
          commands: FluentResultGridResolvedCommand[];
      };

function createVirtualElement(x: number, y: number): PositioningVirtualElement {
    return {
        getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
}

function isCopyAsCommand(command: FluentResultGridResolvedCommand): boolean {
    return command.command.groupId === copyAsGroupId;
}

function getMenuEntries(
    overlay: FluentResultGridMenuOverlayState,
    commands: FluentResultGridResolvedCommand[],
): FluentResultGridMenuEntry[] {
    if (overlay.placement !== FluentResultGridCommandPlacement.CellContextMenu) {
        return commands;
    }

    const copyAsCommands = commands.filter(isCopyAsCommand);
    if (copyAsCommands.length === 0) {
        return commands;
    }

    const entries: FluentResultGridMenuEntry[] = [];
    let insertedCopyAsGroup = false;

    for (const command of commands) {
        if (!isCopyAsCommand(command)) {
            entries.push(command);
            continue;
        }

        if (!insertedCopyAsGroup) {
            entries.push({
                kind: "copyAs",
                commands: copyAsCommands,
            });
            insertedCopyAsGroup = true;
        }
    }

    return entries;
}

function isCopyAsEntry(
    entry: FluentResultGridMenuEntry,
): entry is Extract<FluentResultGridMenuEntry, { kind: "copyAs" }> {
    return "kind" in entry && entry.kind === "copyAs";
}

function getMenuItemDisabled(
    overlay: FluentResultGridMenuOverlayState,
    command: FluentResultGridResolvedCommand,
): boolean {
    return !overlay.onCommand || command.disabled;
}

function renderCommandMenuItem({
    command,
    closeOverlay,
    overlay,
    className,
}: {
    command: FluentResultGridResolvedCommand;
    closeOverlay: () => void;
    overlay: FluentResultGridMenuOverlayState;
    className: string;
}): ReactNode {
    const icon = toFluentResultGridReactElement(command.command.icon);

    return (
        <MenuItem
            key={command.command.id}
            className={className}
            disabled={getMenuItemDisabled(overlay, command)}
            icon={icon}
            secondaryContent={command.shortcutLabel}
            onClick={() => {
                closeOverlay();
                void overlay.onCommand?.({
                    ...overlay.commandContext,
                    commandId: command.command.id,
                });
            }}>
            {command.display.label}
        </MenuItem>
    );
}

function renderCopyAsMenuItem({
    entry,
    closeOverlay,
    overlay,
    className,
    strings,
}: {
    entry: Extract<FluentResultGridMenuEntry, { kind: "copyAs" }>;
    closeOverlay: () => void;
    overlay: FluentResultGridMenuOverlayState;
    className: string;
    strings: FluentResultGridStrings;
}): ReactNode {
    const allItemsDisabled = entry.commands.every((command) =>
        getMenuItemDisabled(overlay, command),
    );

    return (
        <Menu key={copyAsGroupId}>
            <MenuTrigger disableButtonEnhancement>
                <MenuItem className={className} disabled={allItemsDisabled}>
                    {strings.menus.copyAs}
                </MenuItem>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {entry.commands.map((command) =>
                        renderCommandMenuItem({
                            command,
                            closeOverlay,
                            overlay,
                            className,
                        }),
                    )}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}

function FluentResultGridMenuOverlay({
    overlay,
    closeOverlay,
    strings,
    keyBindings,
    defaultCommands,
}: FluentResultGridOverlayHostProps & { overlay: FluentResultGridMenuOverlayState }) {
    const classes = useStyles();
    const virtualTarget = useMemo(
        () => createVirtualElement(overlay.x, overlay.y),
        [overlay.x, overlay.y],
    );
    const commands = useMemo(
        () =>
            resolveFluentResultGridCommands({
                placement: overlay.placement,
                commandIds: overlay.commandIds,
                defaultCommands,
                gridCommands: overlay.commands,
                commandContext: overlay.commandContext,
                keyBindings,
                strings,
            }),
        [defaultCommands, keyBindings, overlay, strings],
    );
    const entries = useMemo(() => getMenuEntries(overlay, commands), [commands, overlay]);

    if (entries.length === 0) {
        return null;
    }

    return (
        <div
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            style={{ position: "fixed", inset: 0, zIndex: overlayZIndex }}>
            <Menu
                open={true}
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
                        closeOverlay();
                    }
                }}>
                <MenuPopover onClick={(event) => event.stopPropagation()}>
                    <MenuList>
                        {entries.map((entry) =>
                            isCopyAsEntry(entry)
                                ? renderCopyAsMenuItem({
                                      entry,
                                      closeOverlay,
                                      overlay,
                                      className: classes.menuItem,
                                      strings,
                                  })
                                : renderCommandMenuItem({
                                      command: entry,
                                      closeOverlay,
                                      overlay,
                                      className: classes.menuItem,
                                  }),
                        )}
                    </MenuList>
                </MenuPopover>
            </Menu>
        </div>
    );
}

export function FluentResultGridOverlayHost({
    overlay,
    closeOverlay,
    strings,
    keyBindings,
    defaultCommands,
}: FluentResultGridOverlayHostProps) {
    if (overlay.kind !== "menu") {
        return null;
    }

    return (
        <FluentResultGridMenuOverlay
            overlay={overlay}
            closeOverlay={closeOverlay}
            strings={strings}
            keyBindings={keyBindings}
            defaultCommands={defaultCommands}
        />
    );
}
