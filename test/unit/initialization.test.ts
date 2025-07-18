/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Extension from "../../src/extension";
import * as assert from "assert";

import MainController from "../../src/controllers/mainController";
import { activateExtension } from "./utils";

suite("Initialization Tests", () => {
    test("Connection manager is initialized properly", async () => {
        console.log("Starting test...");
        await activateExtension();
        console.log("Extension activated");

        let controller: MainController = await Extension.getController();
        console.log("Controller:", !!controller);
        console.log("Connection manager:", !!controller?.connectionManager);
        console.log("Client:", controller?.connectionManager?.client);

        // Add this check
        if (!controller) {
            throw new Error("Controller is undefined");
        }

        if (!controller.connectionManager) {
            throw new Error("ConnectionManager is undefined");
        }

        assert.notStrictEqual(undefined, controller.connectionManager);
    });
});
