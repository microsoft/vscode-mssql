/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright tags that sort e2e tests into tiers; see test/e2e/README.md. An untagged test is in
 * the stable tier.
 */
export const Tag = {
    /** Key stable tests that also run as a check on every pull request. */
    pullRequest: "@pull-request",
    /** Tests that fail or are flaky in CI. They run nightly, and their failures are not fatal. */
    flaky: "@flaky",
} as const;
