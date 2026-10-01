/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    EndLiveExecutionPlanRequest,
    GetLiveExecutionPlanRequest,
} from "../../src/models/contracts/executionPlan";
import {
    LiveQueryStatisticsCallbacks,
    LiveQueryStatisticsMonitor,
} from "../../src/queryResult/liveQueryStatistics";
import { ExecutionPlanGraph } from "../../src/sharedInterfaces/executionPlan";

chai.use(sinonChai);
const { expect } = chai;

suite("LiveQueryStatisticsMonitor", () => {
    const graph = { query: "select 1" } as ExecutionPlanGraph;
    let sandbox: sinon.SinonSandbox;
    let sendRequest: sinon.SinonStub;
    let callbacks: { onPlans: sinon.SinonStub; onError: sinon.SinonStub };

    setup(() => {
        sandbox = sinon.createSandbox();
        sendRequest = sandbox.stub();
        sendRequest.withArgs(EndLiveExecutionPlanRequest.type, sinon.match.any).resolves(true);
        callbacks = { onPlans: sandbox.stub(), onError: sandbox.stub() };
    });

    teardown(() => {
        sandbox.restore();
    });

    function stubReads(): sinon.SinonStub {
        return sendRequest.withArgs(GetLiveExecutionPlanRequest.type, sinon.match.any);
    }

    function requestsOf(type: unknown): sinon.SinonSpyCall[] {
        return sendRequest.getCalls().filter((call) => call.args[0] === type);
    }

    function createMonitor(): LiveQueryStatisticsMonitor {
        return new LiveQueryStatisticsMonitor(
            "test_uri",
            57,
            callbacks as LiveQueryStatisticsCallbacks,
            { sendRequest } as unknown as SqlToolsServiceClient,
            1,
        );
    }

    // Real timers with a 1 ms interval: faking timers would also fire timers the extension host
    // created during the test.
    async function waitFor(condition: () => boolean): Promise<void> {
        for (let attempt = 0; attempt < 500 && !condition(); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }

    function delay(milliseconds: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    test("reports each in-flight plan and reads again after the interval", async () => {
        stubReads().resolves({ graphs: [graph] });
        const monitor = createMonitor();

        monitor.start();
        await waitFor(() => callbacks.onPlans.callCount >= 2);
        monitor.dispose();

        expect(requestsOf(GetLiveExecutionPlanRequest.type)[0].args[1]).to.deep.equal({
            ownerUri: "test_uri",
            sessionId: 57,
        });
        expect(callbacks.onPlans.firstCall.args).to.deep.equal([[graph]]);
    });

    test("waits for a plan while the statement hasn't started", async () => {
        stubReads().resolves({ graphs: [] });
        const monitor = createMonitor();

        monitor.start();
        await waitFor(() => requestsOf(GetLiveExecutionPlanRequest.type).length >= 2);
        monitor.dispose();

        expect(callbacks.onPlans).to.not.have.been.called;
    });

    test("stops, reports the first failed read, and closes its connection", async () => {
        stubReads().rejects(new Error("VIEW SERVER STATE permission was denied"));
        const monitor = createMonitor();

        monitor.start();
        await waitFor(() => requestsOf(EndLiveExecutionPlanRequest.type).length > 0);
        await delay(20);

        expect(callbacks.onError).to.have.been.calledOnceWithExactly(
            "VIEW SERVER STATE permission was denied",
        );
        expect(requestsOf(GetLiveExecutionPlanRequest.type)).to.have.length(1);
        expect(requestsOf(EndLiveExecutionPlanRequest.type)[0].args[1]).to.deep.equal({
            ownerUri: "test_uri",
        });
    });

    test("closes its connection once, after the read in flight", async () => {
        let finishRead: (value: unknown) => void = () => undefined;
        stubReads().returns(new Promise((resolve) => (finishRead = resolve)));
        const monitor = createMonitor();

        monitor.start();
        monitor.dispose();
        monitor.dispose();
        await delay(10);
        expect(requestsOf(EndLiveExecutionPlanRequest.type)).to.have.length(0);

        finishRead({ graphs: [graph] });
        await waitFor(() => requestsOf(EndLiveExecutionPlanRequest.type).length > 0);
        await delay(10);

        expect(requestsOf(EndLiveExecutionPlanRequest.type)).to.have.length(1);
        expect(requestsOf(GetLiveExecutionPlanRequest.type)).to.have.length(1);
        expect(callbacks.onPlans).to.not.have.been.called;
    });
});
