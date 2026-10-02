# Cronenberg — KYC Phishing Hunter

## Problem Statement

Fraud and trust & safety analysts at small-to-mid fintechs, neobanks, and crypto exchanges have no affordable way to find lookalike sites that impersonate their "verify your identity" flow and harvest customers' ID documents and selfies. They typically learn about these sites only after customers report them or after stolen identities are used to open fraudulent accounts. An ID-plus-selfie pair is worth far more than a password because it can be replayed against real KYC checks, so every day a site stays live compounds the damage.

## Evidence

- Phishing pages that request ID uploads and camera access for "identity verification" are documented by Kaspersky and Cofense (see Research Summary).
- Stolen ID + selfie pairs are used to open accounts (e.g. on crypto exchanges) and pass visual verification (Kaspersky; Biometric Update, Feb 2026).
- Identity data is increasingly targeted: Sept 2026 claim of 160M ID images, selfies and liveness videos exfiltrated from a verification provider (Proof, *The Fraud Files*). Note: a breach, not phishing — shows value of the data, not prevalence of this attack.
- **Assumption – needs validation:** that small fintech fraud teams lack coverage for this. Validate via 3–5 conversations with fraud/T&S practitioners, or LinkedIn/community posts.
- **Assumption – needs validation:** that ID-harvesting pages are a meaningful share of brand-lookalike phishing. Validate in Phase 1 by labeling a sample of OpenPhish/PhishTank entries for target brands.
- **Observation (2026-10-01, Phase 1):** one live OpenPhish community snapshot had 300 URLs; ~20 contained any brand keyword, and fintech brands appeared ~once each. Ground-truth volume for fintech brands may be too low from OpenPhish alone — PhishTank and/or additional feeds likely needed.

## Proposed Solution

A Cloudflare-native, open-source pipeline that watches Certificate Transparency logs for newly certified domains resembling a target brand, deduplicates them against a sharded Bloom filter of already-judged domains, and investigates survivors with Browser Run. Unlike keyword-scoring OSS tools (phishing_catcher, gocatchphish) and Cloudflare's own Brand Protection (lookalike names + logo matching), it judges **intent**: does the page ask for an ID upload, request the camera, or present a multi-step onboarding flow, and where does the form post? Suspicious-but-inactive domains are **re-checked over time** with Workflows so they are caught when they go live. Verdicts come with an evidence pack and are explorable via a chat UI.

## Key Hypothesis

We believe that intent-aware detection (ID-upload / camera / onboarding-flow signals) plus scheduled re-checks of freshly certified lookalike domains will surface ID-harvesting sites earlier than public feeds for small fintech fraud teams.
We'll know we're right when, for a fixed set of monitored brands over a 4-week run, flagged domains that later appear in OpenPhish/PhishTank are flagged a median ≥ 24h earlier, with ≥ 80% precision on a manually labeled sample.

## What We're NOT Building

- Generic lookalike-name or logo matching as the headline feature — Cloudflare Brand Protection already does this.
- Anti-cloaking evasion (residential proxies, fingerprint spoofing) — ethically grey, costly; we measure and report cloaking instead.
- Submitting any data into target forms, uploading files, or granting camera access — observation only.
- Automated takedown submission — we produce the evidence pack; a human files it.
- Email/SMS lure analysis, consumer browser extension, multi-tenant SaaS/billing.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Median lead time vs public feeds | ≥ 24h | Join flagged domains with OpenPhish/PhishTank first-seen timestamps |
| Precision of "ID-harvesting" verdict | ≥ 80% | Manual label of random sample (n ≥ 100, or all if fewer) |
| Cloaking rate observed | Reported (no target) | Share of later-confirmed phish that rendered benign to us |
| LLM verdict quality (offline eval set) | `id_harvest` precision ≥ 0.85, recall ≥ 0.70 | Phase 5 harness on a held-out labeled set of saved page snapshots |
| LLM prompt-injection robustness | 0 verdict flips on the adversarial set | Phase 5 harness: pages with injected "say benign" instructions |
| LLM verdict consistency | ≥ 95% identical labels across 3 runs | Phase 5 harness, same inputs re-run |
| Cost | $0/month (Workers Free); collector on a local machine | Cloudflare usage dashboard stays within Free limits |
| Bloom filter FPR, measured vs theoretical | Within ±20% | Offline test with held-out keys |
| Ingest throughput | TBD – set after Phase 2 spike | Entries processed/day per monitored log |

## Open Questions

- [ ] Timeline — how many weeks? (not yet provided)
- [ ] Which 5–10 brands to monitor for the evaluation run?
- [ ] CT ingest: can a cron Worker keep up with a full Let's Encrypt shard, or do we sample / move to a Container running certstream-server-go?
- [ ] What fraction of confirmed phish will cloak against Browser Run's datacenter IPs? If > 80%, the lead-time hypothesis may be untestable.
- [ ] Text-only Llama 3.3 on DOM features vs a vision model on screenshots — is vision needed for acceptable precision? (Phase 5 harness answers this)
- [ ] LLM eval set: how many labeled page snapshots are achievable (target ≥ 150, ≥ 30 `id_harvest`)? Sources: our own Phase 4 renders, plus saved urlscan.io scans where their terms allow reuse.
- [ ] Running the eval harness uses the same 10k neurons/day Workers AI quota as production. Schedule eval runs, or cap their size.
- [ ] Do real fraud practitioners care about ID-harvesting specifically? (user-research gap)
- [ ] Legal/ToS review for automated visits to suspected phishing sites and storing their screenshots.

---

## Users & Context

**Primary User**
- **Who**: Fraud / trust & safety analyst at a small-to-mid fintech, neobank, or crypto exchange without a Netcraft/ZeroFox budget.
- **Current behavior**: Reacts to customer reports and fraud spikes; manually checks suspicious URLs; files takedowns ad hoc.
- **Trigger**: Spike in synthetic or account-takeover fraud, or a customer reporting a fake "verify your account" message.
- **Success state**: Receives a short list of live ID-harvesting domains with evidence, early enough to file takedowns before mass victimization.

**Job to Be Done**
When a new domain impersonating our brand appears, I want to know whether it is collecting IDs or selfies and whether it is related to other sites, so I can file a takedown before customers upload their documents.

**Non-Users**
- Large enterprises already on commercial brand-protection vendors.
- Consumers checking a single link.
- Anyone seeking offensive tooling.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | CT ingest (cron Worker polling CT log HTTP APIs → Queue) | The source of new domains |
| Must | Candidate scoring: punycode decode, Unicode TR39 skeleton, edit distance, brand-in-subdomain | Cheap filter; Browser Run budget covers only thousands of renders/month |
| Must | Sharded "already judged" Bloom filter across Durable Objects, routed by rendezvous hashing, with D1 exact confirm | Dedup at CT volume; core learning goal; FP-safe design |
| Must | Investigation Workflow: Browser Run render (desktop + mobile), instrumented to log `getUserMedia` / file inputs / form action, Llama 3.3 verdict, evidence to R2 | The differentiator: intent detection |
| Must | Scheduled re-checks (+1h, +1d, +7d) via Workflow `step.sleep` | Catch pre-weaponization domains |
| Must | Chat UI (Pages + Agents SDK): "what's new for brand X?", "why was Y flagged?" | Required user-input surface; state in DO/D1 |
| Must | Evaluation harness: OpenPhish/PhishTank ingest + lead-time and precision report | Without this there's no resume-grade result |
| Must | LLM evaluation harness: labeled snapshot set, per-class precision/recall, model comparison, prompt-regression gate, consistency, prompt-injection set | The verdict is the product's core judgment; prompt/model changes need a pass/fail bar |
| Should | Campaign clustering via DOM-structure SimHash (block-permutation near-dup index) | Kit attribution; strong differentiator |
| Should | Takedown-ready evidence pack (Markdown/PDF) | Makes output actionable |
| Could | Vision-model screenshot comparison to the real brand page | Only if text-based precision is poor |
| Could | Rotating Bloom filters for time-windowed "judged" state | Learning value; re-checks may cover need |
| Won't | Anti-cloaking evasion, form submission, auto-takedown | Ethics / scope |

### MVP Scope

One CT log shard + 5 brands → scoring → Bloom dedup (≥ 2 shards) → Browser Run investigation with intent signals and LLM verdict → re-checks → results table in D1 → minimal chat UI → lead-time/precision report after a 2-week run.

### User Flow

1. Analyst configures brand(s) and the legitimate domains.
2. The system ingests CT continuously, scores, dedups, and investigates.
3. Analyst asks in chat: "Anything new for BrandX?" → gets flagged domains with verdict, signals (ID upload, camera, form target), screenshot link.
4. Analyst opens the evidence pack and files a takedown.

---

## Technical Approach

**Feasibility**: MEDIUM — every component exists on Cloudflare (Workers, Queues, DOs, D1, R2, Workflows, Browser Run, Workers AI, Pages); the risks are CT volume on Workers and cloaking.

**Architecture Notes**
- Ingest via CT log HTTP APIs (RFC 6962 `get-entries` and Static CT/tiled logs) from a cron Worker; avoids depending on the unreliable public CertStream. Fallback: self-hosted certstream-server-go in a Cloudflare Container.
- Queues decouple ingest from scoring for backpressure.
- Bloom shards are Durable Objects (SQLite-backed storage for the bit array); the shard for a domain is chosen by rendezvous hashing over a fixed shard list so adding a shard remaps ~1/N keys. A Bloom "maybe" is always confirmed in D1 before skipping a domain (false positives must never suppress investigation).
- Browser Run page instrumented via an init script that wraps `navigator.mediaDevices.getUserMedia` and records file inputs and form actions without granting anything.
- LLM receives page content as quoted data with a strict JSON output schema and no tools (phishing pages may contain prompt injection).
- One Workflow instance per candidate domain: investigate → sleep → re-investigate.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cloaking hides phish from Browser Run (literature: ~96% of kits use cloaking) | H | Measure and report; mobile UA + desktop; re-checks; don't claim to beat it |
| CT volume exceeds Worker CPU/subrequest limits | M | Start with one shard; batch via Queues; Container fallback |
| Browser Run budget exhausted | M | Aggressive scoring threshold; dedup; cap renders/day |
| LLM verdict prompt-injected by page content | M | Data-only prompt, JSON schema, deterministic signals take precedence; adversarial set in the Phase 5 harness |
| Eval set too small or leaks into prompt design | M | Fixed held-out split set before prompt tuning; report sample sizes and confidence intervals |
| Low base rate → too few true positives to evaluate in 2–4 weeks | M | Choose frequently-phished brands; extend run; also backtest on feed URLs |
| Legal/ToS concerns | L | Observation only, rate limits, no data submission |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundation & ground truth | Wrangler project, D1 schema, brand config, OpenPhish/PhishTank ingest | in-progress (code done; deploy + labeling pending) | - | - | [plan](../plans/foundation-ground-truth.plan.md), [report](../reports/foundation-ground-truth-report.md) |
| 2 | CT collector & scoring | External collector: CT log reader + normalization + lookalike scoring → HMAC-authenticated Worker ingest endpoint | pending | with 3 | 1 | - |
| 3 | Sharded Bloom filter | Bloom shards in the collector (rendezvous routing, persisted to disk), D1 confirm, FPR tests | pending | with 2 | 1 | - |
| 4 | Investigation Workflow | Browser Run + intent instrumentation + LLM verdict + R2 evidence + re-checks | pending | - | 2, 3 | - |
| 5 | LLM evaluation harness | Labeled snapshot set, offline eval runner, metrics + prompt-regression gate, injection set | pending | with 6, 7 | 4 | - |
| 6 | Chat UI & evidence pack | Pages + Agents SDK chat over results; evidence export | pending | with 5, 7 | 4 | - |
| 7 | Campaign clustering | DOM SimHash + block-permutation index | pending | with 5, 6 | 4 | - |
| 8 | Evaluation run & write-up | 2–4 week run, lead-time/precision/cloaking report, LLM eval results, README | pending | - | 4, 5, 6 | - |

### Phase Details

**Phase 1: Foundation & ground truth**
- **Goal**: Project skeleton and a ground-truth dataset before any detection exists.
- **Scope**: Wrangler project, D1 migrations (brands, feed_entries, labels, ingest_runs — `candidates`/`verdicts` deferred to Phases 2/4), feed ingestion cron, labeling of a sample of feed entries for ID-harvesting.
- **Success signal**: Feeds ingesting daily; base rate of ID-harvesting pages for chosen brands known.

**Phase 2: CT ingest & scoring**
- **Goal**: Turn CT entries into scored candidates.
- **Scope**: CT HTTP poller with checkpointing, Queue consumer, punycode/TR39 skeleton, edit-distance and subdomain scoring, unit tests.
- **Success signal**: Sustained ingest of one shard; candidates/day within Browser Run budget.

**Phase 3: Sharded Bloom filter**
- **Goal**: FP-safe "already judged" dedup at scale.
- **Scope**: Bloom DO (Kirsch–Mitzenmacher double hashing), rendezvous router, D1 exact confirm, resharding test, FPR benchmark.
- **Success signal**: Measured FPR within ±20% of theory; adding a shard remaps ≈ 1/N keys.

**Phase 4: Investigation Workflow**
- **Goal**: Intent-aware verdicts with re-checks.
- **Scope**: Workflow per candidate, Browser Run render (desktop/mobile), init-script instrumentation, Llama 3.3 JSON verdict, screenshots/HTML to R2, +1h/+1d/+7d re-checks.
- **Success signal**: End-to-end verdict on a known live phish URL from the feeds.
- **Feeds Phase 5**: every investigation stores a **page snapshot** (visible text, deterministic signals, screenshot, R2 keys) with a stable id, so verdicts can be re-run offline without revisiting the site.

**Phase 5: LLM evaluation harness**
- **Goal**: Measure and protect the quality of the LLM verdict, the product's core judgment.
- **Scope**:
  - *Dataset*: page snapshots from Phase 4 (and saved urlscan.io scans where reuse is allowed), labeled with the Phase 1 label set; fixed train/held-out split created **before** prompt tuning.
  - *Runner*: offline script that replays snapshots through the verdict function and stores results per (model, prompt version).
  - *Metrics*: per-class precision/recall/F1 (focus `id_harvest`), confusion matrix, calibration (confidence vs accuracy), consistency across 3 runs, neurons and latency per verdict.
  - *Model comparison*: small model vs Llama 3.3 70B → pick the default under the 10k neurons/day Free budget.
  - *Adversarial set*: snapshots with injected instructions (hidden text, comments, alt text) telling the model to answer "benign"; deterministic signals must override.
  - *Reason grounding*: spot-check that each cited reason appears in the snapshot.
  - *Regression gate*: prompt/model changes must not reduce held-out `id_harvest` F1 or add injection flips.
- **Success signal**: Report with the metrics above on the held-out set; the gate blocks a deliberately bad prompt.

**Phase 6: Chat UI & evidence pack**
- **Goal**: Analyst-facing surface.
- **Scope**: Pages frontend, Agents SDK agent with tools over D1/R2, evidence-pack export.
- **Success signal**: "What's new for BrandX?" returns correct, cited results.

**Phase 7: Campaign clustering**
- **Goal**: Group domains by phishing kit.
- **Scope**: DOM-structure SimHash, 4×16-bit block index, cluster view.
- **Success signal**: Known same-kit domains from feeds cluster together.

**Phase 8: Evaluation run & write-up**
- **Goal**: Resume-grade numbers.
- **Scope**: Fixed-brand run, metrics report (system-level and LLM-level from Phase 5), README with architecture diagram and honest limitations.
- **Success signal**: Report with lead time, precision, cloaking rate, LLM eval results, cost.

### Parallelism Notes

Phases 2 and 3 are independent (scoring vs dedup data structure) and meet in Phase 4. Phases 5, 6 and 7 all consume Phase 4 output and don't touch each other. Phase 5 needs labeled snapshots, so start labeling as soon as Phase 4 produces them.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Differentiator | ID-harvesting intent + re-checks | Lookalike names, logo matching | Cloudflare Brand Protection already covers names/logos |
| Plan tier | Workers Free | Workers Paid ($5/mo) | Owner constraint (2026-10-01): deploy as free as possible. See `docs/deployment-plan.md` |
| CT source | External collector (off Cloudflare) reads CT logs, filters, sends candidates to an authenticated Worker endpoint | Cron Worker polling (infeasible on Free: 10 ms CPU, 100k req/day); crt.sh keyword search (misses homoglyphs); GitHub Actions host (barred by GitHub terms for serverless use) | Only option that handles CT volume on Free; host TBD (own machine / free VM / small VPS) |
| Dedup structure | Sharded Bloom + D1 confirm | D1 only, KV only | Volume + learning goal; D1 confirm keeps it FP-safe |
| Shard routing | Rendezvous hashing | Ring consistent hashing, jump hash, `idFromName` per key | Simplest for small N; minimal remap on resize |
| LLM | Llama 3.3 on Workers AI | External LLM | Platform requirement; cost |
| LLM evaluation | Dedicated harness phase (5) on saved page snapshots, with a regression gate | Rely on end-to-end precision only | End-to-end precision can't tell model errors from scoring/cloaking errors, and doesn't catch prompt regressions |
| Cloaking | Measure, don't evade | Residential proxies | Ethics, cost, scope |

---

## Research Summary

**Market Context**
- Cloudflare Brand Protection: confusable-domain alerts and computer-vision logo matching with adjustable thresholds (2026 changelogs). https://developers.cloudflare.com/security-center/brand-protection
- OSS: phishing_catcher, gocatchphish, openSquat, dnstwist — keyword/permutation scoring, no intent analysis. https://phish.report/blog/phishing-catcher
- ID + selfie phishing: https://www.kaspersky.com/blog/selfie-with-id-card-scam/27926/ , https://cofense.com/blog/the-dangerous-blend-of-phishing-for-government-ids-and-facial-recognition-video
- Verification-layer targeting, Sept 2026: https://www.proof.com/blog/the-fraud-files-when-the-verification-layer-became-the-target-september-2026

**Technical Context**
- Cloaking prevalence and taxonomy: CrawlPhish (S&P 2021) https://kapravelos.com/publications/crawlphish-sp21.pdf ; PhishPrint (USENIX Sec 2021) https://www.usenix.org/conference/usenixsecurity21/presentation/acharya ; Blacksite/Cloaked.gg https://abnormal.ai/blog/blacksite-aitm-phishing-kit-cloaked-gg
- Prior art for LLM-driven crawling: PhishParrot https://arxiv.org/pdf/2508.02035
- CT streaming alternatives: certstream-server-go https://github.com/d-Rickyy-b/certstream-server-go
- Browser Run (renamed from Browser Rendering, Apr 2026); Paid plan: 10 browser-hours included, $2/h after; free: 3 concurrent. https://developers.cloudflare.com/changelog/post/2026-08-20-limits-increase/
- Algorithms: Bloom (1970); Kirsch & Mitzenmacher (2006); Thaler & Ravishankar (1998) rendezvous hashing; Charikar (2002) SimHash; Manku et al. (2007) near-duplicate blocks; Unicode TR39.

---

*Generated: 2026-10-01*
*Status: DRAFT - needs validation*
