/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    LiveQueryStatisticsEndReason,
    LiveQueryStatisticsRunTelemetry,
} from "../../src/queryResult/liveQueryStatisticsTelemetry";
import { ExecutionPlanGraph } from "../../src/sharedInterfaces/executionPlan";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { stubTelemetry } from "./utils";

chai.use(sinonChai);
const { expect } = chai;

suite("LiveQueryStatisticsRunTelemetry", () => {
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;
    let sendActionEvent: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        // Only Date is faked: faking timers would also fire timers the extension host created.
        clock = sandbox.useFakeTimers({ toFake: ["Date"] });
        sendActionEvent = stubTelemetry(sandbox).sendActionEvent;
    });

    teardown(() => {
        sandbox.restore();
    });

    function graph(estimatedProgress?: number, query = "select 1"): ExecutionPlanGraph {
        return {
            query,
            graphFile: { planIndexInFile: 0 },
            liveQueryStatistics:
                estimatedProgress === undefined ? undefined : { estimatedProgress },
        } as ExecutionPlanGraph;
    }

    function sentMeasurements(): { [key: string]: number } {
        return sendActionEvent.lastCall.args[2].additionalMeasurements;
    }

    test("summarizes what a finished run showed", () => {
        const run = new LiveQueryStatisticsRunTelemetry();
        clock.tick(1000);
        run.recordEmptyRead();
        clock.tick(1000);
        run.recordPlans([graph(10)]);
        clock.tick(1000);
        run.recordPlans([graph(50)]);
        clock.tick(3000);
        // Displays the same 50% as the previous read, so this isn't movement.
        run.recordPlans([graph(50.04)]);
        clock.tick(1000);
        run.recordPlans([graph(60)]);
        clock.tick(3000);

        run.send(LiveQueryStatisticsEndReason.Completed, true);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.ExecutionPlan,
            TelemetryActions.LiveQueryStatisticsRun,
            {
                additionalProps: {
                    endReason: "completed",
                    durationBucket: "5-30s",
                    planTabActiveAtEnd: "true",
                },
                additionalMeasurements: {
                    elapsedMs: 10000,
                    planReadCount: 4,
                    emptyReadCount: 1,
                    firstPlanMs: 2000,
                    readsWithProgressPct: 100,
                    progressAtEnd: 60,
                    longestStallMs: 4000,
                    elapsedPctAt50Progress: 30,
                },
            },
        );
    });

    test("counts the time since the last movement as a stall when the run ends", () => {
        const run = new LiveQueryStatisticsRunTelemetry();
        run.recordPlans([graph(10)]);
        clock.tick(8000);

        run.send(LiveQueryStatisticsEndReason.Completed, false);

        expect(sentMeasurements()).to.include({ longestStallMs: 8000 });
    });

    test("reports only counters when no plan was ever shown", () => {
        const run = new LiveQueryStatisticsRunTelemetry();
        run.recordEmptyRead();
        clock.tick(4000);
        run.recordEmptyRead();

        run.send(LiveQueryStatisticsEndReason.Completed, false);

        expect(sentMeasurements()).to.deep.equal({
            elapsedMs: 4000,
            planReadCount: 0,
            emptyReadCount: 2,
        });
    });

    test("reports how many plan reads had a progress estimate", () => {
        const run = new LiveQueryStatisticsRunTelemetry();
        run.recordPlans([graph(20)]);
        run.recordPlans([graph()]);
        run.recordPlans([graph()]);
        clock.tick(1000);

        run.send(LiveQueryStatisticsEndReason.Canceled, true);

        expect(sentMeasurements()).to.include({ readsWithProgressPct: 33, progressAtEnd: 20 });
        expect(sentMeasurements()).not.to.have.property("elapsedPctAt50Progress");
    });

    for (const endReason of [
        LiveQueryStatisticsEndReason.QueryError,
        LiveQueryStatisticsEndReason.Canceled,
        LiveQueryStatisticsEndReason.MonitorError,
        LiveQueryStatisticsEndReason.Closed,
    ]) {
        test(`doesn't compare progress to the duration of a ${endReason} run`, () => {
            const run = new LiveQueryStatisticsRunTelemetry();
            clock.tick(1000);
            run.recordPlans([graph(60)]);
            clock.tick(1000);

            run.send(endReason, true);

            expect(sentMeasurements()).to.include({ progressAtEnd: 60 });
            expect(sentMeasurements()).not.to.have.property("elapsedPctAt50Progress");
        });
    }

    const multipleStatementReads: { name: string; reads: ExecutionPlanGraph[][] }[] = [
        { name: "several plans in one read", reads: [[graph(60), graph(10, "select 2")]] },
        { name: "a changed statement", reads: [[graph(60)], [graph(70, "select 2")]] },
        { name: "progress that starts again", reads: [[graph(60)], [graph(5)]] },
    ];
    for (const { name, reads } of multipleStatementReads) {
        test(`doesn't compare progress to the run's duration after ${name}`, () => {
            const run = new LiveQueryStatisticsRunTelemetry();
            clock.tick(1000);
            reads.forEach((read) => run.recordPlans(read));
            clock.tick(1000);

            run.send(LiveQueryStatisticsEndReason.Completed, true);

            expect(sentMeasurements()).not.to.have.property("elapsedPctAt50Progress");
        });
    }

    test("never sends the query text", () => {
        const run = new LiveQueryStatisticsRunTelemetry();
        run.recordPlans([graph(10, "select secret_column from secret_table")]);

        run.send(LiveQueryStatisticsEndReason.Completed, true);

        expect(JSON.stringify(sendActionEvent.lastCall.args)).not.to.include("secret");
    });
});
