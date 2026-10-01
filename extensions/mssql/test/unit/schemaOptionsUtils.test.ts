/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { DacDeployOptionPropertyBoolean } from "vscode-mssql";
import { locConstants as loc } from "../../src/webviews/common/locConstants";
import { getSchemaCompareGeneralOptionPresentation } from "../../src/webviews/pages/SchemaCompare/components/schemaOptionsUtils";

suite("Schema Compare options utilities", () => {
    test("clarifies that AllowIncompatiblePlatform only applies during deployment", () => {
        const option: DacDeployOptionPropertyBoolean = {
            value: true,
            displayName: "Allow incompatible platform",
            description: "Allows deployment to an incompatible platform.",
        };

        const result = getSchemaCompareGeneralOptionPresentation(
            "allowIncompatiblePlatform",
            option,
        );

        expect(result).to.deep.equal({
            displayName: loc.schemaCompare.allowIncompatiblePlatformDisplayName,
            description: loc.schemaCompare.allowIncompatiblePlatformDescription,
        });
    });

    test("preserves presentation supplied for other deployment options", () => {
        const option: DacDeployOptionPropertyBoolean = {
            value: false,
            displayName: "Block on possible data loss",
            description: "Blocks deployment when data loss is possible.",
        };

        const result = getSchemaCompareGeneralOptionPresentation("blockOnPossibleDataLoss", option);

        expect(result).to.deep.equal({
            displayName: option.displayName,
            description: option.description,
        });
    });
});
