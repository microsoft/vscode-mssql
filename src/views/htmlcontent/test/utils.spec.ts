import * as Utils from './../src/js/utils';

describe('Utility Tests', () => {
    describe('IsNumber', () => {
        it('Returns Correct Value', () => {
            expect(Utils.isNumber(0)).toBe(true);
            expect(Utils.isNumber(1)).toBe(true);
            expect(Utils.isNumber(false)).toBe(false);
            expect(Utils.isNumber(null)).toBe(false);   // tslint:disable-line
            expect(Utils.isNumber(undefined)).toBe(false);
        });
    });
});
