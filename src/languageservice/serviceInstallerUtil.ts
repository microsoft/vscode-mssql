/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {Runtime, PlatformInformation} from '../models/platform';
import Config from  '../configurations/config';
import ServiceDownloadProvider from './serviceDownloadProvider';
import DecompressProvider from './decompressProvider';
import HttpClient from './httpClient';
import ServerProvider from './server';
import {IStatusView} from './interfaces';
import {ILogger} from '../models/interfaces';

export class StubStatusView implements IStatusView {
    installingService(): void {
        console.log('...');
    }
    serviceInstalled(): void {
        console.log('Service installed');
    }
    serviceInstallationFailed(): void {
        console.log('Service installation failed');
    }
    updateServiceDownloadingProgress(downloadPercentage: number): void {
        if (downloadPercentage === 100) {
             process.stdout.write('100%');
        }
    }
}

export class StubLogger implements ILogger {
    logDebug(message: string): void {
        console.log(message);
    }

    increaseIndent(): void {
        console.log('increaseIndent');
    }

    decreaseIndent(): void {
        console.log('decreaseIndent');
    }

    append(message?: string): void {
        process.stdout.write(message);
    }
    appendLine(message?: string): void {
        console.log(message);
    }
}

const config = new Config();
const logger = new StubLogger();
const statusView = new StubStatusView();
const httpClient = new HttpClient();
const decompressProvider = new DecompressProvider();
let downloadProvider = new ServiceDownloadProvider(config, logger, statusView, httpClient, decompressProvider);
let serverProvider = new  ServerProvider(downloadProvider, config, statusView);

/*
* Installs the service for the given platform if it's not already installed.
*/
export function installService(runtime: Runtime): Promise<String> {
    if (runtime === undefined) {
        return PlatformInformation.getCurrent().then( platformInfo => {
            if (platformInfo.isValidRuntime()) {
                return serverProvider.getOrDownloadServer(platformInfo.runtimeId);
            } else {
                throw new Error('unsupported runtime');
            }
        });
    } else {
        return serverProvider.getOrDownloadServer(runtime);
    }
}
