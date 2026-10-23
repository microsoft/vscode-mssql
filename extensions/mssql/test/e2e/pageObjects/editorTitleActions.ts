/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from "@playwright/test";

/**
 * Upper bound for a single click or menu transition. Without it a click waits for the whole
 * test timeout when its target never becomes actionable.
 */
const ACTION_TIMEOUT = 10 * 1000;

/**
 * Page object for the action toolbar in the title of the active editor group.
 *
 * VS Code shows at most nine actions in that toolbar and moves the rest under "More Actions..."
 * (`overflowBehavior` in editorTabsControl.ts). Actions that other extensions contribute without
 * an explicit order sort ahead of ours, so which of our actions overflow depends on what else is
 * installed. This object treats both places as available, so tests do not depend on the layout.
 *
 * The overflow menu is only visible to Playwright when VS Code draws its own menus. macOS uses
 * native menus by default, so specs that use this object set `window.menuStyle` to `custom`.
 */
export class EditorTitleActions {
    constructor(private readonly page: Page) {}

    /** The action toolbar of the active editor group. */
    get toolbar(): Locator {
        return this.page.locator(".editor-group-container.active .editor-actions");
    }

    /**
     * An action shown directly in the toolbar.
     *
     * Matched by prefix because the aria-label appends the keybinding to the command title, for
     * example "Disconnect (MSSQL) (Ctrl+Shift+D)".
     */
    inline(label: string): Locator {
        return this.toolbar.locator(`a.action-label[aria-label^="${label}"]`);
    }

    /** The "More Actions..." button that opens the overflow menu. */
    get moreActions(): Locator {
        return this.toolbar.locator('a.action-label[aria-label^="More Actions"]');
    }

    private get overflowMenu(): Locator {
        return this.page.locator(".context-view.monaco-menu-container");
    }

    private overflowItem(label: string): Locator {
        // A menu item's accessible name is its label followed by its keybinding.
        return this.overflowMenu.getByRole("menuitem", {
            name: new RegExp(`^${escapeRegExp(label)}`),
        });
    }

    /**
     * Returns the labels that are in the toolbar or under "More Actions...".
     *
     * Opens the overflow menu at most once, and only for labels that are not shown inline.
     */
    async findAvailable(labels: readonly string[]): Promise<string[]> {
        const available: string[] = [];
        const notInline: string[] = [];
        for (const label of labels) {
            if (await this.inline(label).isVisible()) {
                available.push(label);
            } else {
                notInline.push(label);
            }
        }
        if (notInline.length === 0 || !(await this.moreActions.isVisible())) {
            return available;
        }

        try {
            await this.openOverflowMenu();
            for (const label of notInline) {
                if ((await this.overflowItem(label).count()) > 0) {
                    available.push(label);
                }
            }
        } finally {
            await this.closeOverflowMenu();
        }
        return available;
    }

    /** Waits until every `available` label is offered and no `unavailable` label is. */
    async expectActions(
        expected: { available?: readonly string[]; unavailable?: readonly string[] },
        timeout = 30 * 1000,
    ): Promise<void> {
        const { available = [], unavailable = [] } = expected;
        await expect
            .poll(
                async () => {
                    let found: Set<string>;
                    try {
                        found = new Set(await this.findAvailable([...available, ...unavailable]));
                    } catch (error) {
                        // expect.poll stops at the first error its callback throws. The toolbar
                        // can re-render while the overflow menu is read, so report the error as
                        // a mismatch and poll again.
                        return { error: error instanceof Error ? error.message : String(error) };
                    }
                    return {
                        missing: available.filter((label) => !found.has(label)),
                        unexpected: unavailable.filter((label) => found.has(label)),
                    };
                },
                {
                    timeout,
                    message: "The editor toolbar did not offer the expected actions.",
                },
            )
            .toEqual({ missing: [], unexpected: [] });
    }

    /**
     * Runs the action from wherever VS Code placed it.
     *
     * Not retried: running a toggle such as Enable Actual Plan twice would undo it.
     */
    async click(label: string): Promise<void> {
        await this.expectActions({ available: [label] });
        if (await this.inline(label).isVisible()) {
            await this.inline(label).click({ timeout: ACTION_TIMEOUT });
            return;
        }
        await this.openOverflowMenu();
        await this.overflowItem(label).click({ timeout: ACTION_TIMEOUT });
        await expect(this.overflowMenu).toBeHidden({ timeout: ACTION_TIMEOUT });
    }

    private async openOverflowMenu(): Promise<void> {
        await this.moreActions.click({ timeout: ACTION_TIMEOUT });
        await expect(this.overflowMenu).toBeVisible({ timeout: ACTION_TIMEOUT });
    }

    /** Closes the overflow menu if it is open. Safe to call when it is not. */
    private async closeOverflowMenu(): Promise<void> {
        if (await this.overflowMenu.isVisible()) {
            await this.page.keyboard.press("Escape");
        }
        await expect(this.overflowMenu).toBeHidden({ timeout: ACTION_TIMEOUT });
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
