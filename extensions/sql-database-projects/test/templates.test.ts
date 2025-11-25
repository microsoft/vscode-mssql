/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require('should/as-function');
import * as templates from '../src/templates/templates';
import { shouldThrowSpecificError, getTemplatesRootPath } from './testUtils';

const templatesPath = getTemplatesRootPath();

suite('Templates: loading templates from disk', function (): void {
	setup(() => {
		templates.reset();
	});

	test('Should throw error when attempting to use templates before loaded from file', async function (): Promise<void> {
		await shouldThrowSpecificError(() => templates.get('foobar'), 'Templates must be loaded from file before attempting to use.');
		await shouldThrowSpecificError(() => templates.get('foobar'), 'Templates must be loaded from file before attempting to use.');
	});

	test('Should load all templates from files', async function (): Promise<void> {
		await templates.loadTemplates(templatesPath);

		// check expected counts

		const numScriptObjectTypes = 12;

		should(templates.projectScriptTypes().length).equal(numScriptObjectTypes);
		should(Object.keys(templates.projectScriptTypes()).length).equal(numScriptObjectTypes);

		// check everything has a value

		should(templates.newSqlProjectTemplate).not.equal(undefined);

		for (const obj of templates.projectScriptTypes()) {
			should(obj.templateScript).not.equal(undefined);
		}
	});
});


