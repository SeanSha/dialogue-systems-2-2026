# Lab 1 一步一步做：语音闲聊，再加上查文档

代码里的编号是 `L1-1` 到 `L1-28`。这份文档按那个顺序讲。每一步都写成三件事：要做什么、为什么、代码怎么写。仓库里的实现已经按这个编号标在注释上，可以边看文档边看代码。

## 这个实验在干什么

你要做一个能开口说话的助手。它做四件事，一轮一轮重复：

1. 把你说的话听成文字。
2. 记住你们已经说过的话。
3. 去一份哥德堡大学学生支持文档里找相关段落。
4. 把那些段落交给本地大模型，让它用很短的话回答，再念出来。

前两步是 Part 1，闲聊。后两步是 Part 2，RAG。RAG 就是「先检索，再把检索结果塞进提示词，最后生成」。VG-1 再加一件事：没听清就请对方再说，而不是干等。

三份代码各管一头：

| 文件 | 管什么 |
|---|---|
| `starter/src/types.ts` | 一条消息长什么样，脑子里记哪些东西 |
| `rag/src/main.ts` | 提前把文档切碎、变成向量、放进 Qdrant |
| `starter/src/dm.ts` | 对话进行时谁先谁后：说、听、查、生成 |

Qdrant 是本机的向量数据库。Ollama 是本机的模型服务。对话状态机用 XState 写。语音进出原来走 SpeechState；这个仓库后来换成了 Lab 3 的 furstate，事件名字没变，所以 Lab 1 的状态图仍然成立。

## 动手之前先让两台服务活着

在 `rag/` 里把 Qdrant 拉起来（端口 6333）。Ollama 里要有两个模型：

- `qwen3-embedding`：把文字变成 384 个数，建库和提问用同一个。
- `llama3.2`：根据提示词生成那句短回答。

然后：

```bash
cd rag
npx tsx src/main.ts createCollection gu_support_all
npx tsx src/main.ts addFolder gu_support_all ../labs/lab1/data
npx tsx src/main.ts queryCollection gu_support_all "What is the phone number for Feelgood" -k 5
```

第三条能打出带 `source=` 的段落，库就算建好了。对话页面在 `starter/` 里 `npm run dev`。浏览器控制台看 `>>> state`，那是状态机现在停在哪。

---

## L1-1 一条消息的形状

文件：`starter/src/types.ts`

**要做什么。** 定义 `Message`。每条只有两个字段：谁说的，说了什么。

**为什么。** 大模型的聊天接口要一个数组，数组里每一项都是 `{ role, content }`。你自己先把这个形状定下来，后面追加历史、调用模型，都用同一种东西，不用临时拼对象。

**怎么写。**

```typescript
export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
};
```

`system` 是给模型的规矩，用户听不见。`user` 是识别出来的那句话。`assistant` 是模型的回复，也是马上要念出来的那句。

---

## L1-2 对话脑子里多记两样东西

文件：`starter/src/types.ts` 的 `DMContext`

**要做什么。** 在原来的 `spstRef`、`lastResult` 旁边加上 `messages` 和 `ragContext`。

**为什么。** `messages` 是整段对话的记忆，会一直变长。`ragContext` 只是这一轮查到的文档，下一轮提问会整段换掉。两样东西混在一个字段里，模型就会把旧文档当成永久聊天记录。

**怎么写。**

```typescript
export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: Hypothesis[] | null;
  messages: Message[];
  ragContext: string;
}
```

`lastResult` 是「刚刚听写出来的那一句」，还没决定要不要写进历史。`messages` 才是已经决定留下来的历史。

---

## L1-3 把一段文字变成 384 个数字

文件：`rag/src/main.ts`

**要做什么。** 写一个 `embed`。输入一句字符串，输出一串数字。

**为什么。** Qdrant 不会按关键字找句子。它比较的是向量离得近不近。问题和文档必须用同一个模型、同一个长度，比出来的距离才有意义。这里选定 384，是因为后面建集合时也写 384。

**怎么写。** Ollama 提供和 OpenAI 一样的接口，所以用 `openai` 这个包，把地址指到本机。

```typescript
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input,
      dimensions: 384,
    })
    .then((result) => result.data[0].embedding);
```

`apiKey` 写 `"ollama"` 只是为了让客户端不报缺钥匙。真正算向量的是本机 Ollama。

---

## L1-4 把一页文档切成小块

文件：`rag/src/main.ts` 的 `makeChunksFromFile`

**要做什么。** 读一个 txt，切成大约 500 字一块、相邻块重叠 50 字的片段。

**为什么。** 一整页塞进一次检索，问「Feelgood 的电话」时会带上一大堆无关段落。切小之后，电话那一段可以单独被找出来。重叠 50 字，是为了句子正好被切断时，两边都还留着后半句或前半句。

爬虫导出的文件用三个换行隔开章节，所以分隔符的第一个是 `"\n\n\n"`。切的时候优先在章节边界下刀，切出来的块更像一个完整小节。

**怎么写。**

```typescript
const makeChunksFromFile = async (filepath: string) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
    separators: ["\n\n\n", "\n\n", "\n", ". ", " "],
  });
  const document = await readFile(filepath, "utf8");
  return splitter.splitText(document);
};
```

分隔符从左到右试。章节切得开，就不再按句号切。

---

## L1-5 每一块变成数据库里的一个点

文件：`rag/src/main.ts` 的 `chunksToPoints`

**要做什么。** 每一块调用 L1-3，做成 Qdrant 的一个 point：有 id、有向量、有 payload。

**为什么。** 向量只负责「找得像不像」。找回来之后，给模型看的是原文，所以原文要放在 `payload.text`。`payload.source` 是文件名。查询时能看到命中的是哪一页，VG 里比较不同的 k 时也靠它认噪声。

一块一块顺序算，是为了进度条稳定，也避免一次把 Ollama 打满。

**怎么写。**

```typescript
points.push({
  id: uuidv4(),
  vector: embedding,
  payload: {
    text: chunks[i],
    source, // basename，例如 page-003-Servicecenter.txt
  },
});
```

---

## L1-6 建一个空集合

**要做什么。** 增加命令 `createCollection <name>`。

**为什么。** 集合要事先声明向量有多长、用什么距离。长度和 L1-3 不一致，后面 upsert 会被拒绝。Cosine 看的是方向像不像，适合这种「这句话和哪一段文档更接近」的比较。

**怎么写。**

```typescript
await client.createCollection(name, {
  vectors: { size: 384, distance: "Cosine" },
});
```

名字随便起，但后面导入和对话里查询必须用同一个。这个仓库用的是 `gu_support_all`。

---

## L1-7 把一个文件放进集合

**要做什么。** 命令 `addData <collection> <path>`：切块、变成 point、`upsert`。

**为什么。** 这是最小的写入路径。先确认一个文件能进去，再写整夹导入。`wait: true` 表示写完才返回，后面马上查询不会查到半截数据。

**怎么写。**

```typescript
const chunks = await makeChunksFromFile(path);
const points = await chunksToPoints(chunks, path);
await client.upsert(collection, { wait: true, points });
```

---

## L1-8 把整个文件夹放进集合

**要做什么。** 命令 `addFolder <collection> <folder>`。只收 `.txt`，一个文件做完再做下一个。

**为什么。** 作业要求能一次灌进 `labs/lab1/data`。并行 embed 会把本机模型打超时，所以用普通 `for`。

**怎么做。**

```bash
npx tsx src/main.ts addFolder gu_support_all ../labs/lab1/data
```

代码就是：`readdir`，滤出 `.txt`，对每个文件重复 L1-7。

---

## L1-9 用一句话试试库

**要做什么。** 命令 `queryCollection <collection> <query>`，可选 `-k`。

**为什么。** 对话接上之前，先用命令行确认「Feelgood 的电话」能命中服务中心那一页。`-k` 是返回几条。作业默认心里想的是 5 条；VG 报告里比较不同 k，改的就是这个数。对话代码里的 `limit: 5` 要和这里的默认值对齐，命令行试出来的结果才和说话时查到的是同一套。

**怎么写。**

```typescript
const embedding = await embed(query);
const results = await client.query(collection, {
  with_payload: true,
  query: embedding,
  limit,
});
```

`with_payload: true` 才会把 `text` 和 `source` 带回来。没有它，你只能看到一串分数。

---

## L1-10 对话这边也连上同一个 Ollama

文件从这里起是 `starter/src/dm.ts`。

**要做什么。** 再创建一个 OpenAI 客户端，地址同样是 `http://localhost:11434/v1/`。

**为什么。** 建库在命令行，对话在浏览器。两边是两个进程，客户端要各写一个，但必须打到同一个 Ollama。`dangerouslyAllowBrowser: true` 是因为这段代码被 Vite 打进页面，官方客户端默认禁止在浏览器里带钥匙运行。

---

## L1-11 提问时用和建库同一个 embed

**要做什么。** 在 `dm.ts` 里把 L1-3 再写一遍：`qwen3-embedding`，384 维。

**为什么。** 用户的问题也要变成向量，才能去 `gu_support_all` 里比。模型或维度有一个不一样，Qdrant 会直接拒绝查询，或者比出来的近邻没有意义。

---

## L1-12 哪些话表示「停」

**要做什么。** 写 `isStopCommand`。整句是 `stop`、`pause`、`goodbye`、`good bye`、`exit`，或者里面含有 `stop listening`、`that's all`，就算停。

**为什么。** 页面按钮可以暂停。说话也能暂停，测试时就不用一边说话一边去点鼠标。比较前先 `toLowerCase().trim()`，识别结果常常带大小写和空格。

这个判断先不要在这里发事件。L1-24 听完之后才用它决定去暂停还是去检索。

---

## L1-13 说、听、停，三件对外的动作

**要做什么。** 在状态机的 `actions` 里写三个动作，都是给 `context.spstRef` 发事件。

**为什么。** 状态机自己不碰麦克风。它只发三种事件，真正去念、去听的是 SpeechState，或者后来的 furstate。事件名字保持不变，换嘴的时候状态图不用重画。

**怎么写。**

```typescript
"spst.speak": ({ context }, params: { utterance: string }) =>
  context.spstRef.send({
    type: "SPEAK",
    value: { utterance: params.utterance },
  }),

"spst.listen": ({ context }) =>
  context.spstRef.send({ type: "LISTEN" }),

"spst.stop": ({ context }) =>
  context.spstRef.send({ type: "STOP" }),
```

---

## L1-14 点开始时先写一句开场白

**要做什么。** `appendGreeting`：往 `messages` 末尾追加一条 assistant。

**为什么。** 后面「说」这个状态不接收一句现成的字符串，它只念 `messages` 的最后一条。开场白先写进去，一进循环就会被念出来，而且模型下一轮也能看见自己打过招呼。

**怎么写。**

```typescript
appendGreeting: assign(({ context }) => ({
  messages: [
    ...context.messages,
    { role: "assistant" as const, content: "Hi! I'm Altlas. How can I help you?" },
  ],
})),
```

`assign` 是 XState 改 context 的方式。用展开写成新数组，旧数组不要原地 `push`，否则状态机看不出变化。

---

## L1-15 听完的那句写成 user

**要做什么。** `appendUserFromSpeech`：取 `lastResult[0].utterance`，追加 `{ role: "user", content }`。

**为什么。** 模型要看见「用户刚才问了什么」，也要看见更早的几轮。只把最新一句发给模型，它会每一轮都像第一次见面。文字放在 `lastResult` 里先存着，是因为听写完成和「决定这句算不算数」不是同一时刻。口令、空识别，都要等听完再决定要不要写进历史。

---

## L1-16 模型的回复写成 assistant

**要做什么。** `appendAssistantFromLLM`：把 `event.output` 追加进 `messages`。

**为什么。** `fromPromise` 这种 actor 成功结束时，返回值放在 `event.output`。先追加，再回到「说」的状态，念的就是刚生成的这句。下一轮它也会作为历史的一部分再送回去。

```typescript
appendAssistantFromLLM: assign(({ context, event }) => {
  const message = (event as { output: { role: "assistant"; content: string } }).output;
  return { messages: [...context.messages, message] };
}),
```

---

## L1-17 调用聊天模型

**要做什么。** 写 actor `chatCompletion`。输入是 `{ messages, ragContext }`，调用 `openai.chat.completions.create`，模型 `llama3.2`，返回 `{ role: "assistant", content }`。

**为什么。** 生成是异步的，而且要花好几秒。放进 `fromPromise`，状态机可以停在「正在生成」，完成了走 `onDone`，失败了走 `onError`，不会在一个回调里把听和说搅在一起。

返回值的形状必须是 L1-1 的 `Message`，这样 L1-16 不用再翻译一遍。

```typescript
const response = await openai.chat.completions.create({
  model: "llama3.2",
  messages: messagesForLLM,
});
const content = response.choices[0]?.message?.content ?? "";
return { role: "assistant" as const, content };
```

---

## L1-18 把查到的文档拼进 system

这一步在 `chatCompletion` 里面，调用模型之前。

**要做什么。**

1. 从 `messages` 里找出原来的 system，当作 `baseSystem`。
2. `history` 只保留 user 和 assistant。
3. 写一条新的 system：原来的规矩，加上「用下面的文档；文档里没有就说不知道；回答要短」，再接上 `ragContext`。
4. 发给模型的数组是 `[新 system, ...history]`。

**为什么。** 这就是 RAG 的 A，augmentation。文档不是又一轮对话，它是这一次的参考资料。放在 system 里，模型会把它当成规矩的一部分。`ragContext` 为空时写成 `(no documents retrieved)`，模型就知道现在没有资料，而不是对着空白发挥。

把旧 system 从 history 里拿掉，是为了避免两条 system 打架。增强后的那条已经包含了原来「回答要短」的要求。

```typescript
const augmentedSystem = `${baseSystem}

You help University of Gothenburg students. Use the documents below when relevant.
If the documents do not contain the answer, say you don't know. Do not invent facts.
Keep replies very short for speech.

RELEVANT DOCUMENTS:
${input.ragContext || "(no documents retrieved)"}
`;
```

---

## L1-19 用刚说的那句去查库

**要做什么。** 写 actor `retrieve`。输入 `{ query: string }`。先 embed，再 `qdrant.query`。

**为什么。** 这是 RAG 的 R。查询和生成分成两个 actor，检索失败时还可以决定「带着空文档继续说」，而不是让整轮对话停住。

**怎么写。**

```typescript
const results = await qdrant.query("gu_support_all", {
  query: vector,
  with_payload: true,
  limit: 5,
});
const texts = (results.points ?? [])
  .map((p) => (p.payload as { text?: string } | null)?.text ?? "")
  .filter(Boolean);
return texts.join("\n\n---\n\n");
```

`limit: 5` 和 L1-9 的默认条数一样。返回一个字符串，是因为 L1-2 的 `ragContext` 就是字符串，L1-18 可以直接贴进提示词。`---` 只是让模型看出这是好几段，不是一段连着的文章。

---

## L1-20 机器一开始脑子里有什么

**要做什么。** `context` 里：

- `spstRef` 启动语音那一台机器
- `lastResult: null`
- `ragContext: ""`
- `messages` 里先放一条 system：`"You are a friendly voice assistant. Keep replies very short."`

**为什么。** 语音回答太长会听着累，所以第一句话就约束长度。这条 system 就是 L1-18 的 `baseSystem`。`ragContext` 用空字符串开头，第一轮如果还没检索，提示词里会是「没有文档」。

Lab 1 当时写的是：

```typescript
spstRef: spawn(speechstate, { input: settings }),
```

`settings` 里 `asrDefaultNoInputTimeout: 5000` 表示 5 秒没说话就发出 `ASR_NOINPUT`。这个仓库现在是 Lab 3 的写法：

```typescript
spstRef: spawn(furstate),
```

超时改由 furstate 的 `no_speech_timeout: 8` 控制。`settings` 还留在文件里，已经没有人读它。Lab 1 交作业时用上面那行 SpeechState 即可。

---

## L1-21 准备好了才让人按按钮

**要做什么。** 初始状态 `Prepare`。一进来就发 `PREPARE`。等到 `ASRTTS_READY`，去 `WaitToStart`。

**为什么。** 麦克风和语音合成还没就绪时让用户开始说话，第一句会丢。`ASRTTS_READY` 是「嘴和耳朵都好了」的信号。furstate 里收到 `PREPARE` 后回的就是这个事件。

```typescript
Prepare: {
  entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
  on: { ASRTTS_READY: "WaitToStart" },
},
```

---

## L1-22 按钮按下，先写入开场白

**要做什么。** `WaitToStart` 收到 `CLICK`，执行 `appendGreeting`，进入 `Loop`。

**为什么。** `Loop` 的初始子状态是 `Speaking`。开场白已经在 L1-14 写进 `messages` 的最后一条，所以一进来就会被念出来。按钮事件来自 `main.ts` 里的 `setupButton`，它把点击转成 `{ type: "CLICK" }`。

---

## L1-23 念出最后一条

**要做什么。** `Speaking` 的 entry 调用 `spst.speak`，文字是 `messages` 最后一条的 `content`。`SPEAK_COMPLETE` 去 `Ask`。

**为什么。** 开场白和模型回复走同一条路。谁想被听见，谁就先成为 `messages` 的最后一条。说完才听，避免自己的声音被麦克风收进去。

```typescript
Speaking: {
  entry: {
    type: "spst.speak",
    params: ({ context }) => ({
      utterance: context.messages[context.messages.length - 1].content,
    }),
  },
  on: { SPEAK_COMPLETE: "Ask" },
},
```

---

## L1-24 听完再决定去哪

**要做什么。** `Ask` 一进来就 `LISTEN`。三个事件分工：

| 事件 | 这时做什么 |
|---|---|
| `RECOGNISED` | 只把 `event.value` 放进 `lastResult` |
| `ASR_NOINPUT` | 把 `lastResult` 写成 `null` |
| `LISTEN_COMPLETE` | 这才分支 |

`LISTEN_COMPLETE` 按顺序试三条：

1. `lastResult` 有字，而且 `isStopCommand` 为真：去暂停，并把这句 user 和一句暂停提示写进历史。
2. `lastResult` 有字：执行 `appendUserFromSpeech`，去 `Retrieve`。
3. 其余：去 `NoInput`。

**为什么。** 识别是陆续来的。`RECOGNISED` 只表示「有一句了」，监听可能还没结束。真正收工的信号是 `LISTEN_COMPLETE`。没听见时，furstate 会先送 `ASR_NOINPUT`（把 `lastResult` 清空），再送 `LISTEN_COMPLETE`，于是走到第 3 条。如果在 `RECOGNISED` 的当下就去检索，半句结果和最终结果会抢着跑。

XState 里 `on` 的一个事件可以写成数组。数组从上往下找第一条 guard 通过的。第 3 条没有 guard，是兜底。

---

## L1-25 没听清就请对方再说（VG-1）

**要做什么。** 状态 `NoInput`。说 `"I didn't catch that. Please say it again."`。说完回到 `Ask`。

**为什么。** 没有这个状态，静音之后要么死循环空听，要么把空字符串拿去检索。这句话不进 `messages` 也可以，它是对这一次失败的提示，下一轮听写成功后历史里仍然是用户真正说的那句。这里也不调用模型和数据库。

```typescript
NoInput: {
  entry: {
    type: "spst.speak",
    params: { utterance: "I didn't catch that. Please say it again." },
  },
  on: { SPEAK_COMPLETE: "Ask" },
},
```

---

## L1-26 听写成功之后先检索

**要做什么。** 状态 `Retrieve`，invoke L1-19。`query` 用 `lastResult[0].utterance`。

- `onDone`：把返回的字符串写入 `ragContext`，去 `ChatCompletion`。
- `onError`：`ragContext` 写成 `""`，仍然去 `ChatCompletion`。

**为什么。** 用户那句在 L1-24 已经写进 `messages`。检索用的是同一句原文，不从历史里再抠。检索挂了还继续生成，是为了对话不要卡死；L1-18 看到空文档会让模型说不知道，而不是编一个电话号码。

---

## L1-27 带着文档去生成

**要做什么。** 状态 `ChatCompletion`，invoke L1-17，把 `messages` 和 `ragContext` 一起送进去。

- `onDone`：执行 L1-16，回到 `Speaking`。
- `onError`：追加 `"Sorry, I had a problem answering."`，也回到 `Speaking`。

**为什么。** 失败也要有一句可念的 assistant。否则 `Speaking` 还会去念上一句开场白，用户以为机器把问候又说了一遍。成功时 L1-16 把模型的话放在最后，L1-23 念的就是它。念完回到 `Ask`，下一轮开始。

到这里，主循环是：

```text
Speaking → Ask → Retrieve → ChatCompletion → Speaking → ...
```

Part 1 如果先不做检索，可以把 `Ask` 的成功分支直接指到 `ChatCompletion`，`ragContext` 保持空字符串。Part 2 再把 `Retrieve` 插进 `Ask` 和 `ChatCompletion` 中间。作业图上的 `Ask → ChatCompletion` 就是还没插检索的那一版。

---

## L1-28 暂停，以及再继续

**要做什么。** 状态 `Paused`，里面再分 `Announce` 和 `Idle`。

两条路都能进来：

- `Loop` 里再点一次按钮。
- `Ask` 里说了 L1-12 的口令。

两条路都先 `spst.stop`，再往 `messages` 追加一句暂停提示。`Announce` 把这句念出来，念完进 `Idle`，这时不再听。`Idle` 再收到点击，追加 `"I'm listening again."`，回到 `Loop.Speaking`。那句会被念出来，然后进入 `Ask`。

**为什么。** `STOP` 把正在进行的朗读和听写掐掉，否则暂停之后麦克风还开着。继续时不直接跳到 `Ask`，是因为用户需要一声「我又在听了」，也因为 `Speaking` 已经会念最后一条，不用再写一条单独的说话状态。

目标写成 `"#DM.Paused"` 和 `"#DM.Loop.Speaking"`，是因为这些状态在嵌套里面，用绝对 id 才能从内层跳到外层。

---

## 一轮真实对话，把编号串起来

用户问 “What is the phone number for Feelgood?”。

1. L1-23 念完上一句，进入 Ask。
2. L1-24 把这句话放进 `lastResult`，听完后追加成 user，进入 Retrieve。
3. L1-26 / L1-19 把这句话 embed，在 `gu_support_all` 里取 5 段，拼成 `ragContext`。
4. L1-27 / L1-18 把这 5 段贴进 system，连同全部 `messages` 交给 `llama3.2`。
5. L1-16 把回复追加成 assistant，L1-23 念出来。
6. 回到 Ask。

8 秒没人说话：L1-24 把 `lastResult` 清空，L1-25 说没听清，再听。

说 “stop”：L1-12 命中，L1-28 停掉嘴和耳朵，等下一次点击。

浏览器控制台里看三行就够了：`>>> state`、`>>> messages`、`>>> ragContext length`。`ragContext length` 在检索成功后应该明显大于 0。
