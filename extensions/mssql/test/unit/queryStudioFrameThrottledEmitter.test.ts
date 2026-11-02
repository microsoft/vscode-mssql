/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    FrameThrottledEmitter,
    type AnimationFrameScheduler,
} from "../../src/webviews/pages/QueryStudio/frameThrottledEmitter";

suite("Query Studio frame-throttled emitter", () => {
    let sandbox: sinon.SinonSandbox;
    let callbacks: Map<number, FrameRequestCallback>;
    let nextHandle: number;
    let request: sinon.SinonStub;
    let cancel: sinon.SinonStub;
    let scheduler: AnimationFrameScheduler;

    setup(() => {
        sandbox = sinon.createSandbox();
        callbacks = new Map();
        nextHandle = 1;
        request = sandbox.stub().callsFake((callback: FrameRequestCallback) => {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            return handle;
        });
        cancel = sandbox.stub().callsFake((handle: number) => callbacks.delete(handle));
        scheduler = { request, cancel };
    });

    teardown(() => sandbox.restore());

    function runFrame(timestamp: number): void {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        for (const [, callback] of pending) {
            callback(timestamp);
        }
    }

    test("emits the latest initial value on the next frame", () => {
        const emit = sandbox.stub();
        const throttle = new FrameThrottledEmitter(emit, 200, scheduler);

        throttle.update("first");
        throttle.update("latest");
        expect(request).to.have.been.calledOnce;
        expect(emit).not.to.have.been.called;

        runFrame(10);
        expect(emit).to.have.been.calledOnceWithExactly("latest");
    });

    test("caps sustained updates and preserves the trailing value", () => {
        const emit = sandbox.stub();
        const throttle = new FrameThrottledEmitter(emit, 200, scheduler);

        throttle.update("initial");
        runFrame(0);
        throttle.update("intermediate");
        runFrame(50);
        throttle.update("trailing");
        runFrame(199);
        expect(emit).to.have.been.calledOnceWithExactly("initial");

        runFrame(200);
        expect(emit).to.have.been.calledWith("trailing");
        expect(emit).to.have.been.calledTwice;
    });

    test("clear cancels pending work and permits a fresh leading update", () => {
        const emit = sandbox.stub();
        const throttle = new FrameThrottledEmitter(emit, 200, scheduler);

        throttle.update("discarded");
        throttle.clear();
        expect(cancel).to.have.been.calledOnce;
        runFrame(500);
        expect(emit).not.to.have.been.called;

        throttle.update("fresh");
        runFrame(501);
        expect(emit).to.have.been.calledOnceWithExactly("fresh");
    });
});
