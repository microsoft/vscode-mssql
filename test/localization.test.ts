'use strict';

import * as LocalizedConstants from '../src/constants/localizedConstants';
import assert = require('assert');

suite('Localization Tests', () => {

    test('Default Localiztion Test' , done => {
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_en');
        done();
    });

    test('EN Localiztion Test' , done => {
        LocalizedConstants.loadLocalizedConstants('en');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_en');
        done();
    });

    test('ES Localiztion Test' , done => {
        LocalizedConstants.loadLocalizedConstants('es');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test_es');
        done();
    });
});
