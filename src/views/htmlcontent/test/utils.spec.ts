import * as Utils from './../src/js/utils';

describe('utils', () => {
    describe('parseTimeString', () => {
        it('should return false if nothing passed', () => {
            expect(Utils.parseTimeString(undefined)).toBe(false);
            expect(Utils.parseTimeString('')).toBe(false);
        });

        it('should return false if input does not have only 1 period', () => {
            expect(Utils.parseTimeString('32:13:23.12.1')).toBe(false);
            expect(Utils.parseTimeString('12:32:33')).toBe(false);
        });

        it('should return false if input does not have 2 :', () => {
            expect(Utils.parseTimeString('32.32')).toBe(false);
            expect(Utils.parseTimeString('32:32:32:32.133'));
        });

        it('returns the correct value', () => {
            expect(Utils.parseTimeString('2:13:30.0')).toEqual(8010000);
            expect(Utils.parseTimeString('0:0:0.220')).toEqual(220);
            expect(Utils.parseTimeString('0:0:0.0')).toEqual(0);
        });
    });

    describe('parseNumAsTimeString', () => {
        it('returns the correct value', () => {
            expect(Utils.parseNumAsTimeString(8010000)).toEqual('02:13:30');
            expect(Utils.parseNumAsTimeString(220)).toEqual('00:00:00.220');
            expect(Utils.parseNumAsTimeString(0)).toEqual('00:00:00');
            expect(Utils.parseNumAsTimeString(5002)).toEqual('00:00:05.002');
        });
    });
});
