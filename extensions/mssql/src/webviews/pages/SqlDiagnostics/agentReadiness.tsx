/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import type { AgentReadiness } from "sql-feature/agent";
import { LocConstants } from "../../common/locConstants";

export function AgentReadinessPanel({
    state,
    busy,
    recheck,
}: {
    state: AgentReadiness;
    busy: boolean;
    recheck: () => void;
}) {
    const loc = LocConstants.getInstance().agentReadiness;
    return (
        <MessageBar
            intent={
                !state.supported || state.service === "stopped" || state.jobsError
                    ? "warning"
                    : "info"
            }>
            <MessageBarBody>
                {!state.supported ? (
                    <Text>{loc.unsupported}</Text>
                ) : (
                    <>
                        <p>{loc.service[state.service]}</p>
                        <p>{loc.visibility[state.visibility]}</p>
                        {state.jobsError && (
                            <p>
                                {loc.jobsError} {state.jobsError}
                            </p>
                        )}
                        {(state.serviceError || state.accessError) && (
                            <details>
                                <summary>{loc.details}</summary>
                                <p>{state.serviceError}</p>
                                <p>{state.accessError}</p>
                            </details>
                        )}
                        <p>
                            <Link href="https://learn.microsoft.com/en-us/ssms/agent/sql-server-agent-fixed-database-roles">
                                {loc.permissions}
                            </Link>
                            {" · "}
                            <Link href="https://learn.microsoft.com/en-us/ssms/agent/start-stop-or-pause-the-sql-server-agent-service">
                                {loc.serviceHelp}
                            </Link>
                        </p>
                    </>
                )}
                <Button disabled={busy} onClick={recheck}>
                    {loc.recheck}
                </Button>
            </MessageBarBody>
        </MessageBar>
    );
}
