/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The object definition contracts live beside the feature that consumes them, in `features`.
import type { ColorizationService } from "../coloring/index.js";
import type { LanguageFeatureService } from "../features/index.js";
import type { FormattingService } from "../formatting/index.js";
import type { MetadataProvider } from "../metadata/index.js";
import type { LanguageServiceStatsProvider } from "../observability/index.js";
import type { LanguageServiceRuntime } from "../runtime/index.js";

/** Minimum host-neutral surface consumed by an LSP or editor adapter. */
export interface TsqlLanguageService {
    readonly runtime: LanguageServiceRuntime;
    readonly coloring: ColorizationService;
    readonly features: LanguageFeatureService;
    readonly formatting: FormattingService;
    readonly metadata: MetadataProvider;
    readonly stats: LanguageServiceStatsProvider;
}
