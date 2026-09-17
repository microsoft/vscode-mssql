/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline/no-metadata provider (design 05 §6.1): every section reports
 * "unknown", every lookup honestly returns nothing. Features degrade to
 * keywords/snippets/local-script intelligence against this provider, which is
 * exactly the disconnected-document behavior.
 */

import {
    IPinnedMetadataView,
    ISqlLanguageMetadataProvider,
    LangDatabase,
    LangObjectInfo,
    LangObjectRef,
    LangResolution,
    LanguageReadiness,
    SqlLanguageEnvironment,
} from "./types";

const OFFLINE_READINESS: LanguageReadiness = {
    objects: "unknown",
    columns: "unknown",
    parameters: "unknown",
    foreignKeys: "unknown",
    definitions: "unknown",
    mode: "offline",
};

const DEFAULT_ENV: SqlLanguageEnvironment = {
    defaultSchema: "dbo",
    caseSensitive: false,
    capabilities: { createOrAlterProgrammability: false, dropIfExists: false },
};

class NullPinnedView implements IPinnedMetadataView {
    readonly generation = 0;
    readonly env = DEFAULT_ENV;
    readonly readiness = OFFLINE_READINESS;

    resolveObject(): LangResolution {
        return { kind: "unavailable", section: "objects" };
    }
    getObject(): LangObjectInfo | undefined {
        return undefined;
    }
    getColumns(): undefined {
        return undefined;
    }
    getParameters(): undefined {
        return undefined;
    }
    fkFrom(): readonly [] {
        return [];
    }
    fkTo(): readonly [] {
        return [];
    }
    searchObjects(): readonly LangObjectInfo[] {
        return [];
    }
    listSchemas(): readonly [] {
        return [];
    }
}

export class NullLanguageMetadataProvider implements ISqlLanguageMetadataProvider {
    readonly generation = 0;
    private readonly pinned = new NullPinnedView();

    env(): SqlLanguageEnvironment {
        return DEFAULT_ENV;
    }
    readiness(): LanguageReadiness {
        return OFFLINE_READINESS;
    }
    pin(): IPinnedMetadataView {
        return this.pinned;
    }
    databases(): readonly LangDatabase[] | undefined {
        return undefined;
    }
    onDidChange(): () => void {
        return () => undefined;
    }
}

export function refEquals(a: LangObjectRef, b: LangObjectRef): boolean {
    return a.objectId === b.objectId && (a.database ?? "") === (b.database ?? "");
}
