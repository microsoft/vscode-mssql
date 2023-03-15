/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as LocalizedConstants from '../src/constants/localizedConstants';
import * as assert from 'assert';

suite('Localization Tests', () => {

	let resetLocalization = () => {
		LocalizedConstants.loadLocalizedConstants('en');
	};

	test('Default Localization Test', done => {
		assert.equal(LocalizedConstants.testLocalizationConstant, 'test');
		done();
	});

	test('EN Localization Test', done => {
		LocalizedConstants.loadLocalizedConstants('en');
		assert.equal(LocalizedConstants.testLocalizationConstant, 'test');
		done();
	});

	test('ES Localization Test', done => {
		LocalizedConstants.loadLocalizedConstants('es');
		assert.equal(LocalizedConstants.testLocalizationConstant, 'prueba');
		resetLocalization();
		done();
	});
});
