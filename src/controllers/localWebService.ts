'use strict';
import path = require('path');
import * as WebSocket from 'ws';
import url = require('url');
import querystring = require('querystring');
import Utils = require('../models/utils');
import Constants = require('../constants/constants');
import Interfaces = require('../models/interfaces');
import http = require('http');
const bodyParser = require('body-parser');
const express = require('express');
const webSocketServer = WebSocket.Server;

class WebSocketMapping {
    public webSocketServer: WebSocket;
    public pendingMessages: Array<WebSocketMessage> = [];
}

class WebSocketMessage {
    public type: string;
    public data: any;
}

export default class LocalWebService {
    private app = express();
    private server = http.createServer();
    private wss = new webSocketServer({ server: this.server});
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
        Utils.logDebug(`LocalWebService: added static html content path: ${LocalWebService.staticContentPath}`);
        this.server.on('request', this.app);

        // Handle new connections to the web socket server
        this.wss.on('connection', (ws, req) => {
            let parse: any = querystring.parse(<string>url.parse(req.url).query);

            // Attempt to find the mapping for the web socket server
            let mapping = self.wsMap.get(parse.uri);

            // If the mapping does not exist, create it now
            if (mapping === undefined) {
                mapping = new WebSocketMapping();
                self.wsMap.set(parse.uri, mapping);
            }

            // Assign the web socket server to the mapping
            mapping.webSocketServer = ws;

            // Replay all messages to the server
            mapping.pendingMessages.forEach(m => {
                ws.send(JSON.stringify(m));
            });
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
        return this.serviceUrl + '/' + Interfaces.contentTypes[type];
    }

    broadcast(uri: string, event: string, data?: any): void {
        // Create a message to send out
        let message: WebSocketMessage = {
            type: event,
            data: data ? data : undefined
        };

        // Attempt to find the web socket server
        let mapping = this.wsMap.get(uri);

        // Is the URI mapped to a web socket server?
        if (mapping === undefined) {
            // There isn't a mapping, so create it
            mapping = new WebSocketMapping();
            this.wsMap.set(uri, mapping);
        } else {
            // Make sure the web socket server is open, then fire away
            if (mapping.webSocketServer && mapping.webSocketServer.readyState === WebSocket.OPEN) {
                mapping.webSocketServer.send(JSON.stringify(message));
            }
        }

        // Append the message to the message history
        mapping.pendingMessages.push(message);
    }

    /**
     * Purges the queue of messages to send on the web socket server for the given uri
     * @param   uri URI of the web socket server to reset
     */
    resetSocket(uri: string): void {
        if (this.wsMap.has(uri)) {
            this.wsMap.delete(uri);
        }
    }

    addHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.contentTypes[type];
        this.app.get(segment, handler);
    }

    addPostHandler(type: Interfaces.ContentType, handler: (req, res) => void): void {
        let segment = '/' + Interfaces.contentTypes[type];
        this.app.post(segment, handler);
    }

    start(): void {
        const address: any = this.server.listen(0).address();
        const port = address.port; // 0 = listen on a random port
        Utils.logDebug(`LocalWebService listening on port ${port}`);
        LocalWebService._servicePort = port.toString();
    }
}
