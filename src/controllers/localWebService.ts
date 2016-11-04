'use strict';
import path = require('path');
import { EventEmitter } from 'events';
import * as ws from 'ws';
import url = require('url');
import querystring = require('querystring');
import Utils = require('../models/utils');
import Constants = require('../models/constants');
import Interfaces = require('../models/interfaces');
import http = require('http');
const bodyParser = require('body-parser');
const express = require('express');
const WebSocketServer = ws.Server;

export default class LocalWebService {
    private app = express();
    private server = http.createServer();
    private wss = new WebSocketServer({ server: this.server});
    private clientMap = new Map<string, ws>();
    public newConnection = new EventEmitter();
    static _servicePort: string;
    static _vscodeExtensionPath: string;
    static _htmlContentLocation = 'out/src/views/htmlcontent';
    static _staticContentPath: string;

    constructor(extensionPath: string) {
        // add static content for express web server to serve
        const self = this;
        LocalWebService._vscodeExtensionPath = extensionPath;
        LocalWebService._staticContentPath = path.join(extensionPath, LocalWebService._htmlContentLocation);
        this.app.use(express.static(LocalWebService.staticContentPath));
        this.app.use(bodyParser.json({limit: '50mb', type: 'application/json'}));
        this.app.set('view engine', 'ejs');
        Utils.logDebug(Constants.msgLocalWebserviceStaticContent + LocalWebService.staticContentPath);
        this.server.on('request', this.app);
        this.wss.on('connection', (ws) => {
            let parse = querystring.parse(url.parse(ws.upgradeReq.url).query);
            self.clientMap.set(parse.uri, ws);
            self.newConnection.emit('connection', parse.uri);
        });
    }

    static get serviceUrl(): string {
        return Constants.outputServiceLocalhost + LocalWebService._servicePort;
    }

    static get staticContentPath(): string {
        return LocalWebService._staticContentPath;
    }

    static get extensionPath(): string {
        return LocalWebService._vscodeExtensionPath;
    }

    static getEndpointUri(type: Interfaces.ContentType): string {
        return this.serviceUrl + '/' + Interfaces.ContentTypes[type];
    }

    broadcast(uri: string, event: string, data?: any): void {
        let temp = {
            type: event
        };

        if (data) {
            temp['data'] = data;
        }

        if (this.clientMap.has(uri) && this.clientMap.get(uri).readyState === ws.OPEN) {
            this.clientMap.get(uri).send(JSON.stringify(temp));
        }
    }

    addHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.ContentTypes[type];
        this.app.get(segment, handler);
    }

    addPostHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.ContentTypes[type];
        this.app.post(segment, handler);
    }

    start(): void {
        const port = this.server.listen(0).address().port; // 0 = listen on a random port
        Utils.logDebug(Constants.msgLocalWebserviceStarted + port);
        LocalWebService._servicePort = port.toString();
    }
}
