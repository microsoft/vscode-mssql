/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCoverageMap, type CoverageMapData } from "istanbul-lib-coverage";

export function mergeCoverageData(
    existingCoverage: CoverageMapData,
    currentCoverage: CoverageMapData,
): CoverageMapData {
    const coverageMap = createCoverageMap(existingCoverage);
    coverageMap.merge(currentCoverage);
    return coverageMap.toJSON();
}
