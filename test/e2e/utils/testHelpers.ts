/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from "@playwright/test";
import { mssqlActivityBarButton, addConnectionButton } from "./commonSelectors";

export async function addDatabaseConnection(vsCodePage: Page, serverName: string, databaseName: string, authType: string, userName: string, password: string, savePassword: string, profileName: string): Promise<void> {
	// wait for 10 seconds for the extension to load
	vsCodePage.click(mssqlActivityBarButton);
	const connButton = await vsCodePage.locator(addConnectionButton);
	await connButton.click();

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
