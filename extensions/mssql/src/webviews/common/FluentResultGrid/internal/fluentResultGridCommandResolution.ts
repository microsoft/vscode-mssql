/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isValidElement, type ReactElement } from "react";
import { builtInFluentResultGridCommands } from "./fluentResultGridBuiltInCommands";
import {
    FluentResultGridCommand,
    type FluentResultGridBuiltInCommandId,
    type FluentResultGridCommandId,
} from "../types/fluentResultGridCommandIds";
import {
    getFluentResultGridCommandTooltip,
    type FluentResultGridCommandConfiguration,
    type FluentResultGridCommandContext,
    type FluentResultGridCommandContribution,
    type FluentResultGridCommandPlacement,
    type FluentResultGridKeyBindingMap,
} from "../types/fluentResultGridCommands";
import type {
    FluentResultGridCommandDisplay,
    FluentResultGridStrings,
} from "../types/fluentResultGridStrings";

export interface FluentResultGridResolvedCommand {
    command: FluentResultGridCommandContribution;
    display: FluentResultGridCommandDisplay;
    shortcutLabel?: string;
    title: string;
    disabled: boolean;
}

export interface FluentResultGridCommandResolutionOptions {
    placement: FluentResultGridCommandPlacement;
    commandIds?: readonly FluentResultGridCommandId[];
    defaultCommands?: FluentResultGridCommandConfiguration;
    gridCommands?: FluentResultGridCommandConfiguration;
    commandContext: FluentResultGridCommandContext;
    keyBindings: FluentResultGridKeyBindingMap;
    strings: FluentResultGridStrings;
}

export function isBuiltInFluentResultGridCommandId(
    commandId: FluentResultGridCommandId,
): commandId is FluentResultGridBuiltInCommandId {
    return Object.values(FluentResultGridCommand).includes(
        commandId as FluentResultGridBuiltInCommandId,
    );
}

export function getFluentResultGridCommandDisplay(
    command: FluentResultGridCommandContribution,
    strings: FluentResultGridStrings,
): FluentResultGridCommandDisplay {
    const stringDisplay = isBuiltInFluentResultGridCommandId(command.id)
        ? strings.commands[command.id]
        : undefined;

    return {
        label: stringDisplay?.label || command.label || command.id,
        tooltip: stringDisplay?.tooltip ?? command.tooltip,
        ariaLabel: stringDisplay?.ariaLabel ?? command.ariaLabel,
    };
}

export function getFluentResultGridShortcutLabel(
    keyBindings: FluentResultGridKeyBindingMap,
    commandId: FluentResultGridCommandId,
): string | undefined {
    const keyBinding = keyBindings[commandId];
    return keyBinding?.label ?? keyBinding?.keyCombination;
}

export function toFluentResultGridReactElement(
    icon: FluentResultGridCommandContribution["icon"],
): ReactElement | undefined {
    return isValidElement(icon) ? icon : undefined;
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

function getConfiguredCommandIds({
    placement,
    commandIds,
    defaultCommands,
    gridCommands,
}: Pick<
    FluentResultGridCommandResolutionOptions,
    "placement" | "commandIds" | "defaultCommands" | "gridCommands"
>): readonly FluentResultGridCommandId[] | undefined {
    return (
        commandIds ??
        gridCommands?.placements?.[placement] ??
        defaultCommands?.placements?.[placement]
    );
}

function getCommandContributionsForPlacement({
    placement,
    commandIds,
    defaultCommands,
    gridCommands,
}: Pick<
    FluentResultGridCommandResolutionOptions,
    "placement" | "commandIds" | "defaultCommands" | "gridCommands"
>) {
    const commandById = getMergedCommandMap(defaultCommands, gridCommands);
    const configuredCommandIds = getConfiguredCommandIds({
        placement,
        commandIds,
        defaultCommands,
        gridCommands,
    });

    if (configuredCommandIds) {
        return configuredCommandIds.map(
            (commandId) =>
                commandById.get(commandId) ?? {
                    id: commandId,
                    label: commandId,
                    placements: [placement],
                },
        );
    }

    return Array.from(commandById.values())
        .filter((command) => command.placements.includes(placement))
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export function resolveFluentResultGridCommands({
    placement,
    commandIds,
    defaultCommands,
    gridCommands,
    commandContext,
    keyBindings,
    strings,
}: FluentResultGridCommandResolutionOptions): FluentResultGridResolvedCommand[] {
    return getCommandContributionsForPlacement({
        placement,
        commandIds,
        defaultCommands,
        gridCommands,
    }).flatMap((command) => {
        if (command.isVisible?.(commandContext) === false) {
            return [];
        }

        const display = getFluentResultGridCommandDisplay(command, strings);
        const shortcutLabel = getFluentResultGridShortcutLabel(keyBindings, command.id);
        const title = getFluentResultGridCommandTooltip(
            display,
            shortcutLabel,
            strings.formatCommandTooltip,
        );

        return [
            {
                command,
                display,
                shortcutLabel,
                title,
                disabled: command.isEnabled?.(commandContext) === false,
            },
        ];
    });
}
