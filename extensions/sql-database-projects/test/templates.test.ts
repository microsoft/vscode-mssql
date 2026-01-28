/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
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

		const numScriptObjectTypes = 16;

		expect(templates.projectScriptTypes().length).to.equal(numScriptObjectTypes, `Expected ${numScriptObjectTypes} script object types to be loaded`);
		expect(Object.keys(templates.projectScriptTypes()).length).to.equal(numScriptObjectTypes, `Expected ${numScriptObjectTypes} keys in script object types`);

		// check everything has a value

		expect(templates.newSqlProjectTemplate).to.not.be.undefined;

		for (const obj of templates.projectScriptTypes()) {
			expect(obj.templateScript).to.not.be.undefined;
		}
	});

	test('Should have Schema item template', async function (): Promise<void> {
		const schemaTemplate = templates.get(ItemType.schema);
		expect(schemaTemplate, 'Schema template should be defined').to.not.be.undefined;
		expect(schemaTemplate.type, 'Schema template type should match').to.equal(ItemType.schema);
		expect(schemaTemplate.friendlyName, 'Schema template friendly name should be "Schema"').to.equal('Schema');
		expect(schemaTemplate.templateScript, 'Schema template should contain CREATE SCHEMA').to.include('CREATE SCHEMA');
		expect(schemaTemplate.templateScript, 'Schema template should contain @@OBJECT_NAME@@ placeholder').to.include('@@OBJECT_NAME@@');
	});

	test('Should have Table item template', async function (): Promise<void> {
		const tableTemplate = templates.get(ItemType.table);
		expect(tableTemplate, 'Table template should be defined').to.not.be.undefined;
		expect(tableTemplate.type, 'Table template type should match').to.equal(ItemType.table);
		expect(tableTemplate.templateScript, 'Table template should contain CREATE TABLE').to.include('CREATE TABLE');
	});

	test('Should have View item template', async function (): Promise<void> {
		const viewTemplate = templates.get(ItemType.view);
		expect(viewTemplate, 'View template should be defined').to.not.be.undefined;
		expect(viewTemplate.type, 'View template type should match').to.equal(ItemType.view);
		expect(viewTemplate.templateScript, 'View template should contain CREATE VIEW').to.include('CREATE VIEW');
	});

	test('Should have Stored Procedure item template', async function (): Promise<void> {
		const spTemplate = templates.get(ItemType.storedProcedure);
		expect(spTemplate, 'Stored Procedure template should be defined').to.not.be.undefined;
		expect(spTemplate.type, 'Stored Procedure template type should match').to.equal(ItemType.storedProcedure);
		expect(spTemplate.templateScript, 'Stored Procedure template should contain CREATE PROCEDURE').to.include('CREATE PROCEDURE');
	});

	test('Should have Script item template', async function (): Promise<void> {
		const scriptTemplate = templates.get(ItemType.script);
		expect(scriptTemplate, 'Script template should be defined').to.not.be.undefined;
		expect(scriptTemplate.type, 'Script template type should match').to.equal(ItemType.script);
	});

	test('Should have Data Source item template', async function (): Promise<void> {
		const dataSourceTemplate = templates.get(ItemType.dataSource);
		expect(dataSourceTemplate, 'Data Source template should be defined').to.not.be.undefined;
		expect(dataSourceTemplate.type, 'Data Source template type should match').to.equal(ItemType.dataSource);
		expect(dataSourceTemplate.templateScript, 'Data Source template should contain CREATE EXTERNAL DATA SOURCE').to.include('CREATE EXTERNAL DATA SOURCE');
	});

	test('Should have File Format item template', async function (): Promise<void> {
		const fileFormatTemplate = templates.get(ItemType.fileFormat);
		expect(fileFormatTemplate, 'File Format template should be defined').to.not.be.undefined;
		expect(fileFormatTemplate.type, 'File Format template type should match').to.equal(ItemType.fileFormat);
		expect(fileFormatTemplate.templateScript, 'File Format template should contain CREATE EXTERNAL FILE FORMAT').to.include('CREATE EXTERNAL FILE FORMAT');
	});

	test('Should have External Stream item template', async function (): Promise<void> {
		const externalStreamTemplate = templates.get(ItemType.externalStream);
		expect(externalStreamTemplate, 'External Stream template should be defined').to.not.be.undefined;
		expect(externalStreamTemplate.type, 'External Stream template type should match').to.equal(ItemType.externalStream);
		expect(externalStreamTemplate.templateScript, 'External Stream template should contain CREATE EXTERNAL STREAM').to.include('CREATE EXTERNAL STREAM');
	});

	test('Should have External Streaming Job item template', async function (): Promise<void> {
		const externalStreamingJobTemplate = templates.get(ItemType.externalStreamingJob);
		expect(externalStreamingJobTemplate, 'External Streaming Job template should be defined').to.not.be.undefined;
		expect(externalStreamingJobTemplate.type, 'External Streaming Job template type should match').to.equal(ItemType.externalStreamingJob);
		expect(externalStreamingJobTemplate.templateScript, 'External Streaming Job template should contain sp_create_streaming_job').to.include('sp_create_streaming_job');
	});

	test('Should have Pre-Deployment Script item template', async function (): Promise<void> {
		const preDeployTemplate = templates.get(ItemType.preDeployScript);
		expect(preDeployTemplate, 'Pre-Deployment Script template should be defined').to.not.be.undefined;
		expect(preDeployTemplate.type, 'Pre-Deployment Script template type should match').to.equal(ItemType.preDeployScript);
	});

	test('Should have Post-Deployment Script item template', async function (): Promise<void> {
		const postDeployTemplate = templates.get(ItemType.postDeployScript);
		expect(postDeployTemplate, 'Post-Deployment Script template should be defined').to.not.be.undefined;
		expect(postDeployTemplate.type, 'Post-Deployment Script template type should match').to.equal(ItemType.postDeployScript);
	});

	test('Should have Publish Profile item template', async function (): Promise<void> {
		const publishProfileTemplate = templates.get(ItemType.publishProfile);
		expect(publishProfileTemplate, 'Publish Profile template should be defined').to.not.be.undefined;
		expect(publishProfileTemplate.type, 'Publish Profile template type should match').to.equal(ItemType.publishProfile);
		expect(publishProfileTemplate.templateScript, 'Publish Profile template should contain Project').to.include('Project');
	});

	test('Should have Table-Valued Function item template', async function (): Promise<void> {
		const tvfTemplate = templates.get(ItemType.tableValuedFunction);
		expect(tvfTemplate, 'Table-Valued Function template should be defined').to.not.be.undefined;
		expect(tvfTemplate.type, 'Table-Valued Function template type should match').to.equal(ItemType.tableValuedFunction);
		expect(tvfTemplate.templateScript, 'Table-Valued Function template should contain CREATE FUNCTION').to.include('CREATE FUNCTION');
		expect(tvfTemplate.templateScript, 'Table-Valued Function template should contain RETURNS @returntable TABLE').to.include('RETURNS @returntable TABLE');
		expect(tvfTemplate.templateScript, 'Table-Valued Function template should contain @@SCHEMA_NAME@@ placeholder').to.include('@@SCHEMA_NAME@@');
		expect(tvfTemplate.templateScript, 'Table-Valued Function template should contain @@OBJECT_NAME@@ placeholder').to.include('@@OBJECT_NAME@@');
	});

	test('Should have Trigger item template', async function (): Promise<void> {
		const triggerTemplate = templates.get(ItemType.trigger);
		expect(triggerTemplate, 'Trigger template should be defined').to.not.be.undefined;
		expect(triggerTemplate.type, 'Trigger template type should match').to.equal(ItemType.trigger);
		expect(triggerTemplate.friendlyName, 'Trigger template friendly name should be "Trigger"').to.equal('Trigger');
		expect(triggerTemplate.templateScript, 'Trigger template should contain CREATE TRIGGER').to.include('CREATE TRIGGER');
		expect(triggerTemplate.templateScript, 'Trigger template should contain @@SCHEMA_NAME@@ placeholder').to.include('@@SCHEMA_NAME@@');
		expect(triggerTemplate.templateScript, 'Trigger template should contain @@OBJECT_NAME@@ placeholder').to.include('@@OBJECT_NAME@@');
	});

	test('Should have Database Trigger item template', async function (): Promise<void> {
		const dbTriggerTemplate = templates.get(ItemType.databaseTrigger);
		expect(dbTriggerTemplate, 'Database Trigger template should be defined').to.not.be.undefined;
		expect(dbTriggerTemplate.type, 'Database Trigger template type should match').to.equal(ItemType.databaseTrigger);
		expect(dbTriggerTemplate.friendlyName, 'Database Trigger template friendly name should be "Database Trigger"').to.equal('Database Trigger');
		expect(dbTriggerTemplate.templateScript, 'Database Trigger template should contain CREATE TRIGGER').to.include('CREATE TRIGGER');
		expect(dbTriggerTemplate.templateScript, 'Database Trigger template should contain ON DATABASE').to.include('ON DATABASE');
		expect(dbTriggerTemplate.templateScript, 'Database Trigger template should contain @@OBJECT_NAME@@ placeholder').to.include('@@OBJECT_NAME@@');
	});
});
