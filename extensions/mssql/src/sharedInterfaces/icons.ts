/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentIcon } from "@fluentui/react-icons";

/**
 * Interface to support type-safe references to icons across both controller and frontend.
 * IMPORTANT: Ensure that the map in iconUtils.tsx is updated when adding new icons here.
 */
export interface Icons {
    BookOpen16Filled: FluentIcon;
    Bug16Regular: FluentIcon;
    Chat16Regular: FluentIcon;
    ClipboardBulletList16Regular: FluentIcon;
    Lightbulb16Regular: FluentIcon;
    VideoClip16Filled: FluentIcon;
}
