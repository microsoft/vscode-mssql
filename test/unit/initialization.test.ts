/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Extension from "../../src/extension/extension";
import * as assert from "assert";

import ConnectionManager from "../../src/extension/controllers/connectionManager";
import MainController from "../../src/extension/controllers/mainController";
import { activateExtension } from "./utils";

suite("Initialization Tests", () => {
    test("Connection manager is initialized properly", async () => {
        await activateExtension();
        let controller: MainController = await Extension.getController();
        let connectionManager: ConnectionManager = controller.connectionManager;
        assert.notStrictEqual(undefined, connectionManager.client);
    });
});
