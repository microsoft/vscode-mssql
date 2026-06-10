/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FluentResultGridBuiltInCommandId } from "./fluentResultGridCommandIds";

export interface FluentResultGridCommandDisplay {
    label: string;
    tooltip?: string;
    ariaLabel?: string;
}

export interface FluentResultGridCommandTooltipFormatArgs {
    label: string;
    tooltip?: string;
    shortcut?: string;
}

export interface FluentResultGridMenuStrings {
    copyAs: string;
    moreActions: string;
    filterOptions: string;
}

export interface FluentResultGridFilterStrings {
    nullValue: string;
    blankValue: string;
    search: string;
    apply: string;
    clear: string;
    close: string;
    noResultsToDisplay: string;
}

export interface FluentResultGridAccessibilityStrings {
    selectedCount: (count: number) => string;
    gridAriaLabel: (batchId: number, resultId: number) => string;
    toolbarAriaLabel: string;
}

export interface FluentResultGridStrings {
    commands: Partial<Record<FluentResultGridBuiltInCommandId, FluentResultGridCommandDisplay>>;
    menus: FluentResultGridMenuStrings;
    filter: FluentResultGridFilterStrings;
    accessibility: FluentResultGridAccessibilityStrings;
    /**
     * Centralized formatting for command tooltips with shortcuts.
     *
     * Default behavior:
     * tooltip ?? label
     * shortcut ? `${text} (${shortcut})` : text
     */
    formatCommandTooltip?: (args: FluentResultGridCommandTooltipFormatArgs) => string;
}

export interface FluentResultGridStringOverrides {
    commands?: Partial<
        Record<FluentResultGridBuiltInCommandId, Partial<FluentResultGridCommandDisplay>>
    >;
    menus?: Partial<FluentResultGridMenuStrings>;
    filter?: Partial<FluentResultGridFilterStrings>;
    accessibility?: Partial<FluentResultGridAccessibilityStrings>;
    formatCommandTooltip?: (args: FluentResultGridCommandTooltipFormatArgs) => string;
}

export function mergeFluentResultGridStrings(
    defaults: FluentResultGridStrings,
    overrides?: FluentResultGridStringOverrides,
): FluentResultGridStrings {
    const commandOverrides = overrides?.commands ?? {};
    const commands = Object.fromEntries(
        Object.entries(defaults.commands).map(([commandId, display]) => [
            commandId,
            {
                ...display,
                ...commandOverrides[commandId as FluentResultGridBuiltInCommandId],
            },
        ]),
    ) as FluentResultGridStrings["commands"];

    for (const [commandId, display] of Object.entries(commandOverrides)) {
        commands[commandId as FluentResultGridBuiltInCommandId] = {
            ...commands[commandId as FluentResultGridBuiltInCommandId],
            ...display,
        } as FluentResultGridCommandDisplay;
    }

    return {
        commands,
        menus: {
            ...defaults.menus,
            ...overrides?.menus,
        },
        filter: {
            ...defaults.filter,
            ...overrides?.filter,
        },
        accessibility: {
            ...defaults.accessibility,
            ...overrides?.accessibility,
        },
        formatCommandTooltip: overrides?.formatCommandTooltip ?? defaults.formatCommandTooltip,
    };
}
