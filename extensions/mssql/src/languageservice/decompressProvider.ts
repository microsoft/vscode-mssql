/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DecompressTar from "tar";
import * as yauzl from "yauzl";
import * as fs from "fs";
import * as path from "path";
import { IDecompressProvider, IPackage } from "./interfaces";

import { ILogger } from "../models/interfaces";

export default class DecompressProvider implements IDecompressProvider {
    private decompressZip(pkg: IPackage, logger: ILogger): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            logger.appendLine(`[decompressZip] Opening zip: ${pkg.tmpFile.name}`);
            yauzl.open(pkg.tmpFile.name, { lazyEntries: true }, (err, zipfile) => {
                if (err) {
                    logger.appendLine(`[ERROR] Failed to open zip: ${err}`);
                    reject(err);
                    return;
                }

                logger.appendLine(`[decompressZip] Zip opened. Entry count: ${zipfile.entryCount}`);

                // Keep the Node.js event loop alive for the entire decompression. Without this,
                // Node.js 24 occasionally drains the event loop between the yauzl.open callback
                // and the first fs.read completion for the central-directory walk, causing the
                // process to exit with code 0 before any entries are extracted.
                const keepAlive = setInterval(() => {}, 500);
                const cleanup = () => clearInterval(keepAlive);

                logger.appendLine(`[decompressZip] Calling readEntry`);
                zipfile.readEntry();
                logger.appendLine(`[decompressZip] readEntry() returned`);
                // Confirm the event loop is still live on the next tick
                setImmediate(() =>
                    logger.appendLine(
                        `[decompressZip] setImmediate after readEntry — event loop alive`,
                    ),
                );

                zipfile.on("entry", (entry) => {
                    if (/\/$/.test(entry.fileName)) {
                        // Directory file names end with '/'
                        const dirPath = path.join(pkg.installPath, entry.fileName);

                        // Create directory
                        fs.mkdir(dirPath, { recursive: true }, (err) => {
                            if (err) {
                                logger.appendLine(
                                    `[ERROR] Failed to create directory ${dirPath}: ${err}`,
                                );
                                reject(err);
                                return;
                            }
                            zipfile.readEntry();
                        });
                    } else {
                        // File entry
                        const filePath = path.join(pkg.installPath, entry.fileName);
                        const dirPath = path.dirname(filePath);

                        // Ensure parent directory exists first
                        fs.mkdir(dirPath, { recursive: true }, (err) => {
                            if (err) {
                                logger.appendLine(
                                    `[ERROR] Failed to create directory ${dirPath}: ${err}`,
                                );
                                reject(err);
                                return;
                            }

                            // Now extract the file
                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) {
                                    logger.appendLine(`[ERROR] ${err}`);
                                    reject(err);
                                    return;
                                }

                                const writeStream = fs.createWriteStream(filePath);

                                // Handle write stream errors
                                writeStream.on("error", (err) => {
                                    logger.appendLine(
                                        `[ERROR] Failed to write ${filePath}: ${err}`,
                                    );
                                    reject(err);
                                });

                                // Wait for write stream to finish, not just read stream
                                writeStream.on("close", () => {
                                    logger.appendLine(`Extracted: ${entry.fileName}`);
                                    zipfile.readEntry();
                                });

                                // Handle read stream errors
                                readStream.on("error", (err) => {
                                    logger.appendLine(
                                        `[ERROR] Read error for ${entry.fileName}: ${err}`,
                                    );
                                    reject(err);
                                });

                                readStream.pipe(writeStream);
                            });
                        });
                    }
                });

                zipfile.on("end", () => {
                    cleanup();
                    logger.appendLine(`Done! Files unpacked.\n`);
                    resolve();
                });

                zipfile.on("error", (err) => {
                    cleanup();
                    logger.appendLine(`[ERROR] Zipfile error: ${err}`);
                    reject(err);
                });
            });
        });
    }

    private async decompressTar(pkg: IPackage, logger: ILogger): Promise<void> {
        let totalFiles = 0;
        await DecompressTar.extract({
            file: pkg.tmpFile.name,
            cwd: pkg.installPath,
            onentry: () => {
                totalFiles++;
            },
            onwarn: (warn) => {
                logger.appendLine(`[ERROR] ${warn}`);
            },
        });
        logger.appendLine(`Done! ${totalFiles} files unpacked.\n`);
    }

    public decompress(pkg: IPackage, logger: ILogger): Promise<void> {
        if (pkg.isZipFile) {
            return this.decompressZip(pkg, logger);
        } else {
            return this.decompressTar(pkg, logger);
        }
    }
}
