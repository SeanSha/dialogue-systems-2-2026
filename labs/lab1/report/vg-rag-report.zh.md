# Lab 1 VG-RAG 报告：检索应返回几条结果？

**课程：** Dialogue Systems 2  
**作者：** Sean Sha  
**聚焦问题：** *是否应返回不同数量的检索结果（当前限制为 5）？*  
**语料：** `gu_support_all` — 21 篇 GU 页面，**438** 个 chunk；`qwen3-embedding`（384 维，Cosine）

---

## 1. 动机

SpeechState 的 RAG 固定取 **top-5** 写入 system prompt。语音场景既要证据够用，又要避免上下文过长。

知识库来自 **21 篇爬取的 GU Service & Support 页面**。用 LangChain 的 `RecursiveCharacterTextSplitter`（优先按爬虫的 `\n\n\n` 分节，再按 `chunkSize=500` 与 overlap 切细）索引为 Qdrant 中的 **438 个 chunk**。查询时把用户问题做成 embedding，再与这 **438 个 chunk 向量**做 Cosine 检索——对比的不是整篇文章，也**不是「自然句对句」**。这些 chunk 是切分窗口（常含多句片段），因此**不能**假设「一个问题 ↔ 一句标准答案」。由此引出我的假设：**k=1 并不是固定最优常量**；多小的 k 才够用，会受切块、embedding、以及**问题类型**等影响。

**若该假设不成立**，则测试的**每一道题**都应在 **k=1** 时就成功（金标字符串或足够内容已在 top-1）。**若假设成立**，则应看到**不同问题需要不同的 k**——有的 k=1 即可，有的要提到 5 或 10 才够。在切块与 embedding 固定的前提下，本 PoC 在 **三类、各两问** 上对比 **k = 1、5、10**，检验问题类型是否已足以改变「k=1 是否够用」。



---

## 2. 方法

我们比较三种**问题类型**，每类各选 **两个具体问题**（共六道）：

1. **事实型（Factoid）** — 答案应是语料中的明确字符串：  
   - *What is the phone number for Feelgood?*（金标：`031-786 43 22`）  
   - *What is the email for student healthcare?*（金标：`student.goteborg@feelgood.se`）

2. **宽问题（Broad）** — 答案分散在多条要点，而非一行：  
   - *What support does student healthcare offer?*  
   - *What can Servicecenter help me with?*

3. **方法/指南型（How-to）** — 偏流程或说明：  
   - *How should I search for scholarly information?*  
   - *How do I work with sources and references?*

以上 **六道问题各自** 都跑 **三组检索设置：k = 1、k = 5、k = 10**（共 18 次）。切块、embedding 与 collection 固定，只改问题与 `k`。事实型看返回块是否含金标字符串；宽问题与方法型看仅 top-1 是否够用，以及第 2–5 名是否必要、第 6–10 名是否噪声。

工具：`npx tsx src/main.ts queryCollection gu_support_all "<q>" -k <n>`。  
明细表：`labs/lab1/topk-experiment-record.md`。

---

## 3. 主要结果

**一句话对照假设：**  
若 k=1 永远够用，六道题都应在 k=1 通过。**实际不是。**

| | k=1 够用？ | k=5 够用？ | k=10 比 k=5 更有用吗？ |
|--|------------|------------|------------------------|
| A1 Feelgood 电话 | 是 | 是 | 否（多出跑题页） |
| A2 医疗邮箱 | **否** | 是 | 否（更多噪声） |
| B1 医疗支持 | 否 | 是 | 否 |
| B2 Servicecenter | 否 | 是 | 否 |
| C1 学术检索 | 否 | 是 | 否 |
| C2 来源与参考文献 | 勉强 | 是 | 几乎没有 |

因此：**6 题里只有约 1 题能明确靠 k=1；6 题在 k=5 都够用；k=10 没有额外赢面。**

**两个具体例子**
- **A1（电话）：** 金标 `031-786 43 22` 已在第 **1** 名 → k=1 可以。  
- **A2（邮箱）：** 第 1 名没有邮箱；金标 `student.goteborg@feelgood.se` 首次出现在第 **4** 名 → k=1 失败，k=5 成功。

宽问题和方法型问题（B/C）也差不多：**第一条**常常只是开头介绍，真正有用的细节在第 **2–5** 条。把 **k 调到 10** 一般**不会答得更好**，多半只是多抓到一些**跑题页面**。


**例子（B2）**

问题：
```text
What can Servicecenter help me with?
```

实际检索到的 chunk（Qdrant 原文摘录）：

**#1 — score 0.72 — `page-003-Servicecenter.txt`**
> Servicecenter can help you navigate the University of Gothenburg - our buildings as well as our organisation. If you don't know who to contact with a question, contact Servicecenter and we will guide you.

**#2 — score 0.70 — `page-003-Servicecenter.txt`**
> Via Servicecenter, you can get access to some IT support. … We can help you with: Login and access to university tools and software … Access to the university wifi eduroam

**#3 — score 0.68 — `page-003-Servicecenter.txt`**
> Servicecenter can help you with general informations about studying at the University of Gothenburg. We can also help you with contact details to study administration, study counsellors or other university functions …

**#4 — score 0.67 — `page-003-Servicecenter.txt`**
> Servicecenter can help you with key pickup and drop-off. For other questions about your student accommodation, please contact studenthousing@gu.se.

**#5 — score 0.63 — `page-003-Servicecenter.txt`**
> In our for Servicecenters you can buy some University of Gothenburg promotional products such as water bottles, tote bags, notebooks and pens.

**#6（仅 k=10）— score 0.62 — `page-017-Disability study support.txt`**
> Applying for and being granted study support

**k=1** 时模型只能看到导航（#1）。  
**k=5** 时还能看到 IT、学习咨询、钥匙、文创（#2–#5）。  
**k=10** 仍有这些，但会多出像 #6 这样的跑题块。

完整排名：`labs/lab1/topk-experiment-record.md`。

---

## 4. 反思

**并非所有问题都适合 k=1。**  
A1 是答案集中、分数断层明显的情况；A2 说明近义相关块可能压过真正含邮箱的块。B/C 类通常需要**多段同主题**才能支撑一句完整口播回答。

**在目前测过的问题里，k=5 对 broad 类特别有价值。**  
以 Servicecenter（B2）为例：k=5 能多拿到 IT、学习咨询、钥匙、文创等**有用**块，而这些在 k=1 根本看不到。所以就本测试集而言，k=5 不只是系统默认值，也是 broad 问题开始“信息够用”的档位。

**k=10 会开始混进噪声。**  
后面名次常来自其他不相关的 GU 页面。对 **broad** 问题，若之前没测过，一个想法是先用**较高的 k** 多取一些结果，再让 **LLM 做一次 filter**，只留下有用片段。这一步属于 **future work**，还需要额外实验验证；本报告只能说明：直接用原始 k=10 已经会出现噪声。

---

## 5. 结论

在本 PoC 的 **2 个事实型 + 2 个宽问题 + 2 个方法型** 查询上，默认 **k=5** 在不同类型问题上取得了**较好的均衡**：比 k=1 更能覆盖“一条不够”的情况，又比 k=10 更少噪声。这对当前 SpeechState RAG 助手是务实的设定，但**不能当作定论**。尤其是需要**多步信息推理**的问题，仍可能要求不同的检索策略。后续学习可在此基础上继续做 **filter** 与 **re-rank**（例如先取较大 k 再筛选），作为 future work。

---

## 6. 声明

本实验过程中我使用了 AI 工具辅助学习。实验方案与文字表达由我自己思考整理；快速验证实验（例如对比不同 k）以及理解 RAG 流水线的代码逻辑时，借助了 AI 协同，但结论与推理仍由我本人完成。
