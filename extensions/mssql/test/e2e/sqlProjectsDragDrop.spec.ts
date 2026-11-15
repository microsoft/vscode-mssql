/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    clearNotifications,
    expectFileNotToContain,
    expectFileToContain,
    getProjectTreeItem,
    getSqlProjectSettings,
    openProjectsView,
    readText,
    removeDir,
    reserveTempDir,
    revealProjectTreeItem,
    sqlprojPath,
    waitForFile,
    waitForFileToBeRemoved,
} from "./utils/sqlProjectHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const FIXTURES = path.join(__dirname, "..", "resources", "e2e", "sqlProjectsDragDrop");

type ProjectStyle = {
    style: "Legacy" | "SDK-style";
    project: string;
    sqlCmdVariable: string;
    reference: string;
};

const PROJECT_STYLES: ProjectStyle[] = [
    {
        style: "Legacy",
        project: "DragLegacy",
        sqlCmdVariable: "LegacyEnv",
        reference: "LegacyLib",
    },
    { style: "SDK-style", project: "DragSdk", sqlCmdVariable: "SdkEnv", reference: "SdkLib" },
];

const MOVE_NOT_SUPPORTED = "Only moving files and folders are supported";
const MOVE_BETWEEN_PROJECTS_NOT_SUPPORTED = "Moving files between projects is not supported";

/** The workbench modal dialog that is currently showing, if any. */
function getModalDialog(page: Page): Locator {
    return page.getByRole("dialog").filter({
        has: page.getByRole("button", { name: "Cancel", exact: true }),
    });
}

/**
 * Drags one Database Projects tree item onto another by dispatching the HTML5 drag-and-drop
 * events the workbench tree handles, sharing one DataTransfer between them as a browser would.
 * A pointer-driven drag (`dragTo`) occasionally turned into a native drag that never dropped and
 * then blocked the rest of the workbench, so the events are dispatched directly instead.
 */
async function dragTreeItem(page: Page, source: Locator, target: Locator): Promise<void> {
    const sourcePoint = await getCenter(source);
    const targetPoint = await getCenter(target);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    try {
        await source.dispatchEvent("dragstart", { dataTransfer, ...sourcePoint });
        for (const type of ["dragenter", "dragover", "drop"]) {
            await target.dispatchEvent(type, { dataTransfer, ...targetPoint });
        }
        await source.dispatchEvent("dragend", { dataTransfer, ...sourcePoint });
    } finally {
        await dataTransfer.dispose();
    }
}

/** The viewport coordinates of a visible element's center, as drag events carry them. */
async function getCenter(locator: Locator): Promise<{ clientX: number; clientY: number }> {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error("Tree item has no bounding box.");
    }
    return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
}

/** Answers the move confirmation that a drop onto a file or folder asks for. */
async function answerMoveConfirmation(
    page: Page,
    button: "Move" | "Cancel",
    fileName: string,
    destination: string,
): Promise<void> {
    const dialog = getModalDialog(page).filter({
        hasText: `Are you sure you want to move ${fileName} to ${destination}?`,
    });
    await expect(dialog).toBeVisible({ timeout: 30 * 1000 });
    await dialog.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog).toBeHidden();
}

/**
 * Waits for a notification with this message. The workbench sometimes skips the toast for a
 * message that repeats an earlier one, so when no toast shows, this looks in the notification
 * center, which lists every notification. Callers clear notifications before the action, so a
 * match is always new.
 */
async function expectNotification(page: Page, message: string): Promise<void> {
    const notification = page
        .getByRole("dialog", { name: /notification/i })
        .filter({ hasText: message });
    await expect(async () => {
        if (!(await notification.isVisible())) {
            await new QuickInput(page).runCommand(
                "Notifications: Show Notifications",
                "Notifications: Show Notifications",
            );
        }
        await expect(notification).toBeVisible({ timeout: 5 * 1000 });
    }).toPass({ timeout: 60 * 1000 });
}

/**
 * SQL Database Projects drag and drop. A checked-in legacy project and an SDK-style project are
 * copied into a temporary folder that VS Code opens, and files, folders, SQLCMD variables and
 * database references are dragged around the Database Projects tree. Legacy moves are verified
 * through the .sqlproj, SDK-style (globbed) moves through the file system, and both through the
 * tree. Each test drags different items, so the tests do not depend on each other.
 */
test.describe("SQL Database Projects drag and drop", () => {
    const workspaceDir = reserveTempDir("sqlproj-dnd");

    // Declared before the lifecycle hooks so the projects exist when VS Code opens the folder.
    test.beforeAll(() => {
        fs.cpSync(FIXTURES, workspaceDir, { recursive: true });
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig(getSqlProjectSettings(workspaceDir)),
            extraLaunchArgs: [workspaceDir],
        },
        afterLaunch: async ({ page }) => {
            await openProjectsView(page);
        },
        afterEach: async ({ page }) => {
            // A failed test may leave a move confirmation up, which would block the next test.
            const dialog = getModalDialog(page);
            if (await dialog.isVisible()) {
                await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
                await expect(dialog).toBeHidden();
            }
            // Also hides the notification center that expectNotification may have opened.
            await clearNotifications(page);
        },
    });

    test.afterAll(() => removeDir(workspaceDir));

    const projectDir = (project: string) => path.join(workspaceDir, project);
    const projectFile = (project: string) => path.join(projectDir(project), `${project}.sqlproj`);
    const projectPath = (project: string, relativePath: string) =>
        path.join(projectDir(project), ...relativePath.split("/"));

    /**
     * Checks that a file moved on disk and in the tree. Legacy projects list every file, so the
     * .sqlproj entry has to move too; SDK-style projects glob their files and list none.
     */
    async function expectMoved(
        page: Page,
        { project, style }: ProjectStyle,
        from: string,
        to: string,
    ): Promise<void> {
        await waitForFile(projectPath(project, to));
        await waitForFileToBeRemoved(projectPath(project, from));
        if (style === "Legacy") {
            await expectFileToContain(projectFile(project), sqlprojPath(to));
            await expectFileNotToContain(projectFile(project), sqlprojPath(from));
        } else {
            expect(readText(projectFile(project))).not.toContain(path.basename(to));
        }
        await expect(getProjectTreeItem(page, `${project}/${from}`)).toHaveCount(0, {
            timeout: 30 * 1000,
        });
        await revealProjectTreeItem(page, project, to);
    }

    for (const projectStyle of PROJECT_STYLES) {
        const { style, project, sqlCmdVariable, reference } = projectStyle;

        test(`${style}: drag a file into a folder`, testCases(5878856), async () => {
            const { page } = getContext();
            const source = await revealProjectTreeItem(page, project, "Tables/Customers.sql");
            const target = await revealProjectTreeItem(page, project, "Archive");

            await dragTreeItem(page, source, target);
            await answerMoveConfirmation(page, "Move", "Customers.sql", "Archive");

            await expectMoved(page, projectStyle, "Tables/Customers.sql", "Archive/Customers.sql");
        });

        test(
            `${style}: drag a file out of a folder to the project root`,
            testCases(5878856),
            async () => {
                const { page } = getContext();
                const source = await revealProjectTreeItem(page, project, "Tables/Orders.sql");
                const target = await revealProjectTreeItem(page, project);

                await dragTreeItem(page, source, target);
                await answerMoveConfirmation(page, "Move", "Orders.sql", project);

                await expectMoved(page, projectStyle, "Tables/Orders.sql", "Orders.sql");
            },
        );

        test(`${style}: drag a folder into another folder`, testCases(5878856), async () => {
            const { page } = getContext();
            const source = await revealProjectTreeItem(page, project, "Staging");
            const target = await revealProjectTreeItem(page, project, "Archive");

            await dragTreeItem(page, source, target);
            await answerMoveConfirmation(page, "Move", "Staging", "Archive");

            await expectMoved(
                page,
                projectStyle,
                "Staging/StagedOrders.sql",
                "Archive/Staging/StagedOrders.sql",
            );
            await expect(getProjectTreeItem(page, `${project}/Staging`)).toHaveCount(0);
            if (style === "Legacy") {
                await expectFileNotToContain(projectFile(project), /Include="Staging\\?"/);
            }
        });

        test(
            `${style}: dropping a file on SQLCMD Variables or Database References does nothing`,
            testCases(5878856),
            async () => {
                const { page } = getContext();
                const sqlprojBefore = readText(projectFile(project));
                const source = await revealProjectTreeItem(page, project, "Tables/Products.sql");

                await dragTreeItem(
                    page,
                    source,
                    await revealProjectTreeItem(page, project, "SQLCMD Variables"),
                );
                await dragTreeItem(
                    page,
                    source,
                    await revealProjectTreeItem(page, project, "Database References"),
                );
                // Drops are handled in order, so the prompt for this drop onto a folder (and no
                // other prompt before it) shows that the two drops above were ignored.
                await dragTreeItem(
                    page,
                    source,
                    await revealProjectTreeItem(page, project, "Archive"),
                );
                await answerMoveConfirmation(page, "Cancel", "Products.sql", "Archive");

                await expect(getModalDialog(page)).toHaveCount(0);
                expect(fs.existsSync(projectPath(project, "Tables/Products.sql"))).toBe(true);
                expect(readText(projectFile(project))).toBe(sqlprojBefore);
                await expect(source).toBeVisible();
            },
        );

        test(
            `${style}: dragging a SQLCMD variable is not supported`,
            testCases(5878856),
            async () => {
                const { page } = getContext();
                const source = await revealProjectTreeItem(
                    page,
                    project,
                    `SQLCMD Variables/${sqlCmdVariable}`,
                );
                const target = await revealProjectTreeItem(page, project, "Tables");
                await clearNotifications(page);

                await dragTreeItem(page, source, target);

                await expectNotification(page, MOVE_NOT_SUPPORTED);
                await expect(getModalDialog(page)).toHaveCount(0);
                expect(readText(projectFile(project))).toContain(
                    `<SqlCmdVariable Include="${sqlCmdVariable}">`,
                );
                await expect(source).toBeVisible();
            },
        );

        test(
            `${style}: dragging a database reference is not supported`,
            testCases(5878856),
            async () => {
                const { page } = getContext();
                const source = await revealProjectTreeItem(
                    page,
                    project,
                    `Database References/${reference}`,
                );
                const target = await revealProjectTreeItem(page, project, "Tables");
                await clearNotifications(page);

                await dragTreeItem(page, source, target);

                await expectNotification(page, MOVE_NOT_SUPPORTED);
                await expect(getModalDialog(page)).toHaveCount(0);
                expect(readText(projectFile(project))).toContain(`${reference}.dacpac`);
                await expect(source).toBeVisible();
            },
        );
    }

    test(
        "dragging a file or folder to another project is not supported",
        testCases(5878856),
        async () => {
            const { page } = getContext();
            const [legacy, sdk] = PROJECT_STYLES.map((projectStyle) => projectStyle.project);
            const legacySqlproj = readText(projectFile(legacy));

            const file = await revealProjectTreeItem(page, legacy, "Tables/Regions.sql");
            const sdkFolder = await revealProjectTreeItem(page, sdk, "Tables");
            await clearNotifications(page);
            await dragTreeItem(page, file, sdkFolder);
            await expectNotification(page, MOVE_BETWEEN_PROJECTS_NOT_SUPPORTED);

            const folder = await revealProjectTreeItem(page, sdk, "Archive");
            const legacyRoot = await revealProjectTreeItem(page, legacy);
            await clearNotifications(page);
            await dragTreeItem(page, folder, legacyRoot);
            await expectNotification(page, MOVE_BETWEEN_PROJECTS_NOT_SUPPORTED);

            await expect(getModalDialog(page)).toHaveCount(0);
            expect(fs.existsSync(projectPath(legacy, "Tables/Regions.sql"))).toBe(true);
            expect(fs.existsSync(projectPath(sdk, "Tables/Regions.sql"))).toBe(false);
            expect(fs.existsSync(projectPath(sdk, "Archive"))).toBe(true);
            expect(readText(projectFile(legacy))).toBe(legacySqlproj);
        },
    );
});
