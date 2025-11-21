/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require('should/as-function');
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';
import { BuildHelper } from '../src/tools/buildHelper';
import { TestContext, createContext } from './testContext';
import { ProjectType } from 'mssql';
import * as sqldbproj from 'sqldbproj';
import * as utils from '../src/common/utils';

suite('BuildHelper: Build Helper tests', function (): void {
	test('Should get correct build arguments for legacy-style projects', function (): void {
		// update settings and validate
		const buildHelper = new BuildHelper();
		const resultArgs = buildHelper.constructBuildArguments('dummy\\dll path', ProjectType.LegacyStyle);

		// Check that it returns an array
		should(resultArgs).be.Array();
		should(resultArgs.length).equal(3); // 3 arguments for legacy projects

		// Check individual arguments
		should(resultArgs[0]).equal('/p:NetCoreBuild=true');

		if (os.platform() === 'win32') {
			should(resultArgs[1]).equal('/p:SystemDacpacsLocation="dummy\\\\dll path"');
			should(resultArgs[2]).equal('/p:NETCoreTargetsPath="dummy\\\\dll path"');
		} else {
			should(resultArgs[1]).equal('/p:SystemDacpacsLocation="dummy/dll path"');
			should(resultArgs[2]).equal('/p:NETCoreTargetsPath="dummy/dll path"');
		}
	});

	test('Should get correct build arguments for SDK-style projects', function (): void {
		// update settings and validate
		const buildHelper = new BuildHelper();
		const resultArgs = buildHelper.constructBuildArguments('dummy\\dll path', ProjectType.SdkStyle);

		// Check that it returns an array
		should(resultArgs).be.Array();
		should(resultArgs.length).equal(2); // 2 arguments for SDK projects (no NETCoreTargetsPath)

		// Check individual arguments
		should(resultArgs[0]).equal('/p:NetCoreBuild=true');

		if (os.platform() === 'win32') {
			should(resultArgs[1]).equal('/p:SystemDacpacsLocation="dummy\\\\dll path"');
		} else {
			should(resultArgs[1]).equal('/p:SystemDacpacsLocation="dummy/dll path"');
		}
	});

	test('Should get correct build folder', async function (): Promise<void> {
		const testContext: TestContext = createContext();
		const buildHelper = new BuildHelper();
		await buildHelper.createBuildDirFolder(testContext.outputChannel);

		// get expected path for build
		const extName = utils.getAzdataApi() ? sqldbproj.extension.name : sqldbproj.extension.vsCodeName;
		const extensionPath = vscode.extensions.getExtension(extName)?.extensionPath ?? '';
		should(buildHelper.extensionBuildDirPath).equal(path.join(extensionPath, 'BuildDirectory'));
	});
});



