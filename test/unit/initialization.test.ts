/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Extension from "../../src/extension";
import * as assert from "assert";

import ConnectionManager from "../../src/controllers/connectionManager";
import MainController from "../../src/controllers/mainController";
import { activateExtension } from "./utils";

function ensureExtensionIsActive(): Promise<void> {
    return new Promise(async (resolve) => {
        await activateExtension();
        resolve();
    });
}

suite("Initialization Tests", () => {
    test("Connection manager is initialized properly", (done) => {
        // Wait for the extension to activate
        void ensureExtensionIsActive().then(async () => {
            // Verify that the connection manager was initialized properly
            let controller: MainController = await Extension.getController();
            let connectionManager: ConnectionManager =
                controller.connectionManager;
            assert.notStrictEqual(undefined, connectionManager.client);
            done();
        });
    });
});
