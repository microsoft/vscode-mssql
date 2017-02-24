'use strict';
import vscode = require('vscode');
import TelemetryReporter from 'vscode-extension-telemetry';
import Utils = require('./utils');
import { PlatformInformation } from './platform';

export namespace Telemetry {
    let reporter: TelemetryReporter;
    let userId: string;
    let platformInformation: PlatformInformation;
    let disabled: boolean;

    // Get the unique ID for the current user of the extension
    function getUserId(): Promise<string> {
        return new Promise<string>(resolve => {
            // Generate the user id if it has not been created already
            if (typeof userId === 'undefined') {
                let id = Utils.generateUserId();
                id.then( newId => {
                    userId = newId;
                    resolve(userId);
                });
            } else {
                resolve(userId);
            }
        });
    }

    function getPlatformInformation(): Promise<PlatformInformation> {
        if (platformInformation) {
            return Promise.resolve(platformInformation);
        } else {
            return new Promise<PlatformInformation>(resolve => {
                PlatformInformation.GetCurrent().then(info => {
                    platformInformation = info;
                    resolve(platformInformation);
                });
            });
        }
    }

    export interface ITelemetryEventProperties {
        [key: string]: string;
    }

    export interface ITelemetryEventMeasures {
        [key: string]: number;
    }

    /**
     * Disable telemetry reporting
     */
    export function disable(): void {
        disabled = true;
    }

    /**
     * Initialize the telemetry reporter for use.
     */
    export function initialize(context: vscode.ExtensionContext): void {
        if (typeof reporter === 'undefined') {
            // Check if the user has opted out of telemetry
            if (!vscode.workspace.getConfiguration('telemetry').get<boolean>('enableTelemetry', true)) {
                disable();
                return;
            }

            let packageInfo = Utils.getPackageInfo(context);
            reporter = new TelemetryReporter('vscode-mssql', packageInfo.version, packageInfo.aiKey);
        }
    }

    /**
     * Filters error paths to only include source files. Exported to support testing
     */
    export function FilterErrorPath(line: string): string {
        if (line) {
            let values: string[] = line.split('/out/');
            if (values.length <= 1) {
                // Didn't match expected format
                return line;
            } else {
                return values[1];
            }
        }
    }

    /**
     * Send a telemetry event for an exception
     */
    export function sendTelemetryEventForException(
        err: any, methodName: string): void {
        try {
            let stackArray: string[];
            let firstLine: string = '';
            if ( err !== undefined && err.stack !== undefined) {
                stackArray = err.stack.split('\n');
                if (stackArray !== undefined && stackArray.length >= 2) {
                    firstLine = stackArray[1]; // The fist line is the error message and we don't want to send that telemetry event
                    firstLine = FilterErrorPath(firstLine);
                }
            }

            // Only adding the method name and the fist line of the stack trace. We don't add the error message because it might have PII
            Telemetry.sendTelemetryEvent('Exception', {methodName: methodName, errorLine: firstLine});
            Utils.logDebug('Unhandled Exception occurred. error: ' + err + ' method: ' + methodName );
        } catch (telemetryErr) {
            // If sending telemetry event fails ignore it so it won't break the extension
            Utils.logDebug('Failed to send telemetry event. error: ' + telemetryErr );
        }
    }

    /**
     * Send a telemetry event using application insights
     */
    export function sendTelemetryEvent(
        eventName: string,
        properties?: ITelemetryEventProperties,
        measures?: ITelemetryEventMeasures): void {

        if (typeof disabled === 'undefined') {
            disabled = false;
        }
        if (disabled || typeof(reporter) === 'undefined') {
            // Don't do anything if telemetry is disabled
            return;
        }

        if (!properties || typeof properties === 'undefined') {
            properties = {};
        }

        // Augment the properties structure with additional common properties before sending
        Promise.all<string|PlatformInformation>([getUserId(), getPlatformInformation()]).then(() => {
            properties['userId'] = userId;
            properties['distribution'] = (platformInformation && platformInformation.distribution) ?
                `${platformInformation.distribution.name}, ${platformInformation.distribution.version}` : '';

            reporter.sendTelemetryEvent(eventName, properties, measures);
        });
    }
}

export default Telemetry;
