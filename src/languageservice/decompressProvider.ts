/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {IDecompressProvider, IPackage} from './interfaces';
import  {ILogger} from '../models/interfaces';
import { PlatformInformation } from '../models/platform';

const DecompressZip = require('decompress-zip');
const DecompressTar = require('tar');

export default class DecompressProvider implements IDecompressProvider {

    private _isWindows: boolean;

    constructor() {
        PlatformInformation.getCurrent().then((platform: PlatformInformation) => {
            this._isWindows = platform.isWindows();
        });
    }

    private decompressZip(pkg: IPackage, logger: ILogger): Promise<void> {
        const unzipper = new DecompressZip(pkg.tmpFile.name);
        return new Promise<void>((resolve, reject) => {
            let totalFiles = 0;
            unzipper.on('progress', async (index, fileCount) => {
                totalFiles = fileCount;
            });
            unzipper.on('extract', async () => {
                logger.appendLine(`Done! ${totalFiles} files unpacked.\n`);
                resolve();
            });
            unzipper.on('error', async (decompressErr) => {
                logger.appendLine(`[ERROR] ${decompressErr}`);
                reject(decompressErr);
            });
            unzipper.extract({ path: pkg.installPath });
        });
    }

    private decompressTar(pkg: IPackage, logger: ILogger): Promise<void> {
        return undefined;
    }

    public decompress(pkg: IPackage, logger: ILogger): Promise<void> {
        if (this._isWindows) {
            return this.decompressZip(pkg, logger);
        } else {
            return this.decompressTar(pkg, logger);
        }
    }
}
