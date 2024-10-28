/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../../src/constants/constants";
import * as sinon from "sinon";
import * as telemetry from "../../src/telemetry/telemetry";
import * as vscode from "vscode";

// Launches and activates the extension.
export async function activateExtension() {
    const extension = vscode.extensions.getExtension(constants.extensionId);
    await extension.activate();
}

// Stubs the telemetry code
export function stubTelemetry(sandbox?: sinon.SinonSandbox): {
    sendActionEvent: sinon.SinonStub;
    sendErrorEvent: sinon.SinonStub;
} {
    if (sandbox) {
        return {
            sendActionEvent: sandbox
                .stub(telemetry, "sendActionEvent")
                .callsFake(() => {}),
            sendErrorEvent: sandbox
                .stub(telemetry, "sendErrorEvent")
                .callsFake(() => {}),
        };
    } else {
        return {
            sendActionEvent: sinon
                .stub(telemetry, "sendActionEvent")
                .callsFake(() => {}),
            sendErrorEvent: sinon
                .stub(telemetry, "sendErrorEvent")
                .callsFake(() => {}),
        };
    }
}
