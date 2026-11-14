/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import { Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { testCases } from "./utils/testCases";
import { getSeededLaunchConfig, SEEDED_PROFILE_NAME } from "./utils/seededConnection";
import { dropDatabaseIfExists, uniqueDatabaseName } from "./utils/sqlClient";
import { getModifierKey } from "./utils/testHelpers";
import {
    useFixtureProjectLifecycle,
    createFixtureDatabase,
    expectFindAllReferences,
    getActiveEditor,
    getRefactorPreview,
    clickInActiveEditor,
    openFileWithQuickOpen,
    openPublishDialog,
    readFixtureFile,
    readActiveEditorText,
    revertAndCloseActiveEditor,
    selectPublishServer,
    setPublishDatabase,
    showDatabaseProjectsView,
} from "./utils/sqlProjectPublishHelpers";
import { VsCodeAppHandle } from "./utils/launchVscodeWithMsSqlExt";
import { QuickInput } from "./pageObjects";

/** Files that reference dbo.Customer in the fixture project, including its definition. */
const CUSTOMER_REFERENCES = ["Customer.sql", "CustomerOrders.sql", "GetCustomer.sql", "Orders.sql"];

const launchConfig = getSeededLaunchConfig({
    // Modal confirmations (name collisions) are drawn by the workbench so they can be driven.
    "window.dialogStyle": "custom",
});

/** Opens Customer.sql and puts the cursor on the table name in its CREATE TABLE statement. */
async function placeCursorOnCustomerTable(page: Page): Promise<void> {
    await openFileWithQuickOpen(page, "Customer.sql");
    await expect(getActiveEditor(page)).toContainText("CREATE TABLE [dbo].[Customer]");
    await clickInActiveEditor(page, "Customer");
}

/** Starts Rename Symbol (F2) and types a new name, returning the inline rename box. */
async function startRename(page: Page, newName: string) {
    const renameBox = page.getByRole("textbox", { name: /^Rename input/ });
    // The language service may still be loading the project model the first time round.
    await expect(async () => {
        await page.keyboard.press("F2");
        await expect(renameBox).toBeVisible({ timeout: 5 * 1000 });
    }).toPass({ timeout: 60 * 1000 });
    return { renameBox, type: async () => renameBox.fill(newName) };
}

/** Generates a publish script for the project against an existing database. */
async function generateScriptAgainst(
    app: VsCodeAppHandle,
    page: Page,
    databaseName: string,
): Promise<string> {
    const dialog = await openPublishDialog(page);
    await selectPublishServer(dialog, SEEDED_PROFILE_NAME);
    await setPublishDatabase(dialog, databaseName);
    await dialog.getByRole("button", { name: "Generate Script" }).click();
    await expect(
        page.getByRole("dialog", { name: /Generate script: Succeeded/ }).first(),
    ).toBeVisible({ timeout: 3 * 60 * 1000 });
    const script = await readActiveEditorText(app, page, getActiveEditor(page));
    await revertAndCloseActiveEditor(page);
    return script;
}

/**
 * SQL Database Projects: Rename Symbol (F2) on objects in a project's .sql files — references,
 * the refactor preview, applying and discarding, name-collision and unsupported-target
 * validation, and that publishing the renamed project emits sp_rename instead of drop/create.
 */
// Failed or flaky in the Linux CI build-and-test smoke run: dialogs and quick picks did not
// appear within 30s. These tests run serially and build on each other, so the whole group is
// marked rather than individual tests.
// TODO: Stabilize these tests and re-enable them.
test.describe.fixme("SQL Database Projects rename refactoring", () => {
    test.describe.configure({ mode: "serial" });
    const databaseName = uniqueDatabaseName("SqlProjRename");
    const { project, getContext } = useFixtureProjectLifecycle({
        initialConfig: launchConfig,
        afterLaunch: async ({ page }) => {
            await createFixtureDatabase(databaseName);
            await showDatabaseProjectsView(page);
        },
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test("finds all references to a table", testCases(5878947), async () => {
        const { page } = getContext();
        await placeCursorOnCustomerTable(page);
        await expectFindAllReferences(page, CUSTOMER_REFERENCES);
    });

    // Failed in the Linux CI build-and-test smoke run: the rename preview's quick input rows never appeared.
    // TODO: Stabilize this test and re-enable it.
    test.fixme("previews a rename and discards it", testCases(5878947), async () => {
        const { page } = getContext();
        await placeCursorOnCustomerTable(page);
        const rename = await startRename(page, "Client");
        await expect(rename.renameBox).toHaveValue("Customer");
        // The current name is selected, so typing replaces it.
        await expect
            .poll(() =>
                rename.renameBox.evaluate((input: HTMLInputElement) =>
                    input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
                ),
            )
            .toBe("Customer");
        await rename.type();
        await expect(rename.renameBox).toHaveValue("Client");
        await rename.renameBox.press(`${getModifierKey()}+Enter`);

        const preview = getRefactorPreview(page);
        await expect(preview).toBeVisible({ timeout: 60 * 1000 });
        for (const file of [
            "dbo/StoredProcedures/GetCustomer.sql",
            "dbo/Tables/Customer.sql",
            "dbo/Tables/Orders.sql",
            "dbo/Views/CustomerOrders.sql",
        ]) {
            await expect(
                preview.getByRole("checkbox", { name: `${file}, making text edits` }),
            ).toBeVisible();
        }
        await expect(
            preview.getByRole("checkbox", { name: "Creating PublishFixture.refactorlog" }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeVisible();

        // Selecting a change opens a diff of the proposed edits, scrolled to that file.
        await preview
            .getByRole("checkbox", { name: "line 6, replacing [Customer] with [Client]" })
            .getByText(/REFERENCES/)
            .click();
        await expect(
            page.getByRole("tab", { name: /^Refactor Preview \(6 files\)/ }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
            page.getByRole("button", { name: /[\\/]dbo[\\/]Tables[\\/]Orders\.sql$/ }),
        ).toBeVisible();

        await page.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(preview).toBeHidden();
        expect(project.read("dbo/Tables/Orders.sql")).toContain("REFERENCES [dbo].[Customer]");
        expect(project.read("dbo/Tables/Customer.sql")).toContain("CREATE TABLE [dbo].[Customer]");
    });

    test("applies a rename to the table and every reference", testCases(5878947), async () => {
        const { page } = getContext();
        await placeCursorOnCustomerTable(page);
        const rename = await startRename(page, "Client");
        await rename.type();
        await rename.renameBox.press(`${getModifierKey()}+Enter`);
        await expect(getRefactorPreview(page)).toBeVisible({ timeout: 60 * 1000 });
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(getRefactorPreview(page)).toBeHidden();

        await expect
            .poll(() => project.read("dbo/Tables/Orders.sql"))
            .toContain("REFERENCES [dbo].[Client] ([CustomerId])");
        expect(project.read("dbo/Tables/Customer.sql")).toContain("CREATE TABLE [dbo].[Client]");
        expect(project.read("dbo/Views/CustomerOrders.sql")).toContain("FROM [dbo].[Client] AS c");
        expect(project.read("dbo/StoredProcedures/GetCustomer.sql")).toContain(
            "FROM [dbo].[Client] WHERE",
        );
        // Columns that merely contain the old name, and unrelated objects, are left alone.
        expect(project.read("dbo/Tables/Orders.sql")).toContain("[CustomerId] INT NOT NULL");
        for (const unrelated of ["dbo/Tables/Product.sql", "Sales/Tables/Product.sql"]) {
            expect(project.read(unrelated)).toBe(readFixtureFile(unrelated));
        }

        const refactorLog = project.read("PublishFixture.refactorlog");
        expect(refactorLog).toContain('Operation Name="Rename Refactor"');
        expect(refactorLog).toContain('<Property Name="ElementName" Value="[dbo].[Customer]" />');
        expect(refactorLog).toContain('<Property Name="ElementType" Value="SqlTable" />');
        expect(refactorLog).toContain('<Property Name="NewName" Value="Client" />');
        expect(fs.readFileSync(project.sqlprojPath, "utf8")).toContain(
            '<RefactorLog Include="PublishFixture.refactorlog" />',
        );

        // References resolve against the updated model under the new name.
        await expect(getActiveEditor(page)).toContainText("CREATE TABLE [dbo].[Client]");
        await clickInActiveEditor(page, "Client");
        await expectFindAllReferences(page, CUSTOMER_REFERENCES);
    });

    test("asks before renaming to an existing object name", testCases(5878947), async () => {
        const { page } = getContext();
        await openFileWithQuickOpen(page, "Customer.sql");
        await clickInActiveEditor(page, "Client");
        let rename = await startRename(page, "Orders");
        await rename.type();
        await rename.renameBox.press(`${getModifierKey()}+Enter`);

        const warning = page.getByRole("dialog").filter({
            hasText:
                /A schema object with the name \[Orders\] already exists\. Would you like to continue\?/,
        });
        await expect(warning).toBeVisible({ timeout: 60 * 1000 });
        await expect(warning.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
        await warning.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(warning).toBeHidden();
        await expect(getRefactorPreview(page)).toBeHidden();
        expect(project.read("dbo/Tables/Customer.sql")).toContain("CREATE TABLE [dbo].[Client]");

        // Yes continues with the rename; discard its preview to keep the project consistent.
        await clickInActiveEditor(page, "Client");
        rename = await startRename(page, "Orders");
        await rename.type();
        await rename.renameBox.press(`${getModifierKey()}+Enter`);
        await warning.getByRole("button", { name: "Yes", exact: true }).click();
        await expect(warning).toBeHidden();
        await expect(getRefactorPreview(page)).toBeVisible({ timeout: 60 * 1000 });
        await page.getByRole("button", { name: "Discard", exact: true }).click();
        expect(project.read("dbo/Tables/Customer.sql")).toContain("CREATE TABLE [dbo].[Client]");
    });

    test("rejects renaming a schema or a keyword", testCases(5878947), async () => {
        const { page } = getContext();
        await openFileWithQuickOpen(page, "Customer.sql");
        for (const target of ["dbo", "TABLE"]) {
            await clickInActiveEditor(page, target);
            const rename = await startRename(page, "Renamed");
            await rename.type();
            await rename.renameBox.press("Enter");
            // The rejection is shown as an inline message over the editor.
            const message = page.getByText("Renaming an object of this type is not supported.", {
                exact: true,
            });
            await expect(message).toBeVisible({ timeout: 60 * 1000 });
            await page.keyboard.press("Escape");
            await expect(message).toBeHidden();
        }
        expect(project.read("dbo/Tables/Customer.sql")).toContain("CREATE TABLE [dbo].[Client]");
    });

    test(
        "publishing the renamed project renames instead of recreating the table",
        testCases(5878947),
        async () => {
            const { electronApp, page } = getContext();
            const script = await generateScriptAgainst(electronApp, page, databaseName);
            expect(script).toMatch(
                /sp_rename\s+@objname\s*=\s*N'\[dbo\]\.\[Customer\]',\s*@newname\s*=\s*N'Client'/,
            );
            expect(script).not.toContain("DROP TABLE [dbo].[Customer]");
            expect(script).not.toContain("CREATE TABLE [dbo].[Client]");
        },
    );
});

/** Runs Move to Schema from the Refactor... menu at the cursor and returns the schema picker. */
async function startMoveToSchema(page: Page): Promise<QuickInput> {
    const quickInput = new QuickInput(page);
    await quickInput.runCommand("Refactor...", "Refactor...");
    const actions = page.getByRole("listbox", { name: "Action Widget" });
    await actions.getByRole("option", { name: /^Move to Schema\.\.\./ }).click();
    await expect(quickInput.input).toBeVisible({ timeout: 60 * 1000 });
    return quickInput;
}

/**
 * SQL Database Projects: Move to Schema (Refactor...) on objects in a project's .sql files — the
 * schema picker, preview, applying and discarding, the refactor log, collision and
 * unsupported-target validation, and that publishing the moved object transfers it instead of
 * dropping and recreating it.
 */
// Failed or flaky in the Linux CI build-and-test smoke run: dialogs and quick picks did not
// appear within 30s. These tests run serially and build on each other, so the whole group is
// marked rather than individual tests.
// TODO: Stabilize these tests and re-enable them.
test.describe.fixme("SQL Database Projects move to schema refactoring", () => {
    test.describe.configure({ mode: "serial" });
    const databaseName = uniqueDatabaseName("SqlProjMoveSchema");
    const { project, getContext } = useFixtureProjectLifecycle({
        initialConfig: launchConfig,
        afterLaunch: async ({ page }) => {
            await createFixtureDatabase(databaseName);
            await showDatabaseProjectsView(page);
        },
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test("finds all references to a table", testCases(5878948), async () => {
        const { page } = getContext();
        await placeCursorOnCustomerTable(page);
        await expectFindAllReferences(page, CUSTOMER_REFERENCES);
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "offers the project's schemas and previews the move",
        testCases(5878948),
        async () => {
            const { page } = getContext();
            await placeCursorOnCustomerTable(page);
            const schemaPicker = await startMoveToSchema(page);
            await expect(schemaPicker.input).toHaveAttribute(
                "placeholder",
                "Current Schema: dbo, Select the new schema:",
            );
            await expect
                .poll(async () => (await schemaPicker.labels()).sort())
                .toEqual(["Archive", "Sales", "dbo"]);
            await schemaPicker.pick("Archive");

            const preview = getRefactorPreview(page);
            await expect(preview).toBeVisible({ timeout: 60 * 1000 });
            for (const file of [
                "dbo/StoredProcedures/GetCustomer.sql",
                "dbo/Tables/Customer.sql",
                "dbo/Tables/Orders.sql",
                "dbo/Views/CustomerOrders.sql",
            ]) {
                await expect(
                    preview.getByRole("checkbox", { name: `${file}, making text edits` }),
                ).toBeVisible();
            }
            await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeVisible();

            await preview
                .getByRole("checkbox", { name: /^line 6, replacing/ })
                .getByText(/REFERENCES/)
                .click();
            await expect(
                page.getByRole("tab", { name: /^Refactor Preview \(\d+ files\)/ }),
            ).toHaveAttribute("aria-selected", "true");
            await expect(
                page.getByRole("button", { name: /[\\/]dbo[\\/]Tables[\\/]Orders\.sql$/ }),
            ).toBeVisible();

            await page.getByRole("button", { name: "Discard", exact: true }).click();
            await expect(preview).toBeHidden();
            expect(project.read("dbo/Tables/Orders.sql")).toBe(
                readFixtureFile("dbo/Tables/Orders.sql"),
            );
            expect(fs.existsSync(project.file("PublishFixture.refactorlog"))).toBe(false);
        },
    );

    test("moves the table and its references to another schema", testCases(5878948), async () => {
        const { page } = getContext();
        await placeCursorOnCustomerTable(page);
        const schemaPicker = await startMoveToSchema(page);
        await schemaPicker.pick("Archive");
        await expect(getRefactorPreview(page)).toBeVisible({ timeout: 60 * 1000 });
        await page.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(getRefactorPreview(page)).toBeHidden();

        await expect
            .poll(() => project.read("dbo/Tables/Orders.sql"))
            .toContain("REFERENCES [Archive].[Customer] ([CustomerId])");
        expect(project.read("dbo/Views/CustomerOrders.sql")).toContain(
            "FROM [Archive].[Customer] AS c",
        );
        expect(project.read("dbo/StoredProcedures/GetCustomer.sql")).toContain(
            "FROM [Archive].[Customer] WHERE",
        );
        // The definition moves into the new schema's folder.
        await expect
            .poll(() => fs.existsSync(project.file("Archive/Tables/Customer.sql")))
            .toBe(true);
        expect(fs.existsSync(project.file("dbo/Tables/Customer.sql"))).toBe(false);
        expect(project.read("Archive/Tables/Customer.sql")).toContain(
            "CREATE TABLE [Archive].[Customer]",
        );
        for (const unrelated of ["dbo/Tables/Product.sql", "Sales/Tables/Product.sql"]) {
            expect(project.read(unrelated)).toBe(readFixtureFile(unrelated));
        }

        const refactorLog = project.read("PublishFixture.refactorlog");
        expect(refactorLog).toContain('Operation Name="Move Schema"');
        expect(refactorLog).toContain('<Property Name="ElementName" Value="[dbo].[Customer]" />');
        expect(refactorLog).toContain('<Property Name="ElementType" Value="SqlTable" />');
        expect(refactorLog).toContain('<Property Name="NewSchema" Value="Archive" />');
        expect(refactorLog).toContain('<Property Name="IsNewSchemaExternal" Value="False" />');

        await openFileWithQuickOpen(page, "Customer.sql");
        await expect(getActiveEditor(page)).toContainText("CREATE TABLE [Archive].[Customer]");
        await clickInActiveEditor(page, "Customer");
        await expectFindAllReferences(page, CUSTOMER_REFERENCES);
    });

    test("asks before moving onto an existing object", testCases(5878948), async () => {
        const { page } = getContext();
        await openFileWithQuickOpen(page, "Product.sql", "dbo/Tables/Product.sql");
        await expect(getActiveEditor(page)).toContainText("CREATE TABLE [dbo].[Product]");
        await clickInActiveEditor(page, "Product");
        const warning = page.getByRole("dialog").filter({
            hasText:
                /A schema object with the name \[Sales\]\.\[Product\] already exists\. Would you like to continue\?/,
        });

        await (await startMoveToSchema(page)).pick("Sales");
        await expect(warning).toBeVisible({ timeout: 60 * 1000 });
        await warning.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(warning).toBeHidden();
        await expect(getRefactorPreview(page)).toBeHidden();

        // Yes continues to the preview; discard it to keep the project consistent.
        await clickInActiveEditor(page, "Product");
        await (await startMoveToSchema(page)).pick("Sales");
        await warning.getByRole("button", { name: "Yes", exact: true }).click();
        await expect(getRefactorPreview(page)).toBeVisible({ timeout: 60 * 1000 });
        await page.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(getRefactorPreview(page)).toBeHidden();
        expect(project.read("dbo/Tables/Product.sql")).toBe(
            readFixtureFile("dbo/Tables/Product.sql"),
        );
    });

    test(
        "reports nothing to move for the same schema or a keyword",
        testCases(5878948),
        async () => {
            const { page } = getContext();
            await openFileWithQuickOpen(page, "Orders.sql");
            const notice = page.getByRole("dialog", {
                name: /No object that can be moved to another schema was found at the cursor\./,
            });
            for (const [target, schema] of [
                ["Orders", "dbo"],
                ["TABLE", "Sales"],
            ]) {
                await new QuickInput(page).runCommand(
                    "Notifications: Clear All Notifications",
                    "Notifications: Clear All Notifications",
                );
                await expect(notice).toHaveCount(0);
                await clickInActiveEditor(page, target);
                await (await startMoveToSchema(page)).pick(schema);
                await expect(notice.first()).toBeVisible({ timeout: 60 * 1000 });
                await expect(getRefactorPreview(page)).toBeHidden();
            }
            expect(project.read("dbo/Tables/Orders.sql")).toContain("CREATE TABLE [dbo].[Orders]");
        },
    );

    test(
        "publishing the moved table transfers it instead of recreating it",
        testCases(5878948),
        async () => {
            const { electronApp, page } = getContext();
            const script = await generateScriptAgainst(electronApp, page, databaseName);
            expect(script).toContain("ALTER SCHEMA [Archive] TRANSFER [dbo].[Customer];");
            expect(script).toContain("INSERT INTO [dbo].[__RefactorLog]");
            expect(script).not.toContain("DROP TABLE [dbo].[Customer]");
            expect(script).not.toContain("CREATE TABLE [Archive].[Customer]");
        },
    );
});
