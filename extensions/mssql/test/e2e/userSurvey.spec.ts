/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from "./baseFixtures";
import { getWebviewByTitle, runCommandFromPalette } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Send Feedback job role", () => {
    const getContext = useSharedVsCodeLifecycle();

    test("offers all roles and clears specifications when leaving Other", async () => {
        const { page } = getContext();
        await runCommandFromPalette(page, "MS SQL: Send Feedback", "MS SQL: Send Feedback");
        const feedback = await getWebviewByTitle(page, "MSSQL Feedback");
        const role = feedback.getByRole("combobox", {
            name: "Which of the following best describes your primary job role?",
        });
        const submit = feedback.getByRole("button", { name: "Submit", exact: true });

        await expect(role).toHaveValue("");
        await expect(role.locator("option")).toHaveText([
            "Select a role (optional)",
            "Application Developer",
            "Database Developer",
            "Database Administrator",
            "Data Engineer",
            "Data Analyst / BI Professional",
            "Data Scientist",
            "Data Architect",
            "IT / DevOps Professional",
            "Other (Please specify)",
        ]);
        await role.selectOption("other");
        const specification = feedback.getByRole("textbox", {
            name: "Please specify your job role (optional)",
        });
        await specification.fill("Technical program manager");
        await expect(submit).toBeDisabled();

        await feedback.getByRole("radio", { name: "8", exact: true }).check();
        await feedback.getByRole("radio", { name: "Satisfied", exact: true }).check();
        await expect(submit).toBeEnabled();

        await role.selectOption("applicationDeveloper");
        await expect(specification).toHaveCount(0);
        await role.selectOption("other");
        await expect(specification).toHaveValue("");
        await expect(submit).toBeEnabled();

        await role.selectOption("");
        await expect(specification).toHaveCount(0);
        await expect(submit).toBeEnabled();
        await feedback.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("submits without answering the optional role question", async () => {
        const { page } = getContext();
        await runCommandFromPalette(page, "MS SQL: Send Feedback", "MS SQL: Send Feedback");
        const feedback = await getWebviewByTitle(page, "MSSQL Feedback");
        await feedback.getByRole("radio", { name: "8", exact: true }).check();
        await feedback.getByRole("radio", { name: "Satisfied", exact: true }).check();
        await feedback.getByRole("button", { name: "Submit", exact: true }).click();
        await expect(
            feedback.getByRole("heading", { name: "Microsoft would like your feedback" }),
        ).toHaveCount(0);
    });
});
