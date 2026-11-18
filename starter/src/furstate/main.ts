
// TODO 1: 再从 xstate 引入 assign、enqueueActions。
// 用途：WebSocket 还没连上时，dm.ts 已经会发 PREPARE。先记在 context 里，连上后再补发。
import { setup, fromCallback, sendTo, sendParent, assign, enqueueActions } from "xstate";
import type { SpeechStateExternalEvent } from "speechstate";
import { FurstateEvent } from "./types";

const callbackLogic = fromCallback(({ sendBack, receive }) => {
  const ws = new WebSocket("ws://127.0.0.1:9000/v1/events");

  // TODO 2A（先写）: 先有一个不会发丢的 send。
  // dm.ts 一启动就发 PREPARE，这时候 WebSocket 经常还没打开。
  // OPEN 之前直接 ws.send 会抛错，命令就丢了。
  // 在 new WebSocket 下面加上 open、heard、pending，以及 send(data)：
  // 已 OPEN 就 ws.send，否则推进 pending。
  // heard 先放着，TODO 4 和 TODO 6 才用它区分「听见了一句」和「听完了但没人说话」。
  let open = false;
  let heard = false;
  const pending: string[] = [];

  function send(data: object) {
    const raw = JSON.stringify(data);
    if (open && ws.readyState === WebSocket.OPEN) ws.send(raw);
    else pending.push(raw);
  }

  receive((event: SpeechStateExternalEvent) => {
    console.log("Event received in the callback", event);
    switch (event.type) {
      case "SPEAK":
        // TODO 2C（2B 写完再写）: 这个分支改成走 send，不要再直接 ws.send。
        // send({ type: "request.speak.text", text: event.value.utterance });
        send({ type: "request.speak.text", text: event.value.utterance })
        
        /*
        ws.send(
          JSON.stringify({
            type: "request.speak.text",
            text: event.value.utterance,
          }),
        );
        */
        break;

      // TODO 3: case "PREPARE"
      // 不要发给 Furhat。sendBack({ type: "ASRTTS_READY" })。
      // dm.ts 的 Prepare 状态一直等这个事件，等到了按钮才能点。
      case "PREPARE":
        sendBack({ type: "ASRTTS_READY" });
        break;

      // TODO 4: case "LISTEN"
      // 先 heard = false，再 send() 一条 request.listen.start。
      // 参数：partial: false, stop_user_end: true, stop_no_speech: true, no_speech_timeout: 8。
      // dm.ts 的 Ask 发的就是 LISTEN，然后等 RECOGNISED 或 ASR_NOINPUT，最后等 LISTEN_COMPLETE。
      case "LISTEN":
        heard = false;
        send({
          type: "request.listen.start",
          partial: false,
          stop_user_end: true,
          stop_no_speech: true,
          no_speech_timeout: 8,
        });
        break;

      // TODO 5: case "STOP"
      // 连发 request.listen.stop 和 request.speak.stop。
      // 对应 dm.ts 暂停时的 spst.stop：正在说的停掉，正在听的也停掉。
      case "STOP":
        send({type: "request.listen.stop"});
        send({type: "request.speak.stop"});
        break;
    }
  });

  ws.addEventListener("open", (event) => {
    console.log("Connection opened.", event);
    // TODO 2B（2A 写完再写）: 连上之后先清队列。
    // open = true;
    // pending.splice(0).forEach((raw) => ws.send(raw));
    // 然后再 sendBack({ type: "WS_CONNECTED" })。
    open = true;
    pending.splice(0).forEach((raw) => ws.send(raw));
    
    sendBack({ type: "WS_CONNECTED" });
  });

  ws.addEventListener("message", (event) => {
    const ev = JSON.parse(event.data);
    console.log("Message from server ", ev);
    // TODO 6: 在 sendBack(ev) 之前处理两种听的结果。
    // response.hear.end 并且 ev.text 有内容：heard = true。
    // response.listen.end 并且 heard 仍是 false：先 sendBack({ type: "ASR_NOINPUT" })。
    // 原始 ev 仍然要 sendBack，下面的状态机靠它做翻译。
    if (ev.type === "response.hear.end" && ev.text) heard = true;
    if (ev.type === "response.listen.end" && !heard) {
      sendBack({ type: "ASR_NOINPUT" });
    }
    sendBack(ev);
  });

  return () => {
    console.log("Connection closed.");
    ws.close();
  };
});

const furstate = setup({
  actors: { fhCallback: callbackLogic },
  // TODO 7: types 加上 context: {} as { preparePending: boolean }。
  types: { 
    events: {} as FurstateEvent, 
    context: {} as { preparePending: boolean},
  },

}).createMachine({
  id: "furstate",
  // TODO 7 续: context: { preparePending: false },
  context: { preparePending: false },

  initial: "Start",
  states: {
    Start: {
      invoke: { id: "furhat", src: "fhCallback" },
      initial: "Connecting",
      states: {
        Connecting: {
          on: {
            WS_CONNECTED: {
              target: "Connected",
              actions: sendParent({ type: "WS_CONNECTED" }),
            },
            // TODO 8: 加上 PREPARE。
            // 只 assign({ preparePending: true })，先不要送进 callback。
            // Connecting 不接收的事件会被丢掉，PREPARE 一丢，dm.ts 永远停在 Prepare。
            PREPARE: {
              actions: assign({ preparePending: true }),
            }
          },
        },
        Connected: {
          // TODO 9: entry 用 enqueueActions。
          // preparePending 为真时，enqueue(sendTo("furhat", { type: "PREPARE" }))，
          // 再 enqueue(assign({ preparePending: false }))。
          entry: enqueueActions(
            ({ context, enqueue }) => {
              if (!context.preparePending) return;
              enqueue(sendTo("furhat", { type: "PREPARE" }));
              enqueue(assign({ preparePending: false }));
            }
          ),
          on: {
            SPEAK: {
              actions: sendTo("furhat", ({ event }) => event),
            },
            // TODO 10: 照 SPEAK 同样转发 PREPARE、LISTEN、STOP 到 id 为 furhat 的 callback。
            PREPARE: { actions: sendTo("furhat", ({ event }) => event ) },
            LISTEN: { actions: sendTo("furhat", ({ event }) => event ) },
            STOP: { actions: sendTo("furhat", ({ event }) => event ) },
            ASRTTS_READY: { actions: sendParent({ type: "ASRTTS_READY" }) },
            "response.speak.start": {
              actions: [sendParent({ type: "TTS_STARTED" })],
            },
            "response.speak.end": {
              actions: [sendParent({ type: "SPEAK_COMPLETE" })],
            },
            // TODO 11: 把 callback 送上来的事件翻译成 dm.ts 认识的事件，再用 sendParent 交出去。
            // ASRTTS_READY        -> 原样送出
            // response.hear.end   -> RECOGNISED，value: [{ utterance: String(event.text ?? "") }]
            // response.listen.end -> LISTEN_COMPLETE
            // ASR_NOINPUT         -> 原样送出
            // 顺序要保住：没听见时先 ASR_NOINPUT，再 LISTEN_COMPLETE。
            // dm.ts 在 LISTEN_COMPLETE 那一刻读 lastResult，之前必须已经写好或清空。
            "response.hear.end": {
              actions: sendParent(
                ({ event }) => ({
                  type: "RECOGNISED",
                  value: [{ utterance: String(event.text ?? "") }],
                }),
              ),
            },
            "response.listen.end": {
              actions: sendParent({ type: "LISTEN_COMPLETE" }),
            },
            ASR_NOINPUT: {
              actions: sendParent({ type: "ASR_NOINPUT" }),
            },
          },
        },
      },
    },
  },
});

export { furstate };
