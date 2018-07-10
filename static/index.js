(function(){
    const logd = (...args)=>console.debug("D|"+new Date().toISOString(), ...args);
    const logi = (...args)=>console.info( "I|"+new Date().toISOString(), ...args);
    const logw = (...args)=>console.warn( "W|"+new Date().toISOString(), ...args);
    const loge = (...args)=>console.error("E|"+new Date().toISOString(), ...args);


    function randomU32() {
        return Math.floor(Math.random()*4294967296);
    }
    function randomU16() {
        return Math.floor(Math.random()*65536);
    }
    const randomID = randomU32;
    function streamExisted(streams, stream) {
        return streams.findIndex((e)=>e.equal(stream)) !== -1;
    }

    class Emitter {
        constructor() {
            this._handlers = Object.create(null);
        };

        /**
         * register the event with a handler
         * @param  {string}     event
         * @param  {function}   handler
         * @return {NA}         NA
         */
        on(event, handler) {
            this._handlers[event] = this._handlers[event] || [];
            handler._once = false;
            this._handlers[event].push(handler);
        };

        /**
         * same as on but just run once when the given event fired
         * @param  {string}     event
         * @param  {function}   handler
         * @return {NA}         NA
         */
        once(event, handler) {
            this._handlers[event] = (this._handlers[event] || []);
            handler._once = true;
            this._handlers[event].push(handler);
        };

        /**
         * turn off the event handler
         * @param  {string}     event
         * @param  {function}   handler
         * @return {NA}         NA
         */
        off(event, handler) {
            let handlers = this._handlers[event];
            if (!handlers) return;
            if (handler) {
                handlers.splice(handlers.indexOf(handler)>>>0, 1);
            } else {
                this._handlers[event] = [];
            }
        };

        /**
         * fire the event with arguments
         * @param  {string}     event
         * @return {NA}         NA
         */
        emit(event, ...args) {
            let emitter = this;
            (this._handlers[event] || []).slice().map(function(handler){
                if(handler._once) {
                    emitter.off(event, handler);
                }
                handler(...args);
            });
        };

        /**
         * fire the event with arguments asynchronously
         * @param  {string}     event
         * @return {NA}         NA
         */
        aemit(event, ...args) {
            let emitter = this;
            new Promise(function (resolve, reject) {
                resolve();
            }).then(function () {
                emitter.emit(event, ...args);
            });
        };

        check(event) {
            return (this._handlers[event] && this._handlers[event].length > 0);
        };
    };


    class RetryTimer {
        constructor() {
            this.reset();
        }

        connectMS() {
            return this.connectTimeoutMS;
        }
        retryMS() {
            let ret = this.retryTimeoutMS;
            this.retryTimeoutMS += this.randomMS();
            if (this.retryTimeoutMS >= this.maxRetryTimeoutMS) {
                this.retryTimeoutMS = this.maxRetryTimeoutMS;
            }
            return ret;
        }
        randomMS() {
            return Math.ceil(Math.random()*1000) + this.incrementMS;
        }
        reset() {
            this.connectTimeoutMS  = 5000;
            this.maxRetryTimeoutMS = 10000;
            this.incrementMS       = 1000;
            this.retryTimeoutMS    = this.randomMS();
        }
    };

    class StableWebSocket {
        constructor() {
            this.url            = null;
            this.onmessage      = null;
            this.onopen         = null;
            this.onclose        = null;
            this.ws             = null;
            this.connectTimerID = 0;
            this.retryTimerID   = 0;
            this.timer          = new RetryTimer();
            this.lastConnectTS  = 0;
        }
        send(data) {
            if (this.ws) {
                this.ws.send(data);
            }
        }
        close() {
            logi("closing socket");
            if (this.ws) {
                this.ws.onclose = null;
                this.ws.onmessage = null;
                this.ws.close();
            }
            if (this.connectTimerID > 0) {
                clearTimeout(this.connectTimerID);
                this.connectTimerID = 0;
            }
            if (this.retryTimerID > 0) {
                clearTimeout(this.retryTimerID);
                this.retryTimerID = 0;
            }
        }
        connect(url) {
            logi('connecting:', url);
            this.url = url;
            this.timer.reset();

            // incase of connect the wrong url: connect will be success, but server will
            // disconnect socket immediately after that.
            if (Date.now() - this.lastConnectTS > this.timer.retryTimeoutMS) {
                logd('direct connect');
                this._connectWebSocket();
            } else {
                logd('random connect');
                this.connectTimerID = setTimeout(this._connectWebSocket.bind(this), this.timer.randomMS());
            }
        }

        _connectWebSocket() {
            try {
                this.lastConnectTS = Date.now();
                let ws     = new WebSocket(url);
                ws.onopen  = this._onopen.bind(this);
                ws.onclose = this._onclose.bind(this);
                ws.onerror = this._onerror.bind(this);
                this.ws    = ws;
                this.connectTimerID = setTimeout(()=>{
                    loge("connect", url, "timeout!");
                    ws.close();
                }, this.timer.connectMS());
            } catch (e) {
                loge("ERROR:", e);
                this.ws = null;
                this._retry();
            }
        }

        _retry() {
            let con = this;
            let ms = con.timer.retryMS();
            logd("retry after", ms, "ms");
            con.retryTimerID = setTimeout(()=>{
                con._connectWebSocket();
            }, ms);
        }
        _onopen() {
            this.timer.reset();
            clearTimeout(this.connectTimerID);
            let ws       = this.ws;
            ws.onclose   = this.onclose;
            ws.onmessage = this.onmessage;
            if (this.onopen) {
                this.onopen();
            }
        }
        _onclose(e) {
            logw("socket closed", e.code);
            this.ws = null;
            clearTimeout(this.connectTimerID);
            this._retry();
        }
        _onerror(e) {
            loge("socket error:", e.type);
            this.ws.close();
        }
    };

    class PingService {
        constructor(intervalMS, timeoutHits) {
            this.pingTimer     = 0;
            this.interval      = intervalMS;
            this.timeoutHits   = timeoutHits;
            this.pingHits      = 0;
            this.con           = null;
        }

        start(con, callback) {
            this.con = con;
            this.timeoutCallback = callback;
            this.pingHits = 0;
            this._ping();
        }
        stop() {
            logi("=> stop ping");
            if (this.pingTimer > 0) {
                clearTimeout(this.pingTimer);
            }
            this.pingTimer = 0;
            this.con = null;
        }
        pong() {
            this.pingHits = 0;
        }
        _ping() {
            if (!this.con) {
                return;
            }

            if (this.pingHits >= this.timeoutHits) {
                if (this.timeoutCallback) {
                    logw("ping time out");
                    this.timeoutCallback();
                }
                this.pingTimer = 0;
            } else {
                let req = {command: "ping"};
                this.con.send(JSON.stringify(req));
                this.pingTimer = setTimeout(this._ping.bind(this), this.interval);
                this.pingHits++;
            }
        }
    };

    const CREATED    = 0;
    const ERROR      = 1;
    const CONNECTING = 2;
    const COMPLETED  = 3;
    const CLOSED     = 4;

    const LOCAL      = 0;
    const REMOTE     = 1;

    const CMD_PUB    = 1;
    const CMD_SUB    = 2;
    const CMD_UNPUB  = 3;
    const CMD_UNSUB  = 4;

    class Stream {
        constructor(id, type = LOCAL) {
            this.type      = type;
            this.id        = id;
            this.status    = CREATED;
            this.timer     = new RetryTimer();
            this.nextTryTS = 0;
        }
        equal(stream) {
            return (stream instanceof Stream) &&
                stream.type === this.type &&
                stream.id === this.id;
        }
        disconnect() {
            this.status = ERROR;
            this.timer.reset();
            this.nextTryTS = 0;
        }
    };
    class StreamCommand {
        constructor(type, stream, resolve, reject) {
            this.type    = type;
            this.stream  = stream;
            this.resolve = resolve;
            this.reject  = reject;
        }
    };
    class StreamPicker {
        constructor(app) {
            this.app = app;
        }
        pick() {
            let stream = null;
            let now = Date.now();
            for(let one of this.app.lstreams) {
                if (one.status !== ERROR) continue;
                if (!stream) {
                    stream = one;
                }
                if ((one.nextTryTS-now) < (stream.nextTryTS-now)) {
                    stream = one;
                }
            }
            for(let one of this.app.rstreams) {
                if (one.status !== ERROR) continue;
                if (!stream) {
                    stream = one;
                }
                if ((one.nextTryTS-now) < (stream.nextTryTS-now)) {
                    stream = one;
                }
            }

            return stream;
        }
    }

    class StreamOperator {
        constructor(app) {
            this.app = app;
            this.working = null;
            this.repairing = null;
            this.timerID = 0;
            this.picker = new StreamPicker(app);
        }
        trigger() {
            if (this.working || this.repairing) {
                logd("already in progress...");
                return;
            }
            let app = this.app;
            if (app.streamCmds.length !== 0) {
                this.working = app.streamCmds[0];
                app.streamCmds.splice(0, 1);
                this._process_();
            } else {
                this._repair_();
            }
        }
        stop() {
            if (this.timerID) {
                clearTimeout(this.timerID);
            }
            this.timerID = 0;
            let app = this.app;
            if (this.working) {
                app.streamCmds.splice(0, 0, this.working);
            }
            this.working = null;
            this.repairing = null;
            app._clearStreamHandler_();
        }

        disconnect() {
            this.stop();
            for (let one of this.app.lstreams) {
                one.disconnect();
            }
            for (let one of this.app.rstreams) {
                one.disconnect();
            }
        }

        _process_() {
            clearTimeout(this.timerID);
            this.timerID = 0;

            let cmd = this.working;
            logi("process stream:", cmd.stream.id);
            switch(cmd.type) {
                case CMD_PUB:   { this._doPublish_(); break; }
                case CMD_SUB:   { this._doSubscribe_(); break; }
                case CMD_UNPUB: { this._doUnPublish_(); break; }
                case CMD_UNSUB: { this._doUnSubscribe_(); break; }
                default:
                {
                    loge("invalid command", cmd.type);
                    this.working = null;
                    this.trigger();
                    break;
                }
            }
        }
        _repair_() {
            let stream = this.picker.pick();
            if (!stream) {
                logd("NO stream needs to be repair");
                return;
            }
            let delta = stream.nextTryTS - Date.now();
            if (delta <= 0) {
                this._repairStream_(stream);
            } else {
                this.timerID = setTimeout(this._repair_.bind(this), delta);
            }
        }

        _repairStream_(stream) {
            this.repairing = stream;
            if (stream.type === LOCAL) {
                this._repairPublishStream_(stream);
            } else {
                this._repairSubscribeStream_(stream);
            }
        }
        _repairPublishStream_(stream) {
            let app = this.app;
            let operator = this;

            function succ(resp) {
                logd("repair succ", stream.id);
                stream.status = COMPLETED;
                operator.repairing = null;
                operator.trigger();
            }
            function fail(resp) {
                logd("fail to repair", stream.id);
                stream.status = ERROR;
                stream.nextTryTS = Date.now() + stream.timer.retryMS();
                operator.repairing = null;
                operator.trigger();
            }
            app._doPublish_(stream, succ, fail);
        }
        _repairSubscribeStream_(stream) {}

        _doPublish_() {
            let app = this.app;
            let cmd = this.working;
            let operator = this;
            if (streamExisted(app.lstreams, cmd.stream)) {
                cmd.reject && reject();
                this.working = null;
                this.trigger();
                return;
            }
            function succ(resp) {
                logi("publish succ", cmd.stream.id);
                app.emitter.aemit("stream-published", cmd.stream);
                cmd.stream.status = COMPLETED;
                operator.working = null;
                app.lstreams.push(cmd.stream);
                operator.trigger();
            }
            function fail(resp) {
                loge("fail to publish", cmd.stream.id);
                cmd.stream.status = ERROR;
                cmd.stream.nextTryTS = Date.now() + cmd.stream.timer.retryMS();
                operator.working = null;
                app.lstreams.push(cmd.stream);
                operator.trigger();
            }
            app._doPublish_(cmd.stream, succ, fail);
        }
        _doUnPublish_() {}
        _doSubscribe_() {}
        _doUnSubscribe_() {}
    };

    class StateBase {
        constructor(app) {
            this.app = app;
        }
        init(resolve, reject) {
            reject && reject();
        }
        join(conf, resolve, reject) {
            reject && reject();
        }
        leave(resolve, reject) {
            reject && reject();
        }
        publish(stream, resolve, reject) {
            let app = this.app;
            app.streamCmds.push(new StreamCommand(CMD_PUB, stream, resolve, reject));
        }
        subscribe(stream, resolve, reject) {
            let app = this.app;
            app.streamCmds.push(new StreamCommand(CMD_SUB, stream, resolve, reject));
        }
        unpublish(stream, resolve, reject) {
            let app = this.app;
            app.streamCmds.push(new StreamCommand(CMD_UNPUB, stream, resolve, reject));
        }
        unsubscribe(stream, resolve, reject) {
            let app = this.app;
            app.streamCmds.push(new StreamCommand(CMD_UNSUB, stream, resolve, reject));
        }
        close() {
            loge("call from state base");
        }
        recover() {
            loge("recover from base");
        }
        stop() {
            loge("stop from base");
        }
    };
    class StateNormal extends StateBase {
        constructor(app) {
            super(app);
        }
        init(resolve, reject) {
            let app = this.app;
            if (app.id >= 0) {
                reject && reject();
                return;
            }
            function succ(resp) {
                app.id = resp.data.id;
                resolve && resolve();
            }
            function fail(resp) {
                loge("fail to init", resp);
                app.id = -1;
                reject && reject();
            }
            app._start_(()=>{
                app.id = 0;
                app._doInit_(succ, fail);
            });
        }
        join(conf, resolve, reject) {
            let app = this.app;
            if (app.conf) {
                reject && reject();
                return;
            }
            app.conf = conf;
            function fail(resp) {
                loge("fail to join", resp);
                app.conf = null;
                reject && reject();
            }
            app._doJoin_(conf, resolve, fail);
        }
        leave(resolve, reject) {
            let app = this.app;
            if (!app.conf) {
                reject && reject();
                return;
            }
            function fail() {
                loge("fail to leave");
                app.conf = null;
                reject && reject();
            }
            app._doLeave_(resolve, fail);
        }
        publish(stream, resolve, reject) {
            super.publish(stream, resolve, reject);
            app.operator.trigger();
        }
        subscribe(stream, resolve, reject) {
            super.subscribe(stream, resolve, reject);
            app.operator.trigger();
        }
        unpublish(stream, resolve, reject) {
            super.unpublish(stream, resolve, reject);
            app.operator.trigger();
        }
        unsubscribe(stream, resolve, reject) {
            super.unsubscribe(stream, resolve, reject);
            app.operator.trigger();
        }

        stop() {
            logd("stop normal");
        }
    };
    class StateRecovery extends StateBase {
        constructor(app) {
            super(app);
            this.timer = new RetryTimer();
            this.timerID = 0;
        }

        recover() {
            logi("start to recover");
            this.timer.reset();
            let app = this.app;
            if (app.id >= 0) {
                this._recoverInit_();
            } else {
                app.state = new StateNormal(app);
            }
        }
        stop() {
            logd("recover stop");
            clearTimeout(this.timerID);
            this.timerID = 0;
        }

        _recoverInit_() {
            let app = this.app;
            let state = this;
            function succ(resp) {
                state.timer.reset();
                app.id = resp.data.id;
                if (app.conf) {
                    state._recoverJoin_();
                } else {
                    state._exit_();
                }
            }
            function fail(resp) {
                loge("fail to do init: ", resp.error);
                state.timerID = setTimeout(state._recoverInit_.bind(state), state.timer.retryMS());
            }
            app._doInit_(succ, fail);
        }
        _recoverJoin_() {
            let app = this.app;
            let state = this;
            function succ(resp) {
                state.timer.reset();
                state._exit_();
            }
            function fail(resp) {
                loge("fail to do join: ", resp.error);
                state.timerID = setTimeout(state._recoverJoin_.bind(state), state.timer.retryMS());
            }
            app._doJoin_(app.conf, succ, fail);
        }
        _exit_() {
            logi("recover exit");
            let app = this.app;
            app.state = new StateNormal(app);
            clearTimeout(this.timerID);
            this.timerID = 0;
            app.operator.trigger();
        }
    };

    class App {
        constructor(url) {
            this.con           = null;
            this.ping          = null;
            this.url           = url;
            this.id            = -1;
            this.conf          = null;
            this.lstreams      = [];
            this.rstreams      = [];
            this.startCallback = null;
            this.emitter       = new Emitter();
            this.state         = new StateNormal(this);
            this.streamCmds    = [];
            this.operator      = new StreamOperator(this);
        }

        init(resolve, reject) {
            logi("===> app init");
            this.state.init(resolve, reject);
        }
        join(conf, resolve, reject) {
            logi("===> app join");
            this.state.join(conf, resolve, reject);
        }
        publish(stream, reject) {
            logi("===> app publish");
            this.state.publish(stream, null, reject);
        }
        subscribe(stream, reject) {
            logi("===> app subscribe");
            this.state.subscribe(stream, null, reject);
        }
        unpublish(stream, reject) {
            logi("===> app unpublish");
            this.state.unpublish(stream, null, reject);
        }
        unsubscribe(stream, reject) {
            logi("===> app unsubscribe");
            this.state.unsubscribe(stream, null, reject);
        }
        leave(resolve, reject) {
            logi("===> app leave");
            this.state.leave(resolve, reject);
        }
        close() {
            logi("===> app close");
            this.id = -1;
            this.ping.stop();
            this.state.stop();
            this.con.close();
            this.ping = null;
            this.con = null;
        }


        _start_(callback) {
            logi("===> app start");
            this.con = new StableWebSocket();
            this.ping = new PingService(2000, 3);
            this.con.onopen = this._onopen_.bind(this);
            this.con.onclose = this._onclose_.bind(this);
            this.con.onmessage = this._onmessage_.bind(this);
            this.con.connect(this.url);
            this.startCallback = callback;
        }

        _onopen_() {
            logi("===> server connected");
            this.ping.start(this.con, this._pingTimeout_.bind(this));
            if (this.id >= 0) {
                this.state.recover();
            }
            if (this.startCallback) {
                this.startCallback();
                this.startCallback = null;
            }
        }
        _onclose_(e) {
            logw("===> server disconnected");
            this.ping.stop();
            this.state.stop();
            this.operator.disconnect();
            this.state = new StateRecovery(this);
            this.con.connect(this.url);
        }
        _onmessage_(msg) {
            // logd("got", msg.data);
            this.ping.pong();
            let resp = JSON.parse(msg.data);
            this.emitter.emit(resp.command, resp);
        }
        _pingTimeout_() {
            this.ping.stop();
            this.state.stop();
            this.con.close();
            this.state = new StateRecovery(this);
            this.con.connect(this.url);
        }

        _clearStreamHandler_(msg) {
            if (msg) {
                this.emitter.off(msg);
            } else {
                this.emitter.off("publish");
                this.emitter.off("subscribe");
                this.emitter.off("unpublish");
                this.emitter.off("unsubscribe");
            }
        }

        _respHandler_(resolve, reject, resp) {
            if (resp.error != 0) {
                reject && reject(resp);
            } else {
                resolve && resolve(resp);
            }
        }
        _doInit_(resolve, reject) {
            logd("_doInit_");
            let req = {
                command: "init"
            };
            this.con.send(JSON.stringify(req));
            this.emitter.off("init");
            this.emitter.once("init", this._respHandler_.bind(this, resolve, reject));
        }
        _doJoin_(id, resolve, reject) {
            logd("_doJoin_");
            let req = {
                command: "join",
                id: id
            };
            this.con.send(JSON.stringify(req));
            this.emitter.off("join");
            this.emitter.once("join", this._respHandler_.bind(this, resolve, reject));
        }
        _doLeave_(resolve, reject) {
            let req = {command: "leave"};
            this.emitter.off("leave");
            this.emitter.once("leave", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doPublish_(stream, resolve, reject) {
            let req = {command: "publish", stream: {id: stream.id, type: stream.type}};
            this.emitter.off("publish");
            this.emitter.once("publish", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doSubscribe_(stream, resolve, reject) {
            let req = {command: "subscribe", stream: stream};
            this.emitter.off("subscribe");
            this.emitter.once("subscribe", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doUnPublish_(stream, resolve, reject) {
            let req = {command: "unpublish", stream: stream};
            this.emitter.off("unpublish");
            this.emitter.once("unpublish", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doUnSubscribe_(stream, resolve, reject) {
            let req = {command: "unsubscribe", stream: stream};
            this.emitter.off("unsubscribe");
            this.emitter.once("unsubscribe", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
    };

    // let url = "ws://10.2.20.98:8090/app/v1.0.0";
    let url = "wss://10.33.11.31:8443/app/v1.0.0";


    let app = null;
    function startApp() {
        app = new App(url);
        app.init(join);

        function join() {
            app.join("conf", publish);
        }

        function publish() {
            app.publish(new Stream(randomID(), LOCAL));
            app.publish(new Stream(randomID(), LOCAL));
        }
    }
    function stopApp() {
        app.close();
    }


    document.getElementById('start').onclick = startApp;
    document.getElementById('stop').onclick = stopApp;
})();
