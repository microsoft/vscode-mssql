'use strict';

import * as LocalizedConstants from '../src/constants/localizedConstants';
import assert = require('assert');

suite('Localization Tests', () => {

    let resetLocalization = () => {
        LocalizedConstants.loadLocalizedConstants('en');
    };

    test('Default Localization Test' , done => {
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test');
        done();
    });

    test('EN Localization Test' , done => {
        LocalizedConstants.loadLocalizedConstants('en');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'test');
        done();
    });

    test('ES Localization Test' , done => {
        LocalizedConstants.loadLocalizedConstants('es');
        assert.equal(LocalizedConstants.testLocalizationConstant, 'prueba');
        resetLocalization();
        done();
    });
});
