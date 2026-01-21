/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    BookOpen16Filled,
    Bug16Regular,
    Chat16Regular,
    ClipboardBulletList16Regular,
    Lightbulb16Regular,
    Open16Regular,
    VideoClip16Filled,
} from "@fluentui/react-icons";
import { Icons } from "../../../sharedInterfaces/icons";

/**
 * Map of icon names to their React components.
 * IMPORTANT: Keep this in sync with the Icons interface in sharedInterfaces/icons.ts
 */
const actionIcons: Record<keyof Icons, React.ComponentType> = {
    BookOpen16Filled: BookOpen16Filled,
    Bug16Regular: Bug16Regular,
    Chat16Regular: Chat16Regular,
    ClipboardBulletList16Regular: ClipboardBulletList16Regular,
    Lightbulb16Regular: Lightbulb16Regular,
    VideoClip16Filled: VideoClip16Filled,
};

/**
 * Gets the icon component for a given icon name.
 * Falls back to Open16Regular if the icon name is not found or not provided.
 * @param iconName - The name of the icon to look up
 * @returns The React element for the icon
 */
export function getActionIcon(iconName?: keyof Icons): React.ReactElement {
    if (iconName && actionIcons[iconName]) {
        const IconComponent = actionIcons[iconName];
        return <IconComponent />;
    }
    return <Open16Regular />;
}
