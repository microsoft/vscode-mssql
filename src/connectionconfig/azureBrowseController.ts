/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from '@azure/arm-resources';
import { AzureSubscription, VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext, IActionContext } from '@microsoft/vscode-azext-utils';

export async function getAzureText(): Promise<string> {
	const auth: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
	let text = "";

	if (await auth.isSignedIn()) {
		// tenant info
		const tenants = new Map((await auth.getTenants()).map(t => [t.tenantId, t]));

		text += `\nTenants (${tenants.size}):`;
		text += Array.from(tenants.values()).map(x => `\n${x.displayName} (${x.tenantId})`);
		text += "\n";

		// subscription info
		const groupBy = function<T>(xs: T[], key: string): Map<string, T[]> {
			return xs.reduce((rv, x) => {
				const keyValue = x[key];
				if (!rv.has(keyValue)) {
					rv.set(keyValue, []);
				}
				rv.get(keyValue)!.push(x);
				return rv;
			}, new Map<string, T[]>());
		};

		const subs = groupBy(await auth.getSubscriptions(), 'tenantId'); // TODO: replace with Object.groupBy once ES2024 is supported

		if (subs.size === 0) {
			text += `\nno subscriptions set in VS Code's Azure account filter`;
		} else {
			text += '\nSubscriptions:';
			for (const t of subs.keys()) {
				text += `\n${tenants.get(t).displayName} (${t}):`;
				for (const s of subs.get(t)) {
					text += `\n${s.name} (${s.subscriptionId})`;

					const databases = await getSqlDatabases(s);
					text += databases.join("\n");
				}
			}
		}
	}
	else {
		text = "Not signed in.";
		await auth.signIn();
	}

	return text;
}

async function getSqlDatabases(sub: AzureSubscription): Promise<string[]> {
	const client = new ResourceManagementClient(sub.credential, sub.subscriptionId);
	const resources = await uiUtils.listAllIterator(client.resources.list({filter: "resourceType eq 'Microsoft.Sql/servers/databases'"}));

	return resources.map(r => r.name);
}