/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TestDetails } from "@playwright/test";

/** Annotation type that links a Playwright test to a manual test case in the test plan. */
export const TEST_CASE_ANNOTATION_TYPE = "testCase";

/**
 * Builds Playwright test details that record which manual test plan cases a test covers.
 *
 * Pass the result as the second argument of `test(...)` or `test.describe(...)`. The IDs are
 * plain test case numbers, so they show up in the HTML and JUnit reports without depending on
 * any particular test-management URL.
 */
export function testCases(...ids: number[]): TestDetails {
    return {
        annotation: ids.map((id) => ({
            type: TEST_CASE_ANNOTATION_TYPE,
            description: String(id),
        })),
    };
}
