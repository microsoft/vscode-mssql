/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Extension from "../../src/extension";
import * as assert from "assert";

import MainController from "../../src/controllers/mainController";
import { activateExtension } from "./utils";
import ConnectionManager from "../../src/controllers/connectionManager";

suite("Initialization Tests", () => {
  test("Connection manager is initialized properly", async () => {
    await activateExtension();
    let controller: MainController = await Extension.getController();
    let connectionManager: ConnectionManager = controller.connectionManager;
    assert.notStrictEqual(undefined, connectionManager);
  });
});
