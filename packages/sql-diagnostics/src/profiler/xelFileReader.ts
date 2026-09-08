/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { open } from "node:fs/promises";

import {
    BUFFER_HEADER_SIZE,
    FILE_MAGIC_BITS,
    LOG_BUFFER_HEADER_SIZE,
    SUPPORTED_VERSION,
} from "./xelFormat";
import { ProfilerEvent, XeEventParser } from "./xelParser";

const MIN_BUFFER_HEADER_BYTES = BUFFER_HEADER_SIZE + LOG_BUFFER_HEADER_SIZE;

/** Receives the events decoded from one buffer. */
export type EventBatchHandler = (batch: readonly ProfilerEvent[]) => void | Promise<void>;

/**
 * Reads an Extended Events .xel file, delivering events one buffer at a time.
 *
 * Delivery is per buffer rather than per event: a buffer is the stream's own natural batch, and
 * awaiting the handler lets a slow consumer pace the read instead of the whole file being
 * decoded into memory at once.
 */
export async function readXelFile(
    filePath: string,
    onBatch: EventBatchHandler,
    signal?: AbortSignal,
): Promise<void> {
    const handle = await open(filePath, "r");
    try {
        const parser = new XeEventParser();
        const header = Buffer.allocUnsafe(MIN_BUFFER_HEADER_BYTES);

        // The file header states how much room it occupies; buffers follow it.
        const headerRead = await handle.read(header, 0, 8, 0);
        if (headerRead.bytesRead < 8) {
            return;
        }
        if (header.readUInt32LE(0) !== FILE_MAGIC_BITS) {
            throw new Error("File is missing the Extended Events magic bits.");
        }
        const version = header.readUInt16LE(4);
        if (version !== SUPPORTED_VERSION) {
            throw new Error(`Extended Events file version ${version} is not supported.`);
        }

        let position = header.readUInt16LE(6);

        for (;;) {
            signal?.throwIfAborted();

            const read = await handle.read(header, 0, MIN_BUFFER_HEADER_BYTES, position);
            if (read.bytesRead < MIN_BUFFER_HEADER_BYTES) {
                break;
            }

            const paddedLength = header.readUInt32LE(BUFFER_HEADER_SIZE + 4);
            if (paddedLength <= MIN_BUFFER_HEADER_BYTES) {
                // A zeroed header marks the end of the written buffers.
                break;
            }

            const buffer = Buffer.allocUnsafe(paddedLength);
            const bufferRead = await handle.read(buffer, 0, paddedLength, position);
            if (bufferRead.bytesRead < paddedLength) {
                break;
            }

            const batch: ProfilerEvent[] = [];
            parser.parseBuffer(buffer, false, batch);
            if (batch.length > 0) {
                await onBatch(batch);
            }

            position += paddedLength;
        }
    } finally {
        await handle.close();
    }
}

/** Reads an entire .xel file into memory. Convenient for tests and small captures. */
export async function readXelFileAll(filePath: string): Promise<ProfilerEvent[]> {
    const events: ProfilerEvent[] = [];
    await readXelFile(filePath, (batch) => {
        events.push(...batch);
    });
    return events;
}
