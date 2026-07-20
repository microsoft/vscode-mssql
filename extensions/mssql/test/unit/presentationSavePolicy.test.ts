/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { presentationSaveRequiresDraftDemotionConfirmation } from "../../src/runbookStudio/presentation/presentationSavePolicy";

suite("presentationSavePolicy", () => {
    test("warns only for approved library-backed documents", () => {
        expect(
            presentationSaveRequiresDraftDemotionConfirmation("mssql-runbook", "approved"),
        ).to.equal(true);
        expect(presentationSaveRequiresDraftDemotionConfirmation("file", "approved")).to.equal(
            false,
        );
        expect(
            presentationSaveRequiresDraftDemotionConfirmation("mssql-runbook", "draft"),
        ).to.equal(false);
        expect(
            presentationSaveRequiresDraftDemotionConfirmation("mssql-runbook", undefined),
        ).to.equal(false);
    });
});
