/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    BUFFER_HEADER_SIZE,
    BaseType,
    FILE_MAGIC_BITS,
    LogBufferType,
    ObjectType,
    SUPPORTED_VERSION,
    XeReader,
    fileTimeToIso,
} from "./xelFormat";
import {
    FieldPlan,
    XeAction,
    XeEventType,
    XeMap,
    XeMetadata,
    XeType,
    ticksToFileTime,
    translateMap,
} from "./xelMetadata";

/** One decoded Extended Event. */
export interface ProfilerEvent {
    /** Event type name, e.g. "sql_batch_completed". */
    readonly name: string;
    /** ISO 8601 UTC timestamp. */
    readonly timestamp: string;
    /**
     * GUID identifying the event *type*, not this occurrence. Every sql_batch_completed shares
     * one. Use {@link eventSequence} to identify a single event.
     */
    readonly eventTypeId: string;
    /**
     * Per-event sequence number from the session, when it collects package0.event_sequence.
     * The server assigns these contiguously, so a gap is proof that events were lost.
     */
    readonly eventSequence?: number;
    /** Field and action values, all rendered as display strings. */
    readonly values: Readonly<Record<string, string>>;
}

const ACTION_SUFFIX = " (action)";

/**
 * Decodes Extended Events buffers into profiler events.
 *
 * The same buffers arrive from a .xel file and from the live stream, so one parser serves both.
 * Instances accumulate metadata as it arrives and are not safe to share across streams.
 */
export class XeEventParser {
    private readonly _metadata = new XeMetadata();
    private readonly _suffixedActionNames = new Map<string, string>();

    /** True once a metadata buffer has been seen and events can be decoded. */
    public hasMetadata = false;

    /**
     * Decodes one complete buffer, appending any events to `output`.
     *
     * @param buffer the whole buffer, starting at its own byte 0
     * @param isStreamHeader true when the payload is a stream header rather than a log buffer
     */
    parseBuffer(buffer: Uint8Array, isStreamHeader: boolean, output: ProfilerEvent[]): void {
        const reader = new XeReader(buffer);

        if (isStreamHeader) {
            readStreamHeader(reader);
            return;
        }

        // XEBufferHeader: version, id, two reserved bytes, sequence number.
        reader.skip(BUFFER_HEADER_SIZE);

        const logVersion = reader.readUInt16();
        const bufferType = reader.readUInt16() as LogBufferType;
        reader.readUInt32(); // padded length
        reader.readUInt16(); // unused
        const dataOffset = reader.readUInt16();
        const dataLength = reader.readUInt32();
        reader.readUInt32(); // tail checksum

        if (logVersion !== SUPPORTED_VERSION) {
            throw new Error(`Extended Events stream version ${logVersion} is not supported.`);
        }

        switch (bufferType) {
            case LogBufferType.Header:
                readStreamHeader(reader);
                break;
            case LogBufferType.Metadata:
                this._metadata.readMetadataBuffer(reader, dataOffset, dataLength);
                this.hasMetadata = true;
                break;
            case LogBufferType.Event:
                if (!this.hasMetadata) {
                    throw new Error("Metadata is expected before events.");
                }
                this.readEvents(reader, dataOffset, dataLength, output);
                break;
            default:
                // Index buffers carry no events.
                break;
        }
    }

    private readEvents(
        reader: XeReader,
        dataOffset: number,
        dataLength: number,
        output: ProfilerEvent[],
    ): void {
        const dataStart = dataOffset;
        const dataEnd = dataStart + dataLength;
        reader.position = dataStart;

        while (reader.position < dataEnd) {
            const eventRid = reader.readRid();
            const flags = reader.readUInt32();
            reader.readUInt32(); // source type mask
            const ticks = reader.readBigUInt64();
            const eventLength = reader.readUInt32();

            const version = flags & 0x3f;
            if (version !== SUPPORTED_VERSION) {
                throw new Error(
                    `Event buffer version ${version} is not supported; the stream is misaligned.`,
                );
            }
            const hasActionData = flags >>> 31 === 1;

            const eventStart = reader.position;

            const pkg = this._metadata.getPackage(eventRid.packageId);
            const eventType = pkg?.collections[ObjectType.Event]?.[eventRid.objectId] as
                | XeEventType
                | undefined;
            if (!pkg || !eventType) {
                throw new Error(`Event ${eventRid} was not found in the stream metadata.`);
            }

            const plan = eventType.plan ?? this.buildPlan(eventType);
            const values: Record<string, string> = {};

            for (const field of plan) {
                reader.position = eventStart + field.offset;

                if (field.map) {
                    values[field.name] = this.readMapValue(reader, field.map);
                    continue;
                }

                let valueLength = 0;
                if (field.typeSize === 0) {
                    // Variable length values are addressed by a descriptor at the field slot.
                    const valueOffset = reader.readUInt32();
                    valueLength = reader.readUInt32();
                    reader.position = eventStart + valueOffset;
                }
                values[field.name] = this.readTypedValue(
                    reader,
                    field.baseType,
                    field.typeSize,
                    valueLength,
                );
            }

            reader.position = eventStart + eventLength;

            let eventSequence: number | undefined;
            if (hasActionData) {
                eventSequence = this.readActions(reader, values);
            }

            output.push({
                name: eventType.name,
                timestamp: fileTimeToIso(ticksToFileTime(ticks, pkg.ticksConfig)),
                eventTypeId: eventType.eventId,
                eventSequence,
                values,
            });
        }
    }

    /** Reads the actions attached to an event, returning the event sequence when collected. */
    private readActions(reader: XeReader, values: Record<string, string>): number | undefined {
        let eventSequence: number | undefined;

        for (;;) {
            const actionRid = reader.readRid();
            const actionLength = reader.readUInt32();
            const actionStart = reader.position;

            if (actionRid.objectType !== ObjectType.Action) {
                break;
            }

            const action = this._metadata.get<XeAction>(actionRid);
            if (!action) {
                throw new Error(`Action ${actionRid} was not found in the stream metadata.`);
            }

            const actionType = this._metadata.get<XeType>(action.type);
            if (actionType) {
                const value = this.readTypedValue(
                    reader,
                    action.type.baseType,
                    actionType.size,
                    actionLength,
                );

                let key = action.name;
                if (key in values) {
                    let suffixed = this._suffixedActionNames.get(key);
                    if (!suffixed) {
                        suffixed = key + ACTION_SUFFIX;
                        this._suffixedActionNames.set(key, suffixed);
                    }
                    key = suffixed;
                }
                values[key] = value;

                if (eventSequence === undefined && action.name === "event_sequence") {
                    const parsed = Number(value);
                    if (Number.isFinite(parsed)) {
                        eventSequence = parsed;
                    }
                }
            }

            reader.position = actionStart + actionLength;
        }

        return eventSequence;
    }

    /** Resolves an event type's field layout once so the per-event path needs no lookups. */
    private buildPlan(eventType: XeEventType): readonly FieldPlan[] {
        const plan: FieldPlan[] = [];

        for (const attribute of eventType.dataAttributes) {
            if (attribute.type.objectType === ObjectType.Type) {
                const type = this._metadata.get<XeType>(attribute.type);
                if (!type) {
                    throw new Error(
                        `Type ${attribute.type} for field '${attribute.name}' is missing from the metadata.`,
                    );
                }
                plan.push({
                    name: attribute.name,
                    offset: attribute.offset,
                    baseType: attribute.type.baseType,
                    typeSize: type.size,
                });
            } else if (attribute.type.objectType === ObjectType.Map) {
                const map = this._metadata.get<XeMap>(attribute.type);
                if (!map) {
                    throw new Error(
                        `Map ${attribute.type} for field '${attribute.name}' is missing from the metadata.`,
                    );
                }
                plan.push({
                    name: attribute.name,
                    offset: attribute.offset,
                    baseType: attribute.type.baseType,
                    typeSize: 0,
                    map,
                });
            } else {
                throw new Error(
                    `Field '${attribute.name}' has unsupported attribute kind ${attribute.type.objectType}.`,
                );
            }
        }

        (eventType as { plan?: readonly FieldPlan[] }).plan = plan;
        return plan;
    }

    private readMapValue(reader: XeReader, map: XeMap): string {
        let code: number;
        switch (map.size) {
            case 1:
                code = reader.readUInt8();
                break;
            case 2:
                code = reader.readInt16();
                break;
            case 4:
                code = reader.readInt32();
                break;
            case 8:
                code = Number(reader.readBigInt64());
                break;
            default:
                throw new Error(`Map values of size ${map.size} are not supported.`);
        }
        return translateMap(map, code);
    }

    /** Decodes one value directly to the string the profiler contract carries. */
    private readTypedValue(
        reader: XeReader,
        baseType: number,
        typeSize: number,
        valueLength: number,
    ): string {
        switch (baseType) {
            case BaseType.Int8:
            case BaseType.UInt8:
                return String(reader.readUInt8());
            case BaseType.Int16:
                return String(reader.readInt16());
            case BaseType.Int32:
                return String(reader.readInt32());
            case BaseType.Int64:
                return String(reader.readBigInt64());
            case BaseType.UInt16:
                return String(reader.readUInt16());
            case BaseType.UInt32:
                return String(reader.readUInt32());
            case BaseType.UInt64:
            case BaseType.CpuCycle:
                return String(reader.readBigUInt64());
            case BaseType.Float32:
                return String(reader.readFloat32());
            case BaseType.Float64:
                return String(reader.readFloat64());
            case BaseType.FileTime:
                return fileTimeToIso(reader.readBigInt64());
            case BaseType.Pointer:
                if (typeSize === 4) {
                    return "0x" + reader.readUInt32().toString(16).toUpperCase().padStart(8, "0");
                }
                if (typeSize === 8) {
                    return (
                        "0x" + reader.readBigUInt64().toString(16).toUpperCase().padStart(16, "0")
                    );
                }
                throw new Error(`Pointer values of size ${typeSize} are not supported.`);
            case BaseType.VarAnsiString:
                return reader.readAnsiString(valueLength);
            case BaseType.VarUnicodeString:
            case BaseType.VarXml:
                return reader.readUnicodeString(valueLength);
            case BaseType.VarGuid:
                return reader.readGuid();
            case BaseType.VarPointer: {
                const skip = typeSize !== 0 ? typeSize : valueLength;
                reader.skip(skip);
                return `<${skip} bytes>`;
            }
            case BaseType.VarCallstack:
                return this.readCallstack(reader, valueLength);
            case BaseType.ActivityId:
            case BaseType.ActivityIdTransfer: {
                const id = reader.readGuid();
                return `${id}:${reader.readUInt32()}`;
            }
            case BaseType.Boolean:
                return reader.readUInt8() !== 0 ? "True" : "False";
            default:
                throw new Error(`Extended Events base type ${baseType} is not supported.`);
        }
    }

    private readCallstack(reader: XeReader, valueLength: number): string {
        const pointerSize = this._metadata.pointerSize;
        if (pointerSize === 0) {
            throw new Error("Callstack values require a known pointer size.");
        }
        const frames = Math.floor(valueLength / pointerSize);
        const lines: string[] = [];
        for (let i = 0; i < frames; i++) {
            lines.push("0x" + reader.readBigUInt64().toString(16).toUpperCase().padStart(16, "0"));
        }
        return lines.join("\n") + (frames > 0 ? "\n" : "");
    }
}

function readStreamHeader(reader: XeReader): void {
    const magic = reader.readUInt32();
    if (magic !== FILE_MAGIC_BITS) {
        throw new Error("Stream is missing the Extended Events magic bits.");
    }
    const version = reader.readUInt16();
    if (version !== SUPPORTED_VERSION) {
        throw new Error(`Extended Events stream version ${version} is not supported.`);
    }
}

/** True when a payload is a stream header, identified by its own magic bits. */
export function looksLikeStreamHeader(bytes: Uint8Array): boolean {
    if (bytes.length < 4) {
        return false;
    }
    const magic = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    return magic >>> 0 === FILE_MAGIC_BITS;
}

/** Reports gaps in a run of event sequence numbers, which are proof of lost events. */
export function findSequenceGap(
    previousSequence: number | undefined,
    event: ProfilerEvent,
): { from: number; to: number; count: number } | undefined {
    if (previousSequence === undefined || event.eventSequence === undefined) {
        return undefined;
    }
    const expected = previousSequence + 1;
    if (event.eventSequence > expected) {
        return {
            from: expected,
            to: event.eventSequence - 1,
            count: event.eventSequence - expected,
        };
    }
    return undefined;
}
