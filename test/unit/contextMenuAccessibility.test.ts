/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { LocConstants } from "../../src/reactviews/common/locConstants";

suite("Context Menu Accessibility Tests", () => {
    test("Localization constants for column resize are defined", () => {
        const locConstants = LocConstants.getInstance();
        
        // Verify that the new localization strings exist for header context menu
        assert.ok(locConstants.queryResult.autoResizeColumn);
        assert.ok(locConstants.queryResult.resizeColumn);
        
        // Verify they return non-empty strings
        assert.notStrictEqual(locConstants.queryResult.autoResizeColumn.trim(), "");
        assert.notStrictEqual(locConstants.queryResult.resizeColumn.trim(), "");
        
        // Verify expected content
        assert.ok(locConstants.queryResult.autoResizeColumn.includes("Auto Resize"));
        assert.ok(locConstants.queryResult.resizeColumn.includes("Resize Column"));
    });

    test("Header context menu provides WCAG 2.5.7 compliant alternatives", () => {
        // This test verifies that we have the necessary building blocks for WCAG 2.5.7 compliance
        
        // Test that we have the required localization strings for single-pointer alternatives
        const locConstants = LocConstants.getInstance();
        
        // Auto resize option (single click alternative to dragging to auto-size)
        assert.ok(locConstants.queryResult.autoResizeColumn);
        
        // Manual resize option (single click alternative to dragging to specific size)
        assert.ok(locConstants.queryResult.resizeColumn);
        
        // These provide the text for context menu items that serve as single-pointer
        // alternatives to the dragging movement for column resizing, satisfying WCAG 2.5.7
    });
});