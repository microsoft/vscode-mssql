/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";

interface QueryStudioErrorBoundaryProps {
    children: React.ReactNode;
    label: string;
    resetKey: string;
    onError?: (label: string, error: Error, componentStack?: string) => void;
}

interface QueryStudioErrorBoundaryState {
    failed: boolean;
}

/** Contains a pane failure so one contributed tab cannot blank Query Studio. */
export class QueryStudioErrorBoundary extends React.Component<
    QueryStudioErrorBoundaryProps,
    QueryStudioErrorBoundaryState
> {
    state: QueryStudioErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): QueryStudioErrorBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        this.props.onError?.(this.props.label, error, info.componentStack ?? undefined);
    }

    componentDidUpdate(previous: QueryStudioErrorBoundaryProps): void {
        if (this.state.failed && previous.resetKey !== this.props.resetKey) {
            this.setState({ failed: false });
        }
    }

    render(): React.ReactNode {
        if (!this.state.failed) {
            return this.props.children;
        }
        return (
            <div className="qs-pane-error" role="alert">
                <span>{this.props.label} could not be rendered.</span>
                <button
                    type="button"
                    className="qs-btn"
                    title={`Retry ${this.props.label}`}
                    aria-label={`Retry ${this.props.label}`}
                    onClick={() => this.setState({ failed: false })}>
                    <span className="codicon codicon-refresh" aria-hidden="true" />
                </button>
            </div>
        );
    }
}
