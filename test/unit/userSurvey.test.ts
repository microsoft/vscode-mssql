/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import * as assert from "assert";
import { UserSurvey } from "../../src/nps/userSurvey";

suite("UserSurvey Tests", () => {
    let sandbox;
    let globalState;
    let context;
    let showInformationMessageStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalState = {
            get: sandbox.stub(),
            update: sandbox.stub(),
        };

        context = {
            globalState: globalState,
            extensionUri: vscode.Uri.file("test"),
        };

        showInformationMessageStub = sandbox.stub(
            vscode.window,
            "showInformationMessage",
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should create and return the same UserSurvey instance", () => {
        UserSurvey.createInstance(context);
        const instance = UserSurvey.getInstance();
        assert.strictEqual(instance, UserSurvey.getInstance());
    });

    test("Should not prompt use if skip version is set", async () => {
        sinon.stub(vscode.extensions, "getExtension").returns({
            packageJSON: {
                version: "someVersion",
            },
        } as any);
        globalState.get.withArgs("nps/skipVersion", "").returns("someVersion");
        UserSurvey.createInstance(context);
        const instance = UserSurvey.getInstance();
        await instance.promptUserForNPSFeedback();
        sinon.assert.notCalled(showInformationMessageStub);
    });
});
