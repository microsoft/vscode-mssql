'use strict';
import os = require('os');
import vscode = require('vscode');
import Utils = require('./utils');
import TelemetryReporter from 'vscode-extension-telemetry';

const dns = require('dns');

export namespace Telemetry {
    let reporter: TelemetryReporter;
    let userId: string;
    let disabled: boolean;
    let internalUser: boolean;

    /**
     * List of all Microsoft internal domains.
     */
    const microsoftInternalDomainList: string[] = [
        'redmond.corp.microsoft.com',
        'northamerica.corp.microsoft.com',
        'fareast.corp.microsoft.com',
        'ntdev.corp.microsoft.com',
        'wingroup.corp.microsoft.com',
        'southpacific.corp.microsoft.com',
        'wingroup.windeploy.ntdev.microsoft.com',
        'ddnet.microsoft.com'
    ];

    const sqmClientRegKey = 'HKLM\\Software\\Policies\\Microsoft\\SQMClient';
    const msftInternalRegValue = 'MSFTInternal';

    function getIsUserInternal(): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            if (typeof(internalUser) === 'undefined') {
                isUserInternal().then(result => {
                    internalUser = result;
                    resolve(result);
                });
            } else {
                resolve(internalUser);
            }
        });
    }

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

    function checkIfOnInternalNetwork(resolve: (value?: boolean | PromiseLike<boolean>) => void): void {
        // Check if any DNS hostnames are Microsoft internal
        let servers: string[] = dns.getServers();
        lookupDnsHostnames(servers, [], 0).then(hostnames => {
            for (let i = 0; i < hostnames.length; i++) {
                for (let j = 0; j < microsoftInternalDomainList.length; j++) {
                    if (hostnames[i].indexOf(microsoftInternalDomainList[j]) !== -1) {
                        resolve(true);
                        return;
                    }
                }
            }
            resolve(false);
        });
    }

    function isUserInternal(): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            if (os.platform() === 'win32') {
                // Check the windows registry for the internal Microsoft key
                const regedit = require('regedit');
                regedit.list(sqmClientRegKey, (err, result) => {
                    if (!err &&
                        result &&
                        result[sqmClientRegKey] &&
                        result[sqmClientRegKey].values &&
                        result[sqmClientRegKey].values[msftInternalRegValue] &&
                        result[sqmClientRegKey].values[msftInternalRegValue].value === 1) {
                        resolve(true);
                    } else {
                        checkIfOnInternalNetwork(resolve);
                    }
                });
            } else {
                checkIfOnInternalNetwork(resolve);
            }
        });
    }

    function lookupDnsHostnames(servers: string[], serverHostnames: string[], index: number): Promise<string[]> {
        return new Promise<string[]>(resolve => {
            if (index >= servers.length) {
                resolve(serverHostnames);
            } else {
                dns.reverse(servers[index], (err, domains) => {
                    if (!err) {
                        serverHostnames = serverHostnames.concat(domains);
                    }
                    lookupDnsHostnames(servers, serverHostnames, ++index).then(hostnames => {
                        resolve(hostnames);
                    });
                });
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
            reporter = new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
        }

        // Augment the properties structure with additional common properties before sending
        getIsUserInternal().then(internal => {
            getUserId().then( id => {
                measures['isUserInternal'] = internal ? 1 : 0;
                properties['userId'] = id;
                properties['computerName'] = '';
                properties['userName'] = '';

                if (internal) { // Capture personal information only if we are Microsoft internal
                    properties['computerName'] = os.hostname();
                    if (os.platform() === 'win32') {
                        properties['userName'] = process.env['USERNAME'];
                    } else {
                        if (process.env['LOGNAME']) {
                            properties['userName'] = process.env['LOGNAME'];
                        } else {
                            properties['userName'] = process.env['USER'];
                        }
                    }
                }

                reporter.sendTelemetryEvent(eventName, properties, measures);
            });
        });
    }
}

export default Telemetry;
