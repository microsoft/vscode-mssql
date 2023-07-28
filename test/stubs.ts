/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import { IQuestion, IPrompter, IPromptCallback } from '../src/prompts/question';
import * as vscode from 'vscode';

// Dummy implementation to simplify mocking
class TestPrompter implements IPrompter {
	public promptSingle<T>(question: IQuestion): Promise<T> {
		return Promise.resolve(undefined);
	}
	public prompt<T>(questions: IQuestion[]): Promise<{ [key: string]: T }> {
		return Promise.resolve(undefined);
	}
	public promptCallback(questions: IQuestion[], callback: IPromptCallback): void {
		callback({});
	}
}

// Bare mock of the extension context for vscode
const testExtensionContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();

// Bare mock of a TextEditor for vscode
const testTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();

// Bare mock of a memento object for vscode
const testMemento = TypeMoq.Mock.ofType<vscode.Memento>();

function createWorkspaceConfiguration(items: { [key: string]: any }, workspaceItems?: { [key: string]: any }): vscode.WorkspaceConfiguration {
	const result: vscode.WorkspaceConfiguration = {
		has(key: string): boolean {
			return items[key] !== 'undefined';
		},
		get<T>(key: string, defaultValue?: T): T {
			let val = items[key];
			if (typeof val === 'undefined') {
				val = defaultValue;
			}
			return val;
		},
		inspect<T>(section: string): { key: string; defaultValue?: T; globalValue?: T; workspaceValue?: T } | undefined {
			return {
				key: undefined,
				defaultValue: undefined,
				globalValue: items[section],
				workspaceValue: workspaceItems === undefined ? undefined : workspaceItems[section]
			};
		},
		update(section: string, value: any, global?: boolean): Thenable<void> {
			// tslint:disable-next-line no-invalid-this Test currently expects the object to contain the property values, so allowing this until further investigation can be done
			this[section] = value;

			global = global === undefined ? true : global;
			if (!global) {
				if (workspaceItems === undefined) {
					workspaceItems = {};
				}
				workspaceItems[section] = value;
			} else {
				items[section] = value;
			}

			return Promise.resolve();
		}
	};

	// Copy properties across so that indexer works as expected
	Object.keys(items).forEach((key) => {
		result.update(key, items[key]);
	});

	return result;
}

// Interface for an Result function passed in by an express call
class ExpressResult {

	constructor() {
		// do nothing
	}

	public render(path: any, vars: any): any {
		// do nothing
	}

	public send(json?: any): any {
		// do nothing
	}

	public status: number;
}

// Interface for a request object passed in by an express call
class ExpressRequest {

	constructor(params?: any) {
		this.query = params;
	}

	public query: {
		uri?: string,
		theme?: string,
		backgroundColor?: string,
		color?: string,
		rowStart?: number,
		resultId?: number,
		batchId?: number,
		numberOfRows?: number,
		resultSetNo?: number,
		batchIndex?: number,
		format?: string,
		includeHeaders?: boolean,
		startLine?: number,
		startColumn?: number,
		endLine?: number,
		endColumn?: number
	};

	public body: any;
}

export {
	TestPrompter,
	testExtensionContext as TestExtensionContext,
	testTextEditor as TestTextEditor,
	testMemento as TestMemento,
	createWorkspaceConfiguration, ExpressRequest, ExpressResult
};
