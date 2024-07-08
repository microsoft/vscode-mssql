/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from "@playwright/test";

export async function addDatabaseConnection(vsCodePage: Page, serverName: string, databaseName: string, authType: string, userName: string, password: string, savePassword: string, profileName: string): Promise<void> {
	// wait for 10 seconds for the extension to load
	await new Promise(resolve => setTimeout(resolve, 10 * 1000));

	const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
	let isConnectionButtonVisible = await addConnectionButton.isVisible();
	if (!isConnectionButtonVisible) {
		await vsCodePage.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
	}

	await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
	await addConnectionButton.click();

	await vsCodePage.fill('input[aria-label="input"]', `${serverName}`);
	await vsCodePage.keyboard.press('Enter');

	if (databaseName) {
		await vsCodePage.fill('input[aria-label="input"]', `${databaseName}`);
	}
	await vsCodePage.keyboard.press('Enter');

	await vsCodePage.fill('input[aria-label="input"]', `${authType}`);
	await vsCodePage.keyboard.press('Enter');

	if (authType === 'SQL Login') {
		await vsCodePage.fill('input[aria-label="input"]', `${userName}`);
		await vsCodePage.keyboard.press('Enter');

		await vsCodePage.fill('input[aria-label="input"]', `${password}`);
		await vsCodePage.keyboard.press('Enter');

		await vsCodePage.fill('input[aria-label="input"]', `${savePassword}`);
		await vsCodePage.keyboard.press('Enter');
	}

	if (profileName) {
		await vsCodePage.fill('input[aria-label="input"]', `${profileName}`);
	}
	await vsCodePage.keyboard.press('Enter');
}
