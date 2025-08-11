/* eslint-disable security/detect-object-injection */
import { TelemetryEventNames } from './TelemetryEventNames';
import { TelemetryService } from './TelemetryService';

/**
 * Represents a record of telemetry events that follows the TelemetryEventNameDefinition interface
 */
export interface TelemetryEventRecord {
    [key: string]: { properties: string | never; measurements: string | never; };
};

/**
 * Generic type for properties of a telemetry event
 */
type Properties<TEventNames extends TelemetryEventRecord, TEvent extends keyof TEventNames> = TEventNames[TEvent]['properties'] extends never
    ? never
    : Partial<Record<TEventNames[TEvent]['properties'], string>>;

/**
 * Generic type for measurements of a telemetry event
 */
type Measurements<TEventNames extends TelemetryEventRecord, TEvent extends keyof TEventNames> = TEventNames[TEvent]['measurements'] extends never
    ? never
    : Partial<Record<TEventNames[TEvent]['measurements'], number>>;

/**
 * Represents a Telemetry event
 * @template TEventNames Record of telemetry event names. Defaults to built-in TelemetryEventNames
 * @template TEvent The specific event name (key of TEventNames)
 */
export class TelemetryEvent<
    TEventNames extends TelemetryEventRecord = TelemetryEventNames,
    TEvent extends keyof TEventNames = keyof TEventNames
> {
    protected properties: { [key: string]: string };
    protected measurements: { [key: string]: number };

    constructor(
		protected readonly eventName: TEvent,
		protected readonly telemetryService: TelemetryService | null,
    ) {
        this.properties = {};
        this.measurements = {};
    }

    /**
	 * Adds or Updates a properties in the telemetry event.
	 * @param values The record of the telemetry properties names and values.
	 */
    addOrUpdateProperties(properties: Properties<TEventNames, TEvent>) {
        for (const property in properties) {
            if (Object.prototype.hasOwnProperty.call(properties, property)) {
                const value = properties[property as keyof Properties<TEventNames, TEvent>];
                if (value) {
                    this.properties[property] = value;
                }
            }
        }
    }

    /**
	 * Adds or Updates a measurements in the telemetry event.
	 * @param values The record of the telemetry measurements names and values.
	 */
    addOrUpdateMeasurements(measurements: Measurements<TEventNames, TEvent>) {
        for (const measurement in measurements) {
            if (Object.prototype.hasOwnProperty.call(measurements, measurement)) {
                const value = measurements[measurement as keyof Measurements<TEventNames, TEvent>];
                if (value) {
                    this.measurements[measurement] = value;
                }
            }
        }
    }

    /**
	 * Sends a telemetry event with the given properties and measurements.
	 */
    sendTelemetry() {
        this.telemetryService?.sendTelemetryEvent(this.eventName as string, this.properties, this.measurements);
    }
}
