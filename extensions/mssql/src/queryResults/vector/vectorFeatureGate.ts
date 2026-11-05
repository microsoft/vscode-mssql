/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PrivatePreviewFeature, previewService } from "../../previews/previewService";
import { VectorWorkbench as VectorLoc } from "../../constants/locConstants";
export function vectorWorkbenchEnabled(): boolean {
    return previewService.isPrivatePreviewEnabled(
        PrivatePreviewFeature.SqlDataPlane,
        PrivatePreviewFeature.QueryStudio,
        PrivatePreviewFeature.VectorWorkbench,
    );
}

export function requireVectorWorkbench(): void {
    if (!vectorWorkbenchEnabled()) throw new Error(VectorLoc.disabled);
}
