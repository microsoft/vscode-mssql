/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EngineCapabilities } from "../common/engineCapabilities.js";
import type { EngineFacts } from "../common/engineProfile.js";
import type { LanguageServiceStats } from "../observability/index.js";
import type { FullColorizationResult } from "../coloring/index.js";
import type {
    CompletionResult,
    DefinitionTarget,
    DocumentSymbol,
    FoldingRange,
    HoverResult,
    Location,
    SignatureHelp,
} from "../features/index.js";
import type { SemanticDiagnostic } from "../semantics/index.js";
import type { SyntaxDiagnostic } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";
import type { TextChange } from "../text/index.js";

export const workerProtocolVersion = 1;

interface RequestBase {
    readonly protocolVersion: typeof workerProtocolVersion;
    readonly id: number;
}

interface DocumentRequest extends RequestBase {
    readonly uri: string;
    readonly expectedVersion: number;
}

export type WorkerRequest =
    | (RequestBase & {
          readonly type: "open";
          readonly uri: string;
          readonly version: number;
          readonly text: string;
      })
    | (RequestBase & {
          readonly type: "change";
          readonly uri: string;
          readonly expectedVersion: number;
          readonly version: number;
          readonly changes: readonly TextChange[];
      })
    | (RequestBase & { readonly type: "close"; readonly uri: string })
    | (RequestBase & {
          readonly type: "rebind";
          readonly uri: string;
          readonly expectedVersion: number;
      })
    | (RequestBase & {
          readonly type: "stats";
          readonly uri: string;
          readonly expectedVersion: number;
      })
    | (RequestBase & {
          /**
           * Reports newly observed server facts. Only serializable facts cross the boundary; a
           * connection object, credential, or resolver never does.
           */
          readonly type: "engineFacts";
          /** Absent changes the default and every open document; present changes only this URI. */
          readonly uri?: string;
          readonly facts?: EngineFacts;
      })
    | (DocumentRequest & { readonly type: "diagnostics" })
    | (DocumentRequest & { readonly type: "completion"; readonly offset: number })
    | (DocumentRequest & { readonly type: "hover"; readonly offset: number })
    | (DocumentRequest & { readonly type: "definition"; readonly offset: number })
    | (DocumentRequest & { readonly type: "references"; readonly offset: number })
    | (DocumentRequest & { readonly type: "documentSymbols" })
    | (DocumentRequest & { readonly type: "foldingRanges" })
    | (DocumentRequest & { readonly type: "selectionRanges"; readonly offsets: readonly number[] })
    | (DocumentRequest & { readonly type: "signatureHelp"; readonly offset: number })
    | (DocumentRequest & { readonly type: "coloring"; readonly range?: TextRange })
    | {
          readonly protocolVersion: typeof workerProtocolVersion;
          readonly type: "cancel";
          readonly id: number;
      };

/** The serializable projection of the worker's engine capabilities. */
export interface WorkerEngineCapabilities {
    readonly profile: EngineCapabilities["engineProfile"];
    readonly generation: string;
    readonly displayName: string;
    readonly serverMajorVersion?: number;
    readonly compatibilityLevel?: number;
    readonly previewFeatures: boolean;
}

export interface WorkerDocumentSummary {
    readonly uri: string;
    readonly version: number;
    readonly utf16Length: number;
    readonly syntaxErrorCount: number;
    readonly semanticDiagnosticCount: number;
    readonly workerElapsedMs: number;
    /** The engine profile identity the worker produced this result under. */
    readonly profileGeneration: string;
    /** Availability diagnostics inside `syntaxErrorCount`, so a host can total them separately. */
    readonly availabilityDiagnosticCount: number;
}

export interface WorkerDiagnostics {
    readonly syntax: readonly SyntaxDiagnostic[];
    readonly semantic: readonly SemanticDiagnostic[];
}

export type WorkerFeatureResult =
    | WorkerDiagnostics
    | CompletionResult
    | HoverResult
    | DefinitionTarget
    | readonly Location[]
    | readonly DocumentSymbol[]
    | readonly FoldingRange[]
    | readonly TextRange[]
    | SignatureHelp
    | FullColorizationResult
    | undefined;

export type WorkerResponse =
    | {
          readonly protocolVersion: typeof workerProtocolVersion;
          readonly type: "response";
          readonly id: number;
          readonly ok: true;
          readonly documentVersion?: number;
          readonly result:
              | WorkerDocumentSummary
              | LanguageServiceStats
              | WorkerEngineCapabilities
              | WorkerFeatureResult
              | boolean;
      }
    | {
          readonly protocolVersion: typeof workerProtocolVersion;
          readonly type: "response";
          readonly id: number;
          readonly ok: false;
          readonly error: {
              readonly name: string;
              readonly message: string;
              readonly stack?: string;
          };
      };

export function isWorkerResponse(value: unknown): value is WorkerResponse {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<WorkerResponse>;
    return (
        candidate.protocolVersion === workerProtocolVersion &&
        candidate.type === "response" &&
        typeof candidate.id === "number"
    );
}
