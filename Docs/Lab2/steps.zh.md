# Lab 2 一步一步做：让系统先问星期几，听不懂就道歉

代码里的编号是 `L2-1` 到 `L2-33`。这份文档按那个顺序讲。每一步都是：要做什么、为什么、代码怎么写。

先在 `sisu/` 里跑测试：

```bash
cd sisu
yarn test
```

浏览器那一版是 `yarn dev`。Lab 2 的正路是先写会失败的测试，再改领域和规则，直到 `yarn test` 里新加的对话都通过。

## 这个实验在干什么

SISU 已经能做两件小事：打招呼，以及用自己早就知道的事实回答「你最喜欢的食物是什么」（答案是 Pizza）。

你要把它变成能查课表的系统。用户问 “Where is the lecture?” 之后，它不能马上说房间，因为房间取决于星期几和哪门课：

| 课 | 星期 | 房间 |
|---|---|---|
| Dialogue systems 2 | Friday | G212 |
| Dialogue systems 2 | Thursday | J440 |
| Dialogue systems 2 | Tuesday | J440 |

然后再处理两种失败：

- 说了听不懂的话：道歉，并且把刚才的问题再问一遍。
- 根本没人说话：问 “Are you there?”，有未完成的问题就再问一遍。

VG-B 再用 Qdrant 把「差不多的句子」也听懂，精确表里没有的近义句可以靠向量找回来。

## 先把脑子里的纸条认清

规则改来改去的是一份 `InformationState`。可以想成几叠纸条。

| 名字 | 大白话 |
|---|---|
| `move` | 一句话的意思。问、答、打招呼、道歉，都是 move，已经不是原句 |
| `agenda` | 这一轮马上要做的事。一轮结束会被清空 |
| `plan` | 为了办成一件事排好的步骤。做完一步才撕掉一步 |
| `qud` | 还挂着、没回答完的问题。最上面那个最急 |
| `com` | 双方都算数的事实，比如「日子是星期五」 |
| `bel` | 系统自己知道、也许还没说出口的事实，比如「房间是 G212」 |
| `next_moves` | 这一轮准备说出口的 move |

`dme.ts` 里两个大状态轮流做。Select 决定下一句说什么。Update 听进一句，改那些纸条。规则写在 `rules.ts`，但是要在 `dme.ts` 的 `always` 列表里挂上，才会被试到。`always` 从上往下，第一条适用的规则赢。

原句和 move 之间隔着两张表，都在 `nlug.ts`：

- `nlu`：用户的英文字符串 → moves。表里没有就返回 `[]`。
- `nlg`：moves → 英文句子。好几条 move 用空格拼成一句。

测试不开麦克风。它假装用户说了一句英文，用 `nlu` 变成 moves，送给 `dme`；`dme` 吐出 `NEXT_MOVES`，再用 `nlg` 变回英文，和期望的句子比。

---

## L2-1 测试里的沉默不要走听懂表

文件：`sisu/test/dme.test.ts`，处理 `INPUT` 的地方。

**要做什么。** 用户那句如果是 `"(silence)"`，送进对话机的 move 是 `{ type: "icm", content: "con*neg" }`。其它句子仍然 `nlu(event.value)`。

**为什么。** 自动测试没有麦克风，没法真的超时。用一个特殊字符串代表「没人说话」。`con*neg` 是负接触：我没有和你接上。后面的规则认的是这个 move，认的不是英文句子 `"(silence)"`。听不懂的普通句子走 `nlu`，返回 `[]`，那是另一种失败。

**怎么写。** 在发给 `dme` 的 `SAYS` 里：

```typescript
moves:
  event.value === "(silence)"
    ? [{ type: "icm", content: "con*neg" }]
    : nlu(event.value),
```

`speaker` 仍然是 `"usr"`。

---

## L2-2 先写周五查到 G212 的测试

**要做什么。** 加一组 `describe`，期望的对话是：

```text
sys  Hello! You can ask me anything!
usr  Where is the lecture?
sys  Which day?
usr  Friday
sys  Which course?
usr  Dialogue Systems 2
sys  The lecture is in G212.
```

**为什么。** 作业要求先写失败的测试。现在系统听到 “Where is the lecture?” 会问 “Which course?”，不会问日子，所以这组会红。红了才知道后面改领域改对没有。

测试框架 `runTest` 会一轮一轮送。系统的句子来自 `nlg`，所以期望字符串必须和 `nlg` 表里的英文逐字一样，包括问号和句号。

---

## L2-3 再写周四查到 J440

**要做什么。** 同一条路径，把 Friday 换成 Thursday，最后一句换成 `The lecture is in J440.`

**为什么。** 只测周五，周二和周四的分支可以写错还照样绿。周四和周二在表上是同一个房间，测一条就覆盖了这个分支的句子。星期二如果也想锁住，再复制一组，把 Thursday 换成 Tuesday。

---

## L2-4 听不懂要道歉，问题还在就再问

**要做什么。** 期望：

```text
sys  Hello! You can ask me anything!
usr  bla bla
sys  Sorry, I didn't understand.
usr  Where is the lecture?
sys  Which day?
usr  bla bla
sys  Sorry, I didn't understand. Which day?
```

**为什么。** `bla bla` 不在听懂表里，`nlu` 给出 `[]`。第一句发生在还没有问题时，系统只道歉。第二句发生在已经问过 “Which day?” 之后，道歉和原来的问题要接在同一轮说出来。中间那个句号加空格，是因为 `nlg` 把两条 move 用一个空格拼起来：`"Sorry, I didn't understand." + " " + "Which day?"`。

---

## L2-5 道歉几次之后仍然能查出 G212

**要做什么。** 在 L2-4 的基础上继续：

```text
usr  Friday
sys  Which course?
usr  bla bla
sys  Sorry, I didn't understand. Which course?
usr  Dialogue Systems 2
sys  The lecture is in G212.
```

**为什么。** 道歉如果把计划撕掉了，后面就问不出课程，也查不出房间。这组测试锁住的是「道歉不毁掉 plan」。

---

## L2-6 还没提问就没人说话

**要做什么。**

```text
sys  Hello! You can ask me anything!
usr  (silence)
sys  Are you there?
```

**为什么。** 这是 VG-A，负接触。这时 plan 是空的，所以只问人在不在，不要凭空再问一个课程。

---

## L2-7 问题还开着时没人说话，然后继续查房间

**要做什么。** “Which day?” 之后用户说 `"(silence)"`，系统说 `Are you there? Which day?`。接着 Friday、Dialogue Systems 2，最后 `The lecture is in G212.`

**为什么。** 接触失败和听不懂是两种 move，但「把没做完的问题再问一遍」这件事应该一样。查房间的后半段还在，说明 `con*neg` 也没有把 plan 清掉。

---

## L2-8 房间已经说完，再沉默

**要做什么。** 先正常走到 `The lecture is in G212.`，然后再 `"(silence)"`，系统只说 `Are you there?`

**为什么。** 房间答完以后，QUD 是空的。原来的 `downdate_qud` 会去读最上面那个问题。问题不存在时再往下算，测试会崩，而不是说出 “Are you there?”。这组把这个洞露出来。

---

## L2-9 在领域里登记「日子」

文件：`sisu/src/is.ts` 的 `initialIS`

**要做什么。**

- `predicates` 加上 `booking_day: "day"`。
- `individuals` 加上 `friday`、`thursday`、`tuesday`，sort 都是 `"day"`。

**为什么。** 系统靠 sort 判断一个回答算不算答到了问题上。问的是 day，用户答 friday，两者的 sort 都是 `"day"`，`relevant` 才放行。名字必须和后面 `nlu` 的 `content`、查表时的字符串完全一样。课程那边原来就有：课是 `LT2319`，sort 是 `"course"`。用户说 “Dialogue Systems 2”，听懂表把它译成 `LT2319`。

```typescript
const predicates = {
  favorite_food: "food",
  booking_course: "course",
  booking_day: "day",
};
const individuals = {
  pizza: "food",
  LT2319: "course",
  friday: "day",
  thursday: "day",
  tuesday: "day",
};
```

---

## L2-10 问房间之前先问日子，再问课程

**要做什么。** 找到内容是 `WHQ("booking_room")` 的那条 plan，把步骤改成：

```typescript
plan: [
  findout(WHQ("booking_day")),
  findout(WHQ("booking_course")),
  consultDB(WHQ("booking_room")),
],
```

**为什么。** 用户一问房间，`integrate_usr_ask` 会把「要回答 booking_room」放上 agenda，`find_plan` 再把这三步抄进 plan。Select 每次从 plan 顶上拿一步来问。所以第一句系统话是 “Which day?”，第二句才是 “Which course?”。两样都进了 `com` 之后，第三步才查表。顺序写反了，L2-2 的第二句就会还是 “Which course?”。

`agenda` 活不过一轮，`plan` 可以留到下一轮。所以「下一轮还要问课程」必须写在 plan 里，不能只堆在 agenda 上。

---

## L2-11 用课程和日子查房间

**要做什么。** 在 `database.consultDB` 里，问题是 `booking_room` 时：

```typescript
const course = getFactArgument(facts, "booking_course");
const day = getFactArgument(facts, "booking_day");
if (course == "LT2319" && day == "friday") {
  return { predicate: "booking_room", argument: "G212" };
}
if (course == "LT2319" && (day == "thursday" || day == "tuesday")) {
  return { predicate: "booking_room", argument: "J440" };
}
```

对不上就让函数末尾 `return null`。

**为什么。** `facts` 就是当时的 `com`，里面是已经说定的命题。`getFactArgument` 按谓词把论元拿出来。返回的命题会进 `bel`。下一轮 Select 发现 `bel` 能回答最上面的问题，就把它说出来。返回 `null` 表示表里没有这格，系统就不会编一个房间。

课程用内部名 `LT2319`，因为听懂表已经把 “Dialogue Systems 2” 译成了这个名字。查表如果去比英文课名，永远对不上。

---

## L2-12 听懂三个星期

文件：`sisu/src/nlug.ts` 的 `nluMapping`

**要做什么。** 加上三条。键是用户可能说的小写句子，值是一条 answer：

```typescript
friday: [{ type: "answer", content: "friday" }],
thursday: [{ type: "answer", content: "thursday" }],
tuesday: [{ type: "answer", content: "tuesday" }],
```

**为什么。** `nlu` 就是 `nluMapping[utterance.toLowerCase()] || []`。键要小写，调用时也会把原句转小写。`content` 必须是 L2-9 里的 individual 名字，查表和 sort 检查用的是它，用的不是英文单词 “Friday” 的大小写原样。

表里没有的句子返回 `[]`。这个空数组就是 L2-18 用来判断「没听懂」的信号。不要在 `nlu` 里直接返回道歉，道歉是对话规则的事，听懂表只负责翻译。

---

## L2-13 两种负反馈怎么说出来

文件：`nlgMapping`

**要做什么。** 加两行：

```typescript
[{ type: "icm", content: "sem*neg" }, "Sorry, I didn't understand."],
[{ type: "icm", content: "con*neg" }, "Are you there?"],
```

**为什么。** `icm` 是交互管理，不是提问也不是回答。`sem*neg` 是语义上没听懂，`con*neg` 是接触上没接上。`nlg` 用 `objectsEqual` 找完全一样的 move。content 字符串有一个字母不一样，就会抛 `Failed to generate move`，测试直接红。

两条 move 一起说时，`nlg` 的最后一行是 `moves.map(generateMove).join(" ")`。所以道歉和重复的问题中间是一个空格。

---

## L2-14 问日子，以及 J440 那句

**要做什么。**

```typescript
[{ type: "ask", content: WHQ("booking_day") }, "Which day?"],
[
  { type: "answer", content: { predicate: "booking_room", argument: "J440" } },
  "The lecture is in J440.",
],
```

G212 那句原来就有。

**为什么。** plan 里问的是 `WHQ("booking_day")`。没有这行，`nlg` 找不到句子，L2-2 在第二句就会抛错，而不是说出 Which day?。查表返回 J440 之后，Select 说出去的 answer move 带的是 `{ predicate: "booking_room", argument: "J440" }`。nlg 表要和这个对象逐字段相等。

---

## L2-15 move 的类型里加上 icm

文件：`sisu/src/types.ts` 的 `OtherMove`

**要做什么。** `type` 从 `"greet" | "request"` 加上 `"icm"`。`content` 保持 `null | string`。

**为什么。** TypeScript 不让你写出 `{ type: "icm", content: "sem*neg" }`，除非类型里有这条。`sem*neg` 和 `con*neg` 都放在 `content` 字符串里，靠它区分两种负反馈。

```typescript
interface OtherMove {
  type: "greet" | "request" | "icm";
  content: null | string;
}
```

---

## L2-16 agenda 上的两种新动作

**要做什么。** `Action["type"]` 加上 `"icm"` 和 `"no_contact"`。

**为什么。** move 是说出口的话，action 是纸条上的待办。听到空 moves，先在 agenda 上插一张 `{ type: "icm" }` 的待办，Select 再把它变成说出口的 `sem*neg`。接触失败用另一张 `{ type: "no_contact" }`。分成两张，是因为 Select 时要说的英文不一样，而且两种情况可能以后要走不同的策略。

```typescript
type Action = {
  type:
    | "greet" | "respond" | "raise" | "findout" | "consultDB"
    | "icm"
    | "no_contact";
  content: null | Question;
};
```

---

## L2-17 同一个问题不要再压进 QUD

文件：`sisu/src/rules.ts` 的 `integrate_sys_ask`

**要做什么。** 系统刚说了一个 ask 时，先看 `qud` 里是不是已经有同一个问题。有了就不要再把它插到最前面。

```typescript
const alreadyThere = is.shared.qud.some((existing) => objectsEqual(existing, q));
if (!alreadyThere) {
  return () => ({
    ...is,
    shared: { ...is.shared, qud: [q, ...is.shared.qud] },
  });
}
```

**为什么。** 道歉之后会把 “Which day?” 再说一遍。原来的规则每听到系统问一次，就往 QUD 顶上再压一层。同一道题压两层之后，用户答一次只能划掉一层，第二层还在，后面的查表和降级都会乱。`objectsEqual` 是按内容比，不能用 `===`，因为每次都是新对象。

规则不适用时什么都不返回。`dme` 的 guard 把「没有返回值」当成这条规则这次不用。

---

## L2-18 空的用户 moves 变成道歉待办

**要做什么。** 新规则 `integrate_not_understood`：

```typescript
integrate_not_understood: ({ is }) => {
  const lu = is.shared.lu;
  if (
    lu &&
    lu.speaker === "usr" &&
    Array.isArray(lu.moves) &&
    lu.moves.length === 0
  ) {
    const icm: Action = { type: "icm", content: null };
    return () => ({
      ...is,
      private: { ...is.private, agenda: [icm, ...is.private.agenda] },
    });
  }
},
```

**为什么。** `nlu` 没听懂时的约定就是空数组。这里只插入待办，不直接写 `next_moves`。说什么是 Select 的工作。插在 agenda 最前面，是因为下一轮 Select 先看 agenda 的第一张。

`lu` 要先判断存在。某些轮次最新一句还没记上，直接读 `lu.speaker` 会崩。

---

## L2-19 QUD 空了就不要划问题

文件：`downdate_qud` 的开头。

**要做什么。**

```typescript
const q = is.shared.qud[0];
if (!q) return;
```

**为什么。** 这条规则原来假设最上面总有一个问题。L2-8 里房间已经说完，QUD 空了，用户又沉默。没有这行，后面的 `resolves` 会拿到 `undefined`。直接 `return`，表示「这次没有问题可划」，后面的规则继续。

---

## L2-20 道歉，并且把没做完的问题再问一遍

**要做什么。** 新规则 `select_icm`。agenda 第一张是 `icm` 时：

1. `next_moves` 先放 `{ type: "icm", content: "sem*neg" }`。
2. 如果 `plan[0]` 是 `findout` 或 `raise`，而且有 content，再追加 `{ type: "ask", content: step.content }`。
3. agenda 去掉第一张。plan 不要动。

```typescript
select_icm: ({ is }) => {
  if (is.private.agenda[0]?.type === "icm") {
    const moves: Move[] = [{ type: "icm", content: "sem*neg" }];
    const step = is.private.plan[0];
    if (step && (step.type === "findout" || step.type === "raise") && step.content) {
      moves.push({ type: "ask", content: step.content });
    }
    return () => ({
      ...is,
      next_moves: [...is.next_moves, ...moves],
      private: { ...is.private, agenda: is.private.agenda.slice(1) },
    });
  }
},
```

**为什么。** L2-4 的最后一句是两句英语拼出来的，所以这里要一次推出两条 move。plan 留着，下一轮 `select_from_plan` 还会把同一个 `findout` 拿出来。用户终于说出 Friday 之后，这个问题被回答，`remove_findout` 才把这一步撕掉，然后问课程。如果在这里把 plan 也 `slice` 掉，L2-5 就走不到 G212。

没有未完成的问题时，plan 顶上不是 findout，就只道歉。这是问候之后第一句 `bla bla` 的情况。

---

## L2-21 没接触上，插一张另一种待办

**要做什么。** `integrate_no_contact`：用户的 moves 里有 `{ type: "icm", content: "con*neg" }` 时，agenda 最前面插入 `{ type: "no_contact", content: null }`。

**为什么。** 测试里的 `"(silence)"` 和浏览器里超时，送进来的都是这个 move。它和空数组不是一回事：空数组是听见了但翻译失败，`con*neg` 是这一轮没有可用的话。分成两条规则，Select 才能说不同的英文。

---

## L2-22 问人在不在，有问题就再问

**要做什么。** `select_no_contact` 和 L2-20 同一形状，只是第一条 move 换成 `{ type: "icm", content: "con*neg" }`。

**为什么。** `nlg` 会把这条说成 “Are you there?”。plan 上还有 findout，就再接那道题，得到 “Are you there? Which day?”。plan 上没有，就只有第一句，这是 L2-6 和 L2-8。agenda 同样只撕掉这一张待办。

---

## L2-23 选句时先试这两种负反馈

文件：`sisu/src/dme.ts`，`SelectMove` 的 `always`。

**要做什么。** 在 `select_ask` 前面加两行：

```typescript
isuTransition("SelectionDone", "select_icm"),
isuTransition("SelectionDone", "select_no_contact"),
isuTransition("SelectionDone", "select_ask"),
```

**为什么。** 规则函数写在 `rules.ts` 里不会自己跑。`isuTransition` 的 guard 是「这个名字的规则这次有没有返回更新函数」。`always` 从上往下试。道歉的待办还在 agenda 顶上时，如果先试 `select_ask`，它可能先把 plan 里的问题单独说出去，道歉就被挤到下一轮，测试期望的「同一句里又道歉又提问」对不上。

`SelectAction` 最后那条无条件去 `SelectMove` 的跳转，是原版为了问候留的，这次不用改。

---

## L2-24 听完之后接住两种失败

文件：`dme.ts` 的 `Integrate`。

**要做什么。** 在 `integrate_greet` 后面、无条件去 `DowndateQUD` 的那条前面，加上：

```typescript
isuTransition("DowndateQUD", "integrate_not_understood"),
isuTransition("DowndateQUD", "integrate_no_contact"),
```

**为什么。** Integrate 也是从上往下，最后一条没有 guard，一定会走。新规则写在它后面，永远轮不到。`integrate_sys_ask` 原来就在列表里，L2-17 只改了函数身体，不用再挂一次。

到这里跑 `yarn test`。L2-2 到 L2-8 应该都绿。后面的 VG-B 是浏览器里的近义句，不在这组字符串测试里。

---

## L2-25 把听懂表灌进 Qdrant

文件：`sisu/src/nlu-qdrant.ts` 的 `seedNlu`

**要做什么。** 集合名叫 `sisu_nlu`。已经存在就删掉重建。向量 `size: 384`，距离 `Cosine`。`nluMapping` 的每一句做成一个 point：向量是这句话的 embedding，payload 是 `{ utterance, move: moves[0] }`。

**为什么。** 精确表只能对上写死的字符串。“where is the lecture” 少一个问号就失败。把已知句子的向量存下来，近义句可以找最近的那条，借用它的 move。删掉重建是为了改表之后不会留下旧句子。维度要和 Lab 1 的 `qwen3-embedding` 一致，因为这里用的是同一个 Ollama。

```typescript
await client.createCollection("sisu_nlu", {
  vectors: { size: 384, distance: "Cosine" },
});
for (const [utterance, moves] of Object.entries(nluMapping)) {
  points.push({
    id: crypto.randomUUID(),
    vector: await embed(utterance),
    payload: { utterance, move: moves[0] },
  });
}
await client.upsert("sisu_nlu", { wait: true, points });
```

`embed` 和 Lab 1 一样：`qwen3-embedding`，`dimensions: 384`。

---

## L2-26 取最接近的那一句

**要做什么。** `retrieveMove(utterance)`：embed 小写后的句子，`limit: 1`。没有命中，或者 `score < 0.7`，返回 `[]`。过了就返回 `[payload.move]`。

**为什么。** 最近的一条不一定相关。“hello there” 也会有一个最近邻。0.7 是一道门槛，挡住胡乱借用别人的 move。返回 `[]` 时，对话会走到 L2-18，系统道歉。这比把一句废话理解成「问房间」安全。

```typescript
const results = await client.query("sisu_nlu", {
  query: await embed(utterance.toLowerCase()),
  limit: 1,
  with_payload: true,
});
const hit = results.points?.[0];
if (!hit || (hit.score ?? 0) < 0.7) return [];
const move = hit.payload?.move as Move | undefined;
return move ? [move] : [];
```

---

## L2-27 先查表，再检索

**要做什么。** `nluWithRetrieval`：

```typescript
export async function nluWithRetrieval(utterance: string): Promise<Move[]> {
  const exact = nlu(utterance);
  if (exact.length > 0) return exact;
  try {
    await ensureNluSeeded();
    return await retrieveMove(utterance);
  } catch (error) {
    console.warn("[VG-B] retrieval failed, using the exact table", error);
    return [];
  }
}
```

**为什么。** 精确表是确定的，向量是近似的。已经写进表的句子不要再冒一次找错近邻的风险。Qdrant 没开时 catch 返回 `[]`，页面退回到「只认精确表，其余道歉」，对话不会白屏。

`ensureNluSeeded` 用一个模块级的 `seeding` promise，整页只灌一次。失败时把 `seeding` 设回 `null`，下次还能再试。

---

## L2-28 这一轮听懂的结果先放进一个 Promise

文件：`sisu/src/isu.ts`

**要做什么。** 模块顶部：

```typescript
let pendingMoves: Promise<Move[]> = Promise.resolve([]);
```

actor：

```typescript
understand: fromPromise(async () => pendingMoves),
```

`Understanding` 状态 invoke 这个 actor。`onDone` 把 `event.output` 当作 moves，用 `SAYS` 送给 `dme`，`speaker` 是 `"usr"`。

**为什么。** `RECOGNISED` 发生的时候检索还没结束，而 XState 的 action 不适合在里面 `await`。所以听到句子时只把 promise 赋给 `pendingMoves`，等监听结束进入 Understanding，再由 `fromPromise` 把这个 promise 等完。对话机收到的仍然是普通的 `SAYS`，它不用知道中间有没有查过 Qdrant。

---

## L2-29 这一轮没人说话

**要做什么。** `reportNoContact`：

```typescript
function reportNoContact() {
  heardThisTurn = true;
  pendingMoves = Promise.resolve([{ type: "icm", content: "con*neg" }]);
  pushChatLine("usr", "(silence)");
}
```

**为什么。** 这和测试里 L2-1 送的是同一个 move，所以同一条 `integrate_no_contact` 两边都能用。`heardThisTurn = true` 是为了这一轮不要在 `LISTEN_COMPLETE` 和 `ASR_NOINPUT` 上各报一次。聊天记录写 `(silence)`，页面上能看见这一轮是空的。

---

## L2-30 新的一轮听之前先清空

**要做什么。** `listen` 这个 action 里，发 `LISTEN` 之前：

```typescript
heardThisTurn = false;
pendingMoves = Promise.resolve([]);
```

**为什么。** 这两个变量在模块顶上，不会跟随机状态机自动复位。上一轮听见过，不重置的话，这一轮静音会被当成「听见了」，L2-29 不会跑，系统会拿着空 moves 去道歉，而不是问 “Are you there?”。

---

## L2-31 听完了，但是这一轮没有字

**要做什么。** 在 `Recognising` 里：

- `LISTEN_COMPLETE` 并且 `!heardThisTurn`：调用 `reportNoContact`，去 `Understanding`。
- 同一事件，`heardThisTurn` 已经是真：直接去 `Understanding`。
- `ASR_NOINPUT` 并且 `!heardThisTurn`：同样 `reportNoContact`，去 `Understanding`。

**为什么。** 有的语音栈用「听结束了」表示静音，有的会另外发 `ASR_NOINPUT`。两条都接到同一个函数，送出去的 move 才一致。`heardThisTurn` 在 L2-29 里会被设成真，所以先到的那条报过之后，后到的那条不会再报一次。

`RECOGNISED` 里要先把 `heardThisTurn = true`，再记录原句。这样后面的 `LISTEN_COMPLETE` 知道这一轮有字。

---

## L2-32 听见的句子交给 VG-B

**要做什么。** 在 `RECOGNISED` 的 actions 里：

```typescript
const utterance = event.type === "RECOGNISED" ? (event.value[0]?.utterance ?? "") : "";
pendingMoves = nluWithRetrieval(utterance);
```

**为什么。** 精确句子在 L2-27 里马上返回。近义句会去 Qdrant。两种情况都是一个 Promise，L2-28 的 Understanding 统一等它。不要在这里 `sendTo` 对话机，因为检索可能还没完，送出去的会是上一轮留下来的空数组。

---

## L2-33 页面一加载就灌听懂表

**要做什么。** 文件底部：

```typescript
void ensureNluSeeded().catch((error) => {
  console.warn("[VG-B] Qdrant seed failed. Near-miss sentences stay on the exact table.", error);
});
```

**为什么。** 灌库要给每条例句算向量，第一句近义句如果才开始灌，用户会等很久。提前灌。失败只打警告，精确表还在，L2-2 那种标准句子仍然能走通。

---

## 一句 “Where is the lecture?” 经过哪些纸条

1. `nlu` 把它变成 `{ type: "ask", content: WHQ("booking_room") }`。
2. `integrate_usr_ask` 把这个问题压上 QUD，agenda 放一张 `respond`。
3. `find_plan` 找到 L2-10 的三步，抄进 plan。
4. Select 取出第一步，说出 “Which day?”。`integrate_sys_ask` 把「问日子」压上 QUD。
5. 用户说 Friday。`integrate_answer` 写出命题「booking_day 是 friday」，放进 `com`，然后这道题被划掉。
6. plan 的下一步问课程。用户说 Dialogue Systems 2，`com` 里多一条「booking_course 是 LT2319」。
7. `consultDB` 读这两条，把「booking_room 是 G212」放进 `bel`。
8. Select 把这条 `bel` 说出来。`nlg` 变成 “The lecture is in G212.”。

中途一句 `bla bla`：moves 是 `[]`，L2-18 插上 `icm`，L2-20 道歉并重复 plan 顶上的问题。plan 还在，所以回答终于来了之后，上面第 5 步照样发生。
