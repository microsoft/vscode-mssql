/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as Extension from "../../src/extension";

import MainController from "../../src/controllers/mainController";
import { activateExtension } from "./utils";
import ConnectionManager from "../../src/controllers/connectionManager";

suite("Initialization Tests", () => {
    test("Connection manager is initialized properly", async () => {
        const sandbox = sinon.createSandbox();
        try {
            await activateExtension(sandbox);
            let controller: MainController = await Extension.getController();
            let connectionManager: ConnectionManager = controller.connectionManager;
            expect(connectionManager).to.not.be.undefined;
        } finally {
            sandbox.restore();
        }
    });
});
