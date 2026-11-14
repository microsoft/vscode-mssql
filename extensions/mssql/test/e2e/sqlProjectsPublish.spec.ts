/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from "crypto";
import * as fs from "fs";
import { test, expect } from "./baseFixtures";
import { testCases } from "./utils/testCases";
import { SEEDED_PROFILE_NAME } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    querySingleValue,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { getPassword, getServerName } from "./utils/envConfigReader";
import {
    answerSimpleFileDialog,
    useFixtureProjectLifecycle,
    FIXTURE_PROJECT_NAME,
    getActiveEditor,
    openAdvancedOptions,
    openPublishDialog,
    readActiveEditorText,
    revertAndCloseActiveEditor,
    selectPublishServer,
    setPublishDatabase,
    setAdvancedOption,
    setSqlCmdVariable,
    closeAllEditors,
    findContainersPublishingPort,
    listContainerNames,
    isContainerRunning,
    isDockerAvailable,
    canReadDockerDesktopSettings,
    queryContainer,
    removeContainers,
} from "./utils/sqlProjectPublishHelpers";

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a SQLCMD variable entry in a publish profile. */
function sqlCmdVariableXml(name: string, value: string): RegExp {
    return new RegExp(
        `<SqlCmdVariable Include="${name}">\\s*<Value>${escapeRegExp(value)}</Value>\\s*</SqlCmdVariable>`,
    );
}

/**
 * SQL Database Projects: the Publish dialog against an existing server — publish targets,
 * SQLCMD variables, advanced options, sqlpackage command and script generation, publishing, and
 * saving/loading publish profiles. Uses a temp copy of the SDK-style PublishFixture project.
 */
test.describe("SQL Database Projects publish dialog", () => {
    const createdDatabases: string[] = [];
    const { project, getContext } = useFixtureProjectLifecycle();

    test.afterEach(async () => {
        await closeAllEditors(getContext().page);
    });

    test.afterAll(async () => {
        for (const database of createdDatabases) {
            await dropDatabaseIfExists(database);
        }
    });

    test(
        "offers existing server and Docker container publish targets",
        testCases(5878851),
        async () => {
            const { page } = getContext();
            const dialog = await openPublishDialog(page);
            const target = dialog.getByRole("combobox", { name: "Publish Target" });
            await expect(target).toHaveText("Existing SQL Server");

            await target.click();
            const targets = dialog
                .getByRole("listbox", { name: "Publish Target" })
                .getByRole("option");
            await expect(targets).toHaveText([
                "Existing SQL Server",
                "New Local Docker SQL Server",
            ]);
            await targets.filter({ hasText: "New Local Docker SQL Server" }).click();

            // The container target asks for the container settings instead of a server connection.
            for (const label of [
                "SQL Server port number",
                "SQL Server admin password",
                "Confirm SQL Server admin password",
            ]) {
                await expect(
                    dialog.getByRole("textbox", { name: label, exact: true }),
                ).toBeVisible();
            }
            await expect(dialog.getByRole("combobox", { name: "Image tag" })).toBeVisible();
            await expect(
                dialog.getByRole("checkbox", {
                    name: "Accept Microsoft SQL Server License Agreement",
                }),
            ).toBeVisible();
            await expect(dialog.getByRole("button", { name: "Server" })).toBeHidden();
            await expect(dialog.getByRole("button", { name: "Generate Script" })).toBeDisabled();

            await target.click();
            await targets.filter({ hasText: "Existing SQL Server" }).click();
            await expect(dialog.getByRole("button", { name: "Server" })).toBeVisible();
            await expect(
                dialog.getByRole("textbox", { name: "SQL Server port number" }),
            ).toBeHidden();
        },
    );

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme("generates the sqlpackage publish command", testCases(5878851), async () => {
        const { page } = getContext();
        const databaseName = uniqueDatabaseName("SqlProjCmd");
        const dialog = await openPublishDialog(page);
        await selectPublishServer(dialog, SEEDED_PROFILE_NAME);
        await setPublishDatabase(dialog, databaseName);
        await setSqlCmdVariable(dialog, "EnvName", "Staging");

        await dialog.getByRole("button", { name: "Generate sqlpackage command" }).click();
        const commandDialog = dialog.getByRole("dialog", { name: "SqlPackage Command" });
        const command = commandDialog.getByRole("textbox", { name: "SqlPackage Command" });
        await expect(command).toHaveValue(/^SqlPackage \/Action:Publish /, { timeout: 60 * 1000 });
        const masked = await command.inputValue();
        expect(masked).toContain(`${FIXTURE_PROJECT_NAME}.dacpac"`);
        expect(masked).toContain(`Data Source=${getServerName()};`);
        expect(masked).toContain(`Initial Catalog=${databaseName};`);
        expect(masked).toContain("/v:EnvName=[MASKED]");
        expect(masked).toContain("/v:OwnerName=[MASKED]");

        await commandDialog.getByRole("button", { name: /^Show unmasked command/ }).click();
        await expect(command).toHaveValue(/\/v:EnvName=Staging/);
        await expect(command).toHaveValue(/\/v:OwnerName=ContosoOwner/);
        await commandDialog.getByRole("button", { name: "Close" }).click();
        await expect(commandDialog).toBeHidden();
    });

    test("advanced options can be changed and reset to defaults", testCases(5878851), async () => {
        const { page } = getContext();
        const dialog = await openPublishDialog(page);
        let drawer = await openAdvancedOptions(dialog);
        const transactional = drawer.getByRole("checkbox", {
            name: "Include transactional scripts",
        });
        const blockOnDataLoss = drawer.getByRole("checkbox", {
            name: "Block on possible data loss",
        });
        await expect(transactional).not.toBeChecked();
        await expect(blockOnDataLoss).toBeChecked();
        await expect(drawer.getByRole("button", { name: "Reset" })).toBeDisabled();
        await transactional.check();
        await blockOnDataLoss.uncheck();
        await drawer.getByRole("button", { name: "OK" }).click();
        await expect(drawer).toBeHidden();

        // The changes are kept when the drawer is reopened, and Reset restores the defaults.
        drawer = await openAdvancedOptions(dialog);
        await expect(transactional).toBeChecked();
        await expect(blockOnDataLoss).not.toBeChecked();
        await drawer.getByRole("button", { name: "Reset" }).click();
        await expect(transactional).not.toBeChecked();
        await expect(blockOnDataLoss).toBeChecked();
        await drawer.getByRole("button", { name: "OK" }).click();
        await expect(drawer).toBeHidden();
    });

    test(
        "SQLCMD values and advanced options flow into the generated script",
        testCases(5878851),
        async () => {
            const { electronApp, page } = getContext();
            const databaseName = uniqueDatabaseName("SqlProjScript");
            const dialog = await openPublishDialog(page);
            await selectPublishServer(dialog, SEEDED_PROFILE_NAME);
            await setPublishDatabase(dialog, databaseName);

            // Revert restores the project defaults after an edit.
            const revert = dialog.getByRole("button", {
                name: "Revert values to project defaults",
            });
            await expect(revert).toBeDisabled();
            await setSqlCmdVariable(dialog, "OwnerName", "Someone");
            await expect(revert).toBeEnabled();
            await revert.click();
            await expect(dialog.getByRole("textbox", { name: "Value for OwnerName" })).toHaveValue(
                "ContosoOwner",
            );
            await setSqlCmdVariable(dialog, "EnvName", "QA");

            await setAdvancedOption(dialog, "Include transactional scripts", true);

            await dialog.getByRole("button", { name: "Generate Script" }).click();
            await expect(
                page.getByRole("dialog", { name: /Generate script: Succeeded/ }).first(),
            ).toBeVisible({ timeout: 3 * 60 * 1000 });
            const script = await readActiveEditorText(electronApp, page, getActiveEditor(page));
            await revertAndCloseActiveEditor(page);

            expect(script).toContain(`:setvar DatabaseName "${databaseName}"`);
            expect(script).toContain(':setvar EnvName "QA"');
            expect(script).toContain(':setvar OwnerName "ContosoOwner"');
            expect(script).toContain("CREATE TABLE [dbo].[Customer]");
            expect(script).toContain("CREATE VIEW [dbo].[CustomerOrders]");
            expect(script).toContain("N'$(EnvName)'");
            expect(script).toContain("BEGIN TRANSACTION");
            // Generating a script must not deploy anything.
            expect(await querySingleValue<number>(`SELECT DB_ID(N'${databaseName}')`)).toBeNull();
        },
    );

    test("publishes the project to an existing server", testCases(5878851), async () => {
        const { page } = getContext();
        const databaseName = uniqueDatabaseName("SqlProjPublish");
        createdDatabases.push(databaseName);
        const dialog = await openPublishDialog(page);
        await selectPublishServer(dialog, SEEDED_PROFILE_NAME);
        await setPublishDatabase(dialog, databaseName);
        await setSqlCmdVariable(dialog, "EnvName", "Prod");
        await dialog.getByRole("button", { name: "Publish", exact: true }).click();

        await expect
            .poll(
                // Connecting fails until the database exists; the post-deployment row comes last.
                () =>
                    querySingleValue<number>(
                        "SELECT COUNT(*) FROM dbo.DeploymentInfo",
                        databaseName,
                    ).catch(() => 0),
                { timeout: 3 * 60 * 1000, intervals: [2000] },
            )
            .toBe(1);
        const [tables] = await runSql(
            "SELECT SCHEMA_NAME(schema_id) + '.' + name AS name FROM sys.tables ORDER BY 1",
            databaseName,
        );
        expect(tables.map((row) => row.name)).toEqual([
            "dbo.Customer",
            "dbo.DeploymentInfo",
            "dbo.Orders",
            "dbo.Product",
            "Sales.Product",
        ]);
        const [deployment] = await runSql(
            "SELECT EnvName, OwnerName FROM dbo.DeploymentInfo",
            databaseName,
        );
        expect(deployment).toEqual([{ EnvName: "Prod", OwnerName: "ContosoOwner" }]);
    });

    // Failed in the Linux CI build-and-test smoke run: the Publish Project webview did not appear within 30s.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "saves a publish profile and loads it back after editing it",
        testCases(5878858, 5878851),
        async () => {
            const { page } = getContext();
            const savedDatabase = uniqueDatabaseName("SqlProjProfile");
            const editedDatabase = uniqueDatabaseName("SqlProjProfileEdited");
            let dialog = await openPublishDialog(page);
            await selectPublishServer(dialog, SEEDED_PROFILE_NAME);
            await setPublishDatabase(dialog, savedDatabase);
            await setSqlCmdVariable(dialog, "EnvName", "Saved");
            await setAdvancedOption(dialog, "Include transactional scripts", true);

            const profileBase = project.file("E2EProfile");
            await dialog.getByRole("button", { name: "Save As..." }).click();
            await answerSimpleFileDialog(page, profileBase);
            // The save dialog's filter appends the publish profile extension.
            const profilePath = `${profileBase}.publish.xml`;
            await expect(dialog.getByText(`Publish profile saved to: ${profilePath}`)).toBeVisible({
                timeout: 60 * 1000,
            });

            const saved = fs.readFileSync(profilePath, "utf8");
            expect(saved).toContain(`<TargetDatabaseName>${savedDatabase}</TargetDatabaseName>`);
            expect(saved).toMatch(
                new RegExp(`<TargetConnectionString>Data Source=${escapeRegExp(getServerName())};`),
            );
            expect(saved).toContain(
                "<IncludeTransactionalScripts>True</IncludeTransactionalScripts>",
            );
            expect(saved).toMatch(sqlCmdVariableXml("EnvName", "Saved"));
            expect(saved).toMatch(sqlCmdVariableXml("OwnerName", "ContosoOwner"));
            // The password is never written to the profile.
            expect(saved).not.toContain(getPassword());

            // Edit the profile by hand: new database, changed and additional SQLCMD variables.
            const edited = saved
                .replace(savedDatabase, editedDatabase)
                // Saved profiles carry a masked "Password=******" placeholder that cannot be used to
                // connect; drop it so loading the profile asks for the password instead.
                .replace("Password=******;", "")
                .replace("<Value>Saved</Value>", "<Value>Edited</Value>")
                .replace(
                    "</ItemGroup>",
                    '  <SqlCmdVariable Include="ExtraVar">\n      <Value>ExtraValue</Value>\n    </SqlCmdVariable>\n  </ItemGroup>',
                );
            fs.writeFileSync(profilePath, edited);

            await closeAllEditors(page);
            dialog = await openPublishDialog(page);
            await dialog.getByRole("button", { name: "Select Profile" }).click();
            await answerSimpleFileDialog(page, profilePath);

            // The profile stores no password, so connecting to its server prompts for one.
            const passwordBox = page.getByRole("textbox", { name: "Password (SQL Login)" });
            await expect(passwordBox).toBeVisible({ timeout: 30 * 1000 });
            await passwordBox.fill(getPassword());
            await passwordBox.press("Enter");
            await expect(dialog.getByRole("textbox", { name: "Publish Profile" })).toHaveValue(
                profilePath,
            );
            await expect(dialog.getByRole("combobox", { name: "Database" })).toHaveValue(
                editedDatabase,
            );
            await expect(dialog.getByRole("button", { name: "Server" })).toHaveText(
                SEEDED_PROFILE_NAME,
                { timeout: 60 * 1000 },
            );
            await expect(dialog.getByRole("textbox", { name: "Value for EnvName" })).toHaveValue(
                "Edited",
            );
            await expect(dialog.getByRole("textbox", { name: "Value for OwnerName" })).toHaveValue(
                "ContosoOwner",
            );
            await expect(dialog.getByRole("textbox", { name: "Value for ExtraVar" })).toHaveValue(
                "ExtraValue",
            );
            const drawer = await openAdvancedOptions(dialog);
            await expect(
                drawer.getByRole("checkbox", { name: "Include transactional scripts" }),
            ).toBeChecked();
            await drawer.getByRole("button", { name: "OK" }).click();
        },
    );

    test("saves a partially completed publish profile", testCases(5878858), async () => {
        const { page } = getContext();
        const databaseName = uniqueDatabaseName("SqlProjPartial");
        const dialog = await openPublishDialog(page);
        // A container target has no server connection yet, so only the database name and
        // SQLCMD values are known.
        await dialog.getByRole("combobox", { name: "Publish Target" }).click();
        await dialog.getByRole("option", { name: "New Local Docker SQL Server" }).click();
        await setPublishDatabase(dialog, databaseName);
        await setSqlCmdVariable(dialog, "OwnerName", "PartialOwner");

        const profileBase = project.file("E2EPartial");
        await dialog.getByRole("button", { name: "Save As..." }).click();
        await answerSimpleFileDialog(page, profileBase);
        const profilePath = `${profileBase}.publish.xml`;
        await expect(dialog.getByText(`Publish profile saved to: ${profilePath}`)).toBeVisible({
            timeout: 60 * 1000,
        });

        const saved = fs.readFileSync(profilePath, "utf8");
        expect(saved).toContain(`<TargetDatabaseName>${databaseName}</TargetDatabaseName>`);
        expect(saved).not.toMatch(/<TargetConnectionString>[^<]/);
        expect(saved).toMatch(sqlCmdVariableXml("EnvName", "Dev"));
        expect(saved).toMatch(sqlCmdVariableXml("OwnerName", "PartialOwner"));
    });
});

/**
 * SQL Database Projects: publishing to new local Docker SQL Server containers from the Publish
 * dialog. Every container this suite creates is identified by its unique host port and removed
 * afterwards; pre-existing containers are never touched.
 */
test.describe("SQL Database Projects publish to container", () => {
    test.skip(!isDockerAvailable(), "Docker is required to publish to a local container.");
    test.skip(
        !canReadDockerDesktopSettings(),
        "macOS privacy consent blocks the extension's Docker Desktop Rosetta check.",
    );

    // The fixed prefix and suffix cover SQL Server's upper, lower, digit and symbol classes.
    const password = `E2e#${randomBytes(6).toString("hex")}Aa1`;
    const createdContainers: string[] = [];
    const { getContext } = useFixtureProjectLifecycle();

    test.afterAll(async () => {
        removeContainers(createdContainers);
    });

    /** Publishes the fixture to a new container on a free port and returns that port. */
    async function publishToNewContainer(databaseName: string): Promise<number> {
        const { page } = getContext();
        const dialog = await openPublishDialog(page);
        await dialog.getByRole("combobox", { name: "Publish Target" }).click();
        await dialog.getByRole("option", { name: "New Local Docker SQL Server" }).click();
        await dialog
            .getByRole("textbox", { name: "SQL Server admin password", exact: true })
            .fill(password);
        await dialog
            .getByRole("textbox", { name: "Confirm SQL Server admin password", exact: true })
            .fill(password);
        await expect(dialog.getByRole("combobox", { name: "Image tag" })).not.toHaveText("", {
            timeout: 60 * 1000,
        });
        // The checkbox is controlled by extension state, so its checked state lags the click.
        const license = dialog.getByRole("checkbox", {
            name: "Accept Microsoft SQL Server License Agreement",
        });
        await license.click();
        await expect(license).toBeChecked();
        await setPublishDatabase(dialog, databaseName);

        // Keep the free port the dialog probed for: a typed port is overwritten when the
        // dialog's background port validation completes.
        const portBox = dialog.getByRole("textbox", { name: "SQL Server port number" });
        await expect(portBox).toHaveValue(/^\d+$/);
        const port = Number(await portBox.inputValue());
        const existingContainers = new Set(listContainerNames());
        const publish = dialog.getByRole("button", { name: "Publish", exact: true });
        await expect(publish).toBeEnabled({ timeout: 30 * 1000 });
        await publish.click();

        let containerName: string | undefined;
        await expect
            .poll(
                () =>
                    (containerName = findContainersPublishingPort(port).find(
                        (name) => !existingContainers.has(name),
                    )),
                { timeout: 5 * 60 * 1000, intervals: [2000] },
            )
            .toBeTruthy();
        createdContainers.push(containerName!);

        await expect
            .poll(
                async () =>
                    (
                        await queryContainer(
                            port,
                            password,
                            "SELECT EnvName FROM dbo.DeploymentInfo",
                            databaseName,
                        ).catch(() => [])
                    ).map((row) => row.EnvName),
                { timeout: 5 * 60 * 1000, intervals: [5000] },
            )
            .toEqual(["Dev"]);
        return port;
    }

    // Failed in the Linux CI build-and-test smoke run: no 'Dev' container appeared within the 300s wait.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "publishes the project to a new local container",
        testCases(5878854, 5878851),
        async () => {
            test.setTimeout(10 * 60 * 1000);
            const databaseName = uniqueDatabaseName("SqlProjContainer");
            const port = await publishToNewContainer(databaseName);

            const tables = await queryContainer(
                port,
                password,
                "SELECT SCHEMA_NAME(schema_id) + '.' + name AS name FROM sys.tables ORDER BY 1",
                databaseName,
            );
            expect(tables.map((row) => row.name)).toEqual([
                "dbo.Customer",
                "dbo.DeploymentInfo",
                "dbo.Orders",
                "dbo.Product",
                "Sales.Product",
            ]);
        },
    );

    // Failed in the Linux CI build-and-test smoke run: no 'Dev' container appeared within the 300s wait.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "publishes to another container while keeping the existing one",
        testCases(5878854),
        async () => {
            test.setTimeout(10 * 60 * 1000);
            if (createdContainers.length === 0) {
                await publishToNewContainer(uniqueDatabaseName("SqlProjContainer"));
            }
            const firstContainer = createdContainers[0];

            const secondPort = await publishToNewContainer(uniqueDatabaseName("SqlProjContainer2"));
            const secondContainer = createdContainers[createdContainers.length - 1];
            expect(secondContainer).not.toBe(firstContainer);
            expect(findContainersPublishingPort(secondPort)).toEqual([secondContainer]);
            expect(isContainerRunning(firstContainer)).toBe(true);
            expect(isContainerRunning(secondContainer)).toBe(true);
        },
    );
});
