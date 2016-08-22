import * as TypeMoq from 'typemoq';
import { IConnectionProfile } from '../src/models/interfaces';
import { ConnectionProfile } from '../src/models/ConnectionProfile';
import { IQuestion, IPrompter, INameValueChoice } from '../src/prompts/question';
import TestPrompter from './TestPrompter';

import Constants = require('../src/models/constants');
import assert = require('assert');
import os = require('os');

suite('Connection Profile tests', () => {
    let authTypeQuestionIndex = 2;

    setup(() => {
        // No setup currently needed
    });

    test('CreateProfile should ask questions in correct order', () => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called and user cancels out
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then expect the following flow:
        let questionNames: string[] = [
            Constants.serverPrompt,     // Server
            Constants.databasePrompt,   // DB Name
            Constants.authTypePrompt,   // Authentication Type
            Constants.usernamePrompt,   // UserName
            Constants.passwordPrompt,   // Password
            Constants.msgSavePassword,  // Save Password
            Constants.profileNamePrompt // Profile Name
        ];

        assert.equal(profileQuestions.length, questionNames.length, 'unexpected number of questions');
        for (let i = 0; i < profileQuestions.length; i++) {
            assert.equal(profileQuestions[i].name, questionNames[i], `Missing question for ${questionNames[i]}`);
        }
        // And expect result to be undefined as questions were not answered
        assert.equal(profileReturned, undefined);
    });


    test('CreateProfile - SqlPassword should be default auth type', () => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;

        // When createProfile is called
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then expect SqlAuth to be the only default type
        let authChoices = <INameValueChoice[]>profileQuestions[authTypeQuestionIndex].choices;
        assert.equal(authChoices[0].name, Constants.authTypeSql);
    });

    test('CreateProfile - Integrated auth support', () => {
        // Given
        let prompter: TypeMoq.Mock<IPrompter> = TypeMoq.Mock.ofType(TestPrompter);
        let answers: {[key: string]: string} = {};
        let profileQuestions: IQuestion[];
        let profileReturned: IConnectionProfile;
        prompter.setup(x => x.prompt(TypeMoq.It.isAny()))
                .callback(questions => {
                    // Capture questions for verification
                    profileQuestions = questions;
                })
                .returns(questions => {
                    //
                    return Promise.resolve(answers);
                });

        // When createProfile is called on an OS
        ConnectionProfile.createProfile(prompter.object)
            .then(profile => profileReturned = profile);

        // Then integrated auth should/should not be supported
        // TODO if possible the test should mock out the OS dependency but it's not clear
        // how to do this without implementing a facade and doing full factory/dependency injection
        // for now, just validates expected behavior on the platform tests are running on
        let authQuestion: IQuestion = profileQuestions[authTypeQuestionIndex];
        let authChoices = <INameValueChoice[]>authQuestion.choices;
        if ('win32' === os.platform()) {
            assert.equal(authChoices.length, 2);
            assert.equal(authChoices[1].name, Constants.authTypeIntegrated);

            // And on a platform with multiple choices, should prompt for input
            assert.strictEqual(authQuestion.shouldPrompt(answers), true);
        } else {
            assert.equal(authChoices.length, 1);
            // And on a platform with only 1 choice, should not prompt for input
            assert.strictEqual(authQuestion.shouldPrompt(answers), false);
        }


    });


});

