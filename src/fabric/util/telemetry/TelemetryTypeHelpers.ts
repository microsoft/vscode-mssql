import { TelemetryEventNames } from './TelemetryEventNames';
import { TelemetryEventRecord } from './TelemetryEvent';

/**
 * Type helper to extract keys from TEventNames that have a specific property
 * @template TEventNames The telemetry event record type
 * @template PropertyName The property name to check for
 */
export type EventsWithProperty<
    TEventNames extends TelemetryEventRecord = TelemetryEventNames,
    PropertyName extends string = string
> = {
    [K in keyof TEventNames]: TEventNames[K]['properties'] extends never
        ? never
        : PropertyName extends TEventNames[K]['properties']
            ? K
            : never
}[keyof TEventNames];

/**
 * Type helper to extract keys from TEventNames that have a specific measurement
 * @template TEventNames The telemetry event record type
 * @template MeasurementName The measurement name to check for
 */
export type EventsWithMeasurement<
    TEventNames extends TelemetryEventRecord = TelemetryEventNames,
    MeasurementName extends string = string
> = {
    [K in keyof TEventNames]: TEventNames[K]['measurements'] extends never
        ? never
        : MeasurementName extends TEventNames[K]['measurements']
            ? K
            : never
}[keyof TEventNames];

/**
 * Type helper to check if a type T extends all types in a union U
 * @template T The type to check
 * @template U The union of types to check against
 */
type ExtendsAll<T, U> = [U] extends [T] ? true : false;

/**
 * Type helper to extract keys from TEventNames that have all of the specified properties
 * @template TEventNames The telemetry event record type
 * @template PropertyNames The union of property names to check for
 */
export type EventsWithAllProperties<
    TEventNames extends TelemetryEventRecord = TelemetryEventNames,
    PropertyNames extends string = string
> = {
    [K in keyof TEventNames]: TEventNames[K]['properties'] extends never
        ? never
        : ExtendsAll<TEventNames[K]['properties'], PropertyNames> extends true
            ? K
            : never
}[keyof TEventNames];

/**
 * Type helper to extract keys from TEventNames that have all of the specified measurements
 * @template TEventNames The telemetry event record type
 * @template MeasurementNames The union of measurement names to check for
 */
export type EventsWithAllMeasurements<
    TEventNames extends TelemetryEventRecord = TelemetryEventNames,
    MeasurementNames extends string = string
> = {
    [K in keyof TEventNames]: TEventNames[K]['measurements'] extends never
        ? never
        : ExtendsAll<TEventNames[K]['measurements'], MeasurementNames> extends true
            ? K
            : never
}[keyof TEventNames];