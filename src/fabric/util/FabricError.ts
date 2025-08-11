import * as vscode from 'vscode';
import { TelemetryActivity } from './telemetry/TelemetryActivity';
import { TelemetryEventNames } from './telemetry/TelemetryEventNames';
import { TelemetryService } from './telemetry/TelemetryService';
import { TelemetryEventRecord } from './telemetry/TelemetryEvent';
import { ILogger, LogImportance } from './logger/Logger';

/**
 * Represents the level of user notification to display for an error or message.
 */
type NotificationLevel = 'Information' | 'Error' | 'None';

/**
 * Interface for errors that represent user cancellation of an operation.
 * When an error implements this interface, it should be treated as a user-initiated
 * cancellation rather than a failure, affecting telemetry and user notifications accordingly.
 */
export interface ICanceledError extends Error {
    readonly isCanceledError: true;
    readonly stepName?: string;
}

/**
 * Interface for errors that represent controlled application errors with telemetry and logging options.
 * When an error implements this interface, it should be processed with special handling for
 * user notifications, logging, and telemetry aggregation.
 */
export interface IFabricError extends Error {
    readonly isFabricError: true;
    readonly nonLocalizedMessage: string;
    didProcessFabricError: boolean;
    readonly options?: {
        showInUserNotification?: NotificationLevel;
        showInFabricLog?: LogImportance | boolean;
    };
}

/*
Throw this FabricError when you want to show a message to the user, log it to the Fabric Log, and/or send it to telemetry.
It allows aggregable messages (not localized, not with variables iike duration or guid or user symbols) to be sent to telemetry.

*/
export class FabricError extends Error implements IFabricError {
    readonly isFabricError = true as const;
    didProcessFabricError: boolean = false;// flag indicating we did process this error as a Fabric Error
    constructor(
        public message: string, // localized string, with perhaps variable information, like # msecs or user symbol name
        public nonLocalizedMessage: string, // non-loc and non-variable, for telemetry aggregation. Without user guids or duration
        public options?: {
            showInUserNotification?: NotificationLevel; // Undefined for none. Else either vscode.window.showInformationMessage or vscode.window.showErrorMessage. Default is 'Error'
            showInFabricLog?: LogImportance | boolean; // output to the Fabric Log, default is true. Optionally specify the LogImportance level.s
        }) {
        // Intentionally use localized msg to call super. The message may be surfaced to user. The 'nonlocalized' also is aggregable, so has relevant information removed from the message, making it less informative.
        // Also, this way both FabricError and Error have the 'message' field identical, avoiding confusion.I'll add this to comments
        super(message);
        /**
https://www.dannyguo.com/blog/how-to-fix-instanceof-not-working-for-custom-errors-in-typescript/
instanceof is broken when class extends Error type https://github.com/microsoft/TypeScript/issues/13965
         * 
         */
        //        Object.setPrototypeOf(this, FabricError.prototype);
    }
}

export interface FabricActionOptions {
    fabricLogger?: ILogger,
    // We considered various approaches to enforce type safety for the 'nonLocalizedMessage' property
    // but found that strict generics would prevent consumers from working with doFabricAction when
    // using TelemetryEventNames types defined in their own packages. Using TelemetryEventRecord as the
    // constraint allows the flexibility needed by all consumers while maintaining runtime functionality.
    // Consumers should ensure their telemetry activities include or can accept a 'nonLocalizedMessage' property,
    // which is added to telemetry when FabricErrors are caught.
    telemetryActivity?: TelemetryActivity<TelemetryEventRecord, keyof TelemetryEventRecord>,
}

/**
 * This is a helper function that wraps a delegate with common error handling. The delegate should
 * use the FabricError class to throw errors, which will allow control over logging and telemetry.
 *
 *  FabricError.options?: { 
 *      showInUserNotification?: 'Information' | 'Error';
 *      showInFabricLog?: LogImportance | boolean;
 *  }
 *
 * @param action - A function returning a Promise of type R.
 * @param fabricLogger - (Optional) ILogger to use when `showInFabricLog` is set to true. This method
 * assumes the ILogger implementation logs to the Fabric log, but technically it is not required. If
 * this is not provided, the error will not be logged, even when `showInFabricLog` is set to true.
 * @param telemetryActivity - (Optional) Telemetry activity for tracking success/failure & duration
 * of param `action`. This is independent of the telemetry that may be sent by `action` or
 * `fabricLogger`.
 * @returns A Promise resolving to a result of type R.
 */
export async function doFabricAction<R>(
    options: FabricActionOptions,
    action: () => Promise<R>,
): Promise<R> {
    if (options.telemetryActivity) {
        return await options.telemetryActivity.doTelemetryActivity(async () => {
            return await doFabricActionInternal(options, action);
        });
    }
    else {
        return await doFabricActionInternal(options, action);
    }
}

/**
 * Internal helper function that handles common error processing logic
 */
async function doFabricActionInternal<R>(
    options: FabricActionOptions,
    action: () => Promise<R>,
): Promise<R> {
    try {
        return await action();
    }
    catch (error: any) {
        if (error?.isFabricError) { // Use contract-based detection instead of property-based
            const fabricError = error as IFabricError;
            if (!fabricError.didProcessFabricError) { // if we haven't processed it yet (multipe nested doFabricActions)
                options.telemetryActivity?.addOrUpdateProperties({
                    nonLocalizedMessage: fabricError.nonLocalizedMessage,
                });
                fabricError.didProcessFabricError = true; // flag indicating we did process this error as a Fabric Error
                const logImportance = fabricError.options?.showInFabricLog ?? LogImportance.normal;
                switch (logImportance) {
                    case LogImportance.low:
                    case LogImportance.normal:
                    case LogImportance.high:
                        options.fabricLogger?.log(fabricError.message, logImportance); // this is the localized messaage
                        break;
                    default:
                        // no log
                        break;
                }
                switch (fabricError.options?.showInUserNotification ?? 'Error') {
                    case 'None':
                        break;
                    case 'Information':
                        void vscode.window.showInformationMessage(fabricError.message); // don't await
                        break;
                    case 'Error':
                        void vscode.window.showErrorMessage(fabricError.message); // don't await
                        break;
                }
            }
        }

        // if this doFabricAction is wrapped in a withErrorHandling, this Throw will be swallowed there.
        throw error;
    }
}

/*
This is a helper function that returns a delegate with common error handling. The delegate should
use the FabricError class to throw errors, which will allow control over logging and telemetry.
The delegate is NOT invoked by this function. It is returned for later invocation.
Also useful for wrapping a chunk of code in a common error handler.
*/
export function withErrorHandling<T extends (...args: any[]) => any>(description: string, logger: ILogger, telemetryService: TelemetryService | null, fn: T): (...args: Parameters<T>) => Promise<void> {
    const returnedFunc = async (...args: Parameters<T>) => {
        try {
            await fn(...args);
        }
        catch (error: any) {
            if (error?.isFabricError) { // Use contract-based detection instead of property-based
                const fabricError = error as IFabricError;
                logger.reportExceptionTelemetryAndLog(description, 'unhandled/fabricerror', error, telemetryService, { fault: fabricError.nonLocalizedMessage ?? fabricError.message }); // this will log the nonlocalized message
                return;
            }
            if (error instanceof Error) {
                // If it's some other error, we definitely want to know about it. 
                logger.reportExceptionTelemetryAndLog(description, 'unhandled/error', error, telemetryService);
                return;
            }
            // If it's not an error, we don't know what it is, so we should still log it.
            logger.reportExceptionTelemetryAndLog(description, 'unhandled/error', error, telemetryService);
        }
    };
    return returnedFunc;
}

/**
 * Helper function that wraps an action with comprehensive error handling, telemetry tracking,
 * and special handling for user cancellations. This function combines multiple layers of error
 * handling to provide consistent behavior across cancellable operations.
 * 
 * The function provides:
 * - Telemetry tracking with success/failure/cancellation outcomes
 * - Special handling for user cancellations (ICanceledError) that don't show as failures
 * - FabricError processing for controlled user notifications and logging
 * - General error safety net for unexpected errors
 * 
 * @param description - Description of the operation for logging and telemetry
 * @param eventName - Telemetry event name as a string
 * @param logger - Logger instance for error reporting
 * @param telemetryService - Telemetry service for event tracking
 * @param actionToPerform - The async action to execute
 * @returns Promise<void>
 */
export async function doCancelableActionWithErrorHandling(
    description: string,
    eventName: string,
    logger: ILogger,
    telemetryService: TelemetryService | null,
    actionToPerform: (telemetryActivity: TelemetryActivity<TelemetryEventRecord, string>) => Promise<void>
): Promise<void> {
    return withErrorHandling(description, logger, telemetryService, async () => {
        const activity = new TelemetryActivity<TelemetryEventRecord, string>(eventName, telemetryService);
        await doFabricAction({ fabricLogger: logger, telemetryActivity: activity }, async () => {
            try {
                await actionToPerform(activity);
                activity.addOrUpdateProperties({ result: 'Succeeded' });
            }
            catch (err: any) {
                if (err && err.isCanceledError === true) {
                    activity.addOrUpdateProperties({ result: 'Canceled' });
                    const canceledError = err as ICanceledError;
                    if (canceledError.stepName) {
                        activity.addOrUpdateProperties({ lastStep: canceledError.stepName });
                    }
                    return;
                }
                activity.addOrUpdateProperties({ result: 'Failed' });
                throw err;
            }
        });
    })();
}