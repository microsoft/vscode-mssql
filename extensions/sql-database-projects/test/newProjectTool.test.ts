/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import should = require('should/as-function');
import * as TypeMoq from 'typemoq';
import * as sinon from 'sinon';
import * as dataworkspace from 'dataworkspace';
import * as newProjectTool from '../src/tools/newProjectTool';
import { generateTestFolderPath, createTestFile, deleteGeneratedTestFolder } from './testUtils';

let testFolderPath: string;

suite('NewProjectTool: New project tool tests', function (): void {
	setup(async function () {
		testFolderPath = await generateTestFolderPath(this.test);

		const dataWorkspaceMock = TypeMoq.Mock.ofType<dataworkspace.IExtension>();
		dataWorkspaceMock.setup(x => x.defaultProjectSaveLocation).returns(() => vscode.Uri.file(testFolderPath));
		sinon.stub(vscode.extensions, 'getExtension').returns(<any>{ exports: dataWorkspaceMock.object });
	});

	suiteTeardown(async function (): Promise<void> {
		await deleteGeneratedTestFolder();
	});

	teardown(async function () {
		sinon.restore();
	});

	test('Should generate correct default project names', async function (): Promise<void> {
		should(newProjectTool.defaultProjectNameNewProj()).equal('DatabaseProject1');
		should(newProjectTool.defaultProjectNameFromDb('master')).equal('DatabaseProjectmaster');
	});

	test('Should auto-increment default project names for new projects', async function (): Promise<void> {
		should(newProjectTool.defaultProjectNameNewProj()).equal('DatabaseProject1');

		await createTestFile(this.test, '', 'DatabaseProject1', testFolderPath);
		should(newProjectTool.defaultProjectNameNewProj()).equal('DatabaseProject2');

		await createTestFile(this.test, '', 'DatabaseProject2', testFolderPath);
		should(newProjectTool.defaultProjectNameNewProj()).equal('DatabaseProject3');
	});

	test('Should auto-increment default project names for create project for database', async function (): Promise<void> {
		should(newProjectTool.defaultProjectNameFromDb('master')).equal('DatabaseProjectmaster');

		await createTestFile(this.test, '', 'DatabaseProjectmaster', testFolderPath);
		should(newProjectTool.defaultProjectNameFromDb('master')).equal('DatabaseProjectmaster2');

		await createTestFile(this.test, '', 'DatabaseProjectmaster2', testFolderPath);
		should(newProjectTool.defaultProjectNameFromDb('master')).equal('DatabaseProjectmaster3');
	});

	test('Should not return a project name if undefined is passed in ', async function (): Promise<void> {
		should(newProjectTool.defaultProjectNameFromDb(undefined)).equal('');
		should(newProjectTool.defaultProjectNameFromDb('')).equal('');
		should(newProjectTool.defaultProjectNameFromDb('test')).equal('DatabaseProjecttest');
	});
});


