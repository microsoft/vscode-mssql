/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TelemetryEvent } from "../telemetry/TelemetryEvent";
import { TelemetryEventNames } from "../telemetry/TelemetryEventNames";
import { FabricEnvironmentName } from "../settings/FabricEnvironment";
import { EventsWithAllProperties, EventsWithProperty } from "../telemetry/TelemetryTypeHelpers";

export class ErrorWithProperties extends Error {
    constructor(
        messsage: string,
        public readonly properties: { [key: string]: string },
    ) {
        super(messsage);
    }
}

type SignInRequestProperties =
    | "silent"
    | "createIfNone"
    | "clearSessionPreference"
    | "forceNewSession";
type EventsWithAllSignInRequestProperties = EventsWithAllProperties<
    TelemetryEventNames,
    SignInRequestProperties
>;
export function addSignInRequestInfoToActivity(
    event: TelemetryEvent<TelemetryEventNames, EventsWithAllSignInRequestProperties>,
    options: vscode.AuthenticationGetSessionOptions,
) {
    event.addOrUpdateProperties({
        silent: String(options.silent),
        createIfNone: String(options.createIfNone),
        clearSessionPreference: String(options.clearSessionPreference),
        forceNewSession: String(options.forceNewSession),
    });
}

type EventsWithAllSignedInRequestProperties = EventsWithProperty<TelemetryEventNames, "signedIn">;
export function addAccountInfoToEvent(
    activity: TelemetryEvent<TelemetryEventNames, EventsWithAllSignedInRequestProperties>,
    account: vscode.AuthenticationSessionAccountInformation | null,
) {
    activity.addOrUpdateProperties({ signedIn: String(!!account) });
}

type EventsWithEnvironmentTypeProperty = EventsWithProperty<TelemetryEventNames, "environmentType">;
export function addEnvironmentInfoToEvent(
    event: TelemetryEvent<TelemetryEventNames, EventsWithEnvironmentTypeProperty>,
) {
    event.addOrUpdateProperties({ environmentType: getEnvironmentType() });
}

function getEnvironmentType(): "codespaces" | "devbox" | "local" {
    if (isInCodeSpaces()) {
        return "codespaces";
    }
    if (isInDevBox()) {
        return "devbox";
    }
    return "local";
}

function isInCodeSpaces(): boolean {
    return vscode.env.remoteName === "codespaces";
}

function isInDevBox(): boolean {
    return process.env["IsDevBox"]?.toLocaleLowerCase() === "true";
}

export const msSessionProvider: string = "microsoft";
export const msSessionProviderPPE: string = "microsoft-sovereign-cloud";

export function getSessionProviderForEnvironment(env: FabricEnvironmentName): string {
    switch (env) {
        case FabricEnvironmentName.MOCK:
        case FabricEnvironmentName.ONEBOX:
        case FabricEnvironmentName.EDOG:
        case FabricEnvironmentName.EDOGONEBOX:
            return msSessionProviderPPE;
        case FabricEnvironmentName.DAILY:
        case FabricEnvironmentName.DXT:
        case FabricEnvironmentName.MSIT:
        case FabricEnvironmentName.PROD:
            return msSessionProvider;
        default:
            throw new Error(`Unknown FabricEnvironment: ${env}`);
    }
}
