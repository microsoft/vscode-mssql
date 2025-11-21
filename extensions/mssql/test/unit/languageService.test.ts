/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import DecompressProvider from "../../src/languageservice/decompressProvider";
import { IPackage, IStatusView } from "../../src/languageservice/interfaces";
import { ILogger } from "../../src/models/interfaces";
import { assert } from "chai";
import HttpClient, {
  IDownloadProgress,
} from "../../src/languageservice/httpClient";

suite("Language Service Tests", () => {
  suite("Decompress Provider Tests", () => {
    let decompressProvider = new DecompressProvider();

    test("Decompress package test", async () => {
      let testPackage: IPackage = {
        url: "test_url",
        tmpFile: undefined,
        isZipFile: false,
      };
      let testLogger: ILogger = {
        logDebug: undefined,
        increaseIndent: undefined,
        decreaseIndent: undefined,
        append: undefined,
        appendLine: undefined,
      };
      try {
        await decompressProvider.decompress(testPackage, testLogger);
      } catch (err) {
        assert.isNotNull(err, "Should throw an error");
      }
    });
  });

  suite("HttpClient Tests", () => {
    let httpClient = new HttpClient();

    test("handleDataReceivedEvent test", () => {
      let mockProgress: IDownloadProgress = {
        packageSize: 10,
        downloadedBytes: 0,
        downloadPercentage: 0,
        dots: 0,
      };
      let testLogger: ILogger = {
        logDebug: () => undefined,
        increaseIndent: () => undefined,
        decreaseIndent: () => undefined,
        append: () => undefined,
        appendLine: () => undefined,
      };
      let mockStatusView: IStatusView = {
        installingService: () => undefined,
        serviceInstalled: () => undefined,
        serviceInstallationFailed: () => undefined,
        updateServiceDownloadingProgress: (downloadPercentage: number) =>
          undefined,
      };
      httpClient.handleDataReceivedEvent(
        mockProgress,
        [1, 2, 3, 4, 5],
        testLogger,
        mockStatusView,
      );
      assert.strictEqual(mockProgress.downloadPercentage, 50);
      assert.strictEqual(mockProgress.downloadedBytes, 5);
      assert.strictEqual(mockProgress.dots, 10);
    });
  });
});
