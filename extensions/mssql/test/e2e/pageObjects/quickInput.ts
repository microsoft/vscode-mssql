/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from "@playwright/test";

/**
 * Page object for VS Code's quick input widget - the command palette and every quick pick the
 * extension opens.
 *
 * Driving the palette with `type()` + `Enter` is the single biggest source of flake in this
 * suite's history, for three distinct reasons. Each is handled here so no test has to know:
 *
 *  1. **The shortcut toggles.** Pressing the palette shortcut while a quick pick is still on
 *     screen closes that one rather than opening a fresh palette, so the next keystrokes go
 *     nowhere. Two commands run back to back hit this whenever the first pick has not finished
 *     closing. {@link QuickInput.open} always dismisses first.
 *
 *  2. **Enter runs the top fuzzy match, not the command you typed.** ">MS SQL: Connect" ranks
 *     "MS SQL: Add Connection" first, so Enter silently runs the wrong command.
 *     {@link QuickInput.pick} clicks the row whose label matches exactly.
 *
 *  3. **The filter and the label are not the same string.** VS Code's matcher returns no rows at
 *     all for a filter containing parentheses, so ">MS SQL: Connect (MSSQL)" matches nothing even
 *     though that is the row's label. {@link QuickInput.runCommand} takes them separately.
 *
 * Row structure is taken from the VS Code source rather than guessed. `quickInputList.ts` builds
 * each row as `.quick-input-list-entry > label.quick-input-list-label > .quick-input-list-rows`,
 * where the first `.quick-input-list-row` holds an IconLabel plus a
 * `.quick-input-list-entry-keybinding`, and the second holds `.quick-input-list-label-meta`. A
 * row's own `innerText` therefore contains the keybinding and the detail text as well as the
 * label, which is why matching on row text fails. `iconLabel.ts` puts the label itself in
 * `a.label-name` inside `span.monaco-icon-name-container`, and that is what this object compares.
 */
export class QuickInput {
    /** Label element inside a row; see the class comment for where this comes from. */
    private static readonly ROW_LABEL = ".quick-input-list-label .monaco-icon-name-container";

    constructor(private readonly page: Page) {}

    /**
     * The quick input widget, only while it is genuinely open.
     *
     * `:visible` alone is not enough. quickInputController.ts hides the widget by setting
     * `inert`, adding `quick-input-widget-closing`, and only setting `display: none` after a
     * 150ms close animation (QUICK_INPUT_CLOSE_ANIMATION_DURATION). For that window the widget is
     * still visible to a selector but has been emptied of rows, so anything polling it sees an
     * open-but-empty quick pick and waits forever. Excluding the closing and inert states is what
     * makes back-to-back commands reliable.
     */
    get widget(): Locator {
        return this.page.locator(
            ".quick-input-widget:not(.quick-input-widget-closing):not([inert]):visible",
        );
    }

    /** The text box at the top of the widget. */
    get input(): Locator {
        return this.page.locator('input[aria-controls="quickInput_list"]');
    }

    /** The selectable rows of the currently open quick pick. */
    get rows(): Locator {
        return this.widget.locator(".monaco-list-row");
    }

    async isOpen(): Promise<boolean> {
        return (await this.widget.count()) > 0;
    }

    /** Dismisses the widget if it is open, and waits for it to actually go away. */
    async close(timeout = 10 * 1000): Promise<void> {
        if (!(await this.isOpen())) {
            return;
        }
        await this.page.keyboard.press("Escape");
        await expect
            .poll(() => this.widget.count(), {
                timeout,
                message: "A quick pick stayed open after Escape.",
            })
            .toBe(0);
    }

    /** Opens a fresh command palette, closing anything already open first. */
    async open(): Promise<void> {
        await this.close();
        await this.page.keyboard.press(`${getPaletteModifier()}+P`);
        await expect(this.input).toBeVisible();
    }

    /** Types into the quick input box. Prefix with ">" to switch the palette to command mode. */
    async filter(text: string): Promise<void> {
        await expect(this.input).toBeVisible();
        await this.page.keyboard.type(text);
    }

    /** The labels of every currently visible row, whitespace-normalized. */
    async labels(): Promise<string[]> {
        const labels: string[] = [];
        const count = await this.rows.count();
        for (let index = 0; index < count; index++) {
            const row = this.rows.nth(index);
            const label = row.locator(QuickInput.ROW_LABEL).first();
            const text =
                (await label.count()) > 0 ? await label.innerText() : await row.innerText();
            labels.push(text.replace(/\s+/g, " ").trim());
        }
        return labels;
    }

    /**
     * Clicks the row whose label matches `label` exactly.
     *
     * On failure the visible labels are reported, so a mismatch says what was on screen instead of
     * just timing out.
     */
    async pick(label: string, timeout = 30 * 1000): Promise<void> {
        let seen: string[] = [];

        try {
            await expect
                .poll(
                    async () => {
                        seen = await this.labels();
                        return seen.includes(label);
                    },
                    { timeout },
                )
                .toBe(true);
        } catch {
            const widgets = await this.page.locator(".quick-input-widget").count();
            const visibleWidgets = await this.widget.count();
            const rowsInDocument = await this.page.locator(".monaco-list-row").count();
            const widgetHtml =
                visibleWidgets > 0
                    ? (await this.widget.first().innerHTML()).slice(0, 1200)
                    : "(none)";
            console.log("WIDGET HTML:", widgetHtml);
            throw new Error(
                `Quick pick row "${label}" never appeared. ` +
                    `widgets=${widgets} visible=${visibleWidgets} rowsInDocument=${rowsInDocument} ` +
                    `seen=[${seen.join(" | ")}]`,
            );
        }

        seen = await this.labels();
        const matchIndex = seen.indexOf(label);
        if (matchIndex < 0) {
            throw new Error(`Quick pick row "${label}" vanished. Visible: ${seen.join(" | ")}`);
        }
        await this.rows.nth(matchIndex).click();
    }

    /**
     * Runs a command: opens the palette, filters, and clicks the exact row.
     *
     * @param filterText Typed after ">". Keep parentheses out of it - the matcher drops every row.
     * @param rowLabel Exact row label to click, e.g. "MS SQL: Connect (MSSQL)".
     */
    async runCommand(filterText: string, rowLabel: string, timeout = 30 * 1000): Promise<void> {
        await this.open();
        await this.filter(`>${filterText}`);
        await this.pick(rowLabel, timeout);
    }

    /** Runs one of the known commands in {@link VsCodeCommand}. */
    async run(command: PaletteCommand, timeout = 30 * 1000): Promise<void> {
        await this.runCommand(command.filter, command.label, timeout);
    }
}

/** A palette entry: what to type, and the row label that identifies it unambiguously. */
export interface PaletteCommand {
    filter: string;
    label: string;
}

/**
 * Palette entries used by the e2e suite.
 *
 * `filter` is what gets typed and must avoid parentheses; `label` is the exact row text, which is
 * "<category>: <title>" from package.json plus package.nls.json.
 */
export const VsCodeCommand = {
    mssqlNewQuery: { filter: "MS SQL: New Query", label: "MS SQL: New Query" },
    mssqlConnect: { filter: "MS SQL: Connect", label: "MS SQL: Connect (MSSQL)" },
    mssqlDisconnect: { filter: "MS SQL: Disconnect", label: "MS SQL: Disconnect (MSSQL)" },
    mssqlChangeConnection: {
        filter: "MS SQL: Change Connection",
        label: "MS SQL: Change Connection (MSSQL)",
    },
} as const satisfies Record<string, PaletteCommand>;

function getPaletteModifier(): string {
    return process.platform === "darwin" ? "Meta" : "Control";
}
