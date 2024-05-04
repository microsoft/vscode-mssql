/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as TypeMoq from 'typemoq';
import PromptFactory from '../src/prompts/factory';
import { assert } from 'chai';
import InputPrompt from '../src/prompts/input';
import PasswordPrompt from '../src/prompts/password';
import ListPrompt from '../src/prompts/list';
import ConfirmPrompt from '../src/prompts/confirm';
import CheckboxPrompt from '../src/prompts/checkbox';
import ExpandPrompt from '../src/prompts/expand';
import VscodeWrapper from '../src/controllers/vscodeWrapper';

suite('Prompts test', () => {

	let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

	setup(() => {
		vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);
	});

	test('Test string prompt', () => {
		let question: any = {
			type: 'string'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof InputPrompt, true);
	});

	test('Test input prompt', () => {
		let question: any = {
			type: 'input',
			default: Error('test'),
			placeHolder: 'test_placeHolder'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof InputPrompt, true);
		assert.equal(question.type, InputPrompt.promptType);
	});

	test('Test password prompt', () => {
		let question: any = {
			type: 'password'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof PasswordPrompt, true);
	});

	test('Test list prompt', () => {
		let question: any = {
			type: 'list'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof ListPrompt, true);
	});

	test('Test confirm prompt', () => {
		let question: any = {
			type: 'confirm'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof ConfirmPrompt, true);
	});

	test('Test checkbox prompt', () => {
		let question: any = {
			type: 'checkbox'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof CheckboxPrompt, true);
	});

	test('Test expand prompt', () => {
		let question: any = {
			type: 'expand'
		};
		let prompt = PromptFactory.createPrompt(question, vscodeWrapper.object);
		assert.equal(prompt instanceof ExpandPrompt, true);
	});

	test('Test bogus prompt', () => {
		let question: any = {
			type: 'fail'
		};
		assert.Throw(() => PromptFactory.createPrompt(question, vscodeWrapper.object));
	});
});
