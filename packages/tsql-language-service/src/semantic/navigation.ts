/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SemanticObjectIdentity,
    SemanticOccurrence,
    SemanticParserSnapshot,
    SemanticSpan,
} from "./contracts.js";

export interface SemanticLocation {
    readonly uri?: string;
    readonly span: SemanticSpan;
}

export interface SemanticReferenceResult {
    readonly identity: SemanticObjectIdentity;
    readonly declaration?: SemanticLocation;
    readonly references: readonly SemanticLocation[];
}

export interface ScriptingDefinitionRequest {
    readonly identity: SemanticObjectIdentity;
    readonly preferredUri?: string;
    readonly signal?: AbortSignal;
}

/**
 * Boundary for a host-owned database scripting service. Implementations may call SMO, DacFx,
 * a server API, or a cached script store; this package deliberately performs no database I/O.
 */
export interface ScriptingDefinitionResolver {
    resolveDefinition(request: ScriptingDefinitionRequest): Promise<SemanticLocation | undefined>;
}

/** Immutable identity index assembled from the current parser snapshot's references. */
export class SemanticNavigationIndex {
    private readonly occurrencesByIdentity: ReadonlyMap<string, readonly SemanticOccurrence[]>;

    public constructor(occurrences: readonly SemanticOccurrence[]) {
        const grouped = new Map<string, SemanticOccurrence[]>();
        for (const occurrence of occurrences) {
            const group = grouped.get(occurrence.identity.key) ?? [];
            group.push(Object.freeze({ ...occurrence }));
            grouped.set(occurrence.identity.key, group);
        }
        this.occurrencesByIdentity = new Map(
            [...grouped.entries()].map(([key, value]) => [
                key,
                Object.freeze([...value].sort(compareOccurrences)),
            ]),
        );
    }

    public static fromSnapshot(snapshot: SemanticParserSnapshot): SemanticNavigationIndex {
        return new SemanticNavigationIndex(snapshot.occurrences?.() ?? []);
    }

    public identityAt(offset: number, uri?: string): SemanticObjectIdentity | undefined {
        const candidates = [...this.occurrencesByIdentity.values()]
            .flat()
            .filter(
                (occurrence) =>
                    offset >= occurrence.span.start &&
                    offset < occurrence.span.end &&
                    (!uri || !occurrence.uri || occurrence.uri === uri),
            );
        return candidates.sort(compareOccurrences)[0]?.identity;
    }

    public localDefinition(identity: SemanticObjectIdentity): SemanticLocation | undefined {
        const occurrence = this.occurrencesByIdentity
            .get(identity.key)
            ?.find((item) => item.role === "declaration");
        return occurrence ? { uri: occurrence.uri, span: occurrence.span } : undefined;
    }

    public references(identity: SemanticObjectIdentity): SemanticReferenceResult {
        const occurrences = this.occurrencesByIdentity.get(identity.key) ?? [];
        return {
            identity,
            declaration: this.localDefinition(identity),
            references: Object.freeze(
                occurrences
                    .filter((item) => item.role === "reference")
                    .map((item) => ({ uri: item.uri, span: item.span })),
            ),
        };
    }
}

/** Local navigation wins; only unresolved identities cross the scripting resolver seam. */
export class SemanticDefinitionService {
    public constructor(
        private readonly index: SemanticNavigationIndex,
        private readonly externalResolver?: ScriptingDefinitionResolver,
    ) {}

    public referencesAt(offset: number, uri?: string): SemanticReferenceResult | undefined {
        const identity = this.index.identityAt(offset, uri);
        return identity ? this.index.references(identity) : undefined;
    }

    public async definitionAt(
        offset: number,
        options: { readonly uri?: string; readonly signal?: AbortSignal } = {},
    ): Promise<SemanticLocation | undefined> {
        const identity = this.index.identityAt(offset, options.uri);
        if (!identity) {
            return undefined;
        }
        return this.definitionFor(identity, options);
    }

    public async definitionFor(
        identity: SemanticObjectIdentity,
        options: { readonly uri?: string; readonly signal?: AbortSignal } = {},
    ): Promise<SemanticLocation | undefined> {
        const local = this.index.localDefinition(identity);
        if (local) {
            return local;
        }
        return this.externalResolver?.resolveDefinition({
            identity,
            preferredUri: options.uri,
            signal: options.signal,
        });
    }
}

function compareOccurrences(left: SemanticOccurrence, right: SemanticOccurrence): number {
    return (
        left.span.start - right.span.start ||
        left.span.end - right.span.end ||
        left.role.localeCompare(right.role)
    );
}
