/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PrivatePreviewFeature, previewService } from "../previews/previewService";

export function isQueryStudioEnabled(): boolean {
    return previewService.isPrivatePreviewEnabled(
        PrivatePreviewFeature.SqlDataPlane,
        PrivatePreviewFeature.QueryStudio,
    );
}

/** Untitled queries remain supported; saved SQL files stay in the classic editor. */
export function isQueryStudioResource(uri: { scheme: string; path: string }): boolean {
    return uri.scheme === "untitled" || /\.mssql$/i.test(uri.path);
}
