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
        expect(openTaskStub).to.have.been.calledWithExactly("task-1");
    });
});
