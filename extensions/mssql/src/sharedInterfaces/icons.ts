/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Interface to support type-safe references to icons across both controller and frontend.
 * IMPORTANT: Ensure that the map in iconUtils.tsx is updated when adding new icons here.
 */
export interface Icons {
    BookOpen16Filled: React.ReactElement;
    Bug16Regular: React.ReactElement;
    Chat16Regular: React.ReactElement;
    ClipboardBulletList16Regular: React.ReactElement;
    Lightbulb16Regular: React.ReactElement;
    VideoClip16Filled: React.ReactElement;
}
