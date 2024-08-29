/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare const assetPathVscodeUri: string;

export function loadImage(path: string): string {
	const loadPath =  assetPathVscodeUri + '/' + path;
	return loadPath;
}