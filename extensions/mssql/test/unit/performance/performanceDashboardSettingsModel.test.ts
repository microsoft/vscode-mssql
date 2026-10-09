/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { QueryStoreSettings } from "../../../src/sharedInterfaces/performance";
import {
    changeOf,
    formOf,
    numberChoices,
    operationModeOf,
    storageUseOf,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardSettingsModel";

const settings: QueryStoreSettings = {
    actualState: "readWrite",
    desiredState: "readWrite",
    currentStorageMb: 246,
    maxStorageMb: 1024,
    intervalLengthMinutes: 15,
    staleQueryThresholdDays: 30,
    captureMode: "auto",
    sizeBasedCleanup: "auto",
    waitStatsCapture: "on",
};

suite("Performance dashboard settings", () => {
    test("offers the presets and the current value, in order", () => {
        expect(numberChoices([1024, 2048, 4096], 100)).to.deep.equal([100, 1024, 2048, 4096]);
        expect(numberChoices([14, 30, 60], 30)).to.deep.equal([14, 30, 60]);
        expect(numberChoices([5, 15, 60], undefined)).to.deep.equal([5, 15, 60]);
    });

    test("shows the operation mode of each state", () => {
        expect(operationModeOf({ ...settings, actualState: "off" })).to.equal("off");
        expect(operationModeOf({ ...settings, actualState: "readOnly" })).to.equal("readOnly");
        expect(operationModeOf({ ...settings, actualState: "error" })).to.equal("readWrite");
    });

    test("sends only the values that differ from the settings", () => {
        expect(changeOf(formOf(settings), settings)).to.deep.equal({});
        expect(
            changeOf(
                { ...formOf(settings), maxStorageMb: 2048, waitStatsCapture: "off" },
                settings,
            ),
        ).to.deep.equal({ maxStorageMb: 2048, waitStatsCapture: "off" });
    });

    test("turns Query Store on from the operation mode, and never sends off or custom", () => {
        const off = { ...settings, actualState: "off" as const };

        expect(changeOf({ ...formOf(off), operationMode: "readWrite" }, off)).to.deep.equal({
            operationMode: "readWrite",
        });
        expect(changeOf({ ...formOf(settings), operationMode: "off" }, settings)).to.deep.equal({});
        const custom = { ...settings, captureMode: "custom" as const };
        expect(changeOf(formOf(custom), custom)).to.deep.equal({});
        expect(changeOf({ ...formOf(custom), captureMode: "auto" }, custom)).to.deep.equal({
            captureMode: "auto",
        });
    });

    test("gives the storage use, with the cleanup mark when cleanup is on", () => {
        expect(storageUseOf(settings)).to.deep.equal({
            usedMb: 246,
            maxMb: 1024,
            percent: (246 / 1024) * 100,
            cleanupPercent: 90,
        });
        expect(storageUseOf({ ...settings, sizeBasedCleanup: "off" })?.cleanupPercent).to.be
            .undefined;
        expect(storageUseOf({ ...settings, currentStorageMb: 2000 })?.percent).to.equal(100);
        expect(storageUseOf({ ...settings, maxStorageMb: undefined })).to.be.undefined;
    });
});
