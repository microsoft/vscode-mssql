/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataView } from "../../metadata/index.js";
import { normalizeIdentifier } from "../identifiers.js";
import type { CatalogTimeline, CatalogTimelineEvent, LocalCatalogState } from "./contracts.js";

/**
 * Same-document DDL, ordered by offset.
 *
 * `CREATE`, `ALTER`, `DROP`, and `SELECT INTO` are events, not facts, so what an object is depends
 * on where in the document you ask. Diagnostics, completion, hover, definition, and signature help
 * all resolve through this one timeline; a table created above the cursor exists for all of them,
 * and a table dropped above the cursor exists for none.
 */
export class DocumentCatalogTimeline implements CatalogTimeline {
    private readonly _byName: ReadonlyMap<string, readonly CatalogTimelineEvent[]>;

    public constructor(
        public readonly events: readonly CatalogTimelineEvent[],
        private readonly _metadata: MetadataView,
    ) {
        const grouped = new Map<string, CatalogTimelineEvent[]>();
        for (const event of events) {
            const key = objectNameKey(event.parts, _metadata);
            const timeline = grouped.get(key) ?? [];
            timeline.push(event);
            grouped.set(key, timeline);
        }
        this._byName = new Map(
            [...grouped].map(([key, timeline]) => [
                key,
                Object.freeze([...timeline].sort((left, right) => left.offset - right.offset)),
            ]),
        );
    }

    public resolve(
        parts: readonly string[],
        offset: number,
        kinds?: readonly string[],
    ): LocalCatalogState | undefined {
        const timeline = this._byName.get(objectNameKey(parts, this._metadata));
        const scoped = kinds ? timeline?.filter((event) => kinds.includes(event.kind)) : timeline;
        const event = lastEventAt(scoped, offset);
        if (!event) return undefined;
        if (event.action === "drop") return Object.freeze({ exists: false, event });
        return Object.freeze({
            exists: true,
            kind: event.kind,
            ...(event.columns ? { columns: event.columns } : {}),
            ...(event.parameters ? { parameters: event.parameters } : {}),
            ...(event.typeCategory ? { typeCategory: event.typeCategory } : {}),
            event,
        });
    }
}

/** A timeline with no events, used where a document has not been bound yet. */
export const emptyCatalogTimeline: CatalogTimeline = Object.freeze({
    events: Object.freeze([]),
    resolve: () => undefined,
});

/** The namespaces a name can occupy, named once so callers agree on what each contains. */
export const relationEventKinds: readonly string[] = Object.freeze([
    "table",
    "view",
    "tableFunction",
    "synonym",
]);
export const procedureEventKinds: readonly string[] = Object.freeze(["procedure"]);
export const typeEventKinds: readonly string[] = Object.freeze(["type"]);

/**
 * The catalog key for a multipart name.
 *
 * A temporary name is global to the session rather than schema-qualified, which is why `#t` keys on
 * its own name; every other name is completed with the connected database and default schema so
 * `t`, `dbo.t`, and `db.dbo.t` are one object.
 */
export function objectNameKey(parts: readonly string[], metadata: MetadataView): string {
    const name = normalizeIdentifier(parts.at(-1) ?? "");
    if (name.startsWith("#")) return foldName(name, metadata);
    const schema =
        parts.length >= 2 ? normalizeIdentifier(parts.at(-2)!) : metadata.environment.defaultSchema;
    const database =
        parts.length >= 3
            ? normalizeIdentifier(parts.at(-3)!)
            : (metadata.environment.currentDatabase ?? "");
    return [database, schema, name].map((part) => foldName(part, metadata)).join("\0");
}

function foldName(value: string, metadata: MetadataView): string {
    const normalized = normalizeIdentifier(value);
    return metadata.environment.caseSensitive ? normalized : normalized.toLowerCase();
}

function lastEventAt(
    events: readonly CatalogTimelineEvent[] | undefined,
    offset: number,
): CatalogTimelineEvent | undefined {
    if (!events || events.length === 0) return undefined;
    let low = 0;
    let high = events.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (events[middle]!.offset <= offset) low = middle + 1;
        else high = middle;
    }
    return low === 0 ? undefined : events[low - 1];
}
