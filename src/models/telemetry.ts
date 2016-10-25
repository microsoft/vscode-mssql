'use strict';
import vscode = require('vscode');
import Utils = require('./utils');
import TelemetryReporter from 'vscode-extension-telemetry';

export namespace Telemetry {
    let reporter: TelemetryReporter;
    let userId: string;
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

    export interface ITelemetryEventProperties {
        [key: string]: string;
    }

    export interface ITelemetryEventMeasures {
        [key: string]: number;
    }

    // Disable telemetry reporting
    export function disable(): void {
        disabled = true;
    }

    // Send a telemetry event using application insights
    export function sendTelemetryEvent(
        context: vscode.ExtensionContext,
        eventName: string,
        properties?: ITelemetryEventProperties,
        measures?: ITelemetryEventMeasures): void {

        if (typeof disabled === 'undefined') {
            disabled = false;
        }
        if (disabled) {
            // Don't do anything if telemetry is disabled
            return;
        }

        if (typeof properties === 'undefined') {
            properties = {};
        }

        // Initialize the telemetry reporter if necessary
        let packageInfo = Utils.getPackageInfo(context);
        if (typeof reporter === 'undefined') {
            reporter = new TelemetryReporter('vscode-mssql', packageInfo.version, packageInfo.aiKey);
        }

        // Augment the properties structure with additional common properties before sending
        getUserId().then( id => {
            properties['userId'] = id;

            reporter.sendTelemetryEvent(eventName, properties, measures);
        });
    }
}

export default Telemetry;
