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
    Overflow,
    OverflowItem,
    Toolbar,
    ToolbarButton,
    type ToolbarButtonProps,
    useIsOverflowItemVisible,
    useOverflowMenu,
} from "@fluentui/react-components";
import {
    ArrowMaximize16Filled,
    ArrowMinimize16Filled,
    DocumentTextRegular,
    MoreVertical20Filled,
    TableRegular,
} from "@fluentui/react-icons";
import { isValidElement, useMemo, type KeyboardEvent, type ReactElement } from "react";
import { useFluentResultGridProvider } from "./FluentResultGridProvider";
import { builtInFluentResultGridCommands } from "./internal/fluentResultGridBuiltInCommands";
import {
    FluentResultGridCommand,
    type FluentResultGridBuiltInCommandId,
    type FluentResultGridCommandId,
} from "./types/fluentResultGridCommandIds";
import {
    FluentResultGridCommandPlacement,
    getFluentResultGridCommandTooltip,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandContext,
    type FluentResultGridCommandContribution,
    type FluentResultGridCommandEvent,
    type FluentResultGridKeyBindingMap,
    type FluentResultGridToolbarOptions,
} from "./types/fluentResultGridCommands";
import type { MaybePromise } from "./types/fluentResultGridPrimitives";
import type {
    FluentResultGridCommandDisplay,
    FluentResultGridStrings,
} from "./types/fluentResultGridStrings";
import type { FluentResultGridTheme } from "./types/fluentResultGridTheme";

const toolbarPlacement = FluentResultGridCommandPlacement.Toolbar;
const toolbarWidthPx = 40;

const useStyles = makeStyles({
    toolbarContainer: {
        width: `${toolbarWidthPx}px`,
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        paddingRight: "10px",
    },
    toolbar: {
        width: "100%",
    },
    buttonImg: {
        display: "block",
        height: "16px",
        width: "16px",
    },
    toolbarButton: {
        width: "32px",
        height: "32px",
        minWidth: "32px",
        minHeight: "32px",
        padding: "4px",
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
});

export interface FluentResultGridToolbarProps {
    toolbar?: FluentResultGridToolbarOptions;
    commands?: FluentResultGridCommandConfiguration;
    commandContext: FluentResultGridCommandContext;
    onCommand?: (event: FluentResultGridCommandEvent) => MaybePromise<void>;
    onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

type ToolbarOverflowButtonProps = {
    overflowId: string;
    overflowGroupId?: string;
} & ToolbarButtonProps;

interface FluentResultGridToolbarAction {
    id: FluentResultGridCommandId;
    groupId?: string;
    icon: ReactElement;
    ariaLabel: string;
    title: string;
    menuLabel: string;
    onClick: () => void;
    disabled?: boolean;
}

function isLightTheme(kind: FluentResultGridTheme["kind"] | undefined): boolean {
    return kind === undefined || kind === "light" || kind === "highContrastLight";
}

function saveAsCsvIcon(kind: FluentResultGridTheme["kind"] | undefined) {
    return isLightTheme(kind)
        ? require("../../media/saveCsv.svg")
        : require("../../media/saveCsv_inverse.svg");
}

function saveAsJsonIcon(kind: FluentResultGridTheme["kind"] | undefined) {
    return isLightTheme(kind)
        ? require("../../media/saveJson.svg")
        : require("../../media/saveJson_inverse.svg");
}

function saveAsExcelIcon(kind: FluentResultGridTheme["kind"] | undefined) {
    return isLightTheme(kind)
        ? require("../../media/saveExcel.svg")
        : require("../../media/saveExcel_inverse.svg");
}

function saveAsInsertIcon(kind: FluentResultGridTheme["kind"] | undefined) {
    return isLightTheme(kind)
        ? require("../../media/saveInsert.svg")
        : require("../../media/saveInsert_inverse.svg");
}

function isBuiltInCommandId(
    commandId: FluentResultGridCommandId,
): commandId is FluentResultGridBuiltInCommandId {
    return Object.values(FluentResultGridCommand).includes(
        commandId as FluentResultGridBuiltInCommandId,
    );
}

function getBuiltInCommandIcon(
    commandId: FluentResultGridCommandId,
    themeKind: FluentResultGridTheme["kind"] | undefined,
    imageClassName: string,
): ReactElement | undefined {
    switch (commandId) {
        case FluentResultGridCommand.SwitchToGridView:
            return <TableRegular />;
        case FluentResultGridCommand.SwitchToTextView:
            return <DocumentTextRegular />;
        case FluentResultGridCommand.Maximize:
            return <ArrowMaximize16Filled className={imageClassName} />;
        case FluentResultGridCommand.Restore:
            return <ArrowMinimize16Filled className={imageClassName} />;
        case FluentResultGridCommand.SaveAsCsv:
            return <img className={imageClassName} src={saveAsCsvIcon(themeKind)} />;
        case FluentResultGridCommand.SaveAsJson:
            return <img className={imageClassName} src={saveAsJsonIcon(themeKind)} />;
        case FluentResultGridCommand.SaveAsExcel:
            return <img className={imageClassName} src={saveAsExcelIcon(themeKind)} />;
        case FluentResultGridCommand.SaveAsInsert:
            return <img className={imageClassName} src={saveAsInsertIcon(themeKind)} />;
        default:
            return undefined;
    }
}

function getCommandDisplay(
    command: FluentResultGridCommandContribution,
    strings: FluentResultGridStrings,
): FluentResultGridCommandDisplay {
    const stringDisplay = isBuiltInCommandId(command.id) ? strings.commands[command.id] : undefined;

    return {
        label: stringDisplay?.label || command.label || command.id,
        tooltip: stringDisplay?.tooltip ?? command.tooltip,
        ariaLabel: stringDisplay?.ariaLabel ?? command.ariaLabel,
    };
}

function addCommandContributions(
    commandById: Map<FluentResultGridCommandId, FluentResultGridCommandContribution>,
    contributions: readonly FluentResultGridCommandContribution[] | undefined,
) {
    for (const contribution of contributions ?? []) {
        const existing = commandById.get(contribution.id);
        commandById.set(
            contribution.id,
            existing ? { ...existing, ...contribution } : contribution,
        );
    }
}

function getMergedCommandMap(
    defaultCommands: FluentResultGridCommandConfiguration | undefined,
    gridCommands: FluentResultGridCommandConfiguration | undefined,
) {
    const commandById = new Map<FluentResultGridCommandId, FluentResultGridCommandContribution>();

    for (const command of builtInFluentResultGridCommands) {
        commandById.set(command.id, command);
    }

    addCommandContributions(commandById, defaultCommands?.contributions);
    addCommandContributions(commandById, gridCommands?.contributions);

    return commandById;
}

function getConfiguredToolbarCommandIds(
    defaultCommands: FluentResultGridCommandConfiguration | undefined,
    gridCommands: FluentResultGridCommandConfiguration | undefined,
    toolbar: FluentResultGridToolbarOptions | undefined,
): readonly FluentResultGridCommandId[] | undefined {
    return (
        toolbar?.commandIds ??
        gridCommands?.placements?.[toolbarPlacement] ??
        defaultCommands?.placements?.[toolbarPlacement]
    );
}

function getToolbarCommandContributions(
    defaultCommands: FluentResultGridCommandConfiguration | undefined,
    gridCommands: FluentResultGridCommandConfiguration | undefined,
    toolbar: FluentResultGridToolbarOptions | undefined,
) {
    const commandById = getMergedCommandMap(defaultCommands, gridCommands);
    const configuredCommandIds = getConfiguredToolbarCommandIds(
        defaultCommands,
        gridCommands,
        toolbar,
    );

    if (configuredCommandIds) {
        return configuredCommandIds.map(
            (commandId) =>
                commandById.get(commandId) ?? {
                    id: commandId,
                    label: commandId,
                    placements: [toolbarPlacement],
                },
        );
    }

    return Array.from(commandById.values())
        .filter((command) => command.placements.includes(toolbarPlacement))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

function getShortcutLabel(
    keyBindings: FluentResultGridKeyBindingMap,
    commandId: FluentResultGridCommandId,
): string | undefined {
    const keyBinding = keyBindings[commandId];
    return keyBinding?.label ?? keyBinding?.keyCombination;
}

function toReactElement(
    icon: FluentResultGridCommandContribution["icon"],
): ReactElement | undefined {
    return isValidElement(icon) ? icon : undefined;
}

function getToolbarActions({
    commandContext,
    commands,
    defaultCommands,
    keyBindings,
    onCommand,
    strings,
    theme,
    toolbar,
    imageClassName,
}: {
    commandContext: FluentResultGridCommandContext;
    commands: FluentResultGridCommandConfiguration | undefined;
    defaultCommands: FluentResultGridCommandConfiguration | undefined;
    keyBindings: FluentResultGridKeyBindingMap;
    onCommand: ((event: FluentResultGridCommandEvent) => MaybePromise<void>) | undefined;
    strings: FluentResultGridStrings;
    theme: FluentResultGridTheme | undefined;
    toolbar: FluentResultGridToolbarOptions | undefined;
    imageClassName: string;
}): FluentResultGridToolbarAction[] {
    return getToolbarCommandContributions(defaultCommands, commands, toolbar).flatMap((command) => {
        if (command.isVisible?.(commandContext) === false) {
            return [];
        }

        const display = getCommandDisplay(command, strings);
        const shortcutLabel = getShortcutLabel(keyBindings, command.id);
        const title = getFluentResultGridCommandTooltip(
            display,
            shortcutLabel,
            strings.formatCommandTooltip,
        );
        const icon = toReactElement(command.icon) ??
            getBuiltInCommandIcon(command.id, theme?.kind, imageClassName) ?? (
                <DocumentTextRegular />
            );

        return [
            {
                id: command.id,
                groupId: command.groupId,
                icon,
                ariaLabel: display.ariaLabel ?? title,
                title,
                menuLabel: display.label,
                disabled: !onCommand || command.isEnabled?.(commandContext) === false,
                onClick: () => {
                    void onCommand?.({
                        ...commandContext,
                        commandId: command.id,
                    });
                },
            },
        ];
    });
}

const ToolbarOverflowButton = ({
    overflowId,
    overflowGroupId,
    className,
    ...props
}: ToolbarOverflowButtonProps & { className?: string }) => {
    const classes = useStyles();
    const mergedClassName = [classes.toolbarButton, className].filter(Boolean).join(" ");
    return (
        <OverflowItem id={overflowId} groupId={overflowGroupId}>
            <ToolbarButton appearance="subtle" {...props} className={mergedClassName} />
        </OverflowItem>
    );
};

const ToolbarOverflowMenuItem = ({ action }: { action: FluentResultGridToolbarAction }) => {
    const isVisible = useIsOverflowItemVisible(action.id);
    if (isVisible) {
        return null;
    }
    return (
        <MenuItem disabled={action.disabled} onClick={action.onClick}>
            {action.menuLabel}
        </MenuItem>
    );
};

const ToolbarOverflowMenu = ({
    actions,
    moreActionsLabel,
}: {
    actions: FluentResultGridToolbarAction[];
    moreActionsLabel: string;
}) => {
    const { ref, isOverflowing } = useOverflowMenu<HTMLButtonElement>();
    if (!isOverflowing) {
        return null;
    }

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <ToolbarButton
                    ref={ref}
                    appearance="subtle"
                    icon={<MoreVertical20Filled />}
                    aria-label={moreActionsLabel}
                    title={moreActionsLabel}
                />
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {actions.map((action) => (
                        <ToolbarOverflowMenuItem key={action.id} action={action} />
                    ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};

export function FluentResultGridToolbar({
    toolbar,
    commands,
    commandContext,
    onCommand,
    onKeyDownCapture,
}: FluentResultGridToolbarProps) {
    const classes = useStyles();
    const { defaultCommands, keyBindings, strings, theme } = useFluentResultGridProvider();

    const actions = useMemo(
        () =>
            getToolbarActions({
                commandContext,
                commands,
                defaultCommands,
                keyBindings,
                onCommand,
                strings,
                theme,
                toolbar,
                imageClassName: classes.buttonImg,
            }),
        [
            classes.buttonImg,
            commandContext,
            commands,
            defaultCommands,
            keyBindings,
            onCommand,
            strings,
            theme,
            toolbar,
        ],
    );

    if (toolbar?.visible === false || actions.length === 0) {
        return null;
    }

    return (
        <div
            className={classes.toolbarContainer}
            data-fluent-result-grid-toolbar="true"
            onKeyDownCapture={onKeyDownCapture}>
            <Overflow overflowAxis="vertical" overflowDirection="end">
                <Toolbar
                    vertical
                    className={classes.toolbar}
                    aria-label={strings.accessibility.toolbarAriaLabel}>
                    {actions.map((action) => (
                        <ToolbarOverflowButton
                            key={action.id}
                            overflowId={action.id}
                            overflowGroupId={action.groupId}
                            icon={action.icon}
                            aria-label={action.ariaLabel}
                            title={action.title}
                            onClick={action.onClick}
                            disabled={action.disabled}
                        />
                    ))}
                    <ToolbarOverflowMenu
                        actions={actions}
                        moreActionsLabel={strings.menus.moreActions}
                    />
                </Toolbar>
            </Overflow>
        </div>
    );
}
