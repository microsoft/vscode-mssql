import assert = require('assert');
import {Platform, getCurrentPlatform} from '../src/models/platform';
import Telemetry from '../src/models/telemetry';

function getPlatform(): Promise<Platform> {
    return new Promise((resolve, reject) => {
        let platform = getCurrentPlatform();
        resolve(platform);
    });
}

suite('Platform Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('getCurrentPlatform should return valid value', (done) => {
        getPlatform().then(platform => {
            assert.notEqual(platform, Platform.Unknown);
            done();
        });
    });
});
