/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import {IDecompressProvider, IPackage} from './interfaces';
import  {ILogger} from '../models/interfaces';
const decompress = require('decompress-zip');

export default class DecompressProvider implements IDecompressProvider {
    public decompress(pkg: IPackage, logger: ILogger): Promise<void> {
        const unzipper = new decompress(pkg.tmpFile.name);
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
}
