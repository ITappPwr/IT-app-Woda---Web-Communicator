


(function ($, window) {
    "use strict";

    if (typeof ($) !== "function") {
        // no jQuery!
        throw new Error("SignalR: jQuery not found. Please ensure jQuery is referenced before the SignalR.js file.");
    }

    if (!window.JSON) {
        // no JSON!
        throw new Error("SignalR: No JSON parser found. Please ensure json2.js is referenced before the SignalR.js file if you need to support clients without native JSON parsing support, e.g. IE<8.");
    }
    
    var signalR,
        _connection,
        _pageLoaded = (window.document.readyState === "complete"),
        _pageWindow = $(window),

        events = {
            onStart: "onStart",
            onStarting: "onStarting",
            onReceived: "onReceived",
            onError: "onError",
            onConnectionSlow: "onConnectionSlow",
            onReconnecting: "onReconnecting",
            onReconnect: "onReconnect",
            onStateChanged: "onStateChanged",
            onDisconnect: "onDisconnect"
        },

        log = function (msg, logging) {
            if (logging === false) {
                return;
            }
            var m;
            if (typeof (window.console) === "undefined") {
                return;
            }
            m = "[" + new Date().toTimeString() + "] SignalR: " + msg;
            if (window.console.debug) {
                window.console.debug(m);
            } else if (window.console.log) {
                window.console.log(m);
            }
        },

        changeState = function (connection, expectedState, newState) {
            if (expectedState === connection.state) {
                connection.state = newState;

                $(connection).triggerHandler(events.onStateChanged, [{ oldState: expectedState, newState: newState }]);
                return true;
            }

            return false;
        },

        isDisconnecting = function (connection) {
            return connection.state === signalR.connectionState.disconnected;
        }, 

        configureStopReconnectingTimeout = function (connection) {
            var stopReconnectingTimeout,
                onReconnectTimeout;

            if (!connection._.configuredStopReconnectingTimeout) {
                onReconnectTimeout = function (connection) {
                    connection.log("Couldn't reconnect within the configured timeout (" + connection.disconnectTimeout + "ms), disconnecting.");
                    connection.stop(false, false);
                };

                connection.reconnecting(function () {
                    var connection = this;
                    stopReconnectingTimeout = window.setTimeout(function () { onReconnectTimeout(connection); }, connection.disconnectTimeout);
                });

                connection.stateChanged(function (data) {
                    if (data.oldState === signalR.connectionState.reconnecting) {
                        window.clearTimeout(stopReconnectingTimeout);
                    }
                });

                connection._.configuredStopReconnectingTimeout = true;
            }
        };

    signalR = function (url, qs, logging) {

        return new signalR.fn.init(url, qs, logging);
    };

    signalR.events = events;

    signalR.changeState = changeState;

    signalR.isDisconnecting = isDisconnecting;

    signalR.connectionState = {
        connecting: 0,
        connected: 1,
        reconnecting: 2,
        disconnected: 4
    };

    signalR.hub = {
        start: function () {
            throw new Error("SignalR: Error loading hubs. Ensure your hubs reference is correct, e.g. <script src='/signalr/hubs'></script>.");
        }
    };

    _pageWindow.load(function () { _pageLoaded = true; });

    function validateTransport(requestedTransport, connection) {
        if ($.isArray(requestedTransport)) {
            for (var i = requestedTransport.length - 1; i >= 0; i--) {
                var transport = requestedTransport[i];
                if ($.type(requestedTransport) !== "object" && ($.type(transport) !== "string" || !signalR.transports[transport])) {
                    connection.log("Invalid transport: " + transport + ", removing it from the transports list.");
                    requestedTransport.splice(i, 1);
                }
            }

            if (requestedTransport.length === 0) {
                connection.log("No transports remain within the specified transport array.");
                requestedTransport = null;
            }
        } else if ($.type(requestedTransport) !== "object" && !signalR.transports[requestedTransport] && requestedTransport !== "auto") {
            connection.log("Invalid transport: " + requestedTransport.toString());
            requestedTransport = null;
        }

        return requestedTransport;
    }

    function getDefaultPort(protocol) {
        if(protocol === "http:") {
            return 80;
        }
        else if (protocol === "https:") {
            return 443;
        }
    }

    function addDefaultPort(protocol, url) {
        if(url.match(/:\d+$/)) {
            return url;
        } else {
            return url + ":" + getDefaultPort(protocol);
        }
    }

    signalR.fn = signalR.prototype = {
        init: function (url, qs, logging) {
            this.url = url;
            this.qs = qs;
            this._ = {};
            if (typeof (logging) === "boolean") {
                this.logging = logging;
            }            
        },

        isCrossDomain: function (url, against) {
            var link;

            url = $.trim(url);
            if (url.indexOf("http") !== 0) {
                return false;
            }

            against = against || window.location;
            link = window.document.createElement("a");
            link.href = url;
            return link.protocol + addDefaultPort(link.protocol, link.host) !== against.protocol + addDefaultPort(against.protocol, against.host);
        },

        ajaxDataType: "json",

        logging: false,

        state: signalR.connectionState.disconnected,

        keepAliveData: {},

        reconnectDelay: 2000,

        disconnectTimeout: 40000, 

        keepAliveWarnAt: 2 / 3,

        start: function (options, callback) {
            var connection = this,
                config = {
                    waitForPageLoad: true,
                    transport: "auto",
                    jsonp: false
                },
                initialize,
                deferred = connection._deferral || $.Deferred(),
                parser = window.document.createElement("a");

            if ($.type(options) === "function") {
                callback = options;
            } else if ($.type(options) === "object") {
                $.extend(config, options);
                if ($.type(config.callback) === "function") {
                    callback = config.callback;
                }
            }

            config.transport = validateTransport(config.transport, connection);
            if (!config.transport) {
                throw new Error("SignalR: Invalid transport(s) specified, aborting start.");
            }

            if (!_pageLoaded && config.waitForPageLoad === true) {
                _pageWindow.load(function () {
                    connection._deferral = deferred;
                    connection.start(options, callback);
                });
                return deferred.promise();
            }

            configureStopReconnectingTimeout(connection);

            if (changeState(connection,
                            signalR.connectionState.disconnected,
                            signalR.connectionState.connecting) === false) {
                deferred.resolve(connection);
                return deferred.promise();
            }

            parser.href = connection.url;
            if (!parser.protocol || parser.protocol === ":") {
                connection.protocol = window.document.location.protocol;
                connection.host = window.document.location.host;
                connection.baseUrl = connection.protocol + "//" + connection.host;
            }
            else {
                connection.protocol = parser.protocol;
                connection.host = parser.host;
                connection.baseUrl = parser.protocol + "//" + parser.host;
            }

            connection.wsProtocol = connection.protocol === "https:" ? "wss://" : "ws://";

            if (config.transport === "auto" && config.jsonp === true) {
                config.transport = "longPolling";
            }

            if (this.isCrossDomain(connection.url)) {
                connection.log("Auto detected cross domain url.");

                if (config.transport === "auto") {
                    config.transport = ["webSockets", "longPolling"];
                }

                if (!config.jsonp) {
                    config.jsonp = !$.support.cors;

                    if (config.jsonp) {
                        connection.log("Using jsonp because this browser doesn't support CORS");
                    }
                }
            }

            connection.ajaxDataType = config.jsonp ? "jsonp" : "json";

            $(connection).bind(events.onStart, function (e, data) {
                if ($.type(callback) === "function") {
                    callback.call(connection);
                }
                deferred.resolve(connection);
            });

            initialize = function (transports, index) {
                index = index || 0;
                if (index >= transports.length) {
                    if (!connection.transport) {
                        $(connection).triggerHandler(events.onError, "SignalR: No transport could be initialized successfully. Try specifying a different transport or none at all for auto initialization.");
                        deferred.reject("SignalR: No transport could be initialized successfully. Try specifying a different transport or none at all for auto initialization.");
                        connection.stop();
                    }
                    return;
                }

                var transportName = transports[index],
                    transport = $.type(transportName) === "object" ? transportName : signalR.transports[transportName];

                if (transportName.indexOf("_") === 0) {
                    initialize(transports, index + 1);
                    return;
                }

                transport.start(connection, function () { 
                    if (transport.supportsKeepAlive && connection.keepAliveData.activated) {
                        signalR.transports._logic.monitorKeepAlive(connection);
                    }

                    connection.transport = transport;

                    changeState(connection,
                                signalR.connectionState.connecting,
                                signalR.connectionState.connected);

                    $(connection).triggerHandler(events.onStart);

                    _pageWindow.unload(function () { 
                        connection.stop(false /* async */);
                    });

                }, function () {
                    initialize(transports, index + 1);
                });
            };

            var url = connection.url + "/negotiate";
            connection.log("Negotiating with '" + url + "'.");
            $.ajax({
                url: url,
                global: false,
                cache: false,
                type: "GET",
                data: {},
                dataType: connection.ajaxDataType,
                error: function (error) {
                    $(connection).triggerHandler(events.onError, [error.responseText]);
                    deferred.reject("SignalR: Error during negotiation request: " + error.responseText);
                    connection.stop();
                },
                success: function (res) {
                    var keepAliveData = connection.keepAliveData;

                    connection.appRelativeUrl = res.Url;
                    connection.id = res.ConnectionId;
                    connection.token = res.ConnectionToken;
                    connection.webSocketServerUrl = res.WebSocketServerUrl;
                    connection.disconnectTimeout = res.DisconnectTimeout * 1000; // in ms
                    
                    if (res.KeepAliveTimeout) {
                        keepAliveData.activated = true;
                        keepAliveData.timeout = res.KeepAliveTimeout * 1000;
                        keepAliveData.timeoutWarning = keepAliveData.timeout * connection.keepAliveWarnAt;
                        keepAliveData.checkInterval = (keepAliveData.timeout - keepAliveData.timeoutWarning) / 3;
                    }
                    else {
                        keepAliveData.activated = false;
                    }

                    if (!res.ProtocolVersion || res.ProtocolVersion !== "1.2") {
                        $(connection).triggerHandler(events.onError, "SignalR: Incompatible protocol version.");
                        deferred.reject("SignalR: Incompatible protocol version.");
                        return;
                    }

                    $(connection).triggerHandler(events.onStarting);

                    var transports = [],
                        supportedTransports = [];

                    $.each(signalR.transports, function (key) {
                        if (key === "webSockets" && !res.TryWebSockets) {
                            return true;
                        }
                        supportedTransports.push(key);
                    });

                    if ($.isArray(config.transport)) {
                        $.each(config.transport, function () {
                            var transport = this;
                            if ($.type(transport) === "object" || ($.type(transport) === "string" && $.inArray("" + transport, supportedTransports) >= 0)) {
                                transports.push($.type(transport) === "string" ? "" + transport : transport);
                            }
                        });
                    } else if ($.type(config.transport) === "object" ||
                                    $.inArray(config.transport, supportedTransports) >= 0) {
                        transports.push(config.transport);
                    } else { 
                        transports = supportedTransports;
                    }
                    initialize(transports);
                }
            });

            return deferred.promise();
        },

        starting: function (callback) {
            var connection = this;
            $(connection).bind(events.onStarting, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        send: function (data) {
            var connection = this;

            if (connection.state === signalR.connectionState.disconnected) {
                throw new Error("SignalR: Connection must be started before data can be sent. Call .start() before .send()");
            }

            if (connection.state === signalR.connectionState.connecting) {
                throw new Error("SignalR: Connection has not been fully initialized. Use .start().done() or .start().fail() to run logic after the connection has started.");
            }

            connection.transport.send(connection, data);
            return connection;
        },

        received: function (callback) {
            var connection = this;
            $(connection).bind(events.onReceived, function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        stateChanged: function (callback) {
            var connection = this;
            $(connection).bind(events.onStateChanged, function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        error: function (callback) {
            var connection = this;
            $(connection).bind(events.onError, function (e, data) {
                callback.call(connection, data);
            });
            return connection;
        },

        disconnected: function (callback) {
            var connection = this;
            $(connection).bind(events.onDisconnect, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        connectionSlow: function (callback) {
            var connection = this;
            $(connection).bind(events.onConnectionSlow, function(e, data) {
                callback.call(connection);
            });

            return connection;
        },

        reconnecting: function (callback) {
            var connection = this;
            $(connection).bind(events.onReconnecting, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        reconnected: function (callback) {
            var connection = this;
            $(connection).bind(events.onReconnect, function (e, data) {
                callback.call(connection);
            });
            return connection;
        },

        stop: function (async, notifyServer) {
            var connection = this;

            if (connection.state === signalR.connectionState.disconnected) {
                return;
            }

            try {
                if (connection.transport) {
                    if (notifyServer !== false) {
                        connection.transport.abort(connection, async);
                    }

                    if (connection.transport.supportsKeepAlive && connection.keepAliveData.activated) {
                        signalR.transports._logic.stopMonitoringKeepAlive(connection);
                    }

                    connection.transport.stop(connection);
                    connection.transport = null;
                }

                $(connection).triggerHandler(events.onDisconnect);

                delete connection.messageId;
                delete connection.groupsToken;
                delete connection.id;
                delete connection._deferral;
            }
            finally {
                changeState(connection, connection.state, signalR.connectionState.disconnected);
            }

            return connection;
        },

        log: function (msg) {
            log(msg, this.logging);
        }
    };

    signalR.fn.init.prototype = signalR.fn;

    signalR.noConflict = function () {
        if ($.connection === signalR) {
            $.connection = _connection;
        }
        return signalR;
    };

    if ($.connection) {
        _connection = $.connection;
    }

    $.connection = $.signalR = signalR;

}(window.jQuery, window));


(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState;

    signalR.transports = {};

    function checkIfAlive(connection) {
        var keepAliveData = connection.keepAliveData,
            diff,
            timeElapsed;

        if (connection.state === signalR.connectionState.connected) {
            diff = new Date();

            diff.setTime(diff - keepAliveData.lastKeepAlive);
            timeElapsed = diff.getTime();
            if (timeElapsed >= keepAliveData.timeout) {
                connection.log("Keep alive timed out.  Notifying transport that connection has been lost.");
                connection.transport.lostConnection(connection);
            }
            else if (timeElapsed >= keepAliveData.timeoutWarning) {
                if (!keepAliveData.userNotified) {
                    connection.log("Keep alive has been missed, connection may be dead/slow.");
                    $(connection).triggerHandler(events.onConnectionSlow);
                    keepAliveData.userNotified = true;
                }
            }
            else {
                keepAliveData.userNotified = false;
            }
        }

        if (keepAliveData.monitoring) {
            window.setTimeout(function () {
                checkIfAlive(connection);
            }, keepAliveData.checkInterval);
        }
    }

    signalR.transports._logic = {
        pingServer: function (connection, transport) {
            var baseUrl = transport === "webSockets" ? "" : connection.baseUrl,
                url = baseUrl + connection.appRelativeUrl + "/ping",
                deferral = $.Deferred();

            $.ajax({
                url: url,
                global: false,
                cache: false,
                type: "GET",
                data: {},
                dataType: connection.ajaxDataType,
                success: function (data) {
                    if (data.Response === "pong") {
                        deferral.resolve();
                    }
                    else {
                        deferral.reject("SignalR: Invalid ping response when pinging server: " + (data.responseText || data.statusText));
                    }
                },
                error: function (data) {
                    deferral.reject("SignalR: Error pinging server: " + (data.responseText || data.statusText));
                }
            });

            return deferral.promise();
        },

        addQs: function (url, connection) {
            if (!connection.qs) {
                return url;
            }

            if (typeof (connection.qs) === "object") {
                return url + "&" + $.param(connection.qs);
            }

            if (typeof (connection.qs) === "string") {
                return url + "&" + connection.qs;
            }

            return url + "&" + window.encodeURIComponent(connection.qs.toString());
        },

        getUrl: function (connection, transport, reconnecting, appendReconnectUrl) {
            var baseUrl = transport === "webSockets" ? "" : connection.baseUrl,
                url = baseUrl + connection.appRelativeUrl,
                qs = "transport=" + transport + "&connectionToken=" + window.encodeURIComponent(connection.token);

            if (connection.data) {
                qs += "&connectionData=" + window.encodeURIComponent(connection.data);
            }

            if (connection.groupsToken) {
                qs += "&groupsToken=" + window.encodeURIComponent(connection.groupsToken);
            }

            if (!reconnecting) {
                url = url + "/connect";
            } else {
                if (appendReconnectUrl) {
                    url = url + "/reconnect";
                }
                if (connection.messageId) {
                    qs += "&messageId=" + window.encodeURIComponent(connection.messageId);
                }
            }
            url += "?" + qs;
            url = this.addQs(url, connection);
            url += "&tid=" + Math.floor(Math.random() * 11);
            return url;
        },

        maximizePersistentResponse: function (minPersistentResponse) {
            return {
                MessageId: minPersistentResponse.C,
                Messages: minPersistentResponse.M,
                Disconnect: typeof (minPersistentResponse.D) !== "undefined" ? true : false,
                TimedOut: typeof (minPersistentResponse.T) !== "undefined" ? true : false,
                LongPollDelay: minPersistentResponse.L,
                GroupsToken: minPersistentResponse.G
            };
        },

        updateGroups: function (connection, groupsToken) {
            if (groupsToken) {
                connection.groupsToken = groupsToken;
            }
        },

        ajaxSend: function (connection, data) {
            var url = connection.url + "/send" + "?transport=" + connection.transport.name + "&connectionToken=" + window.encodeURIComponent(connection.token);
            url = this.addQs(url, connection);
            return $.ajax({
                url: url,
                global: false,
                type: connection.ajaxDataType === "jsonp" ? "GET" : "POST",
                dataType: connection.ajaxDataType,
                data: {
                    data: data
                },
                success: function (result) {
                    if (result) {
                        $(connection).triggerHandler(events.onReceived, [result]);
                    }
                },
                error: function (errData, textStatus) {
                    if (textStatus === "abort" ||
                        (textStatus === "parsererror" && connection.ajaxDataType === "jsonp")) {
                        return;
                    }
                    $(connection).triggerHandler(events.onError, [errData]);
                }
            });
        },

        ajaxAbort: function (connection, async) {
            if (typeof (connection.transport) === "undefined") {
                return;
            }

            async = typeof async === "undefined" ? true : async;

            var url = connection.url + "/abort" + "?transport=" + connection.transport.name + "&connectionToken=" + window.encodeURIComponent(connection.token);
            url = this.addQs(url, connection);
            $.ajax({
                url: url,
                async: async,
                timeout: 1000,
                global: false,
                type: "POST",
                dataType: connection.ajaxDataType,
                data: {}
            });

            connection.log("Fired ajax abort async = " + async);
        },

        processMessages: function (connection, minData) {
            var data;
            if (connection.transport) {
                var $connection = $(connection);

                if (connection.transport.supportsKeepAlive && connection.keepAliveData.activated) {
                    this.updateKeepAlive(connection);
                }

                if (!minData) {
                    return;
                }

                data = this.maximizePersistentResponse(minData);

                if (data.Disconnect) {
                    connection.log("Disconnect command received from server");
                    connection.stop(false, false);
                    return;
                }

                this.updateGroups(connection, data.GroupsToken);

                if (data.Messages) {
                    $.each(data.Messages, function () {
                        try {
                            $connection.triggerHandler(events.onReceived, [this]);
                        }
                        catch (e) {
                            connection.log("Error raising received " + e);
                            $(connection).triggerHandler(events.onError, [e]);
                        }
                    });
                }

                if (data.MessageId) {
                    connection.messageId = data.MessageId;
                }
            }
        },

        monitorKeepAlive: function (connection) {
            var keepAliveData = connection.keepAliveData,
                that = this;

            if (!keepAliveData.monitoring) {
                keepAliveData.monitoring = true;
                that.updateKeepAlive(connection);
                connection.keepAliveData.reconnectKeepAliveUpdate = function () {
                    that.updateKeepAlive(connection);
                };

                $(connection).bind(events.onReconnect, connection.keepAliveData.reconnectKeepAliveUpdate);
                connection.log("Now monitoring keep alive with a warning timeout of " + keepAliveData.timeoutWarning + " and a connection lost timeout of " + keepAliveData.timeout);
                checkIfAlive(connection);
            }
            else {
                connection.log("Tried to monitor keep alive but it's already being monitored");
            }
        },

        stopMonitoringKeepAlive: function (connection) {
            var keepAliveData = connection.keepAliveData;

            if (keepAliveData.monitoring) {
                keepAliveData.monitoring = false;
                $(connection).unbind(events.onReconnect, connection.keepAliveData.reconnectKeepAliveUpdate);
                keepAliveData = {};
                connection.log("Stopping the monitoring of the keep alive");
            }
        },

        updateKeepAlive: function (connection) {
            connection.keepAliveData.lastKeepAlive = new Date();
        },

        ensureReconnectingState: function (connection) {
            if (changeState(connection,
                        signalR.connectionState.connected,
                        signalR.connectionState.reconnecting) === true) {
                $(connection).triggerHandler(events.onReconnecting);
            }
            return connection.state === signalR.connectionState.reconnecting;
        },

        foreverFrame: {
            count: 0,
            connections: {}
        }
    };

}(window.jQuery, window));

(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic;

    signalR.transports.webSockets = {
        name: "webSockets",

        supportsKeepAlive: true,

        attemptingReconnect: false,

        currentSocketID: 0,

        send: function (connection, data) {
            connection.socket.send(data);
        },

        start: function (connection, onSuccess, onFailed) {
            var url,
                opened = false,
                that = this,
                reconnecting = !onSuccess,
                $connection = $(connection);

            if (!window.WebSocket) {
                onFailed();
                return;
            }

            if (!connection.socket) {
                if (connection.webSocketServerUrl) {
                    url = connection.webSocketServerUrl;
                }
                else {
                    url = connection.wsProtocol + connection.host;
                }

                url += transportLogic.getUrl(connection, this.name, reconnecting);

                connection.log("Connecting to websocket endpoint '" + url + "'");
                connection.socket = new window.WebSocket(url);
                connection.socket.ID = ++that.currentSocketID;
                connection.socket.onopen = function () {
                    opened = true;
                    connection.log("Websocket opened");

                    if (that.attemptingReconnect) {
                        that.attemptingReconnect = false;
                    }

                    if (onSuccess) {
                        onSuccess();
                    } else if (changeState(connection,
                                         signalR.connectionState.reconnecting,
                                         signalR.connectionState.connected) === true) {
                        $connection.triggerHandler(events.onReconnect);
                    }
                };

                connection.socket.onclose = function (event) {
                  
                    if (this.ID === that.currentSocketID) {
                        if (!opened) {
                            if (onFailed) {
                                onFailed();
                            }
                            else if (reconnecting) {
                                that.reconnect(connection);
                            }
                            return;
                        }
                        else if (typeof event.wasClean !== "undefined" && event.wasClean === false) {
                            
                            $(connection).triggerHandler(events.onError, [event.reason]);
                            connection.log("Unclean disconnect from websocket." + event.reason);
                        }
                        else {
                            connection.log("Websocket closed");
                        }

                        that.reconnect(connection);
                    }
                };

                connection.socket.onmessage = function (event) {
                    var data = window.JSON.parse(event.data),
                        $connection = $(connection);

                    if (data) {
                     
                        if ($.isEmptyObject(data) || data.M) {
                            transportLogic.processMessages(connection, data);
                        } else {                           
                            $connection.triggerHandler(events.onReceived, [data]);
                        }
                    }
                };
            }
        },

        reconnect: function (connection) {
            var that = this;

            if (connection.state !== signalR.connectionState.disconnected) {
                if (!that.attemptingReconnect) {
                    that.attemptingReconnect = true;
                }

                window.setTimeout(function () {
                    if (that.attemptingReconnect) {
                        that.stop(connection);
                    }

                    if (transportLogic.ensureReconnectingState(connection)) {
                        connection.log("Websocket reconnecting");
                        that.start(connection);
                    }
                }, connection.reconnectDelay);
            }
        },

        lostConnection: function (connection) {
            this.reconnect(connection);

        },

        stop: function (connection) {
            if (connection.socket !== null) {
                connection.log("Closing the Websocket");
                connection.socket.close();
                connection.socket = null;
            }
        },

        abort: function (connection) {
        }
    };

}(window.jQuery, window));


(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic;

    signalR.transports.serverSentEvents = {
        name: "serverSentEvents",

        supportsKeepAlive: true,

        reconnectTimeout: false,

        currentEventSourceID: 0,

        timeOut: 3000,

        start: function (connection, onSuccess, onFailed) {
            var that = this,
                opened = false,
                $connection = $(connection),
                reconnecting = !onSuccess,
                url,
                connectTimeOut;

            if (connection.eventSource) {
                connection.log("The connection already has an event source. Stopping it.");
                connection.stop();
            }

            if (!window.EventSource) {
                if (onFailed) {
                    connection.log("This browser doesn't support SSE.");
                    onFailed();
                }
                return;
            }

            url = transportLogic.getUrl(connection, this.name, reconnecting);

            try {
                connection.log("Attempting to connect to SSE endpoint '" + url + "'");
                connection.eventSource = new window.EventSource(url);
                connection.eventSource.ID = ++that.currentEventSourceID;
            }
            catch (e) {
                connection.log("EventSource failed trying to connect with error " + e.Message);
                if (onFailed) {
                    onFailed();
                }
                else {
                    $connection.triggerHandler(events.onError, [e]);
                    if (reconnecting) {
                        that.reconnect(connection);
                    }
                }
                return;
            }

            connectTimeOut = window.setTimeout(function () {
                if (opened === false) {
                    connection.log("EventSource timed out trying to connect");
                    connection.log("EventSource readyState: " + connection.eventSource.readyState);

                    if (!reconnecting) {
                        that.stop(connection);
                    }

                    if (reconnecting) {                        
                        if (connection.eventSource.readyState !== window.EventSource.CONNECTING &&
                            connection.eventSource.readyState !== window.EventSource.OPEN) {
                            that.reconnect(connection);
                        }
                    } else if (onFailed) {
                        onFailed();
                    }
                }
            },
            that.timeOut);

            connection.eventSource.addEventListener("open", function (e) {
                connection.log("EventSource connected");

                if (connectTimeOut) {
                    window.clearTimeout(connectTimeOut);
                }

                if (that.reconnectTimeout) {
                    window.clearTimeout(that.reconnectTimeout);
                }

                if (opened === false) {
                    opened = true;

                    if (onSuccess) {
                        onSuccess();
                    } else if (changeState(connection,
                                         signalR.connectionState.reconnecting,
                                         signalR.connectionState.connected) === true) {
                        $connection.triggerHandler(events.onReconnect);
                    }
                }
            }, false);

            connection.eventSource.addEventListener("message", function (e) {
              
                if (e.data === "initialized") {
                    return;
                }

                transportLogic.processMessages(connection, window.JSON.parse(e.data));
            }, false);

            connection.eventSource.addEventListener("error", function (e) {

                if (this.ID === that.currentEventSourceID) {
                    if (!opened) {
                        if (onFailed) {
                            onFailed();
                        }

                        return;
                    }

                    connection.log("EventSource readyState: " + connection.eventSource.readyState);

                    if (e.eventPhase === window.EventSource.CLOSED) {                      
                        connection.log("EventSource reconnecting due to the server connection ending");
                        that.reconnect(connection);
                    } else {
                        connection.log("EventSource error");
                        $connection.triggerHandler(events.onError);
                    }
                }
            }, false);
        },

        reconnect: function (connection) {
            var that = this;

            that.reconnectTimeout = window.setTimeout(function () {
                that.stop(connection);

                if (transportLogic.ensureReconnectingState(connection)) {
                    connection.log("EventSource reconnecting");
                    that.start(connection);
                }
            }, connection.reconnectDelay);
        },

        lostConnection: function (connection) {
            this.reconnect(connection);
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        stop: function (connection) {
            if (connection && connection.eventSource) {
                connection.log("EventSource calling close()");
                connection.eventSource.close();
                connection.eventSource = null;
                delete connection.eventSource;
            }
        },
        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        }
    };

}(window.jQuery, window));


(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        transportLogic = signalR.transports._logic;

    signalR.transports.foreverFrame = {
        name: "foreverFrame",

        supportsKeepAlive: true,

        timeOut: 3000,

        start: function (connection, onSuccess, onFailed) {
            var that = this,
                frameId = (transportLogic.foreverFrame.count += 1),
                url,
                frame = $("<iframe data-signalr-connection-id='" + connection.id + "' style='position:absolute;top:0;left:0;width:0;height:0;visibility:hidden;' src=''></iframe>");

            if (window.EventSource) {
                if (onFailed) {
                    connection.log("This browser supports SSE, skipping Forever Frame.");
                    onFailed();
                }
                return;
            }

            url = transportLogic.getUrl(connection, this.name);
            url += "&frameId=" + frameId;

            $("body").append(frame);

            frame.prop("src", url);
            transportLogic.foreverFrame.connections[frameId] = connection;

            connection.log("Binding to iframe's readystatechange event.");
            frame.bind("readystatechange", function () {
                if ($.inArray(this.readyState, ["loaded", "complete"]) >= 0) {
                    connection.log("Forever frame iframe readyState changed to " + this.readyState + ", reconnecting");

                    that.reconnect(connection);
                }
            });

            connection.frame = frame[0];
            connection.frameId = frameId;

            if (onSuccess) {
                connection.onSuccess = onSuccess;
            }

            window.setTimeout(function () {
                if (connection.onSuccess) {
                    connection.log("Failed to connect using forever frame source, it timed out after " + that.timeOut + "ms.");
                    that.stop(connection);

                    if (onFailed) {
                        onFailed();
                    }
                }
            }, that.timeOut);
        },

        reconnect: function (connection) {
            var that = this;
            window.setTimeout(function () {
                if (connection.frame && transportLogic.ensureReconnectingState(connection)) {
                    var frame = connection.frame,
                        src = transportLogic.getUrl(connection, that.name, true) + "&frameId=" + connection.frameId;
                    connection.log("Updating iframe src to '" + src + "'.");
                    frame.src = src;
                }
            }, connection.reconnectDelay);
        },

        lostConnection: function (connection) {
            this.reconnect(connection);
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        receive: function (connection, data) {
            var cw;

            transportLogic.processMessages(connection, data);
            connection.frameMessageCount = (connection.frameMessageCount || 0) + 1;
            if (connection.frameMessageCount > 50) {
                connection.frameMessageCount = 0;
                cw = connection.frame.contentWindow || connection.frame.contentDocument;
                if (cw && cw.document) {
                    $("body", cw.document).empty();
                }
            }
        },

        stop: function (connection) {
            var cw = null;
            if (connection.frame) {
                if (connection.frame.stop) {
                    connection.frame.stop();
                } else {
                    try {
                        cw = connection.frame.contentWindow || connection.frame.contentDocument;
                        if (cw.document && cw.document.execCommand) {
                            cw.document.execCommand("Stop");
                        }
                    }
                    catch (e) {
                        connection.log("SignalR: Error occured when stopping foreverFrame transport. Message = " + e.message);
                    }
                }
                $(connection.frame).remove();
                delete transportLogic.foreverFrame.connections[connection.frameId];
                connection.frame = null;
                connection.frameId = null;
                delete connection.frame;
                delete connection.frameId;
                connection.log("Stopping forever frame");
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        },

        getConnection: function (id) {
            return transportLogic.foreverFrame.connections[id];
        },

        started: function (connection) {
            if (connection.onSuccess) {
                connection.onSuccess();
                connection.onSuccess = null;
                delete connection.onSuccess;
            } else if (changeState(connection,
                                   signalR.connectionState.reconnecting,
                                   signalR.connectionState.connected) === true) {
                $(connection).triggerHandler(events.onReconnect);
            }
        }
    };

}(window.jQuery, window));

(function ($, window) {
    "use strict";

    var signalR = $.signalR,
        events = $.signalR.events,
        changeState = $.signalR.changeState,
        isDisconnecting = $.signalR.isDisconnecting,
        transportLogic = signalR.transports._logic;

    signalR.transports.longPolling = {
        name: "longPolling",

        supportsKeepAlive: false,

        reconnectDelay: 3000,

        init: function (connection, onComplete) {

            var that = this,
                pingLoop,
                pingFail = function (reason) {
                    if (isDisconnecting(connection) === false) {
                        connection.log("SignalR: Server ping failed because '" + reason + "', re-trying ping.");
                        window.setTimeout(pingLoop, that.reconnectDelay);
                    }
                };

            connection.log("SignalR: Initializing long polling connection with server.");
            pingLoop = function () {                
                transportLogic.pingServer(connection, that.name).done(onComplete).fail(pingFail);
            };

            pingLoop();
        },

        start: function (connection, onSuccess, onFailed) {
           
            var that = this,
                initialConnectedFired = false,
                fireConnect = function () {
                    if (initialConnectedFired) {
                        return;
                    }
                    initialConnectedFired = true;
                    onSuccess();
                    connection.log("Longpolling connected");
                };

            if (connection.pollXhr) {
                connection.log("Polling xhr requests already exists, aborting.");
                connection.stop();
            }

            that.init(connection, function () {
                connection.messageId = null;

                window.setTimeout(function () {
                    (function poll(instance, raiseReconnect) {
                        var messageId = instance.messageId,
                            connect = (messageId === null),
                            reconnecting = !connect,
                            url = transportLogic.getUrl(instance, that.name, reconnecting, raiseReconnect);

                        if (isDisconnecting(instance) === true) {
                            return;
                        }

                        connection.log("Attempting to connect to '" + url + "' using longPolling.");
                        instance.pollXhr = $.ajax({
                            url: url,
                            global: false,
                            cache: false,
                            type: "GET",
                            dataType: connection.ajaxDataType,
                            success: function (minData) {
                                var delay = 0,
                                    data;

                                fireConnect();

                                if (minData) {
                                    data = transportLogic.maximizePersistentResponse(minData);
                                }

                                transportLogic.processMessages(instance, minData);

                                if (data &&
                                    $.type(data.LongPollDelay) === "number") {
                                    delay = data.LongPollDelay;
                                }

                                if (data && data.Disconnect) {
                                    return;
                                }

                                if (isDisconnecting(instance) === true) {
                                    return;
                                }
                              
                                if (delay > 0) {
                                    window.setTimeout(function () {
                                        poll(instance, false);
                                    }, delay);
                                } else {
                                    poll(instance, false);
                                }
                            },

                            error: function (data, textStatus) {
                                if (textStatus === "abort") {
                                    connection.log("Aborted xhr requst.");
                                    return;
                                }

                                if (connection.state !== signalR.connectionState.reconnecting) {
                                    connection.log("An error occurred using longPolling. Status = " + textStatus + ". " + data.responseText);
                                    $(instance).triggerHandler(events.onError, [data.responseText]);
                                }

                                transportLogic.ensureReconnectingState(instance);
                                that.init(instance, function () {
                                    poll(instance, true);
                                });
                            }
                        });

                        if (reconnecting && raiseReconnect === true) {
                            if (changeState(connection,
                                            signalR.connectionState.reconnecting,
                                            signalR.connectionState.connected) === true) {
                                connection.log("Raising the reconnect event");
                                $(instance).triggerHandler(events.onReconnect);
                            }
                        }
                    }(connection));

                    window.setTimeout(function () {
                        fireConnect();
                    }, 250);
                }, 250); 
            });
        },

        lostConnection: function (connection) {
            throw new Error("Lost Connection not handled for LongPolling");
        },

        send: function (connection, data) {
            transportLogic.ajaxSend(connection, data);
        },

        stop: function (connection) {
            if (connection.pollXhr) {
                connection.pollXhr.abort();
                connection.pollXhr = null;
                delete connection.pollXhr;
            }
        },

        abort: function (connection, async) {
            transportLogic.ajaxAbort(connection, async);
        }
    };

}(window.jQuery, window));


(function ($, window) {
    "use strict";

    var callbackId = 0,
        callbacks = {},
        eventNamespace = ".hubProxy";

    function makeEventName(event) {
        return event + eventNamespace;
    }

    if (!Array.prototype.hasOwnProperty("map")) {
        Array.prototype.map = function (fun, thisp) {
            var arr = this,
                i,
                length = arr.length,
                result = [];
            for (i = 0; i < length; i += 1) {
                if (arr.hasOwnProperty(i)) {
                    result[i] = fun.call(thisp, arr[i], i, arr);
                }
            }
            return result;
        };
    }

    function getArgValue(a) {
        return $.isFunction(a) ? null : ($.type(a) === "undefined" ? null : a);
    }

    function hasMembers(obj) {
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                return true;
            }
        }

        return false;
    }

    function hubProxy(hubConnection, hubName) {
        return new hubProxy.fn.init(hubConnection, hubName);
    }

    hubProxy.fn = hubProxy.prototype = {
        init: function (connection, hubName) {
            this.state = {};
            this.connection = connection;
            this.hubName = hubName;
            this._ = {
                callbackMap: {}
            };
        },

        hasSubscriptions: function () {
            return hasMembers(this._.callbackMap);
        },

        on: function (eventName, callback) {
            var self = this,
                callbackMap = self._.callbackMap;
            eventName = eventName.toLowerCase();
            if (!callbackMap[eventName]) {
                callbackMap[eventName] = {};
            }

            callbackMap[eventName][callback] = function (e, data) {
                callback.apply(self, data);
            };

            $(self).bind(makeEventName(eventName), callbackMap[eventName][callback]);

            return self;
        },

        off: function (eventName, callback) {
            var self = this,
                callbackMap = self._.callbackMap,
                callbackSpace;

            eventName = eventName.toLowerCase();

            callbackSpace = callbackMap[eventName];

            if (callbackSpace) {
                if (callbackSpace[callback]) {
                    $(self).unbind(makeEventName(eventName), callbackSpace[callback]);
                    delete callbackSpace[callback];
                    if (!hasMembers(callbackSpace)) {
                        delete callbackMap[eventName];
                    }
                }
                else if (!callback) { 
                    $(self).unbind(makeEventName(eventName));

                    delete callbackMap[eventName];
                }
            }

            return self;
        },

        invoke: function (methodName) {
            var self = this,
                args = $.makeArray(arguments).slice(1),
                argValues = args.map(getArgValue),
                data = { H: self.hubName, M: methodName, A: argValues, I: callbackId },
                d = $.Deferred(),
                callback = function (minResult) {
                    var result = self._maximizeHubResponse(minResult);

                    $.extend(self.state, result.State);

                    if (result.Error) {                        
                        if (result.StackTrace) {
                            self.connection.log(result.Error + "\n" + result.StackTrace);
                        }
                        d.rejectWith(self, [result.Error]);
                    } else {
                        d.resolveWith(self, [result.Result]);
                    }
                };

            callbacks[callbackId.toString()] = { scope: self, method: callback };
            callbackId += 1;

            if (!$.isEmptyObject(self.state)) {
                data.S = self.state;
            }
            
            self.connection.send(window.JSON.stringify(data));

            return d.promise();
        },

        _maximizeHubResponse: function (minHubResponse) {
            return {
                State: minHubResponse.S,
                Result: minHubResponse.R,
                Id: minHubResponse.I,
                Error: minHubResponse.E,
                StackTrace: minHubResponse.T
            };
        }
    };

    hubProxy.fn.init.prototype = hubProxy.fn;

    function hubConnection(url, options) {
        var settings = {
            qs: null,
            logging: false,
            useDefaultPath: true
        };

        $.extend(settings, options);

        if (!url || settings.useDefaultPath) {
            url = (url || "") + "/signalr";
        }
        return new hubConnection.fn.init(url, settings);
    }

    hubConnection.fn = hubConnection.prototype = $.connection();

    hubConnection.fn.init = function (url, options) {
        var settings = {
            qs: null,
            logging: false,
            useDefaultPath: true
        },
            connection = this;

        $.extend(settings, options);

        $.signalR.fn.init.call(connection, url, settings.qs, settings.logging);
        connection.proxies = {};
        connection.received(function (minData) {
            var data, proxy, dataCallbackId, callback, hubName, eventName;
            if (!minData) {
                return;
            }

            if (typeof (minData.I) !== "undefined") {
                dataCallbackId = minData.I.toString();
                callback = callbacks[dataCallbackId];
                if (callback) {
                    callbacks[dataCallbackId] = null;
                    delete callbacks[dataCallbackId];
                    callback.method.call(callback.scope, minData);
                }
            } else {
                data = this._maximizeClientHubInvocation(minData);
                connection.log("Triggering client hub event '" + data.Method + "' on hub '" + data.Hub + "'.");
                hubName = data.Hub.toLowerCase();
                eventName = data.Method.toLowerCase();
                proxy = this.proxies[hubName];
                $.extend(proxy.state, data.State);
                $(proxy).triggerHandler(makeEventName(eventName), [data.Args]);
            }
        });
    };

    hubConnection.fn._maximizeClientHubInvocation = function (minClientHubInvocation) {
        return {
            Hub: minClientHubInvocation.H,
            Method: minClientHubInvocation.M,
            Args: minClientHubInvocation.A,
            State: minClientHubInvocation.S
        };
    };

    hubConnection.fn._registerSubscribedHubs = function () {

        if (!this._subscribedToHubs) {
            this._subscribedToHubs = true;
            this.starting(function () {
                var subscribedHubs = [];

                $.each(this.proxies, function (key) {
                    if (this.hasSubscriptions()) {
                        subscribedHubs.push({ name: key });
                    }
                });

                this.data = window.JSON.stringify(subscribedHubs);
            });
        }
    };

    hubConnection.fn.createHubProxy = function (hubName) {
        hubName = hubName.toLowerCase();

        var proxy = this.proxies[hubName];
        if (!proxy) {
            proxy = hubProxy(this, hubName);
            this.proxies[hubName] = proxy;
        }

        this._registerSubscribedHubs();

        return proxy;
    };

    hubConnection.fn.init.prototype = hubConnection.fn;

    $.hubConnection = hubConnection;

}(window.jQuery, window));

(function ($) {
    $.signalR.version = "1.0.0.rc1";
}(window.jQuery));
