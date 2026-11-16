/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import {
    ActivityObject,
    sendActionEvent,
    startActivity,
    StartActivityOptions,
    TelemetryEventOptions,
} from "./telemetry";
import { TelemetryEventMeasures, TelemetryEventProperties } from "./telemetryReporter";

/** Identifies a position in a workflow. Ordinals are optional and may be branch-relative. */
export interface WorkflowStep {
    name: string;
    ordinal?: number;
    branch?: string;
}

/** Options for recording a workflow event. */
export interface WorkflowEventOptions extends TelemetryEventOptions {
    /** Step reached by this event. The most recently recorded step is used when omitted. */
    step?: WorkflowStep;
    /** Outcome associated with this event, when applicable. */
    outcome?: string;
}

/** Options for starting a workflow. */
export interface StartWorkflowOptions extends WorkflowEventOptions {
    /** Correlation ID for the workflow. A new UUID is generated when omitted. */
    correlationId?: string;
    /** Properties included with every workflow event and child activity. */
    commonProps?: TelemetryEventProperties;
    /** Measurements included with every workflow event and child activity. */
    commonMeasurements?: TelemetryEventMeasures;
}

/** Tracks a multi-step workflow without imposing a fixed or linear step structure. */
export interface WorkflowTelemetryObject {
    readonly correlationId: string;
    readonly currentStep: WorkflowStep | undefined;
    readonly isEnded: boolean;
    record(eventName: string, options?: WorkflowEventOptions): boolean;
    end(eventName: string, options?: WorkflowEventOptions): boolean;
    /**
     * Starts an activity correlated with this workflow. The activity reports independently of the
     * workflow's lifetime, so an operation that outlives the workflow still reports its result.
     */
    startChildActivity(telemetryAction: string, options?: StartActivityOptions): ActivityObject;
}

/**
 * Starts a correlated workflow and records its initial event.
 *
 * Each event contains a workflow correlation ID, the event name, optional step and branch
 * metadata, and elapsed time. Callers define their own event and step names so workflows may
 * branch or use different numbers of steps.
 */
export function startWorkflow(
    telemetryView: string,
    telemetryAction: string,
    initialEventName: string,
    {
        correlationId = randomUUID(),
        step: initialStep,
        outcome: initialOutcome,
        commonProps = {},
        commonMeasurements = {},
        additionalProps: initialAdditionalProps = {},
        additionalMeasurements: initialAdditionalMeasurements = {},
        connectionInfo: initialConnectionInfo,
        serverInfo: initialServerInfo,
    }: StartWorkflowOptions = {},
): WorkflowTelemetryObject {
    const startTime = performance.now();
    let currentStep = initialStep;
    let isEnded = false;

    const sendWorkflowEvent = (
        eventName: string,
        {
            step,
            outcome,
            additionalProps = {},
            additionalMeasurements = {},
            connectionInfo,
            serverInfo,
        }: WorkflowEventOptions = {},
    ): void => {
        const effectiveStep = step ?? currentStep;
        if (step) {
            currentStep = step;
        }

        sendActionEvent(telemetryView, telemetryAction, {
            additionalProps: {
                ...commonProps,
                ...additionalProps,
                workflowCorrelationId: correlationId,
                eventName,
                ...(effectiveStep && { stepName: effectiveStep.name }),
                ...(effectiveStep?.ordinal !== undefined && {
                    stepOrdinal: effectiveStep.ordinal.toString(),
                }),
                ...(effectiveStep?.branch && { branch: effectiveStep.branch }),
                ...(outcome && { outcome }),
            },
            additionalMeasurements: {
                ...commonMeasurements,
                ...additionalMeasurements,
                elapsedSinceWorkflowStartMilliseconds: Math.round(performance.now() - startTime),
            },
            connectionInfo,
            serverInfo,
        });
    };

    const record = (eventName: string, options: WorkflowEventOptions = {}): boolean => {
        if (isEnded) {
            return false;
        }
        sendWorkflowEvent(eventName, options);
        return true;
    };

    const end = (eventName: string, options: WorkflowEventOptions = {}): boolean => {
        if (isEnded) {
            return false;
        }
        isEnded = true;
        sendWorkflowEvent(eventName, options);
        return true;
    };

    const startChildActivity = (
        childTelemetryAction: string,
        { additionalProps = {}, ...options }: StartActivityOptions = {},
    ): ActivityObject =>
        startActivity(telemetryView, childTelemetryAction, {
            ...options,
            additionalProps: {
                ...commonProps,
                ...additionalProps,
                workflowCorrelationId: correlationId,
            },
            additionalMeasurements: {
                ...commonMeasurements,
                ...options.additionalMeasurements,
            },
        });

    const workflow: WorkflowTelemetryObject = {
        correlationId,
        get currentStep() {
            return currentStep;
        },
        get isEnded() {
            return isEnded;
        },
        record,
        end,
        startChildActivity,
    };

    sendWorkflowEvent(initialEventName, {
        step: initialStep,
        outcome: initialOutcome,
        additionalProps: initialAdditionalProps,
        additionalMeasurements: initialAdditionalMeasurements,
        connectionInfo: initialConnectionInfo,
        serverInfo: initialServerInfo,
    });
    return workflow;
}
