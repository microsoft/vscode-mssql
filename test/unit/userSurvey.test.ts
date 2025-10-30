/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as locConstants from "../../src/constants/locConstants";
import * as sinon from "sinon";
import * as vscode from "vscode";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";

import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";

import {
    FunnelSteps,
    NEVER_KEY,
    SKIP_VERSION_KEY,
    UserSurvey,
    UserSurveyWebviewController,
} from "../../src/nps/userSurvey";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import { setTimeout } from "timers/promises";

chai.use(sinonChai);

suite("UserSurvey Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let globalState;
    let context: vscode.ExtensionContext;
    let showInformationMessageStub: sinon.SinonStub;
    let sendActionEvent: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalState = {
            get: sandbox.stub(),
            update: sandbox.stub(),
        };

        const vscodeWrapper = stubVscodeWrapper(sandbox);

        context = {
            globalState: globalState,
            extensionUri: vscode.Uri.file(testSurveySource),
        } as vscode.ExtensionContext;

        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        UserSurvey.createInstance(context, vscodeWrapper);

        ({ sendActionEvent } = stubTelemetry(sandbox));
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should create and return the same UserSurvey instance", () => {
        const instance = UserSurvey.getInstance();
        assert.strictEqual(instance, UserSurvey.getInstance());
    });

    test("Should call promptUserForNPSFeedbackAsync when promptUserForNpsFeedback is called", async () => {
        const userSurvey = UserSurvey.getInstance();
        const promptUserForNPSFeedbackAsyncStub = sandbox.stub(
            userSurvey as any,
            "promptUserForNPSFeedbackAsync",
        );

        promptUserForNPSFeedbackAsyncStub.resolves();

        userSurvey.promptUserForNPSFeedback(testSurveySource);

        await setTimeout(500); // Wait for the async call to complete

        assert.strictEqual(
            promptUserForNPSFeedbackAsyncStub.calledOnce,
            true,
            "promptUserForNPSFeedbackAsync should be called once",
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
        await (userSurvey as any).promptUserForNPSFeedbackAsync();
        assert.strictEqual(
            showInformationMessageStub.calledOnce,
            true,
            "showInformationMessage should be called",
        );
    });

    test("should update global state and send telemetry after survey submission", async () => {
        globalState.get.withArgs("nps/isCandidate").returns(true);
        showInformationMessageStub.callsFake(
            async (_text, takeButton, _laterButton, _neverButton) => {
                return takeButton;
            },
        );

        const userSurvey = UserSurvey.getInstance();
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

        userSurvey["_webviewController"] =
            mockWebviewController as undefined as UserSurveyWebviewController;

        await userSurvey["promptUserForNPSFeedbackAsync"]("testSource");

        assert.strictEqual(
            mockWebviewController.revealToForeground.calledOnce,
            true,
            "revealToForeground should have been called",
        );

        assert.strictEqual(sendActionEvent.called, true, "sendActionEvent should be called");

        assert.strictEqual(
            sendActionEvent.calledWith(
                TelemetryViews.UserSurvey,
                TelemetryActions.SurveySubmit,
                {
                    surveyId: "nps",
                    q1: "answer1",
                    q2: "answer2",
                    modernFeaturesEnabled: true,
                    source: "testSource",
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

        await (userSurvey as any).promptUserForNPSFeedbackAsync();

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

        await (userSurvey as any).promptUserForNPSFeedbackAsync();

        assert.strictEqual(
            globalState.update.calledWith(NEVER_KEY, true),
            true,
            "should set never key",
        );
    });

    test("Should open survey directly without checking eligibility with launchSurvey()", async () => {
        const userSurvey = UserSurvey.getInstance();

        const eligibilitySpy = sandbox.spy(globalState.get);
        const launchStub = sandbox
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .stub(userSurvey as any, "launchSurveyAsync")
            .returns(Promise.resolve());

        userSurvey.launchSurvey("nps", { questions: [] }, "testSource");

        await setTimeout(500); // Wait for the async call to complete

        expect(launchStub).to.have.been.calledOnce;

        // Verify that no eligibility checks were performed
        expect(eligibilitySpy).to.not.have.been.calledWith("nps/never");
    });

    suite("Eligibility checks", () => {
        test("should not prompt the user if they opted out of the survey", async () => {
            globalState.get.withArgs(NEVER_KEY, false).returns(true);

            const userSurvey = UserSurvey.getInstance();
            const result = await userSurvey["shouldPromptForFeedback"](testSurveySource);

            expect(result, `should not be eligible when '${NEVER_KEY}' is true`).to.be.false;
            expect(
                sendActionEvent,
                "Survey funnel telemetry should be emitted",
            ).to.have.been.calledWith(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_optedOut",
                source: testSurveySource,
            });
        });

        test("Should not prompt user if skip version is set", async () => {
            const testCurrentVersion = "1.skip.me";

            sinon.stub(vscode.extensions, "getExtension").returns({
                packageJSON: {
                    version: testCurrentVersion,
                },
            } as vscode.Extension<unknown>);
            globalState.get.withArgs(SKIP_VERSION_KEY, "").returns(testCurrentVersion);

            const userSurvey = UserSurvey.getInstance();
            const result = await userSurvey["shouldPromptForFeedback"](testSurveySource);

            expect(result, "should not be eligible when skip version matches current version").to.be
                .false;
            expect(
                sendActionEvent,
                "Survey funnel telemetry should be emitted",
            ).to.have.been.calledWith(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_skipVersion",
                source: testSurveySource,
            });
        });

        test("Should not prompt if user was already considered today", async () => {
            // Simulate that the user was already considered today
            globalState.get.withArgs(NEVER_KEY, false).returns(false);
            globalState.get.withArgs(SKIP_VERSION_KEY, "").returns("");
            globalState.get.withArgs("nps/lastSessionDate").returns(new Date().toDateString());
            globalState.get.withArgs("nps/sessionCount").returns(999); // high enough to be eligible
            globalState.get.withArgs("nps/isCandidate").returns(true);

            const userSurvey = UserSurvey.getInstance();
            const result = await userSurvey["shouldPromptForFeedback"](testSurveySource);

            expect(result, "should not be eligible when user was already considered today").to.be
                .false;
            expect(
                sendActionEvent,
                "Survey funnel telemetry should be emitted",
            ).to.have.been.calledWith(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_alreadyConsidered",
                source: testSurveySource,
            });
        });

        test("Should not prompt if user has not used the extension enough", async () => {
            globalState.get.withArgs(NEVER_KEY, false).returns(false);
            globalState.get.withArgs(SKIP_VERSION_KEY, "").returns("");
            globalState.get.withArgs("nps/lastSessionDate").returns("01/01/2023"); // not today
            globalState.get.withArgs("nps/sessionCount").returns(1); // below threshold
            globalState.get.withArgs("nps/isCandidate").returns(true);

            const userSurvey = UserSurvey.getInstance();
            const result = await userSurvey["shouldPromptForFeedback"](testSurveySource);

            expect(result, "should not be eligible when sessionCount is below threshold").to.be
                .false;
            expect(
                sendActionEvent,
                "Survey funnel telemetry should be emitted",
            ).to.have.been.calledWith(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_notEnoughSessions",
                source: testSurveySource,
            });
        });

        test("Should not prompt if user is not selected by die roll", async () => {
            // Simulate failing the random selection (not a candidate)
            globalState.get.withArgs(NEVER_KEY, false).returns(false);
            globalState.get.withArgs(SKIP_VERSION_KEY, "").returns("");
            globalState.get.withArgs("nps/lastSessionDate").returns("01/01/2023"); // not today
            globalState.get.withArgs("nps/sessionCount").returns(999); // high enough to be eligible
            globalState.get.withArgs("nps/isCandidate").returns(false); // not selected by die roll

            const userSurvey = UserSurvey.getInstance();
            const result = await userSurvey["shouldPromptForFeedback"](testSurveySource);

            expect(
                result,
                "showInformationMessage should not be called when user is not selected by die roll",
            ).to.be.false;
            expect(
                sendActionEvent,
                "Survey funnel telemetry should be emitted",
            ).to.have.been.calledWith(TelemetryViews.UserSurvey, TelemetryActions.SurveyFunnel, {
                step: FunnelSteps.EligibilityCheck,
                outcome: "exit_notSelectedAsCandidate",
                source: testSurveySource,
            });
        });
    });
});

const testSurveySource = "testSurveySource";
