/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Zip extraction for the DAB CLI NuGet package.
 *
 * The service downloader's DecompressProvider works against its own package
 * descriptor and extracts everything; this needs to pull a subset of entries out
 * of a .nupkg into a plain directory, so it drives yauzl directly.
 */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as yauzl from "yauzl";

/**
 * Rejects an entry whose path would escape the destination directory. A NuGet
 * package is not hostile input in practice, but an archive is still untrusted
 * data and zip-slip is cheap to rule out.
 */
function resolveSafeEntryPath(destinationPath: string, entryName: string): string | undefined {
    const resolvedDestination = path.resolve(destinationPath);
    const resolvedEntry = path.resolve(resolvedDestination, entryName);
    const isInsideDestination =
        resolvedEntry === resolvedDestination ||
        resolvedEntry.startsWith(resolvedDestination + path.sep);

    return isInsideDestination ? resolvedEntry : undefined;
}

/**
 * Extracts a zip archive into a directory.
 *
 * @param archivePath Path of the archive to read
 * @param destinationPath Directory to extract into; created as needed
 * @param shouldExtract Optional filter over the archive's entry names, which use
 * forward slashes. Entries it rejects are skipped.
 */
export async function extractZipArchive(
    archivePath: string,
    destinationPath: string,
    shouldExtract?: (entryName: string) => boolean,
): Promise<void> {
    await fsPromises.mkdir(destinationPath, { recursive: true });

    return new Promise<void>((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
            if (openError || !zipFile) {
                reject(openError ?? new Error(`Unable to open archive: ${archivePath}`));
                return;
            }

            const fail = (error: Error) => {
                zipFile.close();
                reject(error);
            };

            zipFile.on("error", fail);
            zipFile.on("end", () => resolve());

            zipFile.on("entry", (entry: yauzl.Entry) => {
                const entryName = entry.fileName;

                if (shouldExtract && !shouldExtract(entryName)) {
                    zipFile.readEntry();
                    return;
                }

                const targetPath = resolveSafeEntryPath(destinationPath, entryName);
                if (!targetPath) {
                    fail(
                        new Error(`Archive entry escapes the destination directory: ${entryName}`),
                    );
                    return;
                }

                // Directory entries end with a forward slash and carry no content.
                if (entryName.endsWith("/")) {
                    fs.mkdir(targetPath, { recursive: true }, (mkdirError) => {
                        if (mkdirError) {
                            fail(mkdirError);
                            return;
                        }
                        zipFile.readEntry();
                    });
                    return;
                }

                fs.mkdir(path.dirname(targetPath), { recursive: true }, (mkdirError) => {
                    if (mkdirError) {
                        fail(mkdirError);
                        return;
                    }

                    zipFile.openReadStream(entry, (streamError, readStream) => {
                        if (streamError || !readStream) {
                            fail(streamError ?? new Error(`Unable to read entry: ${entryName}`));
                            return;
                        }

                        const writeStream = fs.createWriteStream(targetPath);
                        readStream.on("error", fail);
                        writeStream.on("error", fail);
                        writeStream.on("close", () => zipFile.readEntry());
                        readStream.pipe(writeStream);
                    });
                });
            });

            zipFile.readEntry();
        });
    });
}
