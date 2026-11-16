/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const Module = require("node:module");
const { afterEach, beforeEach, suite, test } = require("node:test");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "vscode") {
        return {
            env: {
                machineId: "test-machine",
                sessionId: "test-session",
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const telemetry = require("../dist/vscode/telemetry/telemetry.js");
const { startWorkflow } = require("../dist/vscode/telemetry/workflowTelemetry.js");
Module._load = originalLoad;

suite("WorkflowTelemetry", () => {
    let events;
    let originalCreateActionEvent;

    beforeEach(() => {
        events = [];
        originalCreateActionEvent = telemetry.telemetryReporter.createActionEvent;
        telemetry.telemetryReporter.createActionEvent = (view, action) => {
            const event = {
                view,
                action,
                properties: {},
                measurements: {},
            };
            return {
                withAdditionalProperties(properties) {
                    Object.assign(event.properties, properties);
                    return this;
                },
                withAdditionalMeasurements(measurements) {
                    Object.assign(event.measurements, measurements);
                    return this;
                },
                withConnectionInfo() {
                    return this;
                },
                withServerInfo() {
                    return this;
                },
                send() {
                    events.push(event);
                },
            };
        };
    });

    afterEach(() => {
        telemetry.telemetryReporter.createActionEvent = originalCreateActionEvent;
    });

    test("records correlated named steps with optional branch-relative ordinals", () => {
        const workflow = startWorkflow("Dialog", "Workflow", "Opened", {
            correlationId: "workflow-123",
            step: { name: "Opened", ordinal: 1, branch: "create" },
            commonProps: { surface: "dialog" },
        });

        workflow.record("SelectionChanged", {
            step: { name: "TargetSelected", ordinal: 2, branch: "update" },
            additionalProps: { targetType: "database" },
        });

        assert.equal(events.length, 2);
        assert.deepEqual(events[0].properties, {
            surface: "dialog",
            workflowCorrelationId: "workflow-123",
            eventName: "Opened",
            stepName: "Opened",
            stepOrdinal: "1",
            branch: "create",
        });
        assert.deepEqual(events[1].properties, {
            surface: "dialog",
            targetType: "database",
            workflowCorrelationId: "workflow-123",
            eventName: "SelectionChanged",
            stepName: "TargetSelected",
            stepOrdinal: "2",
            branch: "update",
        });
        assert.equal(typeof events[0].measurements.elapsedSinceWorkflowStartMilliseconds, "number");
        assert.deepEqual(workflow.currentStep, {
            name: "TargetSelected",
            ordinal: 2,
            branch: "update",
        });
    });

    test("ends once and carries the current step into the terminal event", () => {
        const workflow = startWorkflow("Dialog", "Workflow", "Opened", {
            correlationId: "workflow-123",
            step: { name: "Opened" },
        });
        workflow.record("Advanced", {
            step: { name: "Review", branch: "advanced" },
        });

        assert.equal(workflow.end("Cancelled", { outcome: "Cancelled" }), true);
        assert.equal(workflow.end("Closed"), false);
        assert.equal(workflow.record("AdvancedAgain"), false);
        assert.equal(workflow.isEnded, true);
        assert.equal(events.length, 3);
        assert.deepEqual(events[2].properties, {
            workflowCorrelationId: "workflow-123",
            eventName: "Cancelled",
            stepName: "Review",
            branch: "advanced",
            outcome: "Cancelled",
        });
    });

    test("correlates child activities to the workflow", () => {
        const workflow = startWorkflow("Dialog", "Workflow", "Opened", {
            correlationId: "workflow-123",
        });

        const activity = workflow.startChildActivity("Execute");
        activity.end("Succeeded");

        assert.equal(events.length, 3);
        assert.equal(events[1].action, "Execute");
        assert.equal(events[1].properties.workflowCorrelationId, "workflow-123");
        assert.equal(events[2].properties.workflowCorrelationId, "workflow-123");
        assert.equal(events[2].properties.correlationId, activity.correlationId);
        assert.equal(events[2].properties.activityStatus, "Succeeded");
    });
});
