/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { testCases } from "./utils/testCases";
import { getWebviewByTitle } from "./utils/testHelpers";
import {
    FIXTURE_PROJECT_NAME,
    runProjectContextAction,
    useFixtureProjectLifecycle,
} from "./utils/sqlProjectPublishHelpers";

/** Opens Code Analysis Settings from the project node and waits for the rules table. */
async function openCodeAnalysisDialog(page: Page): Promise<FrameLocator> {
    await runProjectContextAction(page, "Code Analysis Settings");
    const dialog = await getWebviewByTitle(page, "Code Analysis");
    await expect(dialog.getByText(`Code Analysis - ${FIXTURE_PROJECT_NAME}`)).toBeVisible();
    await expect(dialog.getByRole("table")).toBeVisible({ timeout: 2 * 60 * 1000 });
    return dialog;
}

/** Picks a value in one of the dialog's Fluent dropdowns. */
async function selectOption(dialog: FrameLocator, comboboxName: string, option: string) {
    const combobox = dialog.getByRole("combobox", { name: comboboxName, exact: true });
    await combobox.click();
    await dialog.getByRole("option", { name: option, exact: true }).click();
    await expect(combobox).toHaveText(option);
}

/**
 * Clicks a button that closes the dialog and waits for its editor tab to go away. The click is
 * not awaited: the webview frame is disposed mid-click, which would otherwise stall it.
 */
async function clickAndExpectClosed(page: Page, button: Locator): Promise<void> {
    await expect(button).toBeEnabled();
    void button.click().catch(() => undefined);
    await expect(page.getByRole("tab", { name: /^Code Analysis/ })).toHaveCount(0);
}

/** The severity dropdown of a rule, e.g. "SR0001". */
function severityOf(dialog: FrameLocator, ruleId: string) {
    return dialog.getByRole("combobox", { name: `Severity for ${ruleId}`, exact: true });
}

/**
 * SQL Database Projects: the Code Analysis Settings dialog — loading rules and saved overrides,
 * changing severities, Enable Code Analysis on Build, Apply/OK/Cancel/Reset, search and severity
 * filtering, category toggles, and save errors.
 */
test.describe("SQL Database Projects code analysis settings", () => {
    test.describe.configure({ mode: "serial" });
    const { project, getContext } = useFixtureProjectLifecycle({
        prepareProject: (copy) => {
            // Start from a project that already has saved overrides.
            const sqlproj = fs.readFileSync(copy.sqlprojPath, "utf8");
            fs.writeFileSync(
                copy.sqlprojPath,
                sqlproj.replace(
                    "</PropertyGroup>",
                    "  <RunSqlCodeAnalysis>True</RunSqlCodeAnalysis>\n" +
                        "    <SqlCodeAnalysisRules>-Microsoft.Rules.Data.SR0001;+!Microsoft.Rules.Data.SR0004</SqlCodeAnalysisRules>\n" +
                        "  </PropertyGroup>",
                ),
            );
        },
    });
    const readSqlproj = () => fs.readFileSync(project.sqlprojPath, "utf8");

    test(
        "opens with the rules grouped by category and the saved overrides",
        testCases(5878944),
        async () => {
            const { page } = getContext();
            const dialog = await openCodeAnalysisDialog(page);
            for (const category of ["Design", "Naming", "Performance"]) {
                await expect(
                    dialog.getByRole("checkbox", { name: `Enable all rules in ${category}` }),
                ).toBeVisible();
            }
            await expect(dialog.getByText(/^\d+ rules$/)).toBeVisible();
            await expect(
                dialog.getByRole("checkbox", { name: "Enable Code Analysis on Build" }),
            ).toBeChecked();
            await expect(severityOf(dialog, "SR0001")).toHaveText("Disabled");
            await expect(severityOf(dialog, "SR0004")).toHaveText("Error");
            await expect(severityOf(dialog, "SR0010")).toHaveText("Warning");
            await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
            await expect(dialog.getByRole("button", { name: "OK" })).toBeDisabled();
            await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));
        },
    );

    test("OK saves a severity change and closes the dialog", testCases(5878944), async () => {
        const { page } = getContext();
        let dialog = await openCodeAnalysisDialog(page);
        await selectOption(dialog, "Severity for SR0010", "Error");
        await clickAndExpectClosed(page, dialog.getByRole("button", { name: "OK" }));
        await expect
            .poll(readSqlproj)
            .toMatch(/<SqlCodeAnalysisRules>[^<]*\+!Microsoft\.Rules\.Data\.SR0010/);

        dialog = await openCodeAnalysisDialog(page);
        await expect(severityOf(dialog, "SR0010")).toHaveText("Error");
        await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));
    });

    test(
        "Apply saves Enable Code Analysis on Build without closing",
        testCases(5878944),
        async () => {
            const { page } = getContext();
            let dialog = await openCodeAnalysisDialog(page);
            const enableOnBuild = dialog.getByRole("checkbox", {
                name: "Enable Code Analysis on Build",
            });
            await enableOnBuild.uncheck();
            const apply = dialog.getByRole("button", { name: "Apply" });
            await apply.click();

            await expect(dialog.getByText("Code analysis rules saved successfully")).toBeVisible();
            await expect(apply).toBeDisabled();
            await expect(dialog.getByRole("button", { name: "OK" })).toBeDisabled();
            await expect
                .poll(readSqlproj)
                .toMatch(/<RunSqlCodeAnalysis>False<\/RunSqlCodeAnalysis>/);
            await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));

            dialog = await openCodeAnalysisDialog(page);
            const reopenedEnableOnBuild = dialog.getByRole("checkbox", {
                name: "Enable Code Analysis on Build",
            });
            await expect(reopenedEnableOnBuild).not.toBeChecked();
            await reopenedEnableOnBuild.check();
            await clickAndExpectClosed(page, dialog.getByRole("button", { name: "OK" }));
            await expect
                .poll(readSqlproj)
                .toMatch(/<RunSqlCodeAnalysis>True<\/RunSqlCodeAnalysis>/);
        },
    );

    test("Cancel with unsaved changes asks to save", testCases(5878944), async () => {
        const { page } = getContext();
        let dialog = await openCodeAnalysisDialog(page);
        const before = readSqlproj();
        await selectOption(dialog, "Severity for SR0016", "Error");
        const unsaved = dialog.getByRole("dialog", { name: "Unsaved Changes" });

        // Cancel in the prompt keeps the dialog and the edit.
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(unsaved).toBeVisible();
        await expect(unsaved.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await expect(unsaved.getByRole("button", { name: "Don't Save" })).toBeVisible();
        await unsaved.getByRole("button", { name: "Cancel" }).click();
        await expect(unsaved).toBeHidden();
        await expect(severityOf(dialog, "SR0016")).toHaveText("Error");

        // Don't Save closes without writing the project.
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await clickAndExpectClosed(page, unsaved.getByRole("button", { name: "Don't Save" }));
        expect(readSqlproj()).toBe(before);

        // Save writes the change and closes.
        dialog = await openCodeAnalysisDialog(page);
        await expect(severityOf(dialog, "SR0016")).toHaveText("Warning");
        await selectOption(dialog, "Severity for SR0016", "Error");
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await clickAndExpectClosed(
            page,
            dialog
                .getByRole("dialog", { name: "Unsaved Changes" })
                .getByRole("button", { name: "Save", exact: true }),
        );
        await expect.poll(readSqlproj).toMatch(/\+!Microsoft\.Rules\.Data\.SR0016/);
    });

    test("search and severity filters narrow the rules", testCases(5878944), async () => {
        const { page } = getContext();
        const dialog = await openCodeAnalysisDialog(page);
        const total = Number(
            (await dialog.getByText(/^\d+ rules$/).innerText()).replace(" rules", ""),
        );
        const search = dialog.getByRole("textbox", { name: "Search rules..." });

        await search.fill("SR0016");
        await expect(dialog.getByText(`1 of ${total} rules`)).toBeVisible();
        await expect(severityOf(dialog, "SR0016")).toBeVisible();
        await expect(severityOf(dialog, "SR0010")).toBeHidden();

        await search.fill("no such rule");
        await expect(dialog.getByText("No rules match the current filter.")).toBeVisible();
        await search.fill("");
        await expect(dialog.getByText(`${total} rules`, { exact: true })).toBeVisible();

        // The saved overrides are SR0001 Disabled and SR0004, SR0010 and SR0016 Error.
        await selectOption(dialog, "Filter by severity", "Error");
        await expect(dialog.getByText(`3 of ${total} rules`)).toBeVisible();
        for (const ruleId of ["SR0004", "SR0010", "SR0016"]) {
            await expect(severityOf(dialog, ruleId)).toHaveText("Error");
        }
        await selectOption(dialog, "Filter by severity", "Disabled");
        await expect(dialog.getByText(`1 of ${total} rules`)).toBeVisible();
        await expect(severityOf(dialog, "SR0001")).toBeVisible();
        await selectOption(dialog, "Filter by severity", "All severities");
        await expect(dialog.getByText(`${total} rules`, { exact: true })).toBeVisible();
        await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));
    });

    test("category checkbox disables and restores its rules", testCases(5878944), async () => {
        const { page } = getContext();
        const dialog = await openCodeAnalysisDialog(page);
        const naming = dialog.getByRole("checkbox", { name: "Enable all rules in Naming" });
        await expect(naming).toBeChecked();

        await naming.uncheck();
        for (const ruleId of ["SR0011", "SR0012", "SR0016"]) {
            await expect(severityOf(dialog, ruleId)).toHaveText("Disabled");
        }
        await naming.check();
        await expect(severityOf(dialog, "SR0011")).toHaveText("Warning");
        await expect(severityOf(dialog, "SR0012")).toHaveText("Warning");
        await expect(severityOf(dialog, "SR0016")).toHaveText("Error");

        // A partly disabled category shows a mixed, non-clickable checkbox.
        await selectOption(dialog, "Severity for SR0012", "Disabled");
        await expect(naming).toBeChecked({ indeterminate: true });
        await expect(naming).toBeDisabled();

        await dialog.getByRole("button", { name: "Cancel" }).click();
        await clickAndExpectClosed(
            page,
            dialog
                .getByRole("dialog", { name: "Unsaved Changes" })
                .getByRole("button", { name: "Don't Save" }),
        );
    });

    test("shows an error and stays usable when saving fails", testCases(5878944), async () => {
        const { page } = getContext();
        const dialog = await openCodeAnalysisDialog(page);
        const apply = dialog.getByRole("button", { name: "Apply" });
        // A read-only project file makes the save fail.
        fs.chmodSync(project.sqlprojPath, 0o444);
        try {
            await selectOption(dialog, "Severity for SR0014", "Error");
            await apply.click();
            await expect(
                dialog.getByText(/Access to the path .*PublishFixture\.sqlproj.* is denied/),
            ).toBeVisible({ timeout: 30 * 1000 });
            await expect(dialog.getByText("Code analysis rules saved successfully")).toBeHidden();
            expect(readSqlproj()).not.toContain("SR0014");
        } finally {
            fs.chmodSync(project.sqlprojPath, 0o644);
        }

        // The dialog stays open, and saving works once the file is writable again.
        await dialog.getByRole("button", { name: "Dismiss" }).click();
        await selectOption(dialog, "Severity for SR0014", "Disabled");
        await apply.click();
        await expect(dialog.getByText("Code analysis rules saved successfully")).toBeVisible();
        await expect.poll(readSqlproj).toMatch(/-Microsoft\.Rules\.Data\.SR0014/);
        await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));
    });

    test(
        "Reset restores the defaults and OK removes the overrides",
        testCases(5878944),
        async () => {
            const { page } = getContext();
            let dialog = await openCodeAnalysisDialog(page);
            await dialog.getByRole("button", { name: "Reset" }).click();
            const confirm = dialog.getByRole("dialog", { name: "Reset to Defaults?" });
            await expect(confirm).toBeVisible();
            await confirm.getByRole("button", { name: "Reset" }).click();
            await expect(confirm).toBeHidden();

            for (const ruleId of ["SR0001", "SR0004", "SR0010", "SR0016"]) {
                await expect(severityOf(dialog, ruleId)).toHaveText("Warning");
            }
            await expect(
                dialog.getByRole("checkbox", { name: "Enable Code Analysis on Build" }),
            ).not.toBeChecked();
            await clickAndExpectClosed(page, dialog.getByRole("button", { name: "OK" }));

            await expect.poll(readSqlproj).not.toMatch(/SR00\d\d/);
            expect(readSqlproj()).not.toMatch(/<RunSqlCodeAnalysis>True/);
            dialog = await openCodeAnalysisDialog(page);
            await expect(severityOf(dialog, "SR0004")).toHaveText("Warning");
            await clickAndExpectClosed(page, dialog.getByRole("button", { name: "Cancel" }));
        },
    );
});
