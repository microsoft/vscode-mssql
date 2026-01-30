/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { BuildHelper } from '../src/tools/buildHelper';
import { TestContext, createContext } from './testContext';
import { ProjectType } from 'mssql';
import * as sqldbproj from 'sqldbproj';
import * as constants from '../src/common/constants';

suite('BuildHelper: Build Helper tests', function (): void {
	test('Should get correct build arguments for legacy-style projects', function (): void {
		// update settings and validate
		const buildHelper = new BuildHelper();
		const resultArgs = buildHelper.constructBuildArguments('dummy\\dll path', ProjectType.LegacyStyle);

		// Check that it returns an array
		expect(resultArgs).to.be.an('array');
		expect(resultArgs.length).to.equal(3); // 3 arguments for legacy projects

		// Check individual arguments
		expect(resultArgs[0]).to.equal('/p:NetCoreBuild=true');

		if (os.platform() === 'win32') {
			expect(resultArgs[1]).to.equal('/p:SystemDacpacsLocation="dummy\\\\dll path"');
			expect(resultArgs[2]).to.equal('/p:NETCoreTargetsPath="dummy\\\\dll path"');
		} else {
			expect(resultArgs[1]).to.equal('/p:SystemDacpacsLocation="dummy/dll path"');
			expect(resultArgs[2]).to.equal('/p:NETCoreTargetsPath="dummy/dll path"');
		}
	});

	test('Should get correct build arguments for SDK-style projects', function (): void {
		// update settings and validate
		const buildHelper = new BuildHelper();
		const resultArgs = buildHelper.constructBuildArguments('dummy\\dll path', ProjectType.SdkStyle);

		// Check that it returns an array
		expect(resultArgs).to.be.an('array');
		expect(resultArgs.length).to.equal(2); // 2 arguments for SDK projects (no NETCoreTargetsPath)

		// Check individual arguments
		expect(resultArgs[0]).to.equal('/p:NetCoreBuild=true');

		if (os.platform() === 'win32') {
			expect(resultArgs[1]).to.equal('/p:SystemDacpacsLocation="dummy\\\\dll path"');
		} else {
			expect(resultArgs[1]).to.equal('/p:SystemDacpacsLocation="dummy/dll path"');
		}
	});

	test('Should get correct build folder', async function (): Promise<void> {
		const testContext: TestContext = createContext();
		const buildHelper = new BuildHelper();
		await buildHelper.createBuildDirFolder(testContext.outputChannel);

		// get expected path for build
		const extensionPath = vscode.extensions.getExtension(sqldbproj.extension.vsCodeName)?.extensionPath ?? '';
		expect(buildHelper.extensionBuildDirPath).to.equal(path.join(extensionPath, 'BuildDirectory'));
	});

	test('Should have all required SystemDacpacs files for supported target platforms', async function (): Promise<void> {
		// Get the extension's build directory path
		const extensionPath = vscode.extensions.getExtension(sqldbproj.extension.vsCodeName)?.extensionPath ?? '';
		const systemDacpacsPath = path.join(extensionPath, 'BuildDirectory', 'SystemDacpacs');

		// Verify SystemDacpacs folder exists
		expect(fs.existsSync(systemDacpacsPath), `SystemDacpacs folder should exist at ${systemDacpacsPath}`).to.be.true;

		// Verify all target platforms from targetPlatformToVersion have required dacpacs
		for (const [platform, version] of constants.targetPlatformToVersion) {
			// Handle Dw -> AzureDw folder name mapping
			const folderName = version === 'Dw' ? constants.AzureDwFolder : version;
			const folderPath = path.join(systemDacpacsPath, folderName);

			expect(fs.existsSync(folderPath), `Folder ${folderName} for platform '${platform}' should exist in SystemDacpacs`).to.be.true;
			expect(fs.existsSync(path.join(folderPath, 'master.dacpac')), `master.dacpac should exist in ${folderName}`).to.be.true;

			// On-prem SQL Server versions (numeric like 110, 120, etc.) also need msdb.dacpac
			const isOnPrem = /^\d+$/.test(version);
			if (isOnPrem) {
				expect(fs.existsSync(path.join(folderPath, 'msdb.dacpac')), `msdb.dacpac should exist in ${folderName}`).to.be.true;
			}
		}
	});
});


