/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as yauzl from "yauzl";

/** Reads one text file out of a zip archive, such as a VSIX or an XLSX workbook. */
export function readZipEntry(zipPath: string, entryName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
            if (openError || !zip) {
                reject(openError ?? new Error(`Could not open ${zipPath}`));
                return;
            }
            zip.on("entry", (entry: yauzl.Entry) => {
                if (entry.fileName !== entryName) {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        reject(streamError ?? new Error(`Could not read ${entryName}`));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("end", () => {
                        zip.close();
                        resolve(Buffer.concat(chunks).toString("utf8"));
                    });
                    stream.on("error", reject);
                });
            });
            zip.on("end", () => reject(new Error(`${entryName} is not in ${zipPath}`)));
            zip.on("error", reject);
            zip.readEntry();
        });
    });
}
