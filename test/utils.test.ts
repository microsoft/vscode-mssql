import { expect } from 'chai';
import * as Utils from './../src/models/utils';

suite('Utility Tests - parseTimeString', () => {
    test('should return false if nothing passed', () => {
        expect(Utils.parseTimeString(undefined)).to.equal(false);
        expect(Utils.parseTimeString('')).to.equal(false);
    });

    test('should return false if input does not have only 1 period', () => {
        expect(Utils.parseTimeString('32:13:23.12.1')).to.equal(false);
        expect(Utils.parseTimeString('12:32:33')).to.equal(false);
    });

    test('should return false if input does not have 2 :', () => {
        expect(Utils.parseTimeString('32.32')).to.equal(false);
        expect(Utils.parseTimeString('32:32:32:32.133')).to.equal(false);
    });

    test('returns the correct value', () => {
        expect(Utils.parseTimeString('2:13:30.0')).to.equal(8010000);
        expect(Utils.parseTimeString('0:0:0.220')).to.equal(220);
        expect(Utils.parseTimeString('0:0:0.0')).to.equal(0);
    });
});

suite('Utility Tests - parseNumAsTimeString', () => {
    test('returns the correct value', () => {
        expect(Utils.parseNumAsTimeString(8010000)).to.equal('02:13:30');
        expect(Utils.parseNumAsTimeString(220)).to.equal('00:00:00.220');
        expect(Utils.parseNumAsTimeString(0)).to.equal('00:00:00');
        expect(Utils.parseNumAsTimeString(5002)).to.equal('00:00:05.002');
    });
});
