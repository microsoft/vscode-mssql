/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extended Events binary stream format.
 *
 * The same buffer layout is used by .xel files and by the live stream from
 * sys.fn_MSxe_read_event_stream, so one decoder serves both. All integers are little-endian and
 * all metadata strings are null-terminated UTF-16 despite what their names suggest elsewhere.
 */

/** Magic value at the start of a stream header. */
export const FILE_MAGIC_BITS = 0xefab375a;

/** The only stream version this decoder understands. */
export const SUPPORTED_VERSION = 10;

/** Bytes in the per-buffer header that precedes the log buffer header. */
export const BUFFER_HEADER_SIZE = 12;

/** Bytes in the log buffer header. */
export const LOG_BUFFER_HEADER_SIZE = 20;

/** 100ns ticks per second, for converting event ticks to a timestamp. */
export const TICKS_PER_SECOND = 10_000_000;

export enum LogBufferType {
    Event = 0,
    Metadata = 1,
    Header = 2,
    Index = 3,
}

/** Object kinds in a package's metadata; also the index into its collection array. */
export const ObjectType = {
    Event: 0,
    Action: 1,
    Map: 3,
    Type: 6,
    Count: 9,
} as const;

/** Base data types an event field or action value can carry. */
export const BaseType = {
    Int8: 1,
    Int16: 2,
    Int32: 3,
    Int64: 4,
    UInt8: 5,
    UInt16: 6,
    UInt32: 7,
    UInt64: 8,
    Float32: 9,
    Float64: 10,
    CpuCycle: 11,
    FileTime: 12,
    Pointer: 13,
    VarAnsiString: 19,
    VarUnicodeString: 20,
    VarGuid: 21,
    VarPointer: 22,
    VarCallstack: 23,
    ActivityId: 24,
    ActivityIdTransfer: 25,
    Boolean: 26,
    VarXml: 27,
} as const;

/**
 * A packed identifier locating an object in the metadata: which package, which kind, and which
 * index within that kind.
 */
export class Rid {
    constructor(public readonly raw: number) {}

    /** Low 10 bits. */
    get packageId(): number {
        return this.raw & 0x3ff;
    }

    /** 18 bits above the package id. */
    get objectId(): number {
        return (this.raw >>> 10) & 0x3ffff;
    }

    /** Top 4 bits; one of the {@link ObjectType} values. */
    get objectType(): number {
        return this.raw >>> 28;
    }

    /**
     * For a type reference, the base data type. Shares bits with {@link objectId} because a
     * type's index in the type collection is its base type.
     */
    get baseType(): number {
        return this.objectId;
    }

    toString(): string {
        return `T:${this.objectType},O:${this.objectId},P:${this.packageId}`;
    }
}

const utf16Decoder = new TextDecoder("utf-16le");
const asciiDecoder = new TextDecoder("latin1");

/**
 * Forward-only reader over a resident Extended Events buffer. Offsets inside a buffer are
 * relative to the buffer's own start, which is index 0 here.
 */
export class XeReader {
    private readonly _view: DataView;
    public position = 0;

    constructor(public readonly bytes: Uint8Array) {
        this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get length(): number {
        return this.bytes.length;
    }

    readUInt8(): number {
        return this.bytes[this.position++];
    }

    readInt16(): number {
        const v = this._view.getInt16(this.position, true);
        this.position += 2;
        return v;
    }

    readUInt16(): number {
        const v = this._view.getUint16(this.position, true);
        this.position += 2;
        return v;
    }

    readInt32(): number {
        const v = this._view.getInt32(this.position, true);
        this.position += 4;
        return v;
    }

    readUInt32(): number {
        const v = this._view.getUint32(this.position, true);
        this.position += 4;
        return v;
    }

    readBigInt64(): bigint {
        const v = this._view.getBigInt64(this.position, true);
        this.position += 8;
        return v;
    }

    readBigUInt64(): bigint {
        const v = this._view.getBigUint64(this.position, true);
        this.position += 8;
        return v;
    }

    readFloat32(): number {
        const v = this._view.getFloat32(this.position, true);
        this.position += 4;
        return v;
    }

    readFloat64(): number {
        const v = this._view.getFloat64(this.position, true);
        this.position += 8;
        return v;
    }

    readGuid(): string {
        // A SQL Server GUID is little-endian in its first three groups and big-endian after,
        // which is the same layout .NET's Guid(byte[]) expects.
        const b = this.bytes.subarray(this.position, this.position + 16);
        this.position += 16;
        const hex = (n: number) => b[n].toString(16).padStart(2, "0");
        return (
            `${hex(3)}${hex(2)}${hex(1)}${hex(0)}-${hex(5)}${hex(4)}-${hex(7)}${hex(6)}-` +
            `${hex(8)}${hex(9)}-${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}`
        );
    }

    readRid(): Rid {
        return new Rid(this.readUInt32());
    }

    /** Reads a null-terminated UTF-16 string; metadata names and descriptions use this form. */
    readNullTerminatedString(): string {
        const start = this.position;
        while (this._view.getUint16(this.position, true) !== 0) {
            this.position += 2;
        }
        const text =
            this.position === start
                ? ""
                : utf16Decoder.decode(this.bytes.subarray(start, this.position));
        this.position += 2; // terminator
        return text;
    }

    readAnsiString(byteCount: number): string {
        const s = asciiDecoder.decode(
            this.bytes.subarray(this.position, this.position + byteCount),
        );
        this.position += byteCount;
        return s;
    }

    readUnicodeString(byteCount: number): string {
        const s = utf16Decoder.decode(
            this.bytes.subarray(this.position, this.position + byteCount),
        );
        this.position += byteCount;
        return s;
    }

    skip(byteCount: number): void {
        this.position += byteCount;
    }
}

/** Converts a FILETIME (100ns ticks since 1601) to an ISO 8601 string. */
export function fileTimeToIso(fileTime: bigint): string {
    // 11644473600 seconds between the FILETIME epoch (1601) and the Unix epoch (1970).
    const unixMs = fileTime / 10000n - 11644473600000n;
    return new Date(Number(unixMs)).toISOString();
}
