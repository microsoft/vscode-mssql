/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from "@playwright/test";
import { mssqlActivityBarButton } from "./commonSelectors";

export async function addDatabaseConnection(vsCodePage: Page, serverName: string, databaseName: string, authType: string, userName: string, password: string, savePassword: string, profileName: string): Promise<void> {

    await wait(1000);
	await clickAddConnection(vsCodePage);

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
	await enableTrustServerCertificate(vsCodePage);
}

export async function clickAddConnection(vsCodePage: Page): Promise<void> {
	await openSqlExplorer(vsCodePage);
	await vsCodePage.focus('div[aria-label="Connections Section"]');
	await vsCodePage.click('.action-label.codicon.codicon-add');
}

export async function openSqlExplorer(vsCodePage: Page): Promise<void> {
	if (!(await isSqlExplorerVisible(vsCodePage))) {
		await vsCodePage.click(mssqlActivityBarButton);
	}
}

export async function isSqlExplorerVisible(vsCodePage: Page): Promise<boolean> {
	return vsCodePage.isVisible(`.action-item.icon.checked > ${mssqlActivityBarButton}`);
}

export async function enableTrustServerCertificate(vsCodePage: Page): Promise<void> {
	try{
	await vsCodePage.waitForSelector('.notification-list-item-buttons-container > a[class="monaco-button monaco-text-button"]');
	await vsCodePage.click('.notification-list-item-buttons-container > a[class="monaco-button monaco-text-button"]');
	}catch(e){
		console.log('Notification not found');
	}
}

export async function wait(ms: number): Promise<void> {
	await new Promise(r => setTimeout(r, ms));
}

export async function disconnectConnection(vsCodePage: Page, connectionExplorerItem: Locator): Promise<void> {
	await openSqlExplorer(vsCodePage);
	await connectionExplorerItem.click({button: 'right'});
	await vsCodePage.keyboard.press('ArrowDown');
	await vsCodePage.keyboard.press('ArrowDown');
	await vsCodePage.keyboard.press('Enter');
}

export async function newQueryForConnection(vsCodePage: Page, connectionExplorerItem: Locator): Promise<void> {
	await openSqlExplorer(vsCodePage);
	await connectionExplorerItem.click({button: 'right'});
	await vsCodePage.keyboard.press('ArrowDown');
	await vsCodePage.keyboard.press('Enter');
}