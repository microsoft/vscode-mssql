/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import { getActiveEditorTextArea, openNewQueryEditor, setQueryText } from "./utils/testHelpers";
import { QuickInput } from "./pageObjects";
import { testCases } from "./utils/testCases";

/** Colors depend on the theme, so the theme is pinned and its token colors asserted. */
const THEME = "Default Dark Modern";
const KEYWORD_COLOR = { hex: "#569CD6", rgb: "rgb(86, 156, 214)" };
const FUNCTION_COLOR = { hex: "#DCDCAA", rgb: "rgb(220, 220, 170)" };

const INSPECT_TOKENS = {
    filter: "Developer: Inspect Editor Tokens",
    label: "Developer: Inspect Editor Tokens and Scopes",
};

/**
 * T-SQL syntax colorization: keywords and system functions get their TextMate scopes from the
 * extension's grammar, and the pinned theme colors them accordingly.
 */
test.describe("MSSQL Extension - Syntax colorization", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({ "workbench.colorTheme": THEME }),
        },
        afterLaunch: async ({ page }) => {
            await openNewQueryEditor(page);
            await setQueryText(
                undefined as never,
                page,
                "SET DEADLOCK_PRIORITY LOW;\nALTER EVENT SESSION s ON SERVER WITH (MAX_DISPATCH_LATENCY = 1, ABORT_AFTER_WAIT = SELF);\nSELECT AVG(object_id) AS average FROM sys.objects;",
            );
        },
    });

    /** A rendered token in the active editor, by its exact text. */
    function getToken(page: Page, text: string): Locator {
        return getActiveEditorTextArea(page)
            .locator(".view-line span span")
            .filter({ hasText: new RegExp(`^${text}$`) })
            .first();
    }

    /** Runs the token inspector on a token and returns the inspector's text. */
    async function inspectToken(page: Page, text: string): Promise<string> {
        const token = getToken(page, text);
        await expect(token).toBeVisible();
        // Grammar tokenization is asynchronous, so wait for the token to be split out.
        await token.click();
        await new QuickInput(page).runCommand(INSPECT_TOKENS.filter, INSPECT_TOKENS.label);
        const inspector = page.locator(".token-inspect-widget");
        await expect(inspector).toBeVisible();
        await expect(inspector).toContainText(text);
        const details = await inspector.innerText();
        await page.keyboard.press("Escape");
        await expect(inspector).toBeHidden();
        return details;
    }

    test(
        "keywords such as ABORT_AFTER_WAIT are colored as keywords",
        testCases(5878828),
        async () => {
            const { page } = getContext();
            await expect(getToken(page, "ABORT_AFTER_WAIT")).toHaveCSS("color", KEYWORD_COLOR.rgb, {
                timeout: 30 * 1000,
            });

            const details = await inspectToken(page, "ABORT_AFTER_WAIT");
            expect(details).toContain("keyword.other.sql");
            expect(details.toUpperCase()).toContain(KEYWORD_COLOR.hex);
        },
    );

    test("system functions such as AVG are colored as functions", testCases(5878828), async () => {
        const { page } = getContext();
        await expect(getToken(page, "AVG")).toHaveCSS("color", FUNCTION_COLOR.rgb, {
            timeout: 30 * 1000,
        });

        const details = await inspectToken(page, "AVG");
        expect(details).toContain("support.function.aggregate.sql");
        expect(details.toUpperCase()).toContain(FUNCTION_COLOR.hex);
    });
});
