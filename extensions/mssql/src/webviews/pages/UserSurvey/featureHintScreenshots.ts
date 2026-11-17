/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FeatureHintScreenshotId } from "../../../sharedInterfaces/userSurvey";

/** Images bundled for survey feature hints, keyed by the id used in featureHints.config.ts. */
export const featureHintScreenshots: Record<FeatureHintScreenshotId, string> = {
    dataTierApplication: require("../../../../images/walkthroughs/features/dacpac-bacpac.gif"),
    editData: require("../../../../images/walkthroughs/features/edit-data.gif"),
    localContainer: require("../../../../images/walkthroughs/buildApp/local-container.gif"),
    schemaCompare: require("../../../../images/walkthroughs/features/schema-compare.gif"),
    schemaDesigner: require("../../../../images/walkthroughs/features/schema-designer.gif"),
    tableDesigner: require("../../../../images/walkthroughs/features/table-designer.gif"),
};
