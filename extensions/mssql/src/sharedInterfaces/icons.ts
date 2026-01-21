/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Interface to support type-safe references to icons across both controller and frontend.
 * IMPORTANT: Ensure that the map in iconUtils.tsx is updated when adding new icons here.
 */
export interface Icons {
    BookOpenFilled: React.ReactElement;
    BugRegular: React.ReactElement;
    ChatRegular: React.ReactElement;
    ClipboardBulletListRegular: React.ReactElement;
    LightbulbRegular: React.ReactElement;
    VideoClipFilled: React.ReactElement;
}
