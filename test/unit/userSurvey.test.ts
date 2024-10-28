/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as locConstants from "../../src/constants/locConstants";
import * as sinon from "sinon";
import * as vscode from "vscode";

import {
    TelemetryActions,
    TelemetryViews,
} from "../../src/sharedInterfaces/telemetry";

import { UserSurvey } from "../../src/nps/userSurvey";
import { stubTelemetry } from "./utils";

suite("UserSurvey Tests", () => {
    let sandbox;
    let globalState;
    let context;
    let showInformationMessageStub: sinon.SinonStub;

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
        UserSurvey.createInstance(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should create and return the same UserSurvey instance", () => {
        const instance = UserSurvey.getInstance();
        assert.strictEqual(instance, UserSurvey.getInstance());
    });

    test("should not prompt the user if they opted out of the survey", async () => {
        globalState.get.withArgs("nps/never", false).returns(true);
        const instance = UserSurvey.getInstance();
        await instance.promptUserForNPSFeedback();
        assert.strictEqual(
            (globalState.get as sinon.SinonStub).calledWith("nps/never", false),
            true,
            "globalState.get should be called with 'nps/never' and false",
        );
        assert.strictEqual(
            showInformationMessageStub.called,
            false,
            "showInformationMessage should not be called",
        );
    });

    test("Should not prompt use if skip version is set", async () => {
        sinon.stub(vscode.extensions, "getExtension").returns({
            packageJSON: {
                version: "someVersion",
            },
        } as any);
        globalState.get.withArgs("nps/skipVersion", "").returns("someVersion");
        const instance = UserSurvey.getInstance();
        await instance.promptUserForNPSFeedback();
        assert.strictEqual(
            showInformationMessageStub.called,
            false,
            "showInformationMessage should not be called",
        );
    });

    test("should prompt for feedback after session count reaches threshold", async () => {
        globalState.get.withArgs("nps/never").returns(false);
        globalState.get.withArgs("nps/skipVersion").returns("");
        globalState.get.withArgs("nps/lastSessionDate").returns("01/01/2023");
        globalState.get.withArgs("nps/sessionCount").returns(5);
        globalState.get.withArgs("nps/isCandidate").returns(true);

        showInformationMessageStub.resolves({
            title: locConstants.UserSurvey.takeSurvey,
            run: sandbox.stub(),
        });
        const userSurvey = UserSurvey.getInstance();
        await userSurvey.promptUserForNPSFeedback();
        assert.strictEqual(
            showInformationMessageStub.calledOnce,
            true,
            "showInformationMessage should be called",
        );
    });

    test("should update global state and send telemetry after survey submission", async () => {
        const { sendActionEvent } = stubTelemetry(sandbox);

        globalState.get.withArgs("nps/isCandidate").returns(true);
        showInformationMessageStub.callsFake(
            async (_text, takeButton, _laterButton, _neverButton) => {
                return takeButton;
            },
        );

        const userSurvey = UserSurvey.getInstance();
        sandbox.stub(userSurvey, "launchSurvey").resolves();
        const onSubmitStub = sandbox.stub();
        const onCancelStub = sandbox.stub();
        // Mock the webview controller
        const mockWebviewController = {
            revealToForeground: sandbox.stub(),
            updateState: sandbox.stub(),
            isDisposed: false,
            onSubmit: onSubmitStub,
            onCancel: onCancelStub,
        };

        // Use callsFake to simulate onSubmit getting triggered when it's called
        onSubmitStub.callsFake((callback) => {
            callback({
                q1: "answer1",
                q2: "answer2",
                q3: 3,
            }); // Simulate submitting empty answers
        });

        (userSurvey as any)._webviewController = mockWebviewController;

        await userSurvey.promptUserForNPSFeedback();

        assert.strictEqual(
            mockWebviewController.revealToForeground.calledOnce,
            true,
            "launchSurvey should be called",
        );

        assert.strictEqual(
            sendActionEvent.calledOnce,
            true,
            "sendActionEvent should be called",
        );

        assert.strictEqual(
            sendActionEvent.calledWith(
                TelemetryViews.UserSurvey,
                TelemetryActions.SurveySubmit,
                {
                    surveyId: "nps",
                    q1: "answer1",
                    q2: "answer2",
                },
                {
                    q3: 3,
                },
            ),
            true,
            "sendActionEvent should be called with correct arguments",
        );
    });

    test('Should reduce session count when user clicks "Later"', async () => {
        globalState.get.withArgs("nps/isCandidate").returns(true);
        globalState.get.withArgs("nps/sessionCount").returns(5);

        showInformationMessageStub.callsFake(
            async (_text, takeButton, _laterButton, _neverButton) => {
                return _laterButton;
            },
        );

        const userSurvey = UserSurvey.getInstance();
        sandbox.stub(userSurvey, "launchSurvey").resolves();

        await userSurvey.promptUserForNPSFeedback();

        assert.strictEqual(
            globalState.update.calledWith("nps/sessionCount", 3),
            true,
            "session count should be decremented",
        );
    });

    test("Should set never key when user clicks 'Never'", async () => {
        globalState.get.withArgs("nps/isCandidate").returns(true);
        showInformationMessageStub.callsFake(
            async (_text, takeButton, _laterButton, neverButton) => {
                return neverButton;
            },
        );

        const userSurvey = UserSurvey.getInstance();
        sandbox.stub(userSurvey, "launchSurvey").resolves();

        await userSurvey.promptUserForNPSFeedback();

        assert.strictEqual(
            globalState.update.calledWith("nps/never", true),
            true,
            "should set never key",
        );
    });
});
