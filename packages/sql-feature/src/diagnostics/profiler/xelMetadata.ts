/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseType, ObjectType, Rid, TICKS_PER_SECOND, XeReader } from "./xelFormat";

/** Clock configuration for a package, used to turn event ticks into a wall time. */
export interface TicksConfig {
    readonly startTimeUtc: bigint;
    readonly frequency: bigint;
}

export function ticksToFileTime(ticks: bigint, config: TicksConfig): bigint {
    if (config.frequency === 0n) {
        return config.startTimeUtc + ticks;
    }
    // Match the reference implementation's arithmetic: scale ticks into 100ns units.
    return config.startTimeUtc + (ticks * BigInt(TICKS_PER_SECOND)) / config.frequency;
}

export interface DataAttribute {
    readonly type: Rid;
    readonly name: string;
    readonly offset: number;
}

/** A field's read plan, with every metadata lookup already resolved. */
export interface FieldPlan {
    readonly name: string;
    readonly offset: number;
    readonly baseType: number;
    /** 0 means the value is variable length and preceded by an offset/length descriptor. */
    readonly typeSize: number;
    readonly map?: XeMap;
}

export interface XeEventType {
    readonly name: string;
    readonly eventId: string;
    readonly dataAttributes: readonly DataAttribute[];
    /** Built the first time an event of this type is decoded, then reused. */
    plan?: readonly FieldPlan[];
}

export interface XeAction {
    readonly name: string;
    readonly type: Rid;
}

export interface XeType {
    readonly size: number;
}

export interface XeMap {
    readonly size: number;
    readonly isBitmask: boolean;
    readonly entries: ReadonlyMap<number, string>;
}

export interface XePackage {
    ticksConfig: TicksConfig;
    metadataSizeInBytes: number;
    packageIndex: number;
    /** Objects by kind, indexed by the ObjectType values. */
    collections: (unknown[] | undefined)[];
}

/**
 * Translates a map code to its display string, decomposing bitmask maps into the set flags.
 */
export function translateMap(map: XeMap, code: number): string {
    if (!map.isBitmask) {
        return map.entries.get(code) ?? String(code);
    }

    const parts: string[] = [];
    let bit = 0;
    for (let remaining = code; remaining !== 0; remaining >>= 1, bit++) {
        if ((remaining & 1) !== 1) {
            continue;
        }
        parts.push(map.entries.get(1 << (bit & 31)) ?? String(code));
    }
    return parts.join(",");
}

/**
 * Decoded metadata for a stream: everything needed to turn raw event buffers into named events
 * with named fields. Streams re-send metadata as sessions change, so packages merge.
 */
export class XeMetadata {
    private static readonly _maxPackages = 1024;

    private readonly _packages: (XePackage | undefined)[] = new Array(XeMetadata._maxPackages);

    /** Pointer width for this stream, needed to decode callstacks. */
    public pointerSize = 0;

    getPackage(packageId: number): XePackage | undefined {
        return packageId < XeMetadata._maxPackages ? this._packages[packageId] : undefined;
    }

    get<T>(rid: Rid): T | undefined {
        const pkg = this.getPackage(rid.packageId);
        const collection = pkg?.collections[rid.objectType];
        return collection?.[rid.objectId] as T | undefined;
    }

    /** Reads a metadata buffer, merging its packages into this instance. */
    readMetadataBuffer(reader: XeReader, dataOffset: number, dataLength: number): void {
        let position = dataOffset;
        const end = dataLength;

        while (position < end) {
            reader.position = position;
            const pkg = readPackage(reader);

            const existing = this._packages[pkg.packageIndex];
            if (!existing) {
                this._packages[pkg.packageIndex] = pkg;
            } else {
                merge(existing, pkg);
            }

            position += pkg.metadataSizeInBytes;
        }

        this.initializePointerSize();
    }

    private initializePointerSize(): void {
        // The pointer type sits in the first package's type collection at the index matching its
        // base type; its size is how wide a pointer is for this stream.
        const pointerType = this._packages[0]?.collections[ObjectType.Type]?.[BaseType.Pointer] as
            | XeType
            | undefined;
        if (!pointerType) {
            return;
        }
        if (pointerType.size !== 4 && pointerType.size !== 8) {
            throw new Error(
                `Pointer size ${pointerType.size} is not supported; the stream is probably corrupted.`,
            );
        }
        this.pointerSize = pointerType.size;
    }
}

function merge(into: XePackage, from: XePackage): void {
    for (let kind = 0; kind < ObjectType.Count; kind++) {
        const source = from.collections[kind];
        if (!source) {
            continue;
        }
        let target = into.collections[kind];
        if (!target || target.length < source.length) {
            const grown = new Array(source.length);
            target?.forEach((v, i) => (grown[i] = v));
            into.collections[kind] = target = grown;
        }
        for (let i = 0; i < source.length; i++) {
            if (source[i] !== undefined) {
                target[i] = source[i];
            }
        }
    }
}

/** Reads the header every metadata object starts with. */
function readObjectHeader(reader: XeReader): {
    rid: Rid;
    name: string;
    specificCapabilities: number;
} {
    reader.readUInt16(); // version
    reader.readUInt8(); // generic capabilities
    const specificCapabilities = reader.readUInt8();
    const rid = reader.readRid();
    const name = reader.readNullTerminatedString();
    reader.readNullTerminatedString(); // description
    return { rid, name, specificCapabilities };
}

function readStaticValue(reader: XeReader, attributeType: Rid): string | bigint {
    switch (attributeType.baseType) {
        case 16:
            return reader.readGuid();
        case 15:
            return reader.readNullTerminatedString();
        default:
            return reader.readBigUInt64();
    }
}

function readPackage(reader: XeReader): XePackage {
    // XE_LogDefaultMetadataPackageHeader
    reader.readUInt16(); // metadata version
    const metadataSizeInBytes = reader.readUInt32();
    reader.readGuid(); // metadata signature
    reader.readUInt16(); // metadata generation
    reader.readUInt16(); // ticks config version
    reader.readUInt16(); // padding
    reader.readUInt32(); // padding
    const startTimeUtc = reader.readBigInt64();
    const frequency = reader.readBigUInt64();

    const packageHeader = readObjectHeader(reader);

    reader.readGuid(); // package id
    reader.readGuid(); // module id
    reader.readUInt16(); // minimum context version
    const collectionCount = reader.readUInt32();
    if (collectionCount > 1000) {
        throw new Error(`Metadata is corrupted: it claims ${collectionCount} collections.`);
    }

    const pkg: XePackage = {
        ticksConfig: { startTimeUtc, frequency },
        metadataSizeInBytes,
        packageIndex: packageHeader.rid.packageId,
        collections: new Array(ObjectType.Count),
    };

    for (let i = 0; i < collectionCount; i++) {
        const kind = reader.readInt32();
        reader.readUInt16(); // collection version
        reader.readUInt16(); // object size
        let objectCount = reader.readUInt32();

        // Targets, predicates and messages are described but never carried in the stream.
        if (kind === 2 || kind === 4 || kind === 5 || kind === 7) {
            objectCount = 0;
        }
        if (kind >= 0 && kind < ObjectType.Count) {
            pkg.collections[kind] = new Array(objectCount);
        }
    }

    readEvents(reader, pkg);
    readActions(reader, pkg);
    readMaps(reader, pkg);
    readTypes(reader, pkg);
    return pkg;
}

function readEvents(reader: XeReader, pkg: XePackage): void {
    const count = reader.readUInt32();
    const collection = pkg.collections[ObjectType.Event];

    for (let i = 0; i < count; i++) {
        const header = readObjectHeader(reader);

        const staticCount = reader.readUInt16();
        const customizableCount = reader.readUInt16();
        const dataCount = reader.readUInt16();
        reader.readUInt16(); // fixed size data count

        let eventId = "";
        for (let s = 0; s < staticCount; s++) {
            const attributeType = reader.readRid();
            reader.readNullTerminatedString(); // name
            const value = readStaticValue(reader, attributeType);
            reader.readNullTerminatedString(); // description
            // The first static attribute carries the event type's identifying GUID.
            if (s === 0 && typeof value === "string") {
                eventId = value;
            }
        }

        for (let c = 0; c < customizableCount; c++) {
            const attributeType = reader.readRid();
            reader.readNullTerminatedString(); // name
            readStaticValue(reader, attributeType); // value
            reader.readBigUInt64(); // default value
            reader.readInt32(); // aggregation
            reader.readInt32(); // capabilities
            reader.readNullTerminatedString(); // description
        }

        const dataAttributes: DataAttribute[] = [];
        for (let d = 0; d < dataCount; d++) {
            const type = reader.readRid();
            const name = reader.readNullTerminatedString();
            const offset = reader.readUInt16();
            reader.readUInt16(); // capabilities
            reader.readNullTerminatedString(); // description
            dataAttributes.push({ type, name, offset });
        }

        const eventType: XeEventType = { name: header.name, eventId, dataAttributes };
        store(collection, header.rid.objectId, eventType);
    }
}

function readActions(reader: XeReader, pkg: XePackage): void {
    const count = reader.readUInt32();
    const collection = pkg.collections[ObjectType.Action];

    for (let i = 0; i < count; i++) {
        const header = readObjectHeader(reader);
        const type = reader.readRid();
        reader.readUInt32(); // storage size
        reader.readInt32(); // storage flags
        store(collection, header.rid.objectId, { name: header.name, type } satisfies XeAction);
    }
}

function readMaps(reader: XeReader, pkg: XePackage): void {
    const count = reader.readUInt32();
    const collection = pkg.collections[ObjectType.Map];

    for (let i = 0; i < count; i++) {
        const header = readObjectHeader(reader);
        const isBitmask = (header.specificCapabilities & 1) === 1;

        const size = reader.readUInt8();
        const entryCount = reader.readUInt16();
        const entries = new Map<number, string>();
        for (let e = 0; e < entryCount; e++) {
            const code = reader.readUInt32();
            entries.set(code, reader.readNullTerminatedString());
        }
        store(collection, header.rid.objectId, { size, isBitmask, entries } satisfies XeMap);
    }
}

function readTypes(reader: XeReader, pkg: XePackage): void {
    const count = reader.readUInt32();
    const collection = pkg.collections[ObjectType.Type];

    for (let i = 0; i < count; i++) {
        const header = readObjectHeader(reader);
        store(collection, header.rid.objectId, { size: reader.readUInt8() } satisfies XeType);
    }
}

function store(collection: unknown[] | undefined, index: number, value: unknown): void {
    if (collection && index >= 0 && index < collection.length) {
        collection[index] = value;
    }
}
