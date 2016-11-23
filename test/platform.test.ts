import assert = require('assert');
import {Runtime, PlatformInformation} from '../src/models/platform';
import Telemetry from '../src/models/telemetry';

function getPlatform(): Promise<Runtime> {
    return PlatformInformation.GetCurrent().then (platformInfo => {
        return platformInfo.runtimeId;
    });
}

suite('Platform Tests', () => {
    setup(() => {
        // Ensure that telemetry is disabled while testing
        Telemetry.disable();
    });

    test('getCurrentPlatform should return valid value', (done) => {
        getPlatform().then(platform => {
            assert.notEqual(platform, Runtime.UnknownRuntime);
            done();
        });
    });
});
