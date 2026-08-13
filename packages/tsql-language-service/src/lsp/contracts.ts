/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageFeatureService } from "../features/index.js";
import type { FormattingService } from "../formatting/index.js";
import type { MetadataProvider } from "../metadata/index.js";
import type { LanguageServiceStatsProvider } from "../observability/index.js";
import type { LanguageServiceRuntime } from "../runtime/index.js";

/** Minimum host-neutral surface consumed by an LSP or editor adapter. */
export interface TsqlLanguageService {
    readonly runtime: LanguageServiceRuntime;
    readonly features: LanguageFeatureService;
    readonly formatting: FormattingService;
    readonly metadata: MetadataProvider;
    readonly stats: LanguageServiceStatsProvider;
}

export interface ObjectDefinitionRequest {
    readonly connectionId: string;
    readonly database?: string;
    readonly schema: string;
    readonly name: string;
    readonly kind: string;
}

export interface ObjectDefinitionProvider {
    getDefinition(
        request: ObjectDefinitionRequest,
        signal?: AbortSignal,
    ): Promise<string | undefined>;
}
