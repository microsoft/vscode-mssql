/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import TelemetryReporter, {
    TelemetryEventMeasures,
    TelemetryEventProperties,
} from "./telemetryReporter";

/**
 * A helper class to send an Action event with its duration.
 */
export class TimedAction<V extends string = string, A extends string = string> {
    private readonly properties: TelemetryEventProperties = {};
    private readonly measures: TelemetryEventMeasures = {};
    private readonly start = Date.now();

    constructor(
        private readonly reporter: TelemetryReporter,
        private readonly view: V,
        private readonly action: A,
        private readonly target: string = "",
        private readonly source: string = "",
    ) {}

    public withAdditionalProperties(
        additionalProperties: TelemetryEventProperties,
    ): TimedAction<V, A> {
        Object.assign(this.properties, additionalProperties);
        return this;
    }

    public withAdditionalMeasures(
        additionalMeasurements: TelemetryEventMeasures,
    ): TimedAction<V, A> {
        Object.assign(this.measures, additionalMeasurements);
        return this;
    }

    public send(): void {
        this.reporter
            .createActionEvent(
                this.view,
                this.action,
                this.target,
                this.source,
                Date.now() - this.start,
            )
            .withAdditionalProperties(this.properties)
            .withAdditionalMeasurements(this.measures)
            .send();
    }
}
