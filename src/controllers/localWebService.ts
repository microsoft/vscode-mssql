'use strict';
import path = require('path');
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

class WebSocketMapping {
    public webSocketServer: ws;
    public pendingMessages: Array<string> = [];
}

export default class LocalWebService {
    private app = express();
    private server = http.createServer();
    private wss = new WebSocketServer({ server: this.server});
    private wsMap = new Map<string, WebSocketMapping>();
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

        // Handle new connections to the web socket server
        this.wss.on('connection', (ws) => {
            let parse = querystring.parse(url.parse(ws.upgradeReq.url).query);
            if (self.wsMap.has(parse.uri)) {
                // Mapping already exists
                let mapping = self.wsMap.get(parse.uri);

                // Replay all messages to the server and assign the server
                while (mapping.pendingMessages.length > 0) {
                    let currentMessage = mapping.pendingMessages.shift();
                    ws.send(currentMessage);
                }
                mapping.webSocketServer = ws;
            } else {
                // Mapping does not exist. Create one now
                let mapping = new WebSocketMapping();
                mapping.webSocketServer = ws;
                self.wsMap.set(parse.uri, mapping);
            }
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
        let message = JSON.stringify({
            type: event,
            data: data ? data : undefined
        });

        // Is the URI mapped to a ready web socket server?
        if (this.wsMap.has(uri)) {
            // There is a mapping already, but has it been opened?
            let mapping = this.wsMap.get(uri);
            if (mapping.webSocketServer && mapping.webSocketServer.readyState === ws.OPEN) {
                // Server is open, go ahead and send the message straight away
                this.wsMap.get(uri).webSocketServer.send(message);
            } else {
                // Server is not open, append it to the queue
                mapping.pendingMessages.push(message);
            }
        } else {
            // There isn't a mapping, so create it
            let mapping = new WebSocketMapping();
            this.wsMap.set(uri, mapping);

            // Append the message to the queue
            mapping.pendingMessages.push(message);
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
