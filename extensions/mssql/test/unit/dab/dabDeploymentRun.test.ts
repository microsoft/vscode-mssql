/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { DabDeploymentRun, DabDeploymentRunHost } from "../../../src/dab/dabDeploymentRun";
import { Dab } from "../../../src/sharedInterfaces/dab";
import { ApiStatus } from "../../../src/sharedInterfaces/webview";

chai.use(sinonChai);

const Step = Dab.DabDeploymentStepOrder;
const params: Dab.DabDeploymentParams = { containerName: "DAB_db_1", port: 5000 };

suite("DabDeploymentRun", () => {
    let sandbox: sinon.SinonSandbox;
    let host: {
        prepare: sinon.SinonStub;
        runStep: sinon.SinonStub;
        cleanUp: sinon.SinonStub;
        cancelSignIn: sinon.SinonStub;
    };

    function createRun(): DabDeploymentRun {
        return new DabDeploymentRun(host as unknown as DabDeploymentRunHost, {
            target: Dab.DabDeploymentTarget.DabCli,
            stepOptions: { entraSignIn: true },
        });
    }

    /** Resolves once the run reaches a state the predicate accepts. */
    function waitFor(
        run: DabDeploymentRun,
        predicate: (state: Dab.DabDeploymentRunState) => boolean,
    ): Promise<Dab.DabDeploymentRunState> {
        if (predicate(run.state)) {
            return Promise.resolve(run.state);
        }
        return new Promise((resolve) => {
            const subscription = run.onDidChange((state) => {
                if (predicate(state)) {
                    subscription.dispose();
                    resolve(state);
                }
            });
        });
    }

    const statusOf = (state: Dab.DabDeploymentRunState, step: Dab.DabDeploymentStepOrder) =>
        state.stepStatuses.find((stepStatus) => stepStatus.step === step);

    setup(() => {
        sandbox = sinon.createSandbox();
        host = {
            prepare: sandbox.stub().resolves({ success: true, params }),
            runStep: sandbox.stub().resolves({ success: true }),
            cleanUp: sandbox.stub().resolves(),
            cancelSignIn: sandbox.stub(),
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("runs every step and picks the name and port before the deployment steps", async () => {
        host.runStep.withArgs(Step.acquireDabCli).resolves({ success: true, detail: "ready" });
        const run = createRun();

        run.start();
        const state = await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Succeeded);

        expect(state.stepStatuses.map((stepStatus) => stepStatus.step)).to.deep.equal([
            Step.acquireDabCli,
            Step.acquireAzureCli,
            Step.signInEntra,
            Step.startCliEngine,
            Step.checkCliEngine,
        ]);
        expect(state.stepStatuses.every((s) => s.status === ApiStatus.Loaded)).to.be.true;
        expect(statusOf(state, Step.acquireDabCli)?.detail).to.equal("ready");
        expect(state.params).to.deep.equal(params);
        expect(host.prepare).to.have.been.calledOnce;
        expect(host.prepare).to.have.been.calledAfter(
            host.runStep.withArgs(Step.signInEntra) as sinon.SinonSpy,
        );
        expect(host.runStep.withArgs(Step.startCliEngine)).to.have.been.calledWith(
            Step.startCliEngine,
            params,
        );
    });

    test("waits for the user at a prompt and continues with their answer", async () => {
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, undefined)
            .resolves({ success: false, prompt: { kind: "entraSignIn", account: "a@b.com" } });
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, Dab.DabDeploymentStepAction.SignIn)
            .resolves({ success: true, detail: "Signed in" });
        const run = createRun();

        run.start();
        const waiting = await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Waiting);
        expect(statusOf(waiting, Step.signInEntra)?.prompt).to.deep.equal({
            kind: "entraSignIn",
            account: "a@b.com",
        });

        run.respond(Step.signInEntra, Dab.DabDeploymentStepAction.SignIn);
        const state = await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Succeeded);
        expect(statusOf(state, Step.signInEntra)?.detail).to.equal("Signed in");
        expect(statusOf(state, Step.signInEntra)?.prompt).to.equal(undefined);
    });

    test("keeps a device code on screen while it waits for the user to enter it", async () => {
        const deviceCodePrompt: Dab.DabDeploymentStepPrompt = {
            kind: "entraDeviceCode",
            userCode: "CODE1234",
            verificationUri: "https://microsoft.com/devicelogin",
        };
        let finishSignIn: (response: Dab.RunDeploymentStepResponse) => void = () => {};
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, undefined)
            .resolves({ success: false, prompt: deviceCodePrompt });
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, Dab.DabDeploymentStepAction.AwaitSignIn)
            .returns(new Promise((resolve) => (finishSignIn = resolve)));
        const run = createRun();

        run.start();
        const showingCode = await waitFor(
            run,
            (s) => statusOf(s, Step.signInEntra)?.prompt?.kind === "entraDeviceCode",
        );
        expect(statusOf(showingCode, Step.signInEntra)?.action).to.equal(
            Dab.DabDeploymentStepAction.AwaitSignIn,
        );

        finishSignIn({ success: true });
        await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Succeeded);
    });

    test("switches a sign-in that is still running when the user asks for a code", async () => {
        let finishBrowserSignIn: (response: Dab.RunDeploymentStepResponse) => void = () => {};
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, undefined)
            .returns(new Promise((resolve) => (finishBrowserSignIn = resolve)));
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, Dab.DabDeploymentStepAction.SignInWithCode)
            .resolves({ success: true });
        host.cancelSignIn.callsFake(() =>
            finishBrowserSignIn({ success: false, error: "canceled" }),
        );
        const run = createRun();

        run.start();
        await waitFor(run, (s) => statusOf(s, Step.signInEntra)?.status === ApiStatus.Loading);
        run.respond(Step.signInEntra, Dab.DabDeploymentStepAction.SignInWithCode);

        const state = await waitFor(
            run,
            (s) =>
                s.status === Dab.DabDeploymentRunStatus.Succeeded ||
                s.status === Dab.DabDeploymentRunStatus.Failed,
        );
        expect(state.status).to.equal(Dab.DabDeploymentRunStatus.Succeeded);
        expect(host.cancelSignIn).to.have.been.calledOnce;
    });

    test("retries a failed deployment step after removing what it left behind", async () => {
        const checkEngine = host.runStep.withArgs(Step.checkCliEngine);
        checkEngine.resolves({ success: true });
        checkEngine
            .onFirstCall()
            .resolves({ success: false, error: "not ready", containerLogs: "logs" });
        const run = createRun();

        run.start();
        const failed = await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Failed);
        expect(statusOf(failed, Step.checkCliEngine)).to.include({
            status: ApiStatus.Error,
            message: "not ready",
            containerLogs: "logs",
        });

        await run.retry();
        await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Succeeded);

        expect(host.cleanUp).to.have.been.calledOnceWith(params);
        // The prerequisites already passed and were not run again.
        expect(host.runStep.withArgs(Step.acquireDabCli)).to.have.been.calledOnce;
        expect(host.runStep.withArgs(Step.startCliEngine)).to.have.been.calledTwice;
        expect(host.prepare).to.have.been.calledOnce;
    });

    test("cancels a run waiting for the user and stops its sign-in", async () => {
        host.runStep
            .withArgs(Step.signInEntra, sinon.match.any, undefined)
            .resolves({ success: false, prompt: { kind: "entraSignIn" } });
        const run = createRun();

        run.start();
        await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Waiting);
        await run.cancel();

        expect(run.state.status).to.equal(Dab.DabDeploymentRunStatus.Canceled);
        expect(run.isActive).to.be.false;
        expect(host.cancelSignIn).to.have.been.called;
        // Nothing was deployed yet, so there is nothing to remove.
        expect(host.cleanUp).to.not.have.been.called;
        expect(host.runStep.withArgs(Step.startCliEngine)).to.not.have.been.called;
    });

    test("removes what a step still running made once it finishes after a cancel", async () => {
        let finishStart!: (response: Dab.RunDeploymentStepResponse) => void;
        host.runStep
            .withArgs(Step.startCliEngine)
            .returns(new Promise((resolve) => (finishStart = resolve)));
        const run = createRun();

        run.start();
        await waitFor(
            run,
            (s) => statusOf(s, Step.startCliEngine)?.status === ApiStatus.Loading && !!s.params,
        );
        const canceled = run.cancel();
        await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Canceled);
        let isSettled = false;
        void run.whenSettled().then(() => (isSettled = true));
        await Promise.resolve();

        expect(host.cleanUp, "What exists is removed right away").to.have.been.calledOnce;
        expect(isSettled, "A replacement run must wait for the step").to.be.false;

        finishStart({ success: true });
        await canceled;

        expect(host.cleanUp, "The engine the step started is removed too").to.have.been.calledTwice;
        expect(isSettled).to.be.true;
        expect(run.state.status).to.equal(Dab.DabDeploymentRunStatus.Canceled);
        expect(host.runStep.withArgs(Step.checkCliEngine)).to.not.have.been.called;
    });

    test("keeps a run canceled when the cancel comes while a retry cleans up", async () => {
        host.runStep.withArgs(Step.checkCliEngine).resolves({ success: false, error: "not ready" });
        const run = createRun();
        run.start();
        await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Failed);

        let finishRetryCleanUp!: () => void;
        host.cleanUp
            .onFirstCall()
            .returns(new Promise<void>((resolve) => (finishRetryCleanUp = resolve)));
        const retried = run.retry();
        await run.cancel();
        finishRetryCleanUp();
        await retried;

        expect(run.state.status).to.equal(Dab.DabDeploymentRunStatus.Canceled);
        expect(
            host.runStep.withArgs(Step.startCliEngine),
            "The canceled deployment must not start again",
        ).to.have.been.calledOnce;
    });

    test("fails the first deployment step when no name and port can be picked", async () => {
        host.prepare.resolves({ success: false, error: "no free port" });
        const run = createRun();

        run.start();
        const failed = await waitFor(run, (s) => s.status === Dab.DabDeploymentRunStatus.Failed);

        expect(statusOf(failed, Step.startCliEngine)).to.include({
            status: ApiStatus.Error,
            message: "no free port",
        });
        expect(host.runStep.withArgs(Step.startCliEngine)).to.not.have.been.called;
    });
});
