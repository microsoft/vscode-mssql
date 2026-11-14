/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    clickContextMenuItem,
    expandObjectExplorerNode,
    getObjectExplorerNode,
    getObjectExplorerPane,
    getSeededConnectionProfile,
    getSeededLaunchConfig,
} from "./utils/seededConnection";
import { getPassword, getServerName, getUserName } from "./utils/envConfigReader";
import { getWebviewByTitle } from "./utils/testHelpers";
import { QuickInput } from "./pageObjects";
import { testCases } from "./utils/testCases";

const EDIT_PROFILE = "e2e-edit-me";
const EDITED_PROFILE = "e2e-edited";
const REMOVE_PROFILE = "e2e-remove-me";
const DELETE_PROFILE = "e2e-delete-me";
const RECENT_PROFILE = "e2e-recent";
const NEW_PROFILE = "e2e-new-profile";

/**
 * The connection dialog: connecting with parameters or a connection string, editing a saved
 * connection, and removing saved and recent connections from the dialog and Object Explorer.
 */
test.describe("MSSQL Extension - Connection Dialog", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({
                "mssql.connections": [
                    EDIT_PROFILE,
                    REMOVE_PROFILE,
                    DELETE_PROFILE,
                    RECENT_PROFILE,
                ].map((name) => getSeededConnectionProfile(name)),
            }),
        },
    });

    // Each test starts from a fresh dialog rather than whatever the previous one left behind.
    test.afterEach(async () => {
        const { page } = getContext();
        const dialogTabs = page.getByRole("tab", { name: /^Connection Dialog/ });
        // A successful connect closes the dialog on its own, so a tab can vanish mid-close.
        await expect(async () => {
            if ((await dialogTabs.count()) > 0) {
                const tab = dialogTabs.first();
                await tab.hover({ timeout: 2000 });
                await tab.getByRole("button", { name: /^Close/ }).click({ timeout: 2000 });
            }
            await expect(dialogTabs).toHaveCount(0, { timeout: 2000 });
        }).toPass({ timeout: 30 * 1000 });
    });

    /** SERVER_NAME split the way the dialog shows it: `host,port` fills both fields. */
    function getExpectedServerFields(): { server: string; port: string } {
        const [server, port] = getServerName().split(",");
        return { server, port: port ?? "" };
    }

    async function openConnectionDialog(page: Page): Promise<FrameLocator> {
        const pane = getObjectExplorerPane(page);
        await pane.getByRole("heading", { name: "Connections", exact: true }).hover();
        await pane.getByRole("button", { name: "Add Connection...", exact: true }).click();
        const dialog = await getWebviewByTitle(page, "Connection Dialog");
        await expect(dialog.getByRole("textbox", { name: "Server name" })).toBeVisible();
        return dialog;
    }

    async function fillSqlLogin(dialog: FrameLocator): Promise<void> {
        await dialog.getByRole("textbox", { name: "Server name" }).fill(getServerName());
        await expect(dialog.getByRole("combobox", { name: "Authentication type" })).toHaveText(
            "SQL Login",
        );
        await dialog.getByRole("textbox", { name: "User name" }).fill(getUserName());
        await dialog.getByRole("textbox", { name: "Password" }).fill(getPassword());
    }

    function connectButton(dialog: FrameLocator): Locator {
        return dialog.getByRole("button", { name: "Connect", exact: true });
    }

    /** Waits for a connection node to be connected, which is when it can be expanded. */
    async function expectConnectedNode(page: Page, label: string | RegExp): Promise<void> {
        await expandObjectExplorerNode(page, label);
        await expect(
            getObjectExplorerPane(page)
                .getByRole("treeitem", { name: /^Databases\b/ })
                .first(),
        ).toBeVisible();
    }

    function savedConnectionCard(dialog: FrameLocator, profileName: string): Locator {
        return dialog.getByRole("button", { name: `Edit ${profileName}`, exact: true });
    }

    test(
        "Connect stays unavailable until the required fields are filled",
        testCases(5878869),
        async () => {
            const { page } = getContext();
            const dialog = await openConnectionDialog(page);
            await expect(
                dialog.getByRole("radio", { name: /^Parameters/ }),
                "Parameters is the default input type",
            ).toBeChecked();

            await expect(connectButton(dialog)).toBeDisabled();
            await fillSqlLogin(dialog);
            await expect(connectButton(dialog)).toBeEnabled();
        },
    );

    test(
        "connecting to an untrusted certificate offers to trust it and then connects",
        testCases(5878869),
        async () => {
            const { page } = getContext();
            const dialog = await openConnectionDialog(page);
            await fillSqlLogin(dialog);
            const trust = dialog.getByRole("checkbox", { name: "Trust server certificate" });
            await expect(trust).not.toBeChecked();
            await expect(dialog.getByRole("textbox", { name: "Profile Name" })).toHaveValue("");

            await connectButton(dialog).click();
            const trustPrompt = dialog.getByRole("dialog", { name: "Connection Error" });
            await expect(trustPrompt).toBeVisible({ timeout: 60 * 1000 });
            await trustPrompt
                .getByRole("button", { name: "Enable 'Trust Server Certificate'" })
                .click();

            // Without a profile name the connection is listed under its server name.
            await expectConnectedNode(page, getServerName());
        },
    );

    test(
        "connecting with a profile name and a trusted certificate does not prompt",
        testCases(5878869),
        async () => {
            const { page } = getContext();
            const dialog = await openConnectionDialog(page);
            await fillSqlLogin(dialog);
            await dialog.getByRole("textbox", { name: "Profile Name" }).fill(NEW_PROFILE);
            const trust = dialog.getByRole("checkbox", { name: "Trust server certificate" });
            await trust.click();
            await expect(trust).toBeChecked();

            await connectButton(dialog).click();
            await expectConnectedNode(page, NEW_PROFILE);
            await expect(dialog.getByRole("dialog", { name: "Connection Error" })).toHaveCount(0);
        },
    );

    test(
        "Load from Connection String rejects an invalid string and loads a valid one",
        testCases(5878870),
        async () => {
            const { page } = getContext();
            const dialog = await openConnectionDialog(page);
            await dialog.getByRole("button", { name: "Load from Connection String" }).click();
            const stringDialog = dialog.getByRole("dialog", {
                name: "Load from Connection String",
            });
            await expect(stringDialog).toBeVisible();
            const input = stringDialog.getByRole("textbox", {
                name: "Load from Connection String",
            });

            await input.fill("this is not a connection string");
            await stringDialog.getByRole("button", { name: "Load", exact: true }).click();
            await expect(stringDialog.getByText(/^Invalid connection string:/)).toBeVisible();

            const database = "msdb";
            await input.fill(
                `Server=${getServerName()};Database=${database};User Id=${getUserName()};Password=${getPassword()};TrustServerCertificate=True;`,
            );
            await stringDialog.getByRole("button", { name: "Load", exact: true }).click();
            await expect(stringDialog).toBeHidden();

            await expect(dialog.getByRole("textbox", { name: "Server name" })).toHaveValue(
                getServerName(),
            );
            await expect(dialog.getByRole("textbox", { name: "User name" })).toHaveValue(
                getUserName(),
            );
            await expect(dialog.getByRole("combobox", { name: "Database name" })).toHaveValue(
                database,
            );
            await expect(
                dialog.getByRole("checkbox", { name: "Trust server certificate" }),
            ).toBeChecked();
        },
    );

    test("Remove Connection deletes it from Object Explorer", testCases(5878873), async () => {
        const { page } = getContext();
        const node = getObjectExplorerNode(page, REMOVE_PROFILE);
        await expect(node).toBeVisible();
        await node.click({ button: "right" });
        await clickContextMenuItem(page, "Remove Connection");

        const confirmation = page.getByRole("dialog").filter({
            hasText: `Are you sure you want to remove ${REMOVE_PROFILE}?`,
        });
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
        await expect(getObjectExplorerNode(page, REMOVE_PROFILE)).toHaveCount(0);
    });

    test(
        "editing a saved connection reports failures and renames the profile",
        testCases(5878874),
        async () => {
            const { page } = getContext();
            const node = getObjectExplorerNode(page, EDIT_PROFILE);
            await node.hover();
            await node.getByRole("button", { name: "Edit Connection..." }).click();
            const dialog = await getWebviewByTitle(page, "Connection Dialog");

            await expect(dialog.getByRole("textbox", { name: "Profile Name" })).toHaveValue(
                EDIT_PROFILE,
            );
            const expectedServer = getExpectedServerFields();
            await expect(dialog.getByRole("textbox", { name: "Server name" })).toHaveValue(
                expectedServer.server,
            );
            if (expectedServer.port) {
                await expect(dialog.getByRole("textbox", { name: "Port" })).toHaveValue(
                    expectedServer.port,
                );
            }
            await expect(dialog.getByRole("textbox", { name: "User name" })).toHaveValue(
                getUserName(),
            );

            const password = dialog.getByRole("textbox", { name: "Password" });
            await password.fill(`${getPassword()}-wrong`);
            await connectButton(dialog).click();
            await expect(dialog.getByText(/Login failed for user/)).toBeVisible({
                timeout: 60 * 1000,
            });

            await password.fill(getPassword());
            await dialog.getByRole("textbox", { name: "Profile Name" }).fill(EDITED_PROFILE);
            await connectButton(dialog).click();

            await expectConnectedNode(page, EDITED_PROFILE);
            await expect(getObjectExplorerNode(page, EDIT_PROFILE)).toHaveCount(0);
        },
    );

    test("deleting a saved connection asks for confirmation", testCases(5878875), async () => {
        const { page } = getContext();
        const dialog = await openConnectionDialog(page);
        const card = savedConnectionCard(dialog, DELETE_PROFILE);
        const deleteButton = card.getByRole("button", { name: "Delete saved connection" });

        // The confirmation is a quick pick offering Delete and Cancel.
        const confirmation = new QuickInput(page);
        await card.hover();
        await deleteButton.click();
        await confirmation.pick("Cancel");
        await expect(card).toBeVisible();

        await card.hover();
        await deleteButton.click();
        await confirmation.pick("Delete");
        await expect(card).toHaveCount(0);
        await expect(getObjectExplorerNode(page, DELETE_PROFILE)).toHaveCount(0);
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry): an Object Explorer node stayed on "Loading...".
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "removing a recent connection does not ask for confirmation",
        testCases(5878875),
        async () => {
            const { page } = getContext();
            // Only connections made through the dialog are listed as recent.
            const editDialog = await openConnectionDialog(page);
            await savedConnectionCard(editDialog, RECENT_PROFILE).click();
            await expect(editDialog.getByRole("textbox", { name: "Profile Name" })).toHaveValue(
                RECENT_PROFILE,
            );
            await connectButton(editDialog).click();
            await expectConnectedNode(page, RECENT_PROFILE);

            const dialog = await openConnectionDialog(page);
            // The card's actions only render while it is hovered, so the card is the one match
            // until then; the Copy action shares its "copied from" name.
            const recent = dialog.getByRole("button", {
                name: `Create new connection copied from ${RECENT_PROFILE}`,
                exact: true,
            });
            await expect(recent).toBeVisible();

            await recent.hover();
            await dialog
                .getByRole("button", { name: "Clear from recent connections list" })
                .click();
            await expect(recent).toHaveCount(0);
            expect(await new QuickInput(page).isOpen()).toBe(false);
            await expect(savedConnectionCard(dialog, RECENT_PROFILE)).toBeVisible();
        },
    );
});
