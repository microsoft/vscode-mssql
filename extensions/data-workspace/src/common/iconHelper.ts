/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export interface IconPath {
    dark: string;
    light: string;
}

export class IconPathHelper {
    private static _extensionContext: vscode.ExtensionContext;
    public static folder: IconPath;
    public static refresh: IconPath;

    public static setExtensionContext(extensionContext: vscode.ExtensionContext) {
        IconPathHelper._extensionContext = extensionContext;

        IconPathHelper.folder = IconPathHelper.makeIcon("folder", true);
        IconPathHelper.refresh = IconPathHelper.makeIcon("refresh", true);
    }

    private static makeIcon(name: string, sameIcon: boolean = false) {
        const folder = "images";

        if (sameIcon) {
            return {
                dark: IconPathHelper._extensionContext.asAbsolutePath(`${folder}/${name}.svg`),
                light: IconPathHelper._extensionContext.asAbsolutePath(`${folder}/${name}.svg`),
            };
        } else {
            return {
                dark: IconPathHelper._extensionContext.asAbsolutePath(`${folder}/dark/${name}.svg`),
                light: IconPathHelper._extensionContext.asAbsolutePath(
                    `${folder}/light/${name}.svg`,
                ),
            };
        }
    }
}
