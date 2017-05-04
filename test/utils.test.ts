import { expect } from 'chai';
import * as Utils from './../src/models/utils';
import Constants = require('../src/constants/constants');
import { ConnectionCredentials } from '../src/models/connectionCredentials';

suite('Utility Tests - parseTimeString', () => {
    test('should return false if nothing passed', () => {
        expect(Utils.parseTimeString(undefined)).to.equal(false);
        expect(Utils.parseTimeString('')).to.equal(false);
    });

    test('should return false if input does not have only 1 period', () => {
        expect(Utils.parseTimeString('32:13:23.12.1')).to.equal(false);
        expect(Utils.parseTimeString('12:32:33')).to.equal(false);
    });

    test('should return false if input does not have 2 :', () => {
        expect(Utils.parseTimeString('32.32')).to.equal(false);
        expect(Utils.parseTimeString('32:32:32:32.133')).to.equal(false);
    });

    test('returns the correct value', () => {
        expect(Utils.parseTimeString('2:13:30.0')).to.equal(8010000);
        expect(Utils.parseTimeString('0:0:0.220')).to.equal(220);
        expect(Utils.parseTimeString('0:0:0.0')).to.equal(0);
    });
});

suite('Utility Tests - parseNumAsTimeString', () => {
    test('returns the correct value', () => {
        expect(Utils.parseNumAsTimeString(8010000)).to.equal('02:13:30');
        expect(Utils.parseNumAsTimeString(220)).to.equal('00:00:00.220');
        expect(Utils.parseNumAsTimeString(0)).to.equal('00:00:00');
        expect(Utils.parseNumAsTimeString(5002)).to.equal('00:00:05.002');
    });
});

suite('Utility Tests - isSameConnection', () => {
    let server = 'my-server';
    let database = 'my-db';
    let authType = Constants.sqlAuthentication;
    let user = 'my-user';
    let connection1 = Object.assign(new ConnectionCredentials(), {
        server: server,
        database: database,
        authenticationType: authType,
        user: user
    });
    let connection2 = Object.assign(new ConnectionCredentials(), {
        server: server,
        database: database,
        authenticationType: authType,
        user: user
    });
    let connectionString = 'Server=my-server;Database=my-db;Authentication=Sql Password;User ID=my-user';
    let connection3 = Object.assign(new ConnectionCredentials(), {
        connectionString: connectionString
    });
    let connection4 = Object.assign(new ConnectionCredentials(), {
        connectionString: connectionString
    });

    test('should return true for matching non-connectionstring connections', () => {
        expect(Utils.isSameConnection(connection1, connection2)).to.equal(true);
    });

    test('should return false for non-matching non-connectionstring connections', () => {
        connection2.server = 'some-other-server';
        expect(Utils.isSameConnection(connection1, connection2)).to.equal(false);
    });

    test('should return true for matching connectionstring connections', () => {
        expect(Utils.isSameConnection(connection3, connection4)).to.equal(true);
    });

    test('should return false for non-matching connectionstring connections', () => {
        connection4.connectionString = 'Server=some-other-server';
        expect(Utils.isSameConnection(connection3, connection4)).to.equal(false);
    });

    test('should return false for connectionstring and non-connectionstring connections', () => {
        expect(Utils.isSameConnection(connection1, connection3)).to.equal(false);
    });
});
