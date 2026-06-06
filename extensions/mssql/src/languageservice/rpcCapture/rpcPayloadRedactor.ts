/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RpcRedactionSummary } from "../../sharedInterfaces/rpcInspector";

export interface RpcPayloadRedactionResult {
    value: unknown;
    summary: RpcRedactionSummary;
}

interface RedactionContext {
    method?: string;
    path: string[];
    errorPayload?: boolean;
    depth: number;
}

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_PROPERTIES = 80;
const MAX_SAFE_STRING_LENGTH = 1024;

const CONNECTION_STRING_REGEX =
    /(^|;)\s*(server|data source|initial catalog|database|user id|uid|password|pwd)\s*=/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOWS_PATH_REGEX = /^[a-zA-Z]:[\\/]/;
const URI_OR_PATH_REGEX = /^(file|untitled|vscode-notebook-cell):|^\/(Users|home|var|tmp)\//i;

const SENSITIVE_KEY_CATEGORIES: Array<[RegExp, string]> = [
    [/^(password|pwd|secret|clientsecret|client_secret)$/i, "secret"],
    [/token|assertion|credential|accesskey|refresh/i, "token"],
    [/^(connectionstring|connection_string)$/i, "connectionString"],
    [/^(owneruri|owner_uri)$/i, "ownerUri"],
    [/^(filepath|filename|path|uri)$/i, "path"],
    [/(^server(name)?$|server(name)?$|^datasource$)/i, "server"],
    [/(^database(name)?$|database(name)?$|^initialcatalog$|^catalog$)/i, "database"],
    [/^(user|userid|user_id|username|userName|login|email)$/i, "user"],
    [/tenant.*id|account.*id|subscription.*id|client.*id|connection.*id/i, "id"],
    [/^(query|querytext|query_string|queryString|script)$/i, "query"],
    [/^(text|sql)$/i, "text"],
    [/^(rows|rowvalues|resultrows|results)$/i, "rows"],
];

export class RpcPayloadRedactor {
    private readonly _placeholderIndexes = new Map<string, number>();
    private readonly _counts: Record<string, number> = {};
    private _truncated = 0;

    public sanitize(
        value: unknown,
        method?: string,
        errorPayload?: boolean,
    ): RpcPayloadRedactionResult {
        this._countsReset();
        const seen = new WeakSet<object>();
        const sanitized = this.sanitizeValue(value, seen, {
            method,
            path: [],
            errorPayload,
            depth: 0,
        });

        return {
            value: sanitized,
            summary: {
                counts: { ...this._counts },
                truncated: this._truncated,
            },
        };
    }

    private sanitizeValue(
        value: unknown,
        seen: WeakSet<object>,
        context: RedactionContext,
    ): unknown {
        if (value === undefined || value === null) {
            return value;
        }

        if (typeof value === "string") {
            return this.sanitizeString(value, context);
        }

        if (typeof value === "number" || typeof value === "boolean") {
            return value;
        }

        if (typeof value === "bigint") {
            return Number.isSafeInteger(Number(value))
                ? Number(value)
                : this.placeholder("number", value.toString());
        }

        if (typeof value !== "object") {
            return this.placeholder("unsupported", String(value));
        }

        if (seen.has(value)) {
            this.increment("circular");
            return "<circular>";
        }

        if (context.depth >= MAX_DEPTH) {
            this.increment("depth");
            this._truncated++;
            return this.summaryObject("object", { truncatedAtDepth: context.depth });
        }

        seen.add(value);

        if (Array.isArray(value)) {
            return this.sanitizeArray(value, seen, context);
        }

        return this.sanitizeObject(value as Record<string, unknown>, seen, context);
    }

    private sanitizeArray(
        value: unknown[],
        seen: WeakSet<object>,
        context: RedactionContext,
    ): unknown {
        const keyCategory = this.getCategoryForKey(this.lastPathSegment(context));
        if (keyCategory === "rows") {
            this.increment("rows");
            return this.summaryObject("rows", {
                rowCount: value.length,
                columnCount: this.estimateColumnCount(value),
            });
        }

        const result: unknown[] = [];
        const count = Math.min(value.length, MAX_ARRAY_ITEMS);
        for (let index = 0; index < count; index++) {
            result.push(
                this.sanitizeValue(value[index], seen, {
                    ...context,
                    path: [...context.path, String(index)],
                    depth: context.depth + 1,
                }),
            );
        }

        if (value.length > MAX_ARRAY_ITEMS) {
            this.increment("array");
            this._truncated++;
            result.push(
                this.summaryObject("array", {
                    totalLength: value.length,
                    retainedLength: MAX_ARRAY_ITEMS,
                }),
            );
        }

        return result;
    }

    private sanitizeObject(
        value: Record<string, unknown>,
        seen: WeakSet<object>,
        context: RedactionContext,
    ): unknown {
        const result: Record<string, unknown> = {};
        const entries = Object.entries(value);
        const count = Math.min(entries.length, MAX_OBJECT_PROPERTIES);

        for (let index = 0; index < count; index++) {
            const [key, childValue] = entries[index];
            const childContext: RedactionContext = {
                ...context,
                path: [...context.path, key],
                errorPayload: context.errorPayload || key.toLowerCase() === "error",
                depth: context.depth + 1,
            };
            result[key] = this.sanitizeProperty(key, childValue, seen, childContext);
        }

        if (entries.length > MAX_OBJECT_PROPERTIES) {
            this.increment("object");
            this._truncated++;
            result.__rpcInspectorSummary = this.summaryObject("object", {
                totalPropertyCount: entries.length,
                retainedPropertyCount: MAX_OBJECT_PROPERTIES,
            });
        }

        return result;
    }

    private sanitizeProperty(
        key: string,
        value: unknown,
        seen: WeakSet<object>,
        context: RedactionContext,
    ): unknown {
        const category = this.getCategoryForKey(key);

        if (category === "rows" && Array.isArray(value)) {
            this.increment("rows");
            return this.summaryObject("rows", {
                rowCount: value.length,
                columnCount: this.estimateColumnCount(value),
            });
        }

        if (typeof value === "string" && category) {
            if (category === "path") {
                return this.sanitizeSensitiveString(
                    value,
                    this.pathPlaceholderCategory(value),
                    context,
                );
            }
            return this.sanitizeSensitiveString(value, category, context);
        }

        if (category === "secret" || category === "token") {
            this.increment(category);
            return this.placeholder(category, String(value ?? ""));
        }

        if (category === "id" && (typeof value === "number" || typeof value === "boolean")) {
            this.increment(category);
            return this.placeholder(category, String(value));
        }

        return this.sanitizeValue(value, seen, context);
    }

    private sanitizeString(value: string, context: RedactionContext): unknown {
        const key = this.lastPathSegment(context);
        const category = this.getCategoryForKey(key);
        if (category) {
            return this.sanitizeSensitiveString(value, category, context);
        }

        if (context.errorPayload && key.toLowerCase() === "message") {
            this.increment("errorText");
            return `<errorText length=${value.length}>`;
        }

        if (CONNECTION_STRING_REGEX.test(value) && value.includes(";")) {
            return this.sanitizeSensitiveString(value, "connectionString", context);
        }

        if (EMAIL_REGEX.test(value)) {
            return this.sanitizeSensitiveString(value, "email", context);
        }

        if (WINDOWS_PATH_REGEX.test(value) || URI_OR_PATH_REGEX.test(value)) {
            return this.sanitizeSensitiveString(
                value,
                this.pathPlaceholderCategory(value),
                context,
            );
        }

        if (value.length > MAX_SAFE_STRING_LENGTH) {
            this.increment("text");
            this._truncated++;
            return `<text length=${value.length}>`;
        }

        return value;
    }

    private sanitizeSensitiveString(
        value: string,
        category: string,
        context: RedactionContext,
    ): string {
        const normalizedCategory = category === "text" ? this.textCategory(context) : category;
        if (normalizedCategory === "query") {
            this.increment("query");
            return `<query length=${value.length}>`;
        }

        if (normalizedCategory === "text") {
            this.increment("text");
            return `<text length=${value.length}>`;
        }

        if (normalizedCategory === "connectionString") {
            this.increment("connectionString");
            return this.placeholder("connectionString", value);
        }

        this.increment(normalizedCategory);
        return this.placeholder(normalizedCategory, value);
    }

    private getCategoryForKey(key: string | undefined): string | undefined {
        if (!key) {
            return undefined;
        }

        const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, "");
        for (const [regex, category] of SENSITIVE_KEY_CATEGORIES) {
            if (regex.test(normalizedKey)) {
                return category;
            }
        }

        return undefined;
    }

    private textCategory(context: RedactionContext): "query" | "text" {
        const method = context.method?.toLowerCase() ?? "";
        if (
            method.startsWith("textdocument/") ||
            method.includes("query") ||
            context.path.some((segment) => segment.toLowerCase().includes("query"))
        ) {
            return "query";
        }

        return "text";
    }

    private pathPlaceholderCategory(value: string): "ownerUri" | "path" {
        return /^(file|untitled|vscode-notebook-cell):/i.test(value) ? "ownerUri" : "path";
    }

    private placeholder(category: string, value: string): string {
        const key = `${category}:${value}`;
        let index = this._placeholderIndexes.get(key);
        if (index === undefined) {
            const nextIndex =
                [...this._placeholderIndexes.keys()].filter((item) =>
                    item.startsWith(`${category}:`),
                ).length + 1;
            index = nextIndex;
            this._placeholderIndexes.set(key, index);
        }

        return `<${category}:${index}>`;
    }

    private estimateColumnCount(rows: unknown[]): number | undefined {
        const firstRow = rows.find((row) => row !== undefined && row !== null);
        if (!firstRow) {
            return undefined;
        }

        if (Array.isArray(firstRow)) {
            return firstRow.length;
        }

        if (typeof firstRow === "object") {
            return Object.keys(firstRow as Record<string, unknown>).length;
        }

        return 1;
    }

    private summaryObject(kind: string, data: Record<string, unknown>): Record<string, unknown> {
        return {
            __rpcInspectorSummary: kind,
            ...data,
        };
    }

    private lastPathSegment(context: RedactionContext): string | undefined {
        return context.path.length > 0 ? context.path[context.path.length - 1] : undefined;
    }

    private increment(category: string): void {
        this._counts[category] = (this._counts[category] ?? 0) + 1;
    }

    private _countsReset(): void {
        for (const key of Object.keys(this._counts)) {
            delete this._counts[key];
        }
        this._truncated = 0;
    }
}
