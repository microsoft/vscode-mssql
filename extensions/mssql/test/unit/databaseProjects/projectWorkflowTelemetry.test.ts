/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    completeSqlProjectWorkflow,
    recordSqlProjectWorkflowEvent,
    SqlProjectWorkflowEventName,
} from "../../../src/databaseProjects/common/projectWorkflowTelemetry";
import { TelemetryActions, TelemetryViews } from "../../../src/sharedInterfaces/telemetry";
import { stubTelemetry } from "../utils";

suite("SQL project workflow telemetry", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("correlates new, build, and publish without emitting the project path", () => {
        const telemetry = stubTelemetry(sandbox);
        const projectFilePath = "C:\\work\\Pokedex\\Pokedex.sqlproj";

        recordSqlProjectWorkflowEvent(projectFilePath, SqlProjectWorkflowEventName.ProjectCreated, {
            outcome: "Succeeded",
        });
        recordSqlProjectWorkflowEvent(projectFilePath, SqlProjectWorkflowEventName.BuildStarted);
        recordSqlProjectWorkflowEvent(projectFilePath, SqlProjectWorkflowEventName.BuildCompleted, {
            outcome: "Succeeded",
        });
        recordSqlProjectWorkflowEvent(
            projectFilePath,
            SqlProjectWorkflowEventName.PublishDialogOpened,
        );
        recordSqlProjectWorkflowEvent(projectFilePath, SqlProjectWorkflowEventName.PublishStarted);
        completeSqlProjectWorkflow(projectFilePath, SqlProjectWorkflowEventName.PublishCompleted, {
            outcome: "Succeeded",
        });

        const events = telemetry.sendActionEvent
            .getCalls()
            .filter(
                (call) =>
                    call.args[0] === TelemetryViews.SqlProjects &&
                    call.args[1] === TelemetryActions.SqlProjectWorkflow,
            )
            .map((call) => call.args[2].additionalProps as Record<string, string>);

        expect(events.map((event) => event.eventName)).to.deep.equal([
            SqlProjectWorkflowEventName.ProjectCreated,
            SqlProjectWorkflowEventName.BuildStarted,
            SqlProjectWorkflowEventName.BuildCompleted,
            SqlProjectWorkflowEventName.PublishDialogOpened,
            SqlProjectWorkflowEventName.PublishStarted,
            SqlProjectWorkflowEventName.PublishCompleted,
        ]);
        expect(new Set(events.map((event) => event.workflowCorrelationId)).size).to.equal(1);
        expect(events.map((event) => event.stepName)).to.deep.equal([
            "New",
            "Build",
            "Build",
            "Publish",
            "Publish",
            "Publish",
        ]);
        expect(events.every((event) => !Object.values(event).includes(projectFilePath))).to.be.true;
    });
});
