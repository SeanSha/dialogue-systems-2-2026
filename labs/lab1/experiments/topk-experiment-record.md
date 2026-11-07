# Top-k Experiment Log (VG-RAG)

**Collection:** `gu_support_all` (21 pages, 438 chunks)  
**Embedding:** `qwen3-embedding`, 384-d, Cosine  
**Date:** 2026-09-24  
**Raw CLI output:** also saved conceptually from `queryCollection -k`

**Judging rules**
- **Type A (factoid):** pass if a retrieved chunk contains the gold string from `labs/lab1/data`.
- **Type B/C (broader):** pass for k=1 only if top-1 alone is enough for a short useful answer; otherwise note which ranks add needed coverage / noise.

---

## Questions

| ID | Type | Query | Gold / success criterion |
|----|------|-------|---------------------------|
| A1 | Factoid | What is the phone number for Feelgood | Contains `031-786 43 22` |
| A2 | Factoid | What is the email for student healthcare | Contains `student.goteborg@feelgood.se` |
| B1 | Broad | What support does student healthcare offer | Lists concrete help topics (stress, ergonomics, …) |
| B2 | Broad | What can Servicecenter help me with | Lists services (navigate, IT, keys, GU card, …) |
| C1 | How-to | How should I search for scholarly information | Search strategies / discovery tools (e.g. Scholar, chain search) |
| C2 | How-to | How do I work with sources and references | Academic sources + how to reference |

---

## Results summary

| ID | k=1 enough? | Best rank of gold / key content | Notes |
|----|-------------|----------------------------------|-------|
| A1 | **Yes** | #1 (0.69) has phone | Classic factoid; k=10 adds Servicecenter/disability noise |
| A2 | **No** | Email first at **#4** (0.67) | Top-1 is Feelgood intro without email |
| B1 | **Partial** | Concrete list at **#4** (0.74) | Top-1 is scope/boundary text, not the “can help with” list |
| B2 | **Partial** | #1 ok intro; fuller list needs **#2–#5** | All top-5 on Servicecenter page; k=10 adds off-topic |
| C1 | **Partial** | Strategies strong from **#2** | #1 discovery services; #2 chain-search strategies |
| C2 | **Mostly yes** | #1 correct page | k=5 adds reference-list detail; still on-topic |

### Pass/fail vs k (for answering the user question)

| ID | k=1 | k=5 | k=10 |
|----|-----|-----|------|
| A1 | OK | OK (+weak 112) | OK + noise |
| A2 | Miss | OK (email in top-5) | OK + more noise |
| B1 | Weak | OK | OK + some other-page noise |
| B2 | Weak/partial | OK | OK + noise |
| C1 | Weak/partial | OK | OK + some noise |
| C2 | OK-ish | Better | Still mostly relevant |

---

## Compact hit table (rank → score → source → snippet cue)

### A1 Feelgood phone
- k=1: #1 0.693 healthcare | email+**031-786 43 22**
- k=5: #5 0.498 healthcare | **112** (weak distractor)
- k=10: #6+ Servicecenter / church / disability (noise)

### A2 Student healthcare email
- k=1: #1 0.736 healthcare | Feelgood company intro (**no email**)
- k=5: #4 0.667 healthcare | **student.goteborg@feelgood.se**
- k=10: #5+ Servicecenter / study admin / library

### B1 Student healthcare support
- k=1: #1 0.793 healthcare | when to use Feelgood / not personal stress (**incomplete**)
- k=5: #4 0.737 healthcare | **“Examples … can help you with: Stress management…”**
- k=10: #8 disability, #9 Servicecenter

### B2 Servicecenter help
- k=1: #1 0.724 Servicecenter | navigate buildings/organisation
- k=5: #2 IT, #3 general info, #4 keys, #5 shop
- k=10: #6 disability, #7 search-process, #10 library

### C1 Search scholarly information
- k=1: #1 0.730 page-008 | discovery services
- k=5: #2 0.727 page-007 | **chain search strategies**; #3 Google Scholar
- k=10: #7/#10 disability-related pages (noise)

### C2 Sources and references
- k=1: #1 0.725 page-009 | what counts as academic sources
- k=5: #4–#5 page-009 | references in body + reference list
- k=10: mostly page-009 + related writing pages

---

## Takeaway for the report

1. **k=1 is not safe for all queries** — even a factoid (A2 email) can rank the gold chunk at #4.  
2. **k=5** recovers gold/key content for all six questions in this set.  
3. **k=10** rarely helps these queries and often injects other GU services (noise for a voice LLM).  
4. Recommendation: keep default **k=5** (or 3–5); do **not** switch globally to k=1; optional score/source filtering if increasing k.
