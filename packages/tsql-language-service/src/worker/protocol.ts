/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceStats } from "../observability/index.js";
import type { TextChange } from "../text/index.js";

export const workerProtocolVersion = 1;

interface RequestBase {
    readonly protocolVersion: typeof workerProtocolVersion;
    readonly id: number;
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
          readonly type: "stats";
          readonly uri: string;
          readonly expectedVersion: number;
      })
    | {
          readonly protocolVersion: typeof workerProtocolVersion;
          readonly type: "cancel";
          readonly id: number;
      };

export interface WorkerDocumentSummary {
    readonly uri: string;
    readonly version: number;
    readonly utf16Length: number;
    readonly syntaxErrorCount: number;
    readonly semanticDiagnosticCount: number;
    readonly workerElapsedMs: number;
}

export type WorkerResponse =
    | {
          readonly protocolVersion: typeof workerProtocolVersion;
          readonly type: "response";
          readonly id: number;
          readonly ok: true;
          readonly documentVersion?: number;
          readonly result: WorkerDocumentSummary | LanguageServiceStats | boolean;
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
