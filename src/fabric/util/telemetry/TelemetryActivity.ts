import { TelemetryEvent, TelemetryEventRecord } from './TelemetryEvent';
import { TelemetryEventNames } from './TelemetryEventNames';
import { TelemetryService } from './TelemetryService';

/**
 * Represent a Telemetry activity that contains start, end and duration time of an activity
 * @template TEventNames Record of telemetry event names. Defaults to built-in TelemetryEventNames
 * @template TEvent The specific event name (key of TEventNames)
 */
export class TelemetryActivity<TEventNames extends TelemetryEventRecord = TelemetryEventNames, TEvent extends keyof TEventNames = keyof TEventNames> extends TelemetryEvent<TEventNames, TEvent> {
    private static readonly startTimeMeasurementName = 'startTimeInMilliseconds';
    private static readonly endTimeMeasurementName = 'endTimeInMilliseconds';
    private static readonly durationMeasurementName = 'activityDurationInMilliseconds';
    private startTime: number = 0;
    private endTime?: number;

    /**
     * Initialize a new instance of a Telemetry Activity and sets the start time of the activity to Date.Now()
     * @param eventName The telemetry activity event name.
     * @param telemetryService The telemetry service.
     */
    constructor(
        eventName: TEvent,
        telemetryService: TelemetryService | null
    ) {
        super(eventName, telemetryService);
        this.start();// some Activity users do not call doTelemetryActivity (which calls start()) so we call it here
    }

    /**
     * Set the start time of the activity to Date.Now()
     */
    start() {
        this.startTime = Date.now();
        this.endTime = undefined;
    }

    /**
     * Set the end time of the activity to Date.Now()
     */
    end() {
        if (this.startTime !== undefined) {
            this.endTime = Date.now();
        }
    }

    override sendTelemetry() {
        if (this.endTime === undefined) {
            this.endTime = Date.now();
        }

        this.measurements[TelemetryActivity.startTimeMeasurementName] = this.startTime;
        this.measurements[TelemetryActivity.endTimeMeasurementName] = this.endTime;
        this.measurements[TelemetryActivity.durationMeasurementName] = this.endTime - this.startTime;

        super.sendTelemetry();
    }

    public async doTelemetryActivity<R>(thing: () => Promise<R>): Promise<R> {
        this.start();
        let result: R;
        try {
            result = await thing();
            this.properties['succeeded'] = 'true';
            return result;
        }
        catch (error: unknown) {
            this.properties['succeeded'] = 'false';
            this.properties['message'] = error instanceof Error ? error.message : 'error';

            if (error instanceof Error && error.stack) {
                this.properties['callstack'] = error.stack;
                /**
                 * Extract method from stack and add as property.
                 */
                const stacklines = error.stack.split('\n');
                let method = '';
                if (stacklines.length > 1) {
                    method = stacklines[1].trim();
                }
                this.properties['method'] = method;
            }
            throw error;
        }
        finally {
            this.end();
            this.sendTelemetry();
        }
    }
}
