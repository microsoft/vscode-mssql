/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RbsModelRole } from "../../sharedInterfaces/runbookStudio";

export interface RuntimeProviderProfileDocument {
    id?: string;
    kind?: string;
    label?: string;
    defaultModels?: Record<string, unknown> & {
        plannerModelId?: unknown;
        workflowModelId?: unknown;
    };
}

/** Resolve the profile Hobbes assigns to a role, including the runtime's
 * documented role -> active -> first-provider fallback chain. */
export function runtimeProviderProfileForRole(
    document: Record<string, unknown>,
    role: RbsModelRole,
): RuntimeProviderProfileDocument | undefined {
    const providers = Array.isArray(document.providers)
        ? (document.providers as RuntimeProviderProfileDocument[])
        : [];
    const roleProfileId = stringValue(
        role === "authoring"
            ? document.planningProviderProfileId
            : document.executionProviderProfileId,
    );
    const activeProfileId = stringValue(document.activeProviderProfileId);
    return (
        providers.find((profile) => profile.id === roleProfileId) ??
        providers.find((profile) => profile.id === activeProfileId) ??
        providers[0]
    );
}

export function runtimeModelIdForRole(
    profile: RuntimeProviderProfileDocument,
    role: RbsModelRole,
): string | undefined {
    const planner = stringValue(profile.defaultModels?.plannerModelId);
    if (role === "authoring") {
        return planner;
    }
    return stringValue(profile.defaultModels?.workflowModelId) ?? planner;
}

export function setRuntimeModelIdForRole(
    profile: RuntimeProviderProfileDocument,
    role: RbsModelRole,
    modelId: string,
): boolean {
    if (!profile.defaultModels) {
        return false;
    }
    if (role === "authoring") {
        profile.defaultModels.plannerModelId = modelId;
    } else {
        profile.defaultModels.workflowModelId = modelId;
    }
    return true;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
