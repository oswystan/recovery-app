(function(){
    const logd = (...args)=>console.debug("D|"+new Date().toISOString(), ...args);
    const logi = (...args)=>console.info( "I|"+new Date().toISOString(), ...args);
    const logw = (...args)=>console.warn( "W|"+new Date().toISOString(), ...args);
    const loge = (...args)=>console.error("E|"+new Date().toISOString(), ...args);

    function random(max) {
        return Math.floor(Math.random()*max);
    }
    function randomU32() {
        return random(4294967296);
    }
    function randomU16() {
        return random(65536);
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

    function clearTimer(timerID) {
        timerID > 0 && clearTimeout(timerID);
        return 0;
    }

    class RandomTimer {
        constructor() {
            this.reset();
        }
        next() {
            let ret = this.val;
            this.val += (this.inc + this.rand());
            this.val = Math.min(this.val, this.max);
            return ret;
        }
        rand() {
            return Math.floor(Math.random()*1000);
        }
        reset() {
            this.base = 1000;
            this.inc  = 1000;
            this.max  = 10000;
            this.val  = this.base + this.rand();
        }
    };

    class AwesomeWebSocket {
        constructor() {
            this.url                = null;
            this.onmessage          = null;
            this.onopen             = null;
            this.onclose            = null;
            this.ws                 = null;
            this.connectTimerID     = 0;
            this.retryTimerID       = 0;
            this.timer              = new RandomTimer();
            this.lastConnectTS      = 0;
            this.kConnectIntervalMS = 5000;
        }
        send(data) {
            this.ws && this.ws.send(data);
        }
        close() {
            logi("closing socket");
            if (this.ws) {
                this.ws.onclose = null;
                this.ws.onmessage = null;
                this.ws.close();
            }
            this.connectTimerID = clearTimer(this.connectTimerID);
            this.retryTimerID   = clearTimer(this.retryTimerID);
        }
        connect(url) {
            this.url = url;
            this.timer.reset();

            // incase of connect the wrong url: connect will be success, but server will
            // disconnect socket immediately after that.
            if (Date.now() - this.lastConnectTS > this.kConnectIntervalMS) {
                logd('direct connect');
                this._connect();
            } else {
                logd('random connect');
                this.connectTimerID = setTimeout(this._connect.bind(this), this.timer.rand());
            }
        }

        _connect() {
            try {
                this.lastConnectTS = Date.now();
                logi('connecting:', this.url);
                let ws     = new WebSocket(this.url);
                ws.onopen  = this._onopen.bind(this);
                ws.onclose = this._onclose.bind(this);
                ws.onerror = this._onerror.bind(this);
                this.ws    = ws;
                this.connectTimerID = setTimeout(()=>{
                    loge("*** *** CONNECT TIMEOUT *** ***");
                    ws.close();
                }, this.kConnectIntervalMS);
            } catch (e) {
                loge("ERROR:", e);
                this.ws = null;
                this._retry();
            }
        }

        _retry() {
            let con = this;
            let ms = con.timer.next();
            logd("retry after", ms, "ms");
            con.retryTimerID = setTimeout(()=>{
                con._connect();
            }, ms);
        }
        _onopen() {
            this.timer.reset();
            this.connectTimerID = clearTimer(this.connectTimerID);
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
            this.connectTimerID = clearTimer(this.connectTimerID);
            this._retry();
        }
        _onerror(e) {
            loge("socket error:", e.type);
            this.ws.close();
        }
    };

    class PingService {
        constructor(intervalMS, timeoutHits) {
            this.timerID     = 0;
            this.interval    = intervalMS;
            this.timeoutHits = timeoutHits;
            this.hits        = 0;
            this.con         = null;
            this.ontimeout   = null;
        }

        start(con, callback) {
            this.con = con;
            this.hits = 0;
            this.ontimeout = callback;
            this._ping();
        }
        stop() {
            logi("=> stop ping");
            this.timerID = clearTimer(this.timerID);
            this.con = null;
        }
        pong() {
            this.hits = 0;
        }
        _ping() {
            if (!this.con) {
                return;
            }

            if (this.hits >= this.timeoutHits) {
                logw("*** *** PING TIMEOUT *** ***");
                this.ontimeout && this.ontimeout();
                this.timerID = 0;
            } else {
                let req = {command: "ping"};
                this.con.send(JSON.stringify(req));
                this.timerID = setTimeout(this._ping.bind(this), this.interval);
                this.hits++;
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
            this.timer     = new RandomTimer();
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
            this.timerID = clearTimer(this.timerID);
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
            this.timerID = clearTimer(this.timerID);

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

            function end(status) {
                stream.status = status;
                operator.repairing = null;
                operator.trigger();
            }

            function succ(resp) {
                logd("repair succ", stream.id);
                stream.timer.reset();
                end(COMPLETED);
            }
            function fail(resp) {
                logd("fail to repair", stream.id);
                stream.nextTryTS = Date.now() + stream.timer.next();
                end(ERROR);
            }
            app._doPublish_(stream, succ, fail);
        }
        _repairSubscribeStream_(stream) {
            let app = this.app;
            let operator = this;

            function end(status) {
                stream.status = status;
                operator.repairing = null;
                operator.trigger();
            }

            function succ(resp) {
                logd("repair succ", stream.id);
                stream.timer.reset();
                end(COMPLETED);
            }
            function fail(resp) {
                logd("fail to repair", stream.id);
                stream.nextTryTS = Date.now() + stream.timer.next();
                end(ERROR);
            }
            app._doSubscribe_(stream, succ, fail);
        }

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
            function end(status) {
                cmd.stream.status = status;
                operator.working = null;
                app.lstreams.push(cmd.stream);
                operator.trigger();
            }
            function succ(resp) {
                logi("publish succ", cmd.stream.id);
                app.emitter.aemit("stream-published", cmd.stream);
                cmd.stream.timer.reset();
                end(COMPLETED);
            }
            function fail(resp) {
                loge("fail to publish", cmd.stream.id);
                cmd.stream.nextTryTS = Date.now() + cmd.stream.timer.next();
                end(ERROR);
            }
            app._doPublish_(cmd.stream, succ, fail);
        }
        _doUnPublish_() {
            let app = this.app;
            let cmd = this.working;
            let operator = this;
            if (!streamExisted(app.lstreams, cmd.stream)) {
                loge("NO such stream:", cmd.stream.id);
                cmd.reject && reject();
                this.working = null;
                this.trigger();
                return;
            }

            function done(resp) {
                if (resp.error) {
                    logw("unpublish failed", resp.error, "of stream", cmd.stream.id);
                } else {
                    logi("unpublish stream", cmd.stream.id, "succ");
                }
                operator.working = null;
                operator.trigger();
            }
            app._removeStream_(cmd.stream);
            app._doUnPublish_(cmd.stream, done, done);
        }
        _doSubscribe_() {
            let app = this.app;
            let cmd = this.working;
            let operator = this;
            if (streamExisted(app.rstreams, cmd.stream)) {
                cmd.reject && reject();
                this.working = null;
                this.trigger();
                return;
            }
            function end(status) {
                cmd.stream.status = status;
                operator.working = null;
                app.rstreams.push(cmd.stream);
                operator.trigger();
            }
            function succ(resp) {
                logi("subscribe succ", cmd.stream.id);
                app.emitter.aemit("stream-subscribed", cmd.stream);
                cmd.stream.timer.reset();
                end(COMPLETED);
            }
            function fail(resp) {
                loge("fail to subscribe", cmd.stream.id);
                cmd.stream.nextTryTS = Date.now() + cmd.stream.timer.next();
                end(ERROR);
            }
            app._doSubscribe_(cmd.stream, succ, fail);
        }
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
            this.timer = new RandomTimer();
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
            this.timerID = clearTimer(this.timerID);
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
                state.timerID = setTimeout(state._recoverInit_.bind(state), state.timer.next());
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
                state.timerID = setTimeout(state._recoverJoin_.bind(state), state.timer.next());
            }
            app._doJoin_(app.conf, succ, fail);
        }
        _exit_() {
            logi("recover exit");
            let app = this.app;
            app.state = new StateNormal(app);
            this.timerID = clearTimer(this.timerID);
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
            this.operator.disconnect();
            this.con.close();
            this.ping = null;
            this.con = null;
        }


        _start_(callback) {
            logi("===> app start");
            this.con = new AwesomeWebSocket();
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
            this.operator.disconnect();
            this.con.close();
            this.state = new StateRecovery(this);
            this.con.connect(this.url);
        }

        _removeStream_(stream) {
            let streams = null;
            if (stream.type === LOCAL) {
                streams = this.lstreams;
            } else {
                streams = this.rstreams;
            }

            let idx = streams.findIndex((e)=>e.equal(stream));
            if (idx>=0) {
                streams.splice(idx, 1);
            }
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
            let req = {command: "subscribe", stream: {id: stream.id, type: stream.type}};
            this.emitter.off("subscribe");
            this.emitter.once("subscribe", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doUnPublish_(stream, resolve, reject) {
            let req = {command: "unpublish", stream: {id: stream.id, type: stream.type}};
            this.emitter.off("unpublish");
            this.emitter.once("unpublish", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
        _doUnSubscribe_(stream, resolve, reject) {
            let req = {command: "unsubscribe", stream: {id: stream.id, type: stream.type}};
            this.emitter.off("unsubscribe");
            this.emitter.once("unsubscribe", this._respHandler_.bind(this, resolve, reject));
            this.con.send(JSON.stringify(req));
        }
    };

    // let url = "wss://10.33.11.31:8443/app/v1.0.0";
    let url = "wss://1.1.1.1:8443/app/v1.0.0";

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
            app.publish(new Stream(randomID(), LOCAL));
            app.publish(new Stream(randomID(), LOCAL));
            app.publish(new Stream(randomID(), LOCAL));
            let s2 = new Stream(randomID(), LOCAL);
            app.publish(s2);
            app.unpublish(s2);
            app.subscribe(new Stream(randomID(), REMOTE));
            app.subscribe(new Stream(randomID(), REMOTE));
            app.subscribe(new Stream(randomID(), REMOTE));
            app.subscribe(new Stream(randomID(), REMOTE));
            app.publish(new Stream(randomID(), LOCAL));
        }
    }
    function stopApp() {
        app.close();
    }


    document.getElementById('start').onclick = startApp;
    document.getElementById('stop').onclick = stopApp;
})();
