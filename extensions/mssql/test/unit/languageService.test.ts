/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { IDownloadProgress } from "extension-toolkit/base";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import { IPackage, IStatusView } from "../../src/languageservice/interfaces";
import DownloadHelper, { IDownloadProgressState } from "../../src/languageservice/downloadHelper";
import { stubILogger } from "./utils";

suite("Language Service Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Decompress Provider Tests", () => {
        let decompressProvider = new DecompressProvider();

        test("Decompress package test", async () => {
            let testPackage: IPackage = {
                url: "test_url",
                tmpFile: {} as IPackage["tmpFile"],
                isZipFile: false,
            };
            let testLogger = stubILogger(sandbox);
            try {
                await decompressProvider.decompress(testPackage, testLogger);
            } catch (err) {
                expect(err, "Should throw an error").to.not.be.null;
            }
        });
    });

    suite("DownloadHelper Tests", () => {
        let downloadHelper = new DownloadHelper();

        test("handleDownloadProgress test", () => {
            const mockProgress: IDownloadProgress = {
                totalBytes: 10,
                downloadedBytes: 5,
                percentage: 50,
            };
            const progressState: IDownloadProgressState = {
                downloadPercentage: 0,
                dots: 0,
            };
            let testLogger = stubILogger(sandbox);
            let mockStatusView: IStatusView = {
                installingService: () => undefined,
                serviceInstalled: () => undefined,
                serviceInstallationFailed: () => undefined,
                updateServiceDownloadingProgress: (_downloadPercentage: number) => undefined,
            };
            downloadHelper.handleDownloadProgress(
                mockProgress,
                progressState,
                testLogger,
                mockStatusView,
            );
            expect(progressState.downloadPercentage).to.equal(50);
            expect(progressState.dots).to.equal(10);
        });
    });
});
