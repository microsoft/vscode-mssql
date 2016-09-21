/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {Platform} from '../models/platform';
import Config from  '../configurations/config';
import ServiceDownloadProvider from './download';
import ServerProvider from './server';

class StubStatusView {
    installingService(fileUri: string): void {
        console.log('Installing service');
    }
    serviceInstalled(fileUri: string): void {
        console.log('Service installed');
    }
}

class StubLogger {
    logDebug(message: string): void {
        console.log(message);
    }
}

class StubVsCode {
    getActiveTextEditorUri(): string {
        return '';
    }
}

const config = new Config();
const logger = new StubLogger();
const statusView = new StubStatusView();
const stubVsCode = new StubVsCode();

/*
* Installs the service for the given platform if it's not already installed.
*/
export function installService(platform: Platform): Promise<String> {
    let downloadProvider = new ServiceDownloadProvider(config, logger);
    let serverProvider = new  ServerProvider(downloadProvider, config, statusView, stubVsCode);
    return serverProvider.getServerPath(platform);
}

/*
* Returns the install folder path for given platform.
*/
export function getServiceInstallDirectory(platform: Platform): string {
    let downloadProvider = new ServiceDownloadProvider(config, logger);
    return downloadProvider.getInstallDirectory(platform);
}

/*
* Returns the path to the root folder of service install location.
*/
export function getServiceInstallDirectoryRoot(): string {
    let downloadProvider = new ServiceDownloadProvider(config, logger);
    return downloadProvider.getInstallDirectoryRoot();
}


