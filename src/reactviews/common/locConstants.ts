/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export interface locKeys {
	GENERATE_SCRIPT: string;
	SCRIPT_AS_CREATE: string;
};

export function getLocString(key: keyof locKeys): string {
	const locStrings: locKeys = {
		// Table Designer
		GENERATE_SCRIPT: l10n.t('Generate Script'),
		SCRIPT_AS_CREATE: l10n.t('Script As Create')
	};
	return locStrings[key];
}