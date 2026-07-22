/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./hostedResultApplication.css";

export interface HostedResultApplicationProps {
    ariaLabel: string;
    readOnlyLabel: string;
    summary?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
}

/** Shared bounded shell for read-only result applications hosted in a larger
 * webview. The host owns lifecycle/error states; the application owns only
 * its provider-neutral result document. */
export function HostedResultApplication({
    ariaLabel,
    readOnlyLabel,
    summary,
    actions,
    children,
}: HostedResultApplicationProps) {
    return (
        <section className="hosted-result-app" aria-label={ariaLabel}>
            <div className="hosted-result-app-toolbar">
                <span className="hosted-result-app-readonly">{readOnlyLabel}</span>
                {summary ? <span className="hosted-result-app-summary">{summary}</span> : null}
                {actions ? <span className="hosted-result-app-actions">{actions}</span> : null}
            </div>
            <div className="hosted-result-app-body">{children}</div>
        </section>
    );
}
