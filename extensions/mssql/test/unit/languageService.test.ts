/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import { createHttpHeaders, HttpClient, IDownloadProgress } from "extension-toolkit/base";
import DecompressProvider from "../../src/languageservice/decompressProvider";
import { IPackage, IStatusView } from "../../src/languageservice/interfaces";
import DownloadHelper, { IDownloadProgressState } from "../../src/languageservice/downloadHelper";
import { stubILogger } from "./utils";

chai.use(sinonChai);

function createStubStatusView(): IStatusView {
    return {
        installingService: () => undefined,
        serviceInstalled: () => undefined,
        serviceInstallationFailed: () => undefined,
        updateServiceDownloadingProgress: (_downloadPercentage: number) => undefined,
    };
}

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

        test("downloadFile accepts descriptor zero", async () => {
            const downloadToFileDescriptor = sandbox
                .stub(HttpClient.prototype, "downloadToFileDescriptor")
                .resolves({
                    status: 200,
                    statusText: "OK",
                    ok: true,
                    headers: createHttpHeaders(),
                });
            const testPackage: IPackage = {
                url: "test_url",
                tmpFile: { name: "temp", fd: 0, removeCallback: () => undefined },
                isZipFile: true,
            };

            await downloadHelper.downloadFile(
                testPackage.url,
                testPackage,
                stubILogger(sandbox),
                createStubStatusView(),
            );

            expect(downloadToFileDescriptor).to.have.been.calledOnce;
            expect(downloadToFileDescriptor.firstCall.args[1]).to.equal(0);
        });

        test("downloadFile rejects when the temporary descriptor is missing", async () => {
            const testPackage: IPackage = {
                url: "test_url",
                tmpFile: { name: "temp", fd: undefined, removeCallback: () => undefined },
                isZipFile: true,
            } as unknown as IPackage;

            let thrownError: Error | undefined;
            try {
                await downloadHelper.downloadFile(
                    testPackage.url,
                    testPackage,
                    stubILogger(sandbox),
                    createStubStatusView(),
                );
            } catch (error) {
                thrownError = error as Error;
            }

            expect(thrownError?.message).to.equal("Temporary package file unavailable");
        });

        test("handleDownloadProgress test", () => {
            const mockProgress: IDownloadProgress = {
                totalBytes: 10,
                downloadedBytes: 5,
            };
            const progressState: IDownloadProgressState = {
                downloadPercentage: 0,
                dots: 0,
            };
            let testLogger = stubILogger(sandbox);
            downloadHelper.handleDownloadProgress(
                mockProgress,
                progressState,
                testLogger,
                createStubStatusView(),
            );
            expect(progressState.downloadPercentage).to.equal(50);
            expect(progressState.dots).to.equal(10);
        });
    });
});
