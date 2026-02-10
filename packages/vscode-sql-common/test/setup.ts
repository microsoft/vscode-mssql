/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Setup file that mocks the vscode module before tests run.
 * This allows the source code to import 'vscode' normally,
 * but get the mock implementation during tests.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module
const mockVscode = {
    Uri: class Uri {
        scheme: string;
        authority: string;
        path: string;
        query: string;
        fragment: string;
        fsPath: string;

        constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
            this.scheme = scheme;
            this.authority = authority;
            this.path = path;
            this.query = query;
            this.fragment = fragment;
            this.fsPath = path;
        }

        static parse(value: string): any {
            try {
                const url = new URL(value);
                return new mockVscode.Uri(
                    url.protocol.replace(':', ''),
                    url.hostname,
                    decodeURIComponent(url.pathname),
                    url.search.replace('?', ''),
                    url.hash.replace('#', '')
                );
            } catch {
                // Handle file:// URIs
                if (value.startsWith('file:///')) {
                    return new mockVscode.Uri('file', '', value.substring(7), '', '');
                }
                return new mockVscode.Uri('', '', value, '', '');
            }
        }

        static file(path: string): any {
            return new mockVscode.Uri('file', '', path, '', '');
        }

        toString(skipEncoding?: boolean): string {
            if (this.scheme === 'file') {
                return `file://${this.path}`;
            }
            return `${this.scheme}://${this.authority}${this.path}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`;
        }

        with(change: any): any {
            return new mockVscode.Uri(
                change.scheme ?? this.scheme,
                change.authority ?? this.authority,
                change.path ?? this.path,
                change.query ?? this.query,
                change.fragment ?? this.fragment
            );
        }
    },

    EventEmitter: class EventEmitter<T> {
        private listeners: ((e: T) => void)[] = [];

        event = (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    const index = this.listeners.indexOf(listener);
                    if (index >= 0) {
                        this.listeners.splice(index, 1);
                    }
                }
            };
        };

        fire(data: T): void {
            this.listeners.forEach(listener => listener(data));
        }

        dispose(): void {
            this.listeners = [];
        }
    },

    commands: {
        executeCommand: async (command: string, ...args: any[]): Promise<any> => {
            return undefined;
        },
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
            return { dispose: () => {} };
        }
    },

    window: {
        activeTextEditor: undefined as any,
        onDidChangeActiveTextEditor: (listener: (e: any) => void) => {
            return { dispose: () => {} };
        },
        showInformationMessage: async (message: string, ...items: any[]): Promise<any> => {
            return undefined;
        }
    },

    extensions: {
        all: [] as any[],
        getExtension: (extensionId: string): any => undefined,
        onDidChange: (listener: () => void) => {
            return { dispose: () => {} };
        }
    },

    workspace: {
        getConfiguration: (section?: string) => ({
            get: (key: string, defaultValue?: any) => defaultValue
        })
    }
};

// Override require to return mock for 'vscode'
Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

// Export for direct use in tests
module.exports = mockVscode;
