(function(){
    let ws = new WebSocket("wss://localhost:8443/app/v1.0.0");
    ws.onopen = function() {
        console.log("open");
        sendPing();
    };
    ws.onclose = function() {
        console.log("close");
    }

    ws.onmessage = (msg)=>{
        console.log(msg.data);
    };

    function sendPing() {
        let req = {
            command: "unpublish",
            sid: 112,
        };
        ws.send(JSON.stringify(req));
    }
})();
