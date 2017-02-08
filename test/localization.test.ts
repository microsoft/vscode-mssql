'use strict';

import * as LocalizedConstants from '../src/constants/localizedConstants';
import assert = require('assert');

suite('Localization Tests', () => {

    test('Default Localization Test' , done => {
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_en');
        done();
    });

    test('EN Localization Test' , done => {
        LocalizedConstants.loadLocalizedConstants('en');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_en');
        done();
    });

    test('ES Localization Test' , done => {
        LocalizedConstants.loadLocalizedConstants('es');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_es');
        done();
    });
});
