/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as azdataType from 'azdata';

type ThemedUriIconPath = { light: vscode.Uri; dark: vscode.Uri };
type CommonIconPath = string | vscode.Uri | ThemedUriIconPath;

// export interface IconPath {
// 	dark: string;
// 	light: string;
// }

export class IconPathHelper {
	private static extensionContext: vscode.ExtensionContext;
	public static databaseProject: CommonIconPath;
	public static colorfulSqlProject: CommonIconPath;
	public static sqlEdgeProject: CommonIconPath;
	public static azureSqlDbProject: CommonIconPath;

	public static dataSourceGroup: CommonIconPath;
	public static dataSourceSql: CommonIconPath;

	public static referenceGroup: CommonIconPath;
	public static referenceDatabase: CommonIconPath;

	public static sqlCmdVariablesGroup: CommonIconPath;
	public static sqlCmdVariable: CommonIconPath;

	public static refresh: CommonIconPath;
	public static folder_blue: CommonIconPath;
	public static selectConnection: CommonIconPath;
	public static connect: CommonIconPath;

	public static folder: CommonIconPath;

	public static add: CommonIconPath;
	public static build: CommonIconPath;
	public static publish: CommonIconPath;
	public static schemaCompare: CommonIconPath;
	public static targetPlatform: CommonIconPath;

	public static success: CommonIconPath;
	public static error: CommonIconPath;
	public static inProgress: CommonIconPath;

	public static dashboardSqlProj: azdataType.ThemedIconPath;

	public static setExtensionContext(extensionContext: vscode.ExtensionContext) {
		IconPathHelper.extensionContext = extensionContext;

		IconPathHelper.databaseProject = IconPathHelper.makeIcon('databaseProject');
		IconPathHelper.colorfulSqlProject = IconPathHelper.makeIcon('colorfulSqlProject', true);
		IconPathHelper.sqlEdgeProject = IconPathHelper.makeIcon('sqlEdgeProject', true);
		IconPathHelper.azureSqlDbProject = IconPathHelper.makeIcon('azure', true);

		IconPathHelper.dataSourceGroup = IconPathHelper.makeIcon('dataSourceGroup');
		IconPathHelper.dataSourceSql = IconPathHelper.makeIcon('dataSource-sql');

		IconPathHelper.referenceGroup = IconPathHelper.makeIcon('referenceGroup');
		IconPathHelper.referenceDatabase = IconPathHelper.makeIcon('reference-database');

		IconPathHelper.sqlCmdVariablesGroup = IconPathHelper.makeIcon('symbol-string');
		IconPathHelper.sqlCmdVariable = IconPathHelper.makeIcon('symbol-variable');

		IconPathHelper.refresh = IconPathHelper.makeIcon('refresh', true);
		IconPathHelper.folder_blue = IconPathHelper.makeIcon('folder_blue', true);
		IconPathHelper.selectConnection = IconPathHelper.makeIcon('selectConnection', true);
		IconPathHelper.connect = IconPathHelper.makeIcon('connect', true);

		IconPathHelper.folder = IconPathHelper.makeIcon('folder');

		IconPathHelper.add = IconPathHelper.makeIcon('add', true);
		IconPathHelper.build = IconPathHelper.makeIcon('build', true);
		IconPathHelper.publish = IconPathHelper.makeIcon('publish', true);
		IconPathHelper.schemaCompare = IconPathHelper.makeIcon('schemaCompare', true);
		IconPathHelper.targetPlatform = IconPathHelper.makeIcon('targetPlatform', true);

		IconPathHelper.success = IconPathHelper.makeIcon('success', true);
		IconPathHelper.error = IconPathHelper.makeIcon('error', true);
		IconPathHelper.inProgress = IconPathHelper.makeIcon('inProgress', true);

		IconPathHelper.dashboardSqlProj = IconPathHelper.makeIcon('dashboardSqlProj', true);
	}

	private static makeIcon(name: string, sameIcon: boolean = false) {
		const folder = 'images';

		const toIconUri = (relativePath: string) => vscode.Uri.file(IconPathHelper.extensionContext.asAbsolutePath(relativePath));

		if (sameIcon) {
			const iconPath = `${folder}/${name}.svg`;
			return {
				dark: toIconUri(iconPath),
				light: toIconUri(iconPath)
			};
		}

		return {
			dark: toIconUri(`${folder}/dark/${name}.svg`),
			light: toIconUri(`${folder}/light/${name}.svg`)
		};
	}
}
