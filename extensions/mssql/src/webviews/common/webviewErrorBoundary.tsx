/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Component, ErrorInfo, ReactNode } from "react";

interface WebviewErrorBoundaryProps {
    children: ReactNode;
    fallback: ReactNode;
    onError: (error: Error, errorInfo: ErrorInfo) => void;
}

interface WebviewErrorBoundaryState {
    hasError: boolean;
}

/**
 * Prevents a renderer failure from taking down the entire webview.
 */
export class WebviewErrorBoundary extends Component<
    WebviewErrorBoundaryProps,
    WebviewErrorBoundaryState
> {
    public state: WebviewErrorBoundaryState = { hasError: false };

    public static getDerivedStateFromError(): WebviewErrorBoundaryState {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.props.onError(error, errorInfo);
    }

    public render(): ReactNode {
        return this.state.hasError ? this.props.fallback : this.props.children;
    }
}
