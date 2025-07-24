/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DecompressTar from "tar";
import * as yauzl from "yauzl";

import { IDecompressProvider, IPackage } from "./interfaces";

import { ILogger } from "../models/interfaces";

export default class DecompressProvider implements IDecompressProvider {
    private decompressZip(pkg: IPackage, logger: ILogger): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            yauzl.open(pkg.tmpFile.name, { lazyEntries: true }, (err, zipfile) => {
                if (err) {
                    logger.appendLine(`[ERROR] ${err}`);
                    reject(err);
                    return;
                }

                zipfile.readEntry();
                zipfile.on("entry", (entry) => {
                    if (/\/$/.test(entry.fileName)) {
                        // Directory file names end with '/'
                        zipfile.readEntry();
                    } else {
                        // File entry
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                logger.appendLine(`[ERROR] ${err}`);
                                reject(err);
                                return;
                            }
                            readStream.on("end", () => {
                                zipfile.readEntry();
                            });
                            readStream.pipe(
                                require("fs").createWriteStream(
                                    `${pkg.installPath}/${entry.fileName}`,
                                ),
                            );
                        });
                    }
                });

                zipfile.on("end", () => {
                    logger.appendLine(`Done! Files unpacked.\n`);
                    resolve();
                });
            });
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
