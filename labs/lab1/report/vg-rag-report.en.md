# Lab 1 VG-RAG Report: How Many Retrieval Results?

**Course:** Dialogue Systems 2  
**Author:** Maoxuan Sha (Sean) 
**Focus question:** *Should you return a different number of query results (currently limited to 5)?*  
**Corpus:** `gu_support_all` — 21 GU Service & Support pages, **438** chunks; `qwen3-embedding` (384-d, Cosine)

---

## 1. Motivation

Our SpeechState RAG path always retrieves **top-5** chunks and pastes them into the system prompt. For voice answers we want enough evidence without flooding the LLM.

The knowledge base is built from **21 scraped GU Service & Support pages**. Using LangChain’s `RecursiveCharacterTextSplitter` (preferring the scraper’s `\n\n\n` section breaks, then smaller splits with `chunkSize=500` and overlap), those pages were indexed as **438 chunks** in Qdrant. At query time we embed the user question and compare it with a Cosine similarity search over **those 438 chunk embeddings**—not over whole articles, and **not over natural sentence pairs**. The chunks are splitter windows (often multi-sentence fragments), so it is **not** safe to assume “one question ↔ one answer sentence.” That motivates my hypothesis: **k=1 is not a fixed “best” constant.** How small k can safely be should depend on the rest of the system—chunking, the embedding model, and especially the **query type**.

**If that hypothesis were wrong**, we would expect **every** tested question to succeed already at **k=1** (gold string or enough content in the single top chunk). **If it is right**, we should see **different questions needing different k**—some answered at k=1, others only when k rises to 5 or 10. Holding chunking and embeddings fixed, this PoC therefore tests **six queries in three types**, each at **k = 1, 5, 10**, to check whether query type alone already changes whether k=1 is enough.



---

## 2. Method

We compare three **query types**, with **two concrete questions each** (six queries in total):

1. **Factoid** — a short answer that should appear as a clear string in the corpus:  
   - *What is the phone number for Feelgood?* (gold: `031-786 43 22`)  
   - *What is the email for student healthcare?* (gold: `student.goteborg@feelgood.se`)

2. **Broad** — the answer is spread across several helpful points, not one line:  
   - *What support does student healthcare offer?*  
   - *What can Servicecenter help me with?*

3. **How-to / guide** — procedural or explanatory content:  
   - *How should I search for scholarly information?*  
   - *How do I work with sources and references?*

For **every** one of these six questions we run the **same three retrieval settings**: **k = 1, k = 5, and k = 10** (18 runs). Chunking, the embedding model, and the collection stay fixed; only the question and `k` change. Factoids are scored by whether the gold string appears in any returned chunk; broad and how-to questions are scored by whether top-1 alone is enough for a short useful answer, or whether ranks 2–5 (or noise at ranks 6–10) matter.

Tool: `npx tsx src/main.ts queryCollection gu_support_all "<q>" -k <n>`.  
Full tables: `labs/lab1/topk-experiment-record.md`.

---

## 3. Main results

**Bottom line (what the hypothesis predicts):**  
If k=1 were always enough, all six questions would pass at k=1. They do **not**.

| | k=1 enough? | k=5 enough? | Does k=10 help more than k=5? |
|--|-------------|-------------|------------------------------|
| A1 Feelgood phone | Yes | Yes | No (adds off-topic pages) |
| A2 Healthcare email | **No** | Yes | No (more noise) |
| B1 Healthcare support | No | Yes | No |
| B2 Servicecenter | No | Yes | No |
| C1 Scholarly search | No | Yes | No |
| C2 Sources/references | Almost | Yes | Little |

So: **only 1/6 questions clearly works with k=1 alone; 6/6 work with k=5; k=10 does not add useful wins.**

**Two concrete examples**
- **A1 (phone):** the gold number `031-786 43 22` is already in rank **#1**. Here k=1 is fine.
- **A2 (email):** rank #1 has no email. The gold address `student.goteborg@feelgood.se` first appears at rank **#4**. Here k=1 fails; k=5 succeeds.

Broad and how-to questions (B/C) look similar: the **first** chunk is often just a short intro, and the **useful details** show up in chunks **2–5**. If we set **k=10**, we usually do **not** get better answers—we mostly get **extra pages that are off-topic**.


**Example (B2)**

Query:
```text
What can Servicecenter help me with?
```

Actual retrieved chunks (verbatim excerpts from Qdrant):

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

**#6 (only if k=10) — score 0.62 — `page-017-Disability study support.txt`**
> Applying for and being granted study support

With **k=1** the LLM only sees navigation (#1).  
With **k=5** it also gets IT, study info, keys, and the shop (#2–#5).  
With **k=10** it still has those, but also off-topic chunks like #6.

Full rank lists: `labs/lab1/topk-experiment-record.md`.

---

## 4. Reflection

**Not every question suits k=1.**  
A1 is the friendly case (answer concentrated in one high-scoring chunk). A2 shows the opposite: semantic neighbours outrank the exact contact line. Broad/how-to questions (B/C) usually need **several** same-topic chunks to cover a short spoken answer.

**On the questions we tested, k=5 helps especially for broad queries.**  
For broad items like Servicecenter support (B2), k=5 brings in more **useful** chunks (IT, study info, keys, shop) that k=1 never shows. So among our test set, k=5 is not just “the default”—it is where broad questions start to get enough information.

**k=10 starts to add noise.**  
Later ranks often come from other GU pages we do not need. One idea for **broad** questions—if we have not tested that question before—is to retrieve with a **higher k**, then let the **LLM filter** and keep only useful snippets. That second filter step is **future work** and still needs experiments; this report only shows that raw k=10 already mixes in noise.

---

## 5. Conclusion

Across **2 factoid + 2 broad + 2 how-to** queries in this PoC, a default of **k=5** gave a **good balance** across question types: better than k=1 when one chunk is not enough, and cleaner than k=10 when extra hits turn into noise. That is a practical setting for our current SpeechState RAG assistant—but **not a final law**. In particular, questions that need **multi-step reasoning** over several pieces of information may still need different retrieval settings. Follow-up work can build on this baseline by studying **filtering** and **re-ranking** of retrieved chunks (for example after a larger k), which we leave as future learning.

---

## 6. Disclaimer

I used AI tools to support my learning in this lab. The experiment design and the written arguments were planned and organised by me. AI assistance was used for faster experimental checks (e.g. running comparisons) and for helping me understand the coding logic of the RAG pipeline—not to replace my own reasoning about the results.
