/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mssqlActivityBarButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("MSSQL Extension - Activity Bar", async () => {
    const getContext = useSharedVsCodeLifecycle();

    test("MSSQL button is present in activity bar", async () => {
        const { page: vsCodePage } = getContext();
        await vsCodePage.click(mssqlActivityBarButton);
        const count = await vsCodePage.locator(mssqlActivityBarButton).count();
        expect(count).toEqual(1);
    });
});
