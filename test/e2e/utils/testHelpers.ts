/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from "@playwright/test";
import { mssqlActivityBarButton } from "./commonSelectors";

/**
 * Add a new database connection in the SQL Explorer
 * @param vscodePage electron page for vscode instance
 * @param serverName server name
 * @param databaseName database name
 * @param authType authentication type
 * @param userName user name
 * @param password password
 * @param savePassword save password
 * @param profileName profile name
 */
export async function addDatabaseConnection(vscodePage: Page, serverName: string, databaseName: string, authType: string, userName: string, password: string, savePassword: string, profileName: string): Promise<void> {
	await clickAddConnection(vscodePage);

	await vscodePage.fill('input[aria-label="input"]', `${serverName}`);
	await vscodePage.keyboard.press('Enter');

	if (databaseName) {
		await vscodePage.fill('input[aria-label="input"]', `${databaseName}`);
	}
	await vscodePage.keyboard.press('Enter');

	await vscodePage.fill('input[aria-label="input"]', `${authType}`);
	await vscodePage.keyboard.press('Enter');

	if (authType === 'SQL Login') {
		await vscodePage.fill('input[aria-label="input"]', `${userName}`);
		await vscodePage.keyboard.press('Enter');
		await vscodePage.fill('input[aria-label="input"]', `${password}`);
		await vscodePage.keyboard.press('Enter');
		await vscodePage.fill('input[aria-label="input"]', `${savePassword}`);
		await vscodePage.keyboard.press('Enter');
	}

	if (profileName) {
		await vscodePage.fill('input[aria-label="input"]', `${profileName}`);
	}
	await vscodePage.keyboard.press('Enter');
	await enableTrustServerCertificate(vscodePage);
}

/**
 * Click on the 'Add Connection' button in the SQL Explorer
 * @param vscodePage vscodePage electron page for vscode instance
 */
export async function clickAddConnection(vscodePage: Page): Promise<void> {
	await openSqlExplorer(vscodePage);
	await vscodePage.waitForSelector('div[aria-label="Connections Section"]');
	await vscodePage.focus('div[aria-label="Connections Section"]');
	await vscodePage.click('.action-label.codicon.codicon-add');
}

/**
 * If the SQL Explorer is not visible, click on the SQL Explorer button to open it
 * @param vscodePage electron page for vscode instance
 */
export async function openSqlExplorer(vscodePage: Page): Promise<void> {
	if (!(await isSqlExplorerVisible(vscodePage))) {
		await vscodePage.click(mssqlActivityBarButton);
	}
}

/**
 * Checks if the SQL Explorer is visible
 * @param vscodePage
 * @returns true if the SQL Explorer is visible, false otherwise
 */
export async function isSqlExplorerVisible(vscodePage: Page): Promise<boolean> {
	return vscodePage.isVisible(`.action-item.icon.checked > ${mssqlActivityBarButton}`);
}

/**
 * Wait for the notification to appear and click on the 'Trust Server Certificate' button
 * @param vscodePage electron page for vscode instance
 */
export async function enableTrustServerCertificate(vscodePage: Page): Promise<void> {
	try{
	await vscodePage.waitForSelector('.notification-list-item-buttons-container > a[class="monaco-button monaco-text-button"]');
	await vscodePage.click('.notification-list-item-buttons-container > a[class="monaco-button monaco-text-button"]');
	}catch(e){
		console.log('Notification not found');
	}
}

/**
 * Wait for a specified time
 * @param ms time in milliseconds
 */
export async function wait(ms: number): Promise<void> {
	await new Promise(r => setTimeout(r, ms));
}

/**
 * Execute a command in vscode command pallette
 * @param vscodePage electron page for vscode instance
 * @param command command to be executed. Do not include the '>' symbol. For better results, use the exact command name eg: 'MS SQL: New Query'
 */
export async function executeCommand(vscodePage: Page, command: string): Promise<void> {
	// Starting command pallette
	vscodePage.keyboard.press('F1');
	await vscodePage.waitForSelector('input[class="input"]');
	// Type the command in the input box
	await vscodePage.fill('input[class="input"]', `> ${command}`);
	// Click on the command
	await vscodePage.keyboard.press('Enter');
}
