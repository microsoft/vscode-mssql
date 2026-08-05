/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Read-only view over HTTP response headers.
 *
 * Header names are matched case-insensitively, so `get("Location")` and `get("location")`
 * return the same value. Repeated headers (for example `set-cookie`) keep every value;
 * use {@link IHttpHeaders.getAll} to read them all.
 */
export interface IHttpHeaders {
    /**
     * Returns the first value for the given header name, or `undefined` when the header is absent.
     *
     * @param name Case-insensitive header name.
     */
    get(name: string): string | undefined;

    /**
     * Returns every value recorded for the given header name, preserving order.
     *
     * @param name Case-insensitive header name.
     */
    getAll(name: string): readonly string[];

    /**
     * Returns whether at least one value is recorded for the given header name.
     *
     * @param name Case-insensitive header name.
     */
    has(name: string): boolean;

    /** Iterates the header entries as `[name, values]` pairs using the originally supplied casing. */
    entries(): IterableIterator<readonly [string, readonly string[]]>;
}

/** Source shape accepted when building {@link HttpHeaders}. */
export type HttpHeadersInit =
    | Readonly<Record<string, unknown>>
    | Iterable<readonly [string, unknown]>;

/**
 * Case-insensitive, multi-value HTTP header collection.
 *
 * Values that cannot be represented as a header string (`undefined`, `null`, objects) are
 * omitted. Numeric and boolean values are converted to their string representation.
 */
export class HttpHeaders implements IHttpHeaders {
    private readonly _entries = new Map<string, { name: string; values: string[] }>();

    /**
     * Creates a header collection.
     *
     * @param init Optional header record or iterable of `[name, value]` pairs.
     */
    constructor(init?: HttpHeadersInit) {
        if (!init) {
            return;
        }

        if (isIterableInit(init)) {
            for (const [name, value] of init) {
                this.append(name, value);
            }
            return;
        }

        for (const name of Object.keys(init)) {
            this.append(name, init[name]);
        }
    }

    /**
     * Adds a value for the given header name, keeping any previously recorded values.
     * Values that cannot be represented as a header string are ignored.
     *
     * @param name Header name.
     * @param value Header value or array of values.
     */
    public append(name: string, value: unknown): void {
        const normalizedValues = normalizeHeaderValue(value);
        if (normalizedValues.length === 0) {
            return;
        }

        const key = name.toLowerCase();
        const existing = this._entries.get(key);
        if (existing) {
            existing.values.push(...normalizedValues);
            return;
        }

        this._entries.set(key, { name, values: normalizedValues });
    }

    /**
     * Returns the first value for the given header name.
     *
     * @param name Case-insensitive header name.
     */
    public get(name: string): string | undefined {
        return this._entries.get(name.toLowerCase())?.values[0];
    }

    /**
     * Returns every value for the given header name.
     *
     * @param name Case-insensitive header name.
     */
    public getAll(name: string): readonly string[] {
        const values = this._entries.get(name.toLowerCase())?.values;
        return values ? [...values] : [];
    }

    /**
     * Returns whether the header is present.
     *
     * @param name Case-insensitive header name.
     */
    public has(name: string): boolean {
        return this._entries.has(name.toLowerCase());
    }

    /** Iterates the header entries as `[name, values]` pairs. */
    public *entries(): IterableIterator<readonly [string, readonly string[]]> {
        for (const entry of this._entries.values()) {
            yield [entry.name, [...entry.values]] as const;
        }
    }
}

/**
 * Creates an {@link IHttpHeaders} instance from a header record or iterable.
 *
 * @param init Optional header record or iterable of `[name, value]` pairs.
 */
export function createHttpHeaders(init?: HttpHeadersInit): IHttpHeaders {
    return new HttpHeaders(init);
}

function isIterableInit(init: HttpHeadersInit): init is Iterable<readonly [string, unknown]> {
    return typeof (init as Iterable<readonly [string, unknown]>)[Symbol.iterator] === "function";
}

function normalizeHeaderValue(value: unknown): string[] {
    if (value === undefined || value === null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((entry) => normalizeHeaderValue(entry));
    }

    switch (typeof value) {
        case "string":
            return [value];
        case "number":
            return Number.isFinite(value) ? [String(value)] : [];
        case "boolean":
        case "bigint":
            return [String(value)];
        default:
            return [];
    }
}
