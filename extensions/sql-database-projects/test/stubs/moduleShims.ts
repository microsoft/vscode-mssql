/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type AnyObject = Record<PropertyKey, any>;

const globalShimFlag = '__sqlprojModuleShimsInstalled';

function createEnumProxy(): AnyObject {
	return new Proxy(
		{},
		{
			get: (_target, prop: PropertyKey) => prop.toString(),
			set: () => true
		}
	);
}

function createProxyModule(name: string): AnyObject {
	const cache: AnyObject = {};

	const proxy = new Proxy(function () {
		return undefined;
	}, {
		get: (_target, prop: PropertyKey) => {
			if (!(prop in cache)) {
				cache[prop] = createProxyModule(`${name}.${String(prop)}`);
			}

			return cache[prop];
		},
		set: (_target, prop: PropertyKey, value: any) => {
			cache[prop] = value;
			return true;
		},
		apply: () => undefined,
		construct: () => ({})
	});

	return proxy as unknown as AnyObject;
}

function createDataWorkspaceShim(): AnyObject {
	const shim = createProxyModule('dataworkspace');

	shim.WorkspaceTreeItem = class WorkspaceTreeItem {
		constructor(public readonly element?: AnyObject) { }
	};

	shim.TreeItemType = createEnumProxy();
	shim.IconPath = class IconPath { constructor(public readonly light: string, public readonly dark: string) { } };
	shim.IconCellValue = class IconCellValue { constructor(public readonly icon: string, public readonly text: string) { } };
	shim.getDataWorkspaceExtensionApi = async () => ({
		get projects() { return []; },
		treeDataProvider: {
			refresh: () => undefined
		}
	});

	return shim;
}

function createSqlToolsShim(name: string): AnyObject {
	const shim = createProxyModule(name);

	shim.SchemaCompareEndpointType = createEnumProxy();
	shim.ProjectType = createEnumProxy();
	shim.ExtractTarget = createEnumProxy();
	shim.TaskExecutionMode = { execute: 'execute', script: 'script' };
	shim.ExtractTarget = createEnumProxy();

	shim.DacFxService = class { };

	return shim;
}

function createAzdataShim(): AnyObject {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const azdata = require('@microsoft/azdata-test/out/stubs/azdata') as AnyObject;

	azdata.TaskExecutionMode = azdata.TaskExecutionMode ?? { execute: 'execute', script: 'script' };
	azdata.TaskStatus = azdata.TaskStatus ?? createEnumProxy();

	azdata.connection = azdata.connection ?? {};
	azdata.connection.AuthenticationType = azdata.connection.AuthenticationType ?? createEnumProxy();
	azdata.connection.ConnectionOptionSpecialType = azdata.connection.ConnectionOptionSpecialType ?? createEnumProxy();

	azdata.connection.getConnections = azdata.connection.getConnections ?? (async () => []);
	azdata.connection.connect = azdata.connection.connect ?? (async () => ({ connected: true, connectionId: 'mock-connection' }));
	azdata.connection.getUriForConnection = azdata.connection.getUriForConnection ?? (async () => 'mock-uri');
	azdata.connection.listDatabases = azdata.connection.listDatabases ?? (async () => []);

	return azdata;
}

function createModuleOverrides(): Record<string, AnyObject> {
	return {
		azdata: createAzdataShim(),
		dataworkspace: createDataWorkspaceShim(),
		mssql: createSqlToolsShim('mssql'),
		'vscode-mssql': createSqlToolsShim('vscode-mssql')
	};
}

export function installModuleShims(): void {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const mod: AnyObject = require('module');

	if ((globalThis as AnyObject)[globalShimFlag]) {
		return;
	}

	const overrides = createModuleOverrides();
	const originalLoad = mod._load;

	mod._load = function patchedLoad(request: string, parent: NodeModule, isMain: boolean) {
		if (request in overrides) {
			return overrides[request];
		}

		return originalLoad.call(this, request, parent, isMain);
	};

	(globalThis as AnyObject)[globalShimFlag] = true;
}

installModuleShims();


