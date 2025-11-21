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
          logger.appendLine(`Done! Files unpacked.\n`);
          resolve();
        });

        zipfile.on("error", (err) => {
          logger.appendLine(`[ERROR] Zipfile error: ${err}`);
          reject(err);
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
