/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import logger2, { ILogger2 } from "../../models/logger2";
import {
    StateCommandDiagnosticEvent,
    StateCommandDiagnosticsSink,
} from "./stateCommandDiagnostics";

export class Logger2StateCommandDiagnosticsSink implements StateCommandDiagnosticsSink {
    constructor(private readonly logger: ILogger2 = logger2.withPrefix("StateCommands")) {}

    public emit(event: StateCommandDiagnosticEvent): void {
        const message = [
            `feature=${event.feature}`,
            event.source ? `source=${event.source}` : undefined,
            `stage=${event.stage}`,
            `status=${event.status}`,
            event.sessionId ? `sessionId=${event.sessionId}` : undefined,
            event.commandType ? `commandType=${event.commandType}` : undefined,
            event.commandIndex !== undefined ? `commandIndex=${event.commandIndex}` : undefined,
            event.commandCount !== undefined ? `commandCount=${event.commandCount}` : undefined,
            event.reason ? `reason=${event.reason}` : undefined,
            event.version ? `version=${event.version}` : undefined,
            event.elapsedMs !== undefined ? `elapsedMs=${event.elapsedMs}` : undefined,
            event.message ? `message=${event.message}` : undefined,
            event.measurements ? `measurements=${JSON.stringify(event.measurements)}` : undefined,
        ]
            .filter((part): part is string => part !== undefined)
            .join(" ");

        switch (event.status) {
            case "failed":
                this.logger.warn(message);
                break;
            case "skipped":
                this.logger.debug(message);
                break;
            case "started":
            case "succeeded":
                this.logger.info(message);
                break;
        }
    }
}
