/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MetadataProvider } from "../metadata/index.js";
import type { LanguageServiceRuntime } from "../runtime/index.js";
import type { FoldingRangeOptions } from "./contracts.js";
import { collectFoldingRanges } from "./foldingRanges.js";
import { CatalogFeatureContext } from "./catalogFeatureContext.js";
import { CompletionFeatureProvider } from "./completionFeatures.js";
import { HoverFeatureProvider } from "./hoverFeatures.js";
import { NavigationFeatureProvider } from "./navigationFeatures.js";
import { RenameReferenceFeatureProvider } from "./renameReferenceFeatures.js";
import { SignatureFeatureProvider } from "./signatureFeatures.js";
import type {
    CompletionItem,
    CompletionResult,
    DefinitionTarget,
    DocumentSymbol,
    FoldingRange,
    HoverResult,
    LanguageFeatureService,
    Location,
    SignatureHelp,
    TextEdit,
} from "./contracts.js";

const measuredMethods = [
    "completion",
    "hover",
    "signatureHelp",
    "definition",
    "definitionTarget",
    "references",
    "documentSymbols",
    "foldingRanges",
    "selectionRanges",
] as const;

/**
 * Thin host-neutral facade over feature-specific providers.
 *
 * Every provider reads the same immutable runtime snapshot. The facade owns request measurement and
 * dispatch only; completion, navigation, hover, and signature policy remain independently testable.
 */
export class TsqlLanguageFeatureService implements LanguageFeatureService {
    private readonly _completion: CompletionFeatureProvider;
    private readonly _navigation: NavigationFeatureProvider;
    private readonly _renameReferences: RenameReferenceFeatureProvider;
    private readonly _hover: HoverFeatureProvider;
    private readonly _signature: SignatureFeatureProvider;

    public constructor(
        private readonly _runtime: LanguageServiceRuntime,
        metadata: MetadataProvider,
    ) {
        const catalog = new CatalogFeatureContext(metadata);
        this._completion = new CompletionFeatureProvider(_runtime, metadata, catalog);
        this._navigation = new NavigationFeatureProvider(_runtime);
        this._renameReferences = new RenameReferenceFeatureProvider(_runtime);
        this._hover = new HoverFeatureProvider(_runtime, catalog);
        this._signature = new SignatureFeatureProvider(_runtime, catalog);
        const recorder = _runtime.requests;
        if (!recorder) return;
        for (const method of measuredMethods) {
            const original = this[method] as (...args: never[]) => unknown;
            Object.defineProperty(this, method, {
                configurable: true,
                writable: true,
                value: (...args: never[]) =>
                    recorder.measure(method, () => original.apply(this, args)),
            });
        }
    }

    public completion(uri: string, version: number, offset: number): CompletionResult {
        return this._completion.completion(uri, version, offset);
    }

    public resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
        return this._completion.resolveCompletion(item);
    }

    public hover(uri: string, version: number, offset: number): HoverResult | undefined {
        return this._hover.hover(uri, version, offset);
    }

    public definition(uri: string, version: number, offset: number): readonly Location[] {
        return this._navigation.definition(uri, version, offset);
    }

    public definitionTarget(uri: string, version: number, offset: number): DefinitionTarget {
        return this._navigation.definitionTarget(uri, version, offset);
    }

    public references(uri: string, version: number, offset: number): readonly Location[] {
        return this._renameReferences.references(uri, version, offset);
    }

    public prepareRename(uri: string, version: number, offset: number) {
        return this._renameReferences.prepareRename(uri, version, offset);
    }

    public rename(
        uri: string,
        version: number,
        offset: number,
        newName: string,
    ): readonly TextEdit[] {
        return this._renameReferences.rename(uri, version, offset, newName);
    }

    public diagnostics(uri: string, version: number) {
        const snapshot = this._runtime.snapshot(uri, version);
        return { syntax: snapshot.syntax.diagnostics, semantic: snapshot.semantics.diagnostics };
    }

    public documentSymbols(uri: string, version: number): readonly DocumentSymbol[] {
        return this._navigation.documentSymbols(uri, version);
    }

    public foldingRanges(
        uri: string,
        version: number,
        options?: FoldingRangeOptions,
    ): readonly FoldingRange[] {
        return collectFoldingRanges(this._runtime.snapshot(uri, version).syntax, options);
    }

    public selectionRanges(uri: string, version: number, offsets: readonly number[]) {
        return this._navigation.selectionRanges(uri, version, offsets);
    }

    public signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined {
        return this._signature.signatureHelp(uri, version, offset);
    }
}
