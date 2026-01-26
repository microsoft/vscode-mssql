/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require('should/as-function');
import * as templates from '../src/templates/templates';
import { shouldThrowSpecificError, getTemplatesRootPath } from './testUtils';
import { ItemType } from 'sqldbproj';

const templatesPath = getTemplatesRootPath();

suite('Templates', function (): void {
	setup(async () => {
		templates.reset();
		await templates.loadTemplates(templatesPath);
	});

	test('Should throw error when attempting to use templates before loaded from file', async function (): Promise<void> {
		templates.reset();
		await shouldThrowSpecificError(() => templates.get('foobar'), 'Templates must be loaded from file before attempting to use.');
		await shouldThrowSpecificError(() => templates.get('foobar'), 'Templates must be loaded from file before attempting to use.');
	});

	test('Should load all templates from files', async function (): Promise<void> {
		// check expected counts

		const numScriptObjectTypes = 14;

		should(templates.projectScriptTypes().length).equal(numScriptObjectTypes);
		should(Object.keys(templates.projectScriptTypes()).length).equal(numScriptObjectTypes);

		// check everything has a value

		should(templates.newSqlProjectTemplate).not.equal(undefined);

		for (const obj of templates.projectScriptTypes()) {
			should(obj.templateScript).not.equal(undefined);
		}
	});

	test('Should have Schema item template', async function (): Promise<void> {
		const schemaTemplate = templates.get(ItemType.schema);
		should(schemaTemplate).not.equal(undefined);
		should(schemaTemplate.type).equal(ItemType.schema);
		should(schemaTemplate.friendlyName).equal('Schema');
		should(schemaTemplate.templateScript).containEql('CREATE SCHEMA');
		should(schemaTemplate.templateScript).containEql('@@OBJECT_NAME@@');
	});

	test('Should have Table item template', async function (): Promise<void> {
		const tableTemplate = templates.get(ItemType.table);
		should(tableTemplate).not.equal(undefined);
		should(tableTemplate.type).equal(ItemType.table);
		should(tableTemplate.templateScript).containEql('CREATE TABLE');
	});

	test('Should have View item template', async function (): Promise<void> {
		const viewTemplate = templates.get(ItemType.view);
		should(viewTemplate).not.equal(undefined);
		should(viewTemplate.type).equal(ItemType.view);
		should(viewTemplate.templateScript).containEql('CREATE VIEW');
	});

	test('Should have Stored Procedure item template', async function (): Promise<void> {
		const spTemplate = templates.get(ItemType.storedProcedure);
		should(spTemplate).not.equal(undefined);
		should(spTemplate.type).equal(ItemType.storedProcedure);
		should(spTemplate.templateScript).containEql('CREATE PROCEDURE');
	});

	test('Should have Script item template', async function (): Promise<void> {
		const scriptTemplate = templates.get(ItemType.script);
		should(scriptTemplate).not.equal(undefined);
		should(scriptTemplate.type).equal(ItemType.script);
	});

	test('Should have Data Source item template', async function (): Promise<void> {
		const dataSourceTemplate = templates.get(ItemType.dataSource);
		should(dataSourceTemplate).not.equal(undefined);
		should(dataSourceTemplate.type).equal(ItemType.dataSource);
		should(dataSourceTemplate.templateScript).containEql('CREATE EXTERNAL DATA SOURCE');
	});

	test('Should have File Format item template', async function (): Promise<void> {
		const fileFormatTemplate = templates.get(ItemType.fileFormat);
		should(fileFormatTemplate).not.equal(undefined);
		should(fileFormatTemplate.type).equal(ItemType.fileFormat);
		should(fileFormatTemplate.templateScript).containEql('CREATE EXTERNAL FILE FORMAT');
	});

	test('Should have External Stream item template', async function (): Promise<void> {
		const externalStreamTemplate = templates.get(ItemType.externalStream);
		should(externalStreamTemplate).not.equal(undefined);
		should(externalStreamTemplate.type).equal(ItemType.externalStream);
		should(externalStreamTemplate.templateScript).containEql('CREATE EXTERNAL STREAM');
	});

	test('Should have External Streaming Job item template', async function (): Promise<void> {
		const externalStreamingJobTemplate = templates.get(ItemType.externalStreamingJob);
		should(externalStreamingJobTemplate).not.equal(undefined);
		should(externalStreamingJobTemplate.type).equal(ItemType.externalStreamingJob);
		should(externalStreamingJobTemplate.templateScript).containEql('sp_create_streaming_job');
	});

	test('Should have Pre-Deployment Script item template', async function (): Promise<void> {
		const preDeployTemplate = templates.get(ItemType.preDeployScript);
		should(preDeployTemplate).not.equal(undefined);
		should(preDeployTemplate.type).equal(ItemType.preDeployScript);
	});

	test('Should have Post-Deployment Script item template', async function (): Promise<void> {
		const postDeployTemplate = templates.get(ItemType.postDeployScript);
		should(postDeployTemplate).not.equal(undefined);
		should(postDeployTemplate.type).equal(ItemType.postDeployScript);
	});

	test('Should have Publish Profile item template', async function (): Promise<void> {
		const publishProfileTemplate = templates.get(ItemType.publishProfile);
		should(publishProfileTemplate).not.equal(undefined);
		should(publishProfileTemplate.type).equal(ItemType.publishProfile);
		should(publishProfileTemplate.templateScript).containEql('Project');
	});

	test('Should have Table-Valued Function item template', async function (): Promise<void> {
		const tvfTemplate = templates.get(ItemType.tableValuedFunction);
		should(tvfTemplate).not.equal(undefined);
		should(tvfTemplate.type).equal(ItemType.tableValuedFunction);
		should(tvfTemplate.templateScript).containEql('CREATE FUNCTION');
		should(tvfTemplate.templateScript).containEql('RETURNS @returntable TABLE');
		should(tvfTemplate.templateScript).containEql('@@SCHEMA_NAME@@');
		should(tvfTemplate.templateScript).containEql('@@OBJECT_NAME@@');
	});
});
