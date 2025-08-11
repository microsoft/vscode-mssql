import { OutputChannel, window } from 'vscode';
import { performance } from 'node:perf_hooks';
import { TelemetryEventNames } from '../telemetry/TelemetryEventNames';
import { TelemetryEvent } from '../telemetry/TelemetryEvent';
import { TelemetryService } from '../telemetry/TelemetryService';
import { IMessageReporter } from '../zipUtilities';

// export type WatchOptions = {
//     importance?: LogImportance
//     telemetry?: TelemetryEvent<keyof TelemetryEventNames>
//     catchUnhandledErrors?: boolean
// };

export enum LogImportance {
    low,
    normal,
    high,
}

export interface ILogger {
    log(message: string, importance?: LogImportance, show?: boolean): void;
    show(): void;
    reportExceptionTelemetryAndLog(
        methodName: string,
        eventName: string,
        exception: unknown,
        telemetryService: any | null,
        properties?: { [key: string]: string } | undefined,
    ): void;
}


export abstract class LoggerBase {
    abstract log(message: string, importance?: LogImportance): void;
}

export class Logger implements ILogger {
    private readonly outputChannel: OutputChannel;
    readonly level: LogImportance;

    constructor(logNameOrOutputChannel: string | OutputChannel) {
        this.outputChannel = typeof logNameOrOutputChannel === 'string' ? window.createOutputChannel(logNameOrOutputChannel, { log: true }) : logNameOrOutputChannel;
        this.level = LogImportance.normal;
        switch (process.env.MINIMUM_LOG_LEVEL?.toLowerCase()) {
            case 'low':
                this.level = LogImportance.low;
                break;
            case 'normal':
                this.level = LogImportance.normal;
                break;
            case 'high':
                this.level = LogImportance.high;
                break;
        }
    }

    log(message: string, importance?: LogImportance, show?: boolean) {
        if (importance === undefined || importance >= this.level) {
            if (show) {
                this.outputChannel.show();
            }
            this.outputChannel.appendLine(message);
        }
    }

    show() {
        this.outputChannel.show();
    }

    reportExceptionTelemetryAndLog(
        methodName: string, //method or operation name
        errorEventName: string,
        exception: unknown,
        telemetryService: TelemetryService | null,
        properties?: { [key: string]: string } | undefined,
    ) {
        let stack: string | null = null;
        let error: Error = exception as Error;
        let fault: string | null = null;
        if (properties?.fault) {
            fault = properties.fault;
            delete properties.fault;
        }
        if (error) {
            // vscode-extension-telemetry tries to scrub all strings but errorMessages can be risky with user data.
            // To be safe, we will post stacktraces but not the message in the error for now.
            stack = error.stack ?? null;
            if (!fault) {
                fault = error.message;
            }
        }

        fault = fault ?? methodName;
        let props: { [key: string]: string } = stack ? { exceptionStack: stack } : {};
        props = { ...props, ...properties, fault: fault, errorMethodName: methodName };
        telemetryService?.sendTelemetryErrorEvent(errorEventName, props);
        this.log('Error occurred in ' + methodName + ': ' + exception, LogImportance.high);
    }
}

export class StepProgressLogger implements IProgress<StepProgress> {
    constructor(
        private readonly logger: LoggerBase,
        private readonly name: string,
    ) { }

    report(data: StepProgress) {
        this.logger.log(`${this.name}: Step ${data.currentStep} of ${data.totalSteps}.`);
    }
}

export class OutputMonitor extends LoggerBase {
    outputLog: string[];
    constructor() {
        super();
        this.outputLog = [];
    }

    log(message: string) {
        this.outputLog.push(message);
    }

    getOutput() {
        return this.outputLog.join('');
    }
}

export interface IProgress<T> {
    report(data: T): void
}

/**
 * Can be used to report progress of a multi-step operation.
 */
export interface StepProgress {
    currentStep: number
    totalSteps: number
}

export class MockConsoleLogger extends Logger implements IMessageReporter {
    public logMessagesArray: string[] = [];

    log(message: string | undefined, importance?: LogImportance | undefined, show?: boolean | undefined): void {
        // get the date time stamp with format "yyyy-MM-dd HH:mm:ss"
        const dt = new Date();
        message = `MockConsoleLogger: ${padTo2Digits(dt.getHours())}:${padTo2Digits(dt.getMinutes())}:${padTo2Digits(dt.getSeconds())} ${message}`; // so can distinguish from console.log messages.
        console.log(message);
        this.logMessagesArray.push(message);

        super.log(message, importance, show);
    }

    resetMessageArray(): void {
        this.logMessagesArray = [];
    }

    reportExceptionTelemetryAndLog(methodName: string, eventName: string, exception: unknown, telemetryService: TelemetryService | null, properties?: { [key: string]: string; } | undefined): void {
        let faultMessage: string | null = null;
        if (properties?.fault) {
            faultMessage = properties.fault;
            delete properties.fault;
        }
        else if (exception instanceof Error) {
            faultMessage = exception.message;
        }
        let msg = faultMessage ?? ((exception as string)) ?? 'Unknown error';

        console.log(msg);
        this.logMessagesArray.push(msg);

        super.reportExceptionTelemetryAndLog(methodName, eventName, exception, telemetryService, properties);
    }

    show(): void {
        // do nothing
    }

    report(message: string): void {
        this.log(message);
    }

}

function padTo2Digits(num: number): string {
    return num.toString().padStart(2, '0');
}