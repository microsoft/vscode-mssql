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
import { Deferred } from "../../src/protocol";
import { ExecutionPlanGraph } from "../../src/sharedInterfaces/executionPlan";

chai.use(sinonChai);
const { expect } = chai;

suite("LiveQueryStatisticsMonitor", () => {
    const graph = { query: "select 1" } as ExecutionPlanGraph;
    let sandbox: sinon.SinonSandbox;
    let sendRequest: sinon.SinonStub;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let callbacks: { onPlans: sinon.SinonStub; onError: sinon.SinonStub };

    setup(() => {
        sandbox = sinon.createSandbox();
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        sendRequest = client.sendRequest;
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

    function createMonitor(ownerUri = "test_uri", sessionId = 57): LiveQueryStatisticsMonitor {
        return new LiveQueryStatisticsMonitor(
            ownerUri,
            sessionId,
            callbacks as LiveQueryStatisticsCallbacks,
            client,
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

    test("waits for the previous generation's in-flight read and close before reopening", async () => {
        const read = new Deferred<unknown>();
        const close = new Deferred<boolean>();
        stubReads().resolves({ graphs: [graph] });
        sendRequest
            .withArgs(GetLiveExecutionPlanRequest.type, { ownerUri: "test_uri", sessionId: 57 })
            .returns(read.promise);
        sendRequest
            .withArgs(EndLiveExecutionPlanRequest.type, { ownerUri: "test_uri" })
            .returns(close.promise);
        const old = createMonitor();
        old.start();
        await waitFor(() =>
            sendRequest.calledWith(GetLiveExecutionPlanRequest.type, {
                ownerUri: "test_uri",
                sessionId: 57,
            }),
        );
        old.dispose();
        const next = createMonitor("test_uri", 58);
        next.start();
        await delay(5);
        expect(sendRequest).not.to.have.been.calledWith(EndLiveExecutionPlanRequest.type, {
            ownerUri: "test_uri",
        });
        expect(sendRequest).not.to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "test_uri",
            sessionId: 58,
        });
        read.resolve({ graphs: [graph] });
        await waitFor(() =>
            sendRequest.calledWith(EndLiveExecutionPlanRequest.type, { ownerUri: "test_uri" }),
        );
        expect(sendRequest).not.to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "test_uri",
            sessionId: 58,
        });
        close.resolve(true);
        await waitFor(() => callbacks.onPlans.called);
        next.dispose();
        await next.closed;
        expect(sendRequest).to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "test_uri",
            sessionId: 58,
        });
        expect(callbacks.onError).not.to.have.been.called;
    });

    test("waits for a renamed monitor to close and suppresses a disposed replacement", async () => {
        const close = new Deferred<boolean>();
        stubReads().resolves({ graphs: [graph] });
        sendRequest
            .withArgs(EndLiveExecutionPlanRequest.type, { ownerUri: "test_uri" })
            .returns(close.promise);
        const old = createMonitor();
        old.start();
        await waitFor(() => callbacks.onPlans.called);
        old.dispose();
        const replacement = createMonitor("renamed_uri");
        replacement.start(old.closed);
        await delay(5);
        expect(sendRequest).not.to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "renamed_uri",
            sessionId: 57,
        });
        replacement.dispose();
        const latest = createMonitor("renamed_uri", 58);
        latest.start();
        close.resolve(true);
        await waitFor(() =>
            sendRequest.calledWith(GetLiveExecutionPlanRequest.type, {
                ownerUri: "renamed_uri",
                sessionId: 58,
            }),
        );
        latest.dispose();
        await latest.closed;
        expect(sendRequest).not.to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "renamed_uri",
            sessionId: 57,
        });
        expect(sendRequest).to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "renamed_uri",
            sessionId: 58,
        });
    });

    test("does not delay an unrelated editor while another editor's connection closes", async () => {
        const close = new Deferred<boolean>();
        stubReads().resolves({ graphs: [graph] });
        sendRequest
            .withArgs(EndLiveExecutionPlanRequest.type, { ownerUri: "test_uri" })
            .returns(close.promise);
        const old = createMonitor();
        old.start();
        await waitFor(() => callbacks.onPlans.called);
        old.dispose();
        const other = createMonitor("other_uri");
        other.start();
        await waitFor(() =>
            sendRequest.calledWith(GetLiveExecutionPlanRequest.type, {
                ownerUri: "other_uri",
                sessionId: 57,
            }),
        );
        other.dispose();
        close.resolve(true);
        await Promise.all([old.closed, other.closed]);
        expect(sendRequest).to.have.been.calledWith(GetLiveExecutionPlanRequest.type, {
            ownerUri: "other_uri",
            sessionId: 57,
        });
    });

    test("keeps progress monotonic per statement and resets when elapsed time starts over", async () => {
        const sample = (rows: number, elapsed: number, query = "select 1"): ExecutionPlanGraph =>
            ({
                query,
                root: { children: [{ cost: 1, children: [] }] },
                graphFile: {
                    graphFileType: "xml",
                    planIndexInFile: 0,
                    graphFileContent: `<ShowPlanXML><StmtSimple StatementId="1"><QueryPlan><QueryTimeStats ElapsedTime="${elapsed}" />
                    <RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="${rows}" /></RunTimeInformation></RelOp>
                    </QueryPlan></StmtSimple></ShowPlanXML>`,
                },
            }) as ExecutionPlanGraph;
        const reads = stubReads();
        reads.onCall(0).resolves({ graphs: [sample(75, 100), sample(10, 100, "select 2")] });
        reads.onCall(1).resolves({ graphs: [sample(50, 200), sample(20, 200, "select 2")] });
        reads.onCall(2).resolves({ graphs: [sample(5, 10), sample(30, 300, "select 2")] });
        reads.resolves({ graphs: [] });
        const monitor = createMonitor();
        monitor.start();
        await waitFor(() => callbacks.onPlans.callCount >= 3);
        monitor.dispose();

        const reported = callbacks.onPlans
            .getCalls()
            .map((call) =>
                (call.args[0] as ExecutionPlanGraph[]).map(
                    (plan) => plan.liveQueryStatistics?.estimatedProgress,
                ),
            );
        expect(reported).to.deep.equal([
            [75, 10],
            [75, 20],
            [5, 30],
        ]);
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
        await waitFor(() => requestsOf(GetLiveExecutionPlanRequest.type).length > 0);
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
