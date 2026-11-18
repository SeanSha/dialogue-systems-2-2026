# Lab 3 一步一步做：让 Furhat 看人、说话、听，再接上以前的对话

代码里 Part A 和 VG-1 的编号是 `L3-1` 到 `L3-12`，听的测试是 `L3-13`。VG-2 用的是 `starter/src/furstate/main.ts` 里原来的 `TODO 1` 到 `TODO 11`。这份文档按这个顺序讲。每一步都是：要做什么、为什么、代码怎么写。

## 这个实验在干什么

Furhat 是一个机器人头。你的程序不跑在它身体里，而是通过 HTTP 或 WebSocket 叫它看人、做表情、说话、听。

实验分成三截，可以各交一截：

| 部分 | 你要交出的东西 | 代码 |
|---|---|---|
| Part A | 一段短演示：看向人、做一个新手势、问名字、听、复述、再生气 | `furhat/src/main.ts` |
| VG-1 | 用这颗头去说 Lab 2 的 SISU，而不是自己问名字 | `furhat/src/sisu.ts` |
| VG-2 | 写一个和 SpeechState 长得一样的接口，让 Lab 1 的 `dm.ts` 可以换嘴 | `starter/src/furstate/main.ts` |

Part A 用的是旧的 Remote API，地址是 `http://127.0.0.1:54321`。VG-2 用的是新的 Realtime API，WebSocket 地址是 `ws://127.0.0.1:9000/v1/events`。两套地址不一样，虚拟 Furhat 里要打开对应的那一个。

动手前：注册 Furhat SDK，打开虚拟 Furhat，启动 Remote API。Part A 在 `furhat/` 里跑：

```bash
cd furhat
npx tsx src/main.ts
```

`main.ts` 一加载就会把演示跑起来。所以 VG-1 不从它 import 函数，否则两个对话会抢同一个头。VG-1 单独跑 `npx tsx src/sisu.ts`。

每个 HTTP 调用都是一次 `fetch`。说话用 `POST`，并且 `blocking=true`，这样 `await` 会等到这句话说完，状态机才进入下一步。听用 `GET /furhat/listen`，身体在响应里，解析出 `.message` 就是听到的字符串。

---

## L3-1 做一个自己的手势

文件：`furhat/src/main.ts` 的 `newGesture`

**要做什么。** `POST /furhat/gesture?blocking=false`。body 是一个 Gesture：有名字、有 `class`、有好几帧。每一帧有时间、`persist: true`、一组脸部参数。

**为什么。** 作业要一个新的表情，并且放进演示，而不是只在控制台里单独点一下。`blocking=false` 是因为这个手势发生在说话之前，演示可以接着往下走；如果你希望头做完才说话，再改成 `true`。`persist: true` 表示这一帧的参数会留着，直到后面的帧改掉它。最后一帧 `reset: true` 把脸收回中性，否则头会一直保持最后一个表情。

**怎么写。** 这个仓库的三帧是：抬头扬眉、低头歪脖子、复位。

```typescript
body: JSON.stringify({
  name: "newGesture",
  class: "furhatos.gestures.Gesture",
  frames: [
    {
      time: [0.2],
      persist: true,
      params: { LOOK_UP: 1, BROW_UP_LEFT: 0.6, BROW_UP_RIGHT: 0.6 },
    },
    {
      time: [0.8],
      persist: true,
      params: { LOOK_DOWN: 0.5, NECK_ROLL: 15 },
    },
    {
      time: [1.3],
      persist: true,
      params: { reset: true },
    },
  ],
}),
```

`time` 是从手势开始算的秒。参数名字是 Furhat 的肌肉和脖子参数，可以换成眨眼、微笑。左右眉一起动，脸才对称。

---

## L3-2 听一句，拿到一个字符串

**要做什么。** `GET /furhat/listen`。把 body 读完，解码，`JSON.parse`，返回 `.message`。

**为什么。** 这个接口的结果是一块流，不是一个已经解析好的 JSON。不读 reader，你拿到的是一个还没展开的 body。`.message` 在听见时是用户的话；没听见时是 `SILENCE`、`FAILED`、`INTERRUPTED`，或者空字符串。后面的复述和生气都要认这四个值，否则机器人会说 “You said SILENCE”。

```typescript
async function fhListen() {
  return fetch(`http://127.0.0.1:54321/furhat/listen`, {
    method: "GET",
    headers: { accept: "application/json" },
  })
    .then((response) => response.body)
    .then((body) => body!.getReader().read())
    .then((reader) => reader.value)
    .then((value) => JSON.parse(new TextDecoder().decode(value)).message);
}
```

---

## L3-3 看向最近的那个人

**要做什么。** 两下请求：

```typescript
async function fhUsers() {
  const response = await fetch(`http://127.0.0.1:54321/furhat/users`);
  return response.json();
}

async function fhAttendClosest() {
  return fetch(`http://127.0.0.1:54321/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
}
```

演示里的 actor 先 `console.log` 用户列表，再 `fhAttendClosest()`。

**为什么。** `attend?user=CLOSEST` 让头转向最近的人脸。先把 `/furhat/users` 打出来，是为了虚拟环境里没检测到人时你能看见空列表，而不是不知道头为什么不转。检测不到用户时，最近的人这个请求会失败，状态机走到 `Fail`，终端里有 `console.error`。

---

## L3-4 用灯区分「在说」和「在听」

**要做什么。** `POST /furhat/led?red=&green=&blue=`。说话前 `fhLed(255, 0, 0)`，开始听之前 `fhLed(0, 0, 0)`。

**为什么。** 作业要求灯光能让旁边的人看出机器人是在说还是在听，对应 Irfan 等人论文里的做法。红灯是「嘴在动」，关灯是「耳朵开着」。颜色可以换，但说和听必须不同，否则灯没有信息。

灯要打在真正说和听的前面，而不是状态切换的后面。`fhSay` 是阻塞的，灯如果等话说完再亮，别人看到的红灯是在沉默的时候。

```typescript
async function fhLed(red: number, green: number, blue: number) {
  return fetch(
    `http://127.0.0.1:54321/furhat/led?red=${red}&green=${green}&blue=${blue}`,
    { method: "POST", headers: { accept: "application/json" } },
  );
}
```

---

## L3-5 一个带着声音的手势

**要做什么。** `fhAngerWithSound(name)`：

1. `POST /furhat/gesture?name=ExpressAnger&blocking=false`。这是系统自带的生气。
2. 把听到的名字 trim。
3. 是 `SILENCE`、`FAILED`、`INTERRUPTED` 或空字符串，就说 `I am angry. You never told me your name.`
4. 否则说 `` `${heard}! Have you heard the story?!` ``，用 `fhSay`，也就是阻塞到说完。

**为什么。** 作业要另一个手势，并且带声音。`ExpressAnger` 不用等它做完再开口，表情和句子叠在一起，才像「带着声音的手势」。`blocking=false` 就是这个叠法。句子仍然用阻塞的 `say`，状态机才会等这句话结束再进入 `Done`。

没听见时不要把 `SILENCE` 念进句子里。L3-2 已经说明那四个值是失败，这里用同一份清单。

---

## L3-6 把上面几步串成一段短对话

**要做什么。** 一台 XState 机器。`context.lastUtterance` 一开始是 `""`。每个对外动作是一个 `fromPromise` actor。状态顺序：

```text
Start --1秒--> Attend --> Roll --> Greet --> Listen --> Echo --> AngerSound --> Done
```

任何一步 `onError` 去 `Fail`，并把 `event` 打出来。

各步具体做的事：

| 状态 | actor 里做什么 |
|---|---|
| Attend | 打印用户，再看向最近的人 |
| Roll | 调用 L3-1 的新手势 |
| Greet | 红灯，说 “Hi. What is your name?” |
| Listen | 关灯，调用 L3-2。`onDone` 把 `event.output` 写进 `lastUtterance` |
| Echo | 红灯。没听见就说没听见、请再说名字；听见了就说 `You said ...`。`input` 读 `lastUtterance` |
| AngerSound | 把同一个 `lastUtterance` 送给 L3-5 |

**为什么。** `fromPromise` 把一次 HTTP 包成状态机能等的事情。`onDone` 才走下一步，所以顺序就是你在虚拟头上看到的顺序。`lastUtterance` 要在 Listen 结束时写进 context，因为 Echo 和 Anger 是后面两个状态，它们看不到 Listen 那个 actor 的局部变量。

`invoke` 的 `input` 在进入状态时就求值。Echo 写成：

```typescript
Echo: {
  invoke: {
    src: "fhEcho",
    input: ({ context }) => context.lastUtterance,
    onDone: "AngerSound",
    onError: { target: "Fail", actions: ({ event }) => console.error(event) },
  },
},
```

Listen 的 `assign` 和跳转写在同一个 `onDone` 里，XState 会先做 action 再进入目标，所以 Echo 读到的已经是刚听见的那句。

`Start` 用 `after: { 1000: "Attend" }` 等一秒，是给虚拟 Furhat 的远程接口一点启动时间。接口没开时，Attend 的 fetch 失败，停在 `Fail`，终端里能看到错误，而不是一个没头没尾的异常。

跑完你应该看到：头转向人，做一个抬头再低头的表情，红灯问名字，灯灭并等待，红灯复述，然后生气并把名字喊出来。

---

## L3-7 麦克风里的一句变成 SISU 的 move

文件从这里起是 `furhat/src/sisu.ts`。这是 VG-1：Furhat 只当嘴和耳朵，下一句说什么由 Lab 2 的 `dme` 决定。

**要做什么。** `movesFor(heard)`：

- 小写并 trim 之后是 `silence`、`failed`、`interrupted` 或空字符串：返回 `[{ type: "icm", content: "con*neg" }]`。
- 否则去掉问号、句号、叹号、逗号、撇号，再和 `nluMapping` 的每个键做同样的清理，对上就返回那条 moves。
- 都对不上返回 `[]`。

**为什么。** Lab 2 的对话机不吃英文字符串，它吃 move。`con*neg` 就是 Lab 2 的「没接触上」，系统会说 “Are you there?”。空数组是「没听懂」，系统会道歉。Furhat 的失败字符串是大写的 `SILENCE`，所以先 `toLowerCase()`。听懂表的键带问号，麦克风结果常常不带，所以两边都先 `normalize` 再比。

```typescript
function normalize(text: string) {
  return text.toLowerCase().replace(/[?.!,']/g, "").replace(/\s+/g, " ").trim();
}
```

不要在这里调用 `nlg`。说什么英文是对话机先决定 move，再由 `nlg` 生成。这里只做听。

---

## L3-8 两台机器同时跑

**要做什么。** 一台并行机器。一边叫 `DME`，一边叫 `Loop`。

```typescript
DME: {
  invoke: {
    src: "dme",
    id: "dmeID",
    input: ({ self }) => ({ parentRef: self, is: initialIS() }),
  },
},
```

`context` 只有 `{ line: "" }`。事件类型写成 `{ type: "NEXT_MOVES"; value: Move[] }`。

**为什么。** `dme` 需要 `parentRef`，它才能把 `NEXT_MOVES` 送回这台机器。`id: "dmeID"` 是后面 `sendTo` 用的名字。`initialIS()` 就是 Lab 2 那个会问好、会问日子的初始状态。`Loop` 从 `Idle` 开始，负责说和听。两台并行，所以对话机在想下一句的时候，头可以停在等待。

事件类型里必须写上 `value`。Idle 只处理 `NEXT_MOVES`，不写 `value`，后面 `event.value` 的类型对不上，`nlg` 和 `SAYS` 都会报错。

XState 从 `../../sisu/node_modules/xstate` 引进来，是为了和 SISU 用同一份。`furhat/` 自己如果另有一份 XState，两台机器的类型对不上。

---

## L3-9 接到下一句：先告诉对话机「这是我说的」，再去说

**要做什么。** `Idle` 收到 `NEXT_MOVES` 时做两件事，然后去 `Speak`：

```typescript
sendTo("dmeID", ({ event }) => ({
  type: "SAYS",
  value: { speaker: "sys", moves: event.value },
})),
assign({ line: ({ event }) => nlg(event.value) }),
```

**为什么。** 对话机如果不知道自己刚刚问过 “Which day?”，它不会把这个问题压上 QUD，用户的回答就没处可放。所以系统的 move 要原样送回去，`speaker` 是 `"sys"`。同时 `nlg` 把这些 move 变成一句英文，放进 `line`，下一步才有字可念。

`nlg` 抛错通常是 Lab 2 的表里缺了这种 move。先看终端里的 move JSON，再回到 `nlug.ts` 补句子。

---

## L3-10 红灯，把 line 说完

**要做什么。** `Speak` invoke 一个 `fromPromise`。input 的类型是 `{ line: string }`，取值 `{ line: context.line }`。函数里先 `fhLed(255, 0, 0)`，再 `fhSay(input.line)`。`onDone` 去 `Listen`。

**为什么。** `fromPromise` 的 `input` 是一个对象时，函数参数必须解构这个对象。写成 `async (line: string)` 会把整个 `{ line }` 当成字符串，机器人会念出 `[object Object]`。用对象是因为以后还可以往 input 里加别的字段；现在至少要和 invoke 的 `input:` 对上。

红灯在 `fhSay` 之前，原因和 L3-4 一样。`fhSay` 阻塞到说完，`onDone` 才去听，不会自己打断自己。

---

## L3-11 关灯听用户，再把结果送回对话机

**要做什么。** `Listen` 里先 `fhLed(0, 0, 0)`，再 `fhListen()`。`onDone`：

```typescript
actions: sendTo("dmeID", ({ event }) => {
  const heard = String(event.output ?? "");
  return {
    type: "SAYS",
    value: { speaker: "usr", moves: movesFor(heard) },
  };
}),
target: "Idle",
```

**为什么。** 用户这句的 `speaker` 必须是 `"usr"`。对话机靠这个区分「我自己刚说的」和「对方刚说的」。moves 用 L3-7。然后回到 Idle，等对话机算出下一句 `NEXT_MOVES`。一轮就是：Idle → Speak → Listen → Idle。

没听见时 `movesFor` 给出 `con*neg`，Lab 2 会说 “Are you there?”，有未完成的问题还会再问。听见了但表里没有，moves 是 `[]`，Lab 2 会道歉。VG-1 不用在 Furhat 这边再写一套道歉。

---

## L3-12 先看向用户，再启动

**要做什么。** 文件底部不能直接 `await`，所以包进 `main`：

```typescript
async function main() {
  const users = await fhUsers();
  console.log(users);
  await fhAttendClosest();
  createActor(machine).start();
}
main();
```

**为什么。** 头先转向人，再让 SISU 开始问好。`createActor` 一启动，`dme` 就会发出问候那条 `NEXT_MOVES`，Idle 接住，红灯说出 “Hello! You can ask me anything!”。这之后的路径就是 Lab 2：问日子、问课程、说房间。

`Speak` 和 `Listen` 都要有一个 `Fail` 状态当 `onError` 的目标。没有这个状态，机器在描述阶段就会因为指向不存在的状态而起不来。

两份入口不要同时跑。`main.ts` 和 `sisu.ts` 都会占 `127.0.0.1:54321` 这一个头。

---

## VG-2：做一个可以替换 SpeechState 的 furstate

文件：`starter/src/furstate/main.ts`。编号是文件里的 `TODO 1` 到 `TODO 11`。

Lab 1 的 `dm.ts` 只会发四种事件：`PREPARE`、`SPEAK`、`LISTEN`、`STOP`。它只会等这几种回音：`ASRTTS_READY`、`TTS_STARTED`、`SPEAK_COMPLETE`、`RECOGNISED`、`ASR_NOINPUT`、`LISTEN_COMPLETE`。

Furhat Realtime API 说的是另一套名字，例如 `request.speak.text`、`response.hear.end`。furstate 夹在中间做翻译。做完之后，`dm.ts` 里把

```typescript
spstRef: spawn(speechstate, { input: settings }),
```

换成

```typescript
spstRef: spawn(furstate),
```

状态图一个字都不用改。

测试在 `starter/src/furstate/basic.test.ts`。虚拟 Furhat 的 Realtime API 开在 9000 端口时再跑。听的那一条就是 L3-13。

### TODO 1 多引入两个工具

**要做什么。** 从 `xstate` 再引入 `assign` 和 `enqueueActions`。

**为什么。** WebSocket 还没连上时，`dm.ts` 已经会发 `PREPARE`。这个事件要先记在 context 里，连上再补发。`assign` 负责记，`enqueueActions` 负责连上之后按顺序补发。

### TODO 2A 先有一个不会发丢的 send

**要做什么。** 在 `new WebSocket` 下面加：

```typescript
let open = false;
let heard = false;
const pending: string[] = [];

function send(data: object) {
  const raw = JSON.stringify(data);
  if (open && ws.readyState === WebSocket.OPEN) ws.send(raw);
  else pending.push(raw);
}
```

**为什么。** `OPEN` 之前调用 `ws.send` 会抛错，`PREPARE` 或第一句 `SPEAK` 就丢了。`dm.ts` 一启动就发 `PREPARE`，这时套接字经常还没开。先推进 `pending`，2B 连上再倒出去。`heard` 这一步先放着，TODO 4 和 TODO 6 用它区分「听见了一句」和「听完了但没人说话」。

### TODO 2B 连上之后先清队列

**要做什么。** 在 `open` 事件里，`sendBack({ type: "WS_CONNECTED" })` 之前：

```typescript
open = true;
pending.splice(0).forEach((raw) => ws.send(raw));
```

**为什么。** `splice(0)` 把数组掏空并返回原来的那些字符串，每条已经是 JSON，直接 `ws.send`。先清队列再告诉上面「连上了」，避免连上的信号和补发的命令抢顺序。`open = true` 要放在循环前面，不过这些字符串已经绕过 `send()`，直接走 `ws.send`，所以顺序只影响之后新来的命令。

### TODO 2C SPEAK 也走这个 send

**要做什么。** `case "SPEAK"` 里改成：

```typescript
send({ type: "request.speak.text", text: event.value.utterance });
```

**为什么。** 原来的例子直接 `ws.send`。队列只保护走 `send()` 的命令。说话如果还走旧写法，连接没好时第一句问候会丢，而 `PREPARE` 又被队列保住了，故障会看起来像「准备好了，但是不开口」。

### TODO 3 PREPARE 不发给机器人

**要做什么。**

```typescript
case "PREPARE":
  sendBack({ type: "ASRTTS_READY" });
  break;
```

**为什么。** SpeechState 的 `PREPARE` 是去连 Azure。Furhat 没有这一步。`dm.ts` 的 `Prepare` 却一直等 `ASRTTS_READY`，等不到按钮就不能点。所以这里立刻回这个事件。不要把 `PREPARE` 编成某条 Furhat 请求，机器人不认识它。

如果这条 `PREPARE` 来的时候状态机还在 `Connecting`，它到不了这个 `switch`。那是 TODO 8 和 TODO 9 的事：先记下来，连上再送进 callback。

### TODO 4 LISTEN 要带上四个参数

**要做什么。**

```typescript
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
```

**为什么。** 每次开始听都把 `heard` 清掉，这一轮才能重新判断有没有听见。四个参数的意思是：

| 参数 | 作用 |
|---|---|
| `partial: false` | 不要一句还没说完就往外吐半句。`dm.ts` 只在听完时做决定 |
| `stop_user_end: true` | 用户说完就停 |
| `stop_no_speech: true` | 没人说话也要停，否则 `Ask` 会一直挂着 |
| `no_speech_timeout: 8` | 8 秒没声音算没说话 |

`dm.ts` 的 `Ask` 发的就是 `LISTEN`。它然后等 `RECOGNISED` 或 `ASR_NOINPUT`，最后等 `LISTEN_COMPLETE`。

### TODO 5 STOP 把说和听都停掉

**要做什么。**

```typescript
case "STOP":
  send({ type: "request.listen.stop" });
  send({ type: "request.speak.stop" });
  break;
```

**为什么。** `dm.ts` 暂停时发一个 `STOP`。当时可能正在念，也可能正在听。只停一个，另一个还会继续。两条都走 `send()`，连接还没开时会进队列，而不会抛错。

### TODO 6 在往上交之前，先判断这轮有没有听见

**要做什么。** 在 `message` 事件里，`sendBack(ev)` 之前：

```typescript
if (ev.type === "response.hear.end" && ev.text) heard = true;
if (ev.type === "response.listen.end" && !heard) {
  sendBack({ type: "ASR_NOINPUT" });
}
sendBack(ev);
```

**为什么。** Furhat 用两条消息表示听：`response.hear.end` 是「有一句文字」，`response.listen.end` 是「监听结束」。SpeechState 在没人说话时会发 `ASR_NOINPUT`。这里在结束、并且 `heard` 还是 false 时，先补一条 `ASR_NOINPUT`。原始的 `ev` 仍然要 `sendBack`，因为下面的状态机还要把它翻译成 `LISTEN_COMPLETE`。

顺序因此是：没听见时先 `ASR_NOINPUT`，再 `response.listen.end`。`dm.ts` 的 `Ask` 靠这个顺序，在 `LISTEN_COMPLETE` 那一刻 `lastResult` 已经是 `null`。`ev.text` 要真有内容才把 `heard` 设为真，空字符串不算听见。

### TODO 7 context 里记「准备请求来早了」

**要做什么。**

```typescript
types: {
  events: {} as FurstateEvent,
  context: {} as { preparePending: boolean },
},
// ...
context: { preparePending: false },
```

**为什么。** `assign` 要改的字段必须先在 context 类型里。`preparePending` 表示：`PREPARE` 来过，可是当时还在连接，还没送进 callback。

### TODO 8 连接中先把 PREPARE 记下来

**要做什么。** `Connecting` 的 `on` 里加上：

```typescript
PREPARE: {
  actions: assign({ preparePending: true }),
},
```

**为什么。** 这个状态原来只接收 `WS_CONNECTED`。XState 不接收的事件会被丢掉。`dm.ts` 的第一件事就是 `PREPARE`，它经常比 `WS_CONNECTED` 更早到。丢掉之后，`dm.ts` 永远停在 `Prepare`，按钮一直不能点。这里只记下来，不送进还没打开的 callback。

### TODO 9 一连上，把记下的 PREPARE 补发出去

**要做什么。** `Connected` 的 `entry`：

```typescript
entry: enqueueActions(({ context, enqueue }) => {
  if (!context.preparePending) return;
  enqueue(sendTo("furhat", { type: "PREPARE" }));
  enqueue(assign({ preparePending: false }));
}),
```

**为什么。** `entry` 里要先发事件、再改 context，用 `enqueueActions` 把两件排队，顺序才稳定。`sendTo("furhat")` 的 `"furhat"` 是 `invoke` 的 id，也就是那个 WebSocket callback。callback 里的 TODO 3 收到后回 `ASRTTS_READY`。然后把旗子放倒，避免下次再进 `Connected` 时又补发一次。

`preparePending` 是 false 就直接 return。正常情况如果 `PREPARE` 来得比连接晚，它会走 TODO 10，不经过这条 entry。

### TODO 10 连上之后，四种命令都转给 callback

**要做什么。** 在 `Connected.on` 里，照着已有的 `SPEAK` 再写三条：

```typescript
PREPARE: { actions: sendTo("furhat", ({ event }) => event) },
LISTEN: { actions: sendTo("furhat", ({ event }) => event) },
STOP: { actions: sendTo("furhat", ({ event }) => event) },
```

**为什么。** 状态机这一层不认识 `request.listen.start`。它只负责把 `dm.ts` 的事件原样送进 callback，翻译在 callback 的 `switch` 里。少写 `LISTEN`，`Ask` 会发了听，机器人却没有反应，然后一直等 `LISTEN_COMPLETE`。

### TODO 11 把机器人的回音翻译成 dm.ts 认识的事件

**要做什么。** 仍然在 `Connected.on`：

| 从 callback 来的 | 用 `sendParent` 送出去的 |
|---|---|
| `ASRTTS_READY` | 原样 |
| `response.speak.start` | `{ type: "TTS_STARTED" }` |
| `response.speak.end` | `{ type: "SPEAK_COMPLETE" }` |
| `response.hear.end` | `{ type: "RECOGNISED", value: [{ utterance: String(event.text ?? "") }] }` |
| `response.listen.end` | `{ type: "LISTEN_COMPLETE" }` |
| `ASR_NOINPUT` | 原样 |

`RECOGNISED` 的写法：

```typescript
"response.hear.end": {
  actions: sendParent(({ event }) => ({
    type: "RECOGNISED",
    value: [{ utterance: String(event.text ?? "") }],
  })),
},
```

**为什么。** `dm.ts` 的 `appendUserFromSpeech` 读的是 `lastResult[0].utterance`。SpeechState 的 `RECOGNISED` 就是 `value: [{ utterance }]` 这个形状。翻译如果只送一个字符串，Lab 1 的历史里会写下 `undefined`。

`sendParent` 是因为 furstate 被 `dm.ts` spawn 为子机器，回音要交给父机器。顺序仍然靠 TODO 6：没听见时父机器先收到 `ASR_NOINPUT`，再收到 `LISTEN_COMPLETE`。

---

## L3-13 用测试把「听」这条顺序锁住

文件：`starter/src/furstate/basic.test.ts` 的 `ListeningTest`

**要做什么。** 父机器先等自己到 `Connected`（子机器已经送来 `WS_CONNECTED`）。再发 `LISTEN` 给 furstate。`RECOGNISED` 或 `ASR_NOINPUT` 都进入下一步，然后再等 `LISTEN_COMPLETE`，才算这轮听完。

**为什么。** 这就是 `dm.ts` 的 `Ask` 依赖的顺序。只等到文字、没等到 `LISTEN_COMPLETE`，对话机会在监听还没收尾时去检索。只等到结束、没处理 `ASR_NOINPUT`，静音会被当成一句空话拿去查库。两条都要出现在测试的路径上。

说话那条测试是：发 `SPEAK`，先等 `TTS_STARTED`，再等 `SPEAK_COMPLETE`。它锁的是 TODO 2C 和 TODO 11 的说话半边。

---

## 三截怎么接在一起看

Part A 证明你能叫这颗头：看人、做表情、亮灯、说、听、再生气。

VG-1 把「下一句说什么」交给 Lab 2。Furhat 每一轮只做四件小事：接 `NEXT_MOVES`，告诉对话机这是系统说的，红灯念出来，关灯听完再把 move 送回去。

VG-2 把「嘴和耳朵」做成 Lab 1 已经在用的那组事件。`dm.ts` 仍然是说、听、检索、生成。换的只是 `spawn` 的那一台机器。
