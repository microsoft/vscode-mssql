/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DecompressTar from "tar";
import * as DecompressZip from "decompress-zip";

import { IDecompressProvider, IPackage } from "./interfaces";

import { ILogger } from "../models/interfaces";

export default class DecompressProvider implements IDecompressProvider {
    private decompressZip(pkg: IPackage, logger: ILogger): Promise<void> {
        const unzipper = new DecompressZip(pkg.tmpFile.name);
        return new Promise<void>((resolve, reject) => {
            let totalFiles = 0;
            unzipper.on("progress", async (index, fileCount) => {
                totalFiles = fileCount;
            });
            unzipper.on("extract", async () => {
                logger.appendLine(`Done! ${totalFiles} files unpacked.\n`);
                resolve();
            });
            unzipper.on("error", async (decompressErr) => {
                logger.appendLine(`[ERROR] ${decompressErr}`);
                reject(decompressErr);
            });
            unzipper.extract({ path: pkg.installPath });
        });
    }

    private decompressTar(pkg: IPackage, logger: ILogger): Promise<void> {
        let totalFiles = 0;
        return DecompressTar.extract(
            {
                file: pkg.tmpFile.name,
                cwd: pkg.installPath,
                onentry: () => {
                    totalFiles++;
                },
                onwarn: (warn) => {
                    logger.appendLine(`[ERROR] ${warn}`);
                },
            },
            () => {
                logger.appendLine(`Done! ${totalFiles} files unpacked.\n`);
            },
        );
    }

    public decompress(pkg: IPackage, logger: ILogger): Promise<void> {
        if (pkg.isZipFile) {
            return this.decompressZip(pkg, logger);
        } else {
            return this.decompressTar(pkg, logger);
        }
    }
}
