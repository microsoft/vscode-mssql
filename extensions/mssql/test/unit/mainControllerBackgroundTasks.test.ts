/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";
import {
    BackgroundTaskHandle,
    BackgroundTasksService,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);

suite("MainController Background Tasks Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("background task action opens only on double click", async () => {
        const context = stubExtensionContext(sandbox);
        const vscodeWrapper = stubVscodeWrapper(sandbox) as unknown as VscodeWrapper;
        const controller = new MainController(context, undefined, vscodeWrapper);
        const openTaskStub = sandbox.stub().resolves();

        (controller as any)._backgroundTasksProvider = {
            openTask: openTaskStub,
        };

        const nowStub = sandbox.stub(Date, "now");
        nowStub.onCall(0).returns(1000);
        nowStub.onCall(1).returns(1300);

        await (controller as any).handleBackgroundTaskNodeAction({ taskId: "task-1" });
        expect(openTaskStub).to.not.have.been.called;

        await (controller as any).handleBackgroundTaskNodeAction({ taskId: "task-1" });
        expect(openTaskStub).to.have.been.calledOnceWithExactly("task-1");
    });

    test("background task test command drives a task to completion", async () => {
        const clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });
        const context = stubExtensionContext(sandbox);
        const vscodeWrapper = stubVscodeWrapper(sandbox);
        const controller = new MainController(context, undefined, vscodeWrapper);
        const handle = {
            id: "demo-task",
            update: sandbox.stub(),
            complete: sandbox.stub(),
            remove: sandbox.stub(),
        } as unknown as BackgroundTaskHandle;
        const backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);

        backgroundTasksService.registerTask.returns(handle);
        controller.backgroundTasksService =
            backgroundTasksService as unknown as BackgroundTasksService;

        await (controller as any).startBackgroundTaskTest();

        const registration = backgroundTasksService.registerTask.firstCall.args[0];
        expect(registration.displayText).to.contain("Background Task Demo");
        expect(registration.canCancel).to.equal(true);
        expect(registration.percent).to.equal(0);
        expect(registration.open).to.be.a("function");

        await registration.open();
        expect(vscodeWrapper.showInformationMessage).to.have.been.calledOnce;

        await clock.tickAsync(10000);

        expect((handle.update as sinon.SinonStub).callCount).to.be.greaterThan(1);
        expect(handle.complete).to.have.been.calledOnce;
        expect((handle.complete as sinon.SinonStub).firstCall.args[0]).to.equal(
            BackgroundTaskState.Succeeded,
        );
    });

    test("background task test command supports cancellation", async () => {
        const context = stubExtensionContext(sandbox);
        const vscodeWrapper = stubVscodeWrapper(sandbox);
        const controller = new MainController(context, undefined, vscodeWrapper);
        const handle = {
            id: "demo-task",
            update: sandbox.stub(),
            complete: sandbox.stub(),
            remove: sandbox.stub(),
        } as unknown as BackgroundTaskHandle;
        const backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);

        backgroundTasksService.registerTask.returns(handle);
        controller.backgroundTasksService =
            backgroundTasksService as unknown as BackgroundTasksService;

        await (controller as any).startBackgroundTaskTest();

        const registration = backgroundTasksService.registerTask.firstCall.args[0];
        await registration.cancel();

        expect(handle.complete).to.have.been.calledOnce;
        expect((handle.complete as sinon.SinonStub).firstCall.args[0]).to.equal(
            BackgroundTaskState.Canceled,
        );
        expect(vscodeWrapper.showWarningMessage).to.have.been.calledOnce;
    });

    test("failed background task test command drives a task to failure", async () => {
        const clock = sandbox.useFakeTimers({ shouldClearNativeTimers: true });
        const context = stubExtensionContext(sandbox);
        const vscodeWrapper = stubVscodeWrapper(sandbox);
        const controller = new MainController(context, undefined, vscodeWrapper);
        const handle = {
            id: "demo-task",
            update: sandbox.stub(),
            complete: sandbox.stub(),
            remove: sandbox.stub(),
        } as unknown as BackgroundTaskHandle;
        const backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);

        backgroundTasksService.registerTask.returns(handle);
        controller.backgroundTasksService =
            backgroundTasksService as unknown as BackgroundTasksService;

        await (controller as any).startFailedBackgroundTaskTest();

        const registration = backgroundTasksService.registerTask.firstCall.args[0];
        expect(registration.displayText).to.contain("Background Task Failure Demo");
        expect(registration.canCancel).to.equal(true);
        expect(registration.percent).to.equal(0);

        await clock.tickAsync(10000);

        expect((handle.update as sinon.SinonStub).callCount).to.be.greaterThan(1);
        expect(handle.complete).to.have.been.calledOnce;
        expect((handle.complete as sinon.SinonStub).firstCall.args[0]).to.equal(
            BackgroundTaskState.Failed,
        );
        expect(vscodeWrapper.showErrorMessage).to.have.been.calledOnce;
    });
});
