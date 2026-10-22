<!-- Research report, 2026-10-22. Produced by a learning-experience review agent for the v3 plan (docs/plan-v3.md). Walkthrough done against commit 47c5573 at 1440x900 and 390x844. Nothing here is implemented yet; the plan decides what ships and when. -->

# System Lab: how the best explainers teach, a first-time-learner audit, and a v3 concept-delivery system

Research and proposal only. No repository file was modified. Screenshots are in `/private/tmp/claude-501/-Users-mackie-Codes--Tester-Ai-system-lab/fd692202-855c-4c34-88dc-c966933ecc45/scratchpad/shots-pedagogy/` and the raw text dump of every captured state (captions, node labels, metric tables, panel overflow) is in `/private/tmp/claude-501/-Users-mackie-Codes--Tester-Ai-system-lab/fd692202-855c-4c34-88dc-c966933ecc45/scratchpad/audit-dump.json`.

**Method note.** The Playwright MCP browser turned out to be shared with other agents during this session (tabs were navigated out from under me mid-sequence; two of those stray captures are kept as `00-health-checks-…` and `00b-capstone-…`). The lesson walkthrough was therefore done with a scripted, isolated Playwright run against the same dev server (`http://localhost:3100`) using the repo's installed Playwright and the local Chrome: four lessons × two viewports (1440×900 and 390×844 with touch emulation), problem → scripted note → fault → fix → fault → recap → Key, 32 captured states, 44 screenshots. `npm run tune` was used to confirm what the numbers do over a full simulated minute.

---

## 1. How the references do it

For each: the concrete mechanisms (not adjectives), then which transfer to a one-screen live simulation.

### samwho.dev: Load Balancing, Queueing, Retries, Memory Allocation
Sources: https://samwho.dev/load-balancing/ · https://samwho.dev/queueing/ · https://encore.dev/blog/retries (Sam Rose's retries piece lives on the Encore blog) · https://samwho.dev/memory-allocation/

1. **The vocabulary is taught before it is used, by one figure that does nothing else.** Load Balancing opens with one server, one stream of dots, and the text states the rules ("a server drops a request that arrives while it is busy", "a request is dropped when its queue is full"). Retries opens with a bulleted list of the parts, then explains the drawing: failed requests have "spiked edges", a waiting client shows "a circular timer". Memory Allocation establishes the grid/dark-square notation before any allocator logic.
2. **Add exactly one variable per figure, and each figure exposes the previous fix's weakness.** Queueing: no buffer → FIFO → FIFO with timeouts → LIFO → priority → AQM. Retries: one client → tight-loop retry → more clients → fixed delay → exponential backoff → jitter.
3. **The prose tells you what to look at and what to do, in the imperative.** "Goals" boxes ("click the button to send a request… click rapidly to force a drop"), "watch for", "notice that", "does anything stand out", "Set the failure rate up to 100%", "When you're ready, switch from 0% to 100%". The reader is cast as the traffic source.
4. **Breakage is staged by the reader at a known moment, then the author pre-empts the obvious question.** In Retries the storm is triggered by the reader flipping failure to 100%, a server "explodes", and the text warns that setting it back to 0% "may not help". Queueing asks "why are timed-out requests still served?" and answers it. Comparisons run identical parameters for a fixed 60 s and are shown as percentile bars, with the text explaining how to read a percentile.

Transfer to one screen: 1, 3 and 4 transfer directly (a build phase, imperative beats, learner-triggered break with the "it won't come back" moment). 2 transfers as "one new node or one new rule per step", not as a scroll of figures.

### Bartosz Ciechanowski: Mechanical Watch
Source: https://ciechanow.ski/mechanical-watch/

1. **One subsystem at a time, added to a working whole** (mainspring → gear train → escapement → balance), then everything is assembled onto the mainplate at the end.
2. **Hide what is not being discussed.** Unrelated parts are removed, covers taken off, a hole cut in the barrel so you can see inside.
3. **Pointing is explicit and typed:** grey arrows mark features, red arrows show force/rotation, blue arrows show pushing; part names are colour-coded to their part; the active gear pair is highlighted when discussed.
4. **Pace belongs to the reader:** animations run by default but there is a global pause, time can be scrubbed, and buttons step through discrete states (pallet fork positions).

Transfer: 2 and 3 are the spotlight/dim and the typed callout arrow this report proposes; 1 is "nodes enter one by one"; 4 is "beats can pause and be re-stepped".

### The Secret Lives of Data: Raft
Sources: https://thesecretlivesofdata.com/raft/ and its source frames (https://github.com/benbjohnson/thesecretlivesofdata, `raft/scripts/frames/intro.js`, `overview.js`, `election.js`)

1. **A slide is one sentence plus one state change.** The frame scripts are literally `subtitle("…")` then `node.state = …` or `send(a → b)`. Twenty-four steps carry the whole overview. Most sentences are under 15 words.
2. **The learner advances every step.** Nearly every frame ends with `wait()` (controls shown, timeline halted until the user continues). Nothing runs away from you.
3. **Show, then name.** The log entry appears on node a (step 15) before the word "log" is used (step 16); "This process is called Leader Election" comes after an election has been watched. (States are the exception: follower/candidate/leader are named as node b flips through them.)
4. **Failures are scripted at a sentence boundary:** "Let's stop the leader and watch a re-election happen", then the leader is stopped and the next caption is filled from live state ("Node B is now leader of term 2").

Transfer: all four. This is the closest model for "beats": short, learner-advanced, one state change each, with captions that read the live simulation.

### Red Blob Games: Introduction to A*
Sources: https://www.redblobgames.com/pathfinding/a-star/introduction.html · Amit Patel's design notes https://www.redblobgames.com/x/2306-educ432/

1. **Each algorithm differs from the previous by one or two lines**, and the sequence BFS → early exit → Dijkstra → Greedy → A* is the lesson.
2. **Side-by-side panels for the same input** (BFS vs Dijkstra; Dijkstra, Greedy, A* together) with a "Compare" call-out before them, and a counterexample right after the enthusiasm ("Wow!! Amazing, right?" → a harder map where Greedy fails).
3. **Diagrams are guided, not open sandboxes:** drag the goal, step the frontier, open a hole in the wall. Amit's notes: diagrams "guide readers through main concepts, rather than open-ended simulations"; only 10–15% of readers interact, so the explanation must work without interaction; learner-controlled animations beat system-controlled ones "even when learners didn't use the controls".
4. **Pitfalls he names:** labelling is hard because readers split attention between text and diagram; readers "may play around without understanding".

Transfer: 2 is already the Without/With table, but the "counterexample after the win" is missing; 3 says beats must carry the lesson for the majority who never touch a knob; 4 is the argument for putting the words on the stage, next to the thing.

### Nicky Case: The Evolution of Trust, Parable of the Polygons
Sources: https://ncase.me/trust/ (script at https://github.com/ncase/trust `words.html`) · https://ncase.me/polygons/ · https://blog.ncase.me/explorable-explanations/

1. **Bet before you see.** Trust asks four times, before a tournament runs: "Who do you think will get the highest total score?", "Who do you think will win now?". Polygons has you drag unhappy shapes yourself before any theory.
2. **The rule is shown, then stated in the character's voice, then generalised in bold.** Polygons: "I wanna move if less than 1/3 of my neighbors are like me" → watch → "Small individual bias can lead to large collective bias."
3. **One forward button, one idea per screen, a three-point ending.** Trust closes on exactly three conditions (repeat interactions, possible win-wins, low miscommunication), then a sandbox.
4. From his design post: start with a **hook** that needs no prior knowledge; "start small, build big" (teach each mechanic alone, then combine); embed "homework problems"; use **cognitive gates** so you can't reach a part you lack prerequisites for; playtest with real people because testers "skimmed and got confused".

Transfer: 1 is the predict stage; 2 is the "show → say it plainly → name it" rule for copy; 3 is already the shape of System Lab's dock and takeaways; 4's gating is the learning-path idea.

### Brilliant.org
Sources: https://brilliant.org/ (public positioning) and third-party description https://skillscouter.com/brilliant-review-math-science-coding/ (the official "About Brilliant lessons" Notion page did not render for fetching)

1. **One interaction per screen with immediate, explained feedback;** wrong answers get a why, not just a cross.
2. **Lessons framed as "own a discovery, no matter how small"** (their learning-designer materials): the learner is led to the rule, then told its name.
3. Bite-size sequencing by concept and adaptive practice.

Transfer: 1 and 2 are the check-yourself and predict stages, with a one-line "why" on every answer.

### Distill.pub: Communicating with Interactive Articles
Source: https://distill.pub/2020/communicating-with-interactive-articles/

1. **Prompting self-reflection works:** predictions and low-stakes quizzes improve recall, "especially with feedback" (NYT "You Draw It", Quantum Country). Showing other people's predictions did not clearly help.
2. **Details on demand reduces load:** keep the overview visible, hide detail until requested (tooltips, hover-linked equations, expandable text).
3. **Segment into small parts so readers pace themselves;** comprehension was better in slideshow layouts than scrollytelling in the studies they cite.
4. Caution: "not everything needs to be interactive, and unused interactivity wastes effort"; accessibility needs text alternatives.

Transfer: 1 → predict and check; 2 → inline metric explainers and glossary; 3 → beats as segments.

### Bret Victor: Explorable Explanations, Up and Down the Ladder of Abstraction
Sources: http://worrydream.com/ExplorableExplanations/ · http://worrydream.com/LadderOfAbstraction/

1. **The text must read normally without interaction;** interaction is for going deeper. "Dumping readers into a sandbox with no guidance is not an explanation."
2. **Contextual information in place:** look a term up without leaving the page, so you don't lose your place.
3. **Ladder of abstraction:** start concrete (one case, control time directly), step up (a trail shows all moments at once; overlay runs across a parameter), step down again to explain a pattern by touching one point on the trail. Insight comes from the transitions.

Transfer: 1 is the standard for beats; 2 is the glossary; 3 maps exactly onto "follow one request" (concrete) ↔ sparkline/table (abstract over time) ↔ tapping a metric to see the current number read as a sentence (stepping down).

### ByteByteGo
Source: https://bytebytego.com/guides ("Succinct graphical explanations"), third-party description https://medium.com/javarevisited/how-bytebytego-makes-system-design-easy-for-visual-learners-5196ba31bec3

1. **One static diagram per concept**, numbered steps around it, the same component icons reused across hundreds of guides so recognition compounds.
2. Progressive refinement of the same architecture diagram across a case study.

Transfer: 1's "numbered steps around the diagram" is the build phase; the consistent icon vocabulary is something System Lab already has (and should protect).

### Hello Interview
Sources: https://www.hellointerview.com/learn/system-design/core-concepts/caching · https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery

1. **Opens with the moment you would need the idea** (an interviewer expecting caching on a read-heavy workload), then grounds it in two numbers (Postgres ~50 ms vs Redis ~1 ms).
2. **Term named formally with its alias** ("Cache-Aside (Lazy Loading)", "Cache Stampede (Thundering Herd)"), each pattern followed by a one-line "when to use".
3. Light checks ("Test Your Knowledge"), a quick-reference sheet, and a five-step script for introducing the idea in an interview.

Transfer: 1 is the hook; 2 is how the glossary should name things (plain name, then the alias people will meet in the wild); 3 is the "Seen in"/"Say it in an interview" line for the advanced path.

### Julia Evans' zines
Sources: https://jvns.ca/blog/2016/08/29/how-i-made-a-zine/ · https://egghead.io/podcasts/exploring-concepts-and-teaching-using-focused-zines-with-julia-evans

1. **Narrow scope on purpose:** each zine "breaks down something very particular"; specificity "respects people's time".
2. **One panel = one idea, in plain words and stick figures;** companion sites because "you can't really learn about computers without trying things".

Transfer: the beat word budget and the rule "one thing per beat".

### 3Blue1Brown
Sources: https://www.3blue1brown.com/faq/ · https://www.stanforddaily.com/2020/01/24/3blue1brown-creator-grant-sanderson-15-talks-engaging-with-math-using-stories-and-visuals

1. **"Concrete before abstract. Give examples before general frameworks."** and **"Never start with definitions"**: definitions are an ending point.
2. **"Every movement on the screen should be deliberate, with an identifiable purpose"**, reinforcing the narration rather than competing with it.
3. "When we put the visuals first, then start to articulate the meaning, you can get a sense of ownership."

Transfer: 1 is the term-naming rule; 2 is the test every beat and every stage effect must pass.

### Learning-science basis (what the mechanisms above are instances of)

- **Mayer's multimedia principles** (summary PDF: https://ugc.futurelearn.com/uploads/files/7d/d6/7dd6188d-c343-4311-b064-ac98d2c95abc/Multimedia_Principles._R._E._Mayer__2020.pdf; handbook chapter on segmenting/pretraining: https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning-segmenting-pretraining-and-modality-principles/DD24C2F48B9B1277CE59F78276110258). **Signalling** (cues that show what matters), **segmenting** (user-paced pieces beat a continuous unit), **pre-training** (know the names and characteristics of the parts before the lesson), **coherence** (leave extraneous material out), **temporal contiguity** (words and the picture they describe at the same time, not before or after). A fast, continuous narrated animation of complex material produces "essential overload".
- **Why animations often fail to teach** (Tversky, Morrison & Bétrancourt 2002, https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf): the **apprehension** principle, animations are "too complex or too fast to be accurately perceived", and people conceive continuous events as discrete steps anyway; interactivity (control of pace, stepping) is the proposed remedy.
- **Transient information effect** (Educational Psychology Review 2010, https://link.springer.com/doi/10.1007/s10648-010-9135-6; Routledge chapter https://www.taylorfrancis.com/chapters/edit/10.4324/9780429283895-15/): information in an animation disappears before it is processed, and "may be missed completely if it is not attended to at the right moment". Remedies with evidence: **cueing** at the right moment and **segmenting**, which "slows the pace of presentation". Mayer & Chandler (2001) found a segmented lightning animation beat the continuous one on transfer; Spanjers et al. (https://repub.eur.nl/pub/21321/29102010-9.pdf) found segmentation helps low-prior-knowledge learners and not experts (expertise reversal), which is the argument for difficulty levels.
- **Attention cueing in animations** (De Koning, Tabbers, Rikers & Paas 2009, https://link.springer.com/article/10.1007/s10648-009-9098-7): **selection** cues (point at the location) reliably help; cues for organisation and relations need the cue itself to be dynamic or verbal ("the dot you are watching is now…"), not a static highlight borrowed from print.
- **Predict–Observe–Explain** (White & Gunstone; e.g. https://ulspace.ul.ac.za/items/7cde52e8-1449-4f32-8086-5d59a7087d46/full): committing to a prediction before the demonstration surfaces misconceptions and improves conceptual change versus watching alone. Evidence is many small studies, consistently positive.
- **Worked examples and fading** (Atkinson, Derry, Renkl & Wortham 2000, https://repositories.cdlib.org/content/qt27j4x4r8/qt27j4x4r8.pdf; handbook chapter https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/workedout-examples-principle-in-multimedia-learning/5A8A07C14A2911C49982D19950EF5307): novices learn more from a fully worked example than from solving; fade the support step by step; self-explanation prompts ("why did that help?") are what make the example stick, and most learners don't self-explain unless prompted.
- **Retrieval practice and desirable difficulties** (Bjork; https://en.wikipedia.org/wiki/Desirable_difficulty; load caveat https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.01483/full): a short recall question beats re-reading; feedback must come; difficulty backfires when working memory is already full, so the check comes after the scene, not during it.

**What this means for System Lab, in one table**

| Mechanism | Evidence | In System Lab today |
|---|---|---|
| Pre-train the parts and the dot vocabulary before the scene runs | Mayer pre-training; samwho; Memory Allocation | Missing. The Key is a popover listing all 8 dot kinds for every lesson; nodes appear all at once |
| Segment: learner-paced steps, one state change each | Mayer segmenting; Raft; transient-information remedies | Partly: 3 tabs. Inside a tab the sim runs continuously for 30–70 s with nothing to step through |
| Cue: point at the exact thing at the exact moment | De Koning; Ciechanowski arrows; Mayer signalling | Missing. Scripted notes are a centred pill that names nothing on stage |
| Imperative text: "watch", "count", "set X to" | samwho; Red Blob; Polygons | Missing. Captions describe outcomes in the past/present tense |
| Predict before the break | POE; Trust; Distill (You Draw It) | Missing |
| Learner triggers the break at a known moment | samwho Retries; Raft ("Let's stop the leader") | Half: fault buttons exist, but the scripted loop also fires on its own and fights the button |
| Compare on the same input, then a counterexample | Red Blob; samwho 60 s comparisons | Table exists; its verdict colouring is wrong for explore/trade-off figures (see audit) |
| Show, then say plainly, then name | Raft; Polygons; 3Blue1Brown | Mixed: "p95", "leader/follower", "hash % N", "jitter", "retry budget" appear before being shown |
| Check with feedback | Brilliant; Distill; retrieval practice | Missing |
| Details on demand (term lookup, metric meaning) | Victor; Distill | Only `title` tooltips, invisible on touch |
| Difficulty by prior knowledge | Spanjers expertise reversal; Case's gates | Missing |

---

## 2. First-time learner audit of System Lab today

Viewing as someone who knows what a website is, has heard "server" and "database", and has never seen a queueing diagram.

### What I look at first (all lessons)
Desktop: the eye lands on the dark **Users** disc (largest, highest contrast), then the moving dots, then the big **Next** button. The **why** sentence is top-right in small type; the caption is below a tab strip whose names ("Rising traffic", "More workers") don't say what the step is for. The metric table is the last thing seen and the hardest to read (three columns of numbers, two of them for a world you can't see).
Phone: the stage takes 371 px, nodes stacked vertically with labels to the right. The table is **below the fold on every lesson** (panel overflow 125–282 px in every captured phone state; `audit-dump.json`), so a learner who only taps Next never sees a number. Evidence: `latency-and-throughput--phone--1-problem.png` (table cut at its first row), `caching--phone--2-fix.png`, `retries-and-backoff--phone--2-fix.png`.

### F1 Latency & throughput (`latency-and-throughput--desktop--1-problem.png`, `--2-fix.png`, phone equivalents)
- **The scene is calm when I arrive and the caption promises drama.** At 3.5 s the stage shows Users 20 req/s, Server 0/4 busy, two dots on the wire. The caption says "the line … grows much faster than the traffic does", but the wave period is 3600 ms simulated = 36 s real at 10× slow motion. Nothing tells me when to look, so I switch tabs before the peak.
- **Two numbers that don't add up.** Users says "20 req/s", the table says "Answered 4/s". A newcomer asks where the other 16 went. (It is the 1000 ms sliding window on a rising wave; nobody says so.)
- **The Change column lies in this lesson.** Step 2 is an "explore" figure with fixed 26/s traffic, not a fix; the table still prints a verdict: "Server busy 27% → 91% ▲ worse by 232%", "Answered 4/s → 17/s ▲ better by 307%" (problem view), and later "Answered 36/s → 26/s ▼ worse by 29%" in red (explore view). The second world answers fewer because it is sent fewer. Red/green here teaches something false.
- **"294 ms": is that good?** No target is ever shown. The engine has a 400 ms latency target (`kit.ts` `sloMs: 400`) and amber dots mean "past the latency target" (Key), but the number is never on screen.
- **The explore figure asks me to do arithmetic.** "Four workers, each taking about 120 ms, can finish roughly 33 requests a second" is the lesson, and it is in the caption, not on the stage. There is no capacity line, no "33/s" on the server.
- **Jargon before it is shown:** "p95" (only in the tooltip), "workers" (the Key calls them sockets; the caption calls them workers; the stage shows four grey circles with no label).
- **Missed opportunity:** this is the one lesson where "follow one request" would make the whole idea land (it waits, it is served for 120 ms, it comes back; total = wait + service).

### C1 Caching (`caching--desktop--1-problem.png`, `--2-fix.png`, `--4-key-open.png`, phone)
- **The problem is invisible unless you look at the right place.** "Database [9 waiting]" is a tiny sub-label; the dots lining up are small. No cue says "look at the line in front of Database".
- **The caption refers to an effect that lasts a quarter of a second.** "A hit (green ring) … A miss (amber ring)" are clock-wipe rings on the cache card; on desktop you can catch an amber ring (`caching--desktop--4-key-open.png`); on the phone at 1× the ring is a few pixels. The caption names a signal the learner may never perceive (Tversky's apprehension problem).
- **Unexplained number:** "Cache hits 74%" with "Cache 15/15 items". Why not 100%? Because there are 60 distinct keys with skew, and copies expire after 4 s. Neither fact is anywhere on screen. "15/15 items" plus a full bar reads as "the cache is broken/full".
- **"Database busy >99%" but "Failed 0%".** A learner expects overload to mean failure; the lesson never says "nothing fails, everyone waits".
- **Text and scene agree on the win but the catch is unobservable:** the takeaway says copies "go out of date", but the stale (violet donut) dot never appears in this lesson, so the learner's first stale dot arrives in C3 with no memory of what it means.
- **Knob invitation is absent:** "Cache size" ranges 0–40 but nothing says "drag it to 0 and watch the database" (samwho would).

### A3 Retries & backoff (`retries-and-backoff--desktop--1b-problem-note.png`, `--2-fix.png`, phone `--1b…`, `--2d…`)
- **The text says "it never recovers"; the table says 100% succeeded in both worlds.** For the whole first ~25 s real (all 10 captured states, both viewports) Succeeded is 100% | 100%, Load multiplier ×1.0 | ×1.0, Response time 276 | 276 ms, Change "—". The stall happens at 1000 ms sim = 10 s real and lasts 8 s real; the metric window lags another 10 s. `npm run tune` confirms the story is true over a full minute (problem: 24% succeeded, ×3.4 load; fix: 60%), but the first minute shows nothing. This is the clearest text/scene disagreement in the course.
- **The "Backoff" fix looks identical to the problem at the moment most learners look.** `retries-and-backoff--desktop--2-fix.png`: 12 dots piled in a grid in front of "Service · stalled", several amber, same numbers in both columns. The thing that differs (clients waiting with a timer before retrying) has no visual at all; the hollow "ghost" dots the caption relies on are rare and small.
- **Three terms in a knob with no definitions:** "At once | Backoff + jitter | + retry budget". "Jitter" and "budget" are never shown doing anything distinct.
- **The stall is the lesson, and it is a 3-second pill at the top of the stage** ("The service stalls for a moment") that points at nothing and fades. On the phone it collides with the Key button.
- **Phone label clipping:** `retries-and-backoff--phone--1b-problem-note.png` shows "stalled · 2 wai" cut off at the right edge; `--2d-fix-panel-scrolled.png` shows "stalled · 13 wa" and a "+1" overflow marker with no explanation.
- **"Load multiplier ×1.0"** is the headline idea and the learner cannot interpret "×1.0" without the tooltip ("Attempts sent per real request").

### D4 Consistency vs availability (`consistency-vs-availability--desktop--1b-problem-note.png`, `--2c-fix-fault.png`, phone `--2c…`)
- **Labels name roles before they are explained:** "US database · leader", "EU database · follower", "Consistent", "Available", "Trade-off". The why says "refuse requests, or answer with data that might be old", which is good; the stage then speaks a different language.
- **The badge arrives before the number.** `…--1b-problem-note.png`: the link is red with a ✕, EU follower wears "CUT OFF", yet "EU requests answered 100% | 100%". The sliding window makes the metric lag the scene by up to 10 s real; a learner reads it as "cut off, but everything's fine".
- **The promised costs never show up while I watch.** The "Available" caption says "some are stale" and "writes … conflict when the link comes back". In all 16 captured D4 states "EU stale reads" is 0% | 0% and "Conflicting writes" 0 | 0. `tune` shows they do appear later (stale avg 7%, max 50%; conflicts up to 3), but only well into the loop. The trade-off lesson shows one side of the trade.
- **The table passes a verdict on a trade-off.** "EU requests answered 38% → 100% ▲ better by 166%" in green: the "Available" column wins every row that moves, so the lesson reads as "availability is better", the opposite of its point.
- **The fault button fights the script.** Pressing the button during the scripted cut repairs the link (the label had flipped to "Repair the network"), which is consistent but surprising; a learner who wants to "cause" the split finds it already caused on a 52 s real loop with no countdown.
- **Response time in the Consistent world is 350 ms in amber** (the lesson's target is 300 ms) and nothing says "amber because every EU request crosses the ocean" until the takeaways.

### F4 Health checks (stray capture, `00-health-checks-desktop-problem-server2-down.png` plus the accessibility snapshot taken while on that page)
- The snapshot read: "Servers in use 3 | 2 | ▼ worse by 33%" and "Response time 272 | 294 | ▲ worse by 8%". Taking the dead server out of rotation is the fix, and the table marks it worse. Same root cause as F1/D4: the Change column applies a fixed "lower/higher is better" to every row in every lesson.

### Cross-cutting confusions and copy problems
1. **Captions describe; nothing directs.** Every caption is a paragraph about what the scene does ("Traffic swells and fades…", "Each write is copied…"). None starts with a verb, names a node label, or gives a number to look for. The learner has to find the evidence for the sentence somewhere in a moving picture.
2. **No cue is anchored to the stage.** Scripted notes are a centred pill; faults are buttons in the panel; metrics are in a table. The thing being talked about is never pointed at. (De Koning: selection cues are the ones that reliably work; System Lab has none.)
3. **The clock is hidden.** "10× slow motion" in the dock is the only hint that 1 s on screen is 100 ms in the table. Loops are 36–70 s real; the interesting moment is often 10–50 s in; there is no countdown, no timeline, no "next: the service stalls in 4 s".
4. **Metrics the learner cannot interpret:** p95 labelled "Response time" with no target; "Load multiplier ×1.0"; "Server busy 27%" with no sense of what is healthy; "Answered 4/s" next to "20 req/s"; sparkline with no axis; "Change" with a verdict colour that is wrong for explore and trade-off figures and for "Servers in use".
5. **Jargon before it is shown:** p95, leader/follower, hash % N, "ring of 64 points each", jitter, retry budget, replica, stale, round robin, "key → 3 nodes", SLO/latency target (named in the Key, never given).
6. **The Key is global, not local.** Eight entries, covering a third of the stage, in every lesson; it never says which of them will appear here, and the dot kinds that matter most in a lesson (ghost in A3, stale in D1/D4, slate square in R1) are not introduced when they first appear.
7. **Reduced motion is safe but empty.** A settled still frame with Play/Step is correct, but the scripted notes, the only narrative the lessons have, never fire for that learner.
8. **Nothing asks anything.** No prediction, no check, no "why did that help?". The learner can click through all three tabs in 8 s and be told "Recap".
9. **Tabs named by figure, not by purpose.** "Rising traffic / More workers / Recap" reads as content, not as a path ("see it break → fix it → check yourself").

---

## 3. Concept delivery system v3

Design constraints kept: one screen, no scrolling document, the existing shell (bar · stage | panel · dock), deterministic engine, both worlds in lockstep, at most 2 knobs and 4 metrics, reduced motion first-class.

The lesson keeps three tabs, but each tab is now a short sequence of **beats** the learner steps through, and the beats are anchored to the stage. The dock's single Next button advances the beat, not the tab; the tab changes when the beats of a step are done.

```
desktop                                                       phone
┌──────────────────────────────────────────────────────────┐  ┌────────────────────────┐
│ bar                                                       │  │ bar                    │
├─────────────────────────────────────┬────────────────────┤  ├────────────────────────┤
│  stage                              │ hook / why          │  │ stage (46svh)          │
│   ┌──────────┐                      │ [Problem][Fix][✓]   │  │  ◉ callout anchored    │
│   │ callout ─┼─▶ (Server)           │ beat 2 of 4  ●●○○   │  │    to a node           │
│   └──────────┘                      │ ▸ current beat text │  ├────────────────────────┤
│   dimmed everything not pointed at  │   (same words)      │  │ beat text (1 line)     │
│                                     │ knobs · faults      │  │ [Problem][Fix][✓] ●●○○ │
│                                     │ Without|With|Diff   │  │ headline number row    │
│                                     │ (tap a row → why)   │  │ knobs · faults · table │
├─────────────────────────────────────┴────────────────────┤  ├────────────────────────┤
│ ▶ ⏭ ↺ 1×  · Follow one request · 1 s = 100 ms   ‹ Next › │  │ ▶ ⏭ ↺ 1×   ‹ Next ›   │
└──────────────────────────────────────────────────────────┘  └────────────────────────┘
```

### Stage-by-stage

**0. Hook** · Purpose: give the learner a question to hold while they watch (Case, 3Blue1Brown). · UI: replaces the first line of the panel: a 10–16 word question in display type; the why sentence sits under it in body type. Phone: same, top of the panel. · Data: `hook: string`. · Reduced motion: unchanged.

**1. Build the scene** · Purpose: pre-training (Mayer): know the parts before they move. · UI: nodes enter one by one (the existing scale-in with accent ring), each with a one-line callout anchored beside it ("Users: send about 20 requests a second", "Server: 4 workers, 120 ms each"), 1.2 s apart, no traffic yet; the dots that will appear in this lesson are listed in a 2–4 item local Key under the stage tag ("In this scene: ● request, ● late, ● answered"). Phone: callout rendered as the single text line under the stage with the node pulsed. · Data: `build: { node: string; line: string }[]`, `dots: DotKind[]`. · Reduced motion: all nodes present, the build lines shown as a numbered list in the panel; Next walks them, pulsing the node outline (opacity only).

**2. Watch (guided beats)** · Purpose: cueing + segmenting; the text says what to look at, when, and where. · UI: a callout (dark pill with a short leader line) anchored to a node, a link, a group of dots (the waiting line), a metric row or a knob; everything else dims to ~25% (spotlight); the panel shows the beat list with the current one highlighted (so beats are re-triggerable by click); a dot strip "beat 2 of 4" under the tabs. Beats fire on a condition read from the sim (queue length, a dot turned amber, an event) or at a simulated time; a beat with `pause` stops both worlds and shows "Next" to resume; `holdMs` keeps a non-pausing callout for 4 s then fades to the list. Phone: callout text in a fixed one-line row between stage and tabs, the target pulsed on stage. · Data: see `Beat` below. · Reduced motion: beats are the only navigation: Next steps the sim to the beat's time (`sim.step(at - sim.t)`) and renders the still frame with the spotlight; no fades.

**3. Predict** · Purpose: POE; commit before seeing. · UI: a card in the panel where the caption was, with the prompt and 2–3 tap options; the sim pauses while the card is open (so the answer isn't on stage); after a tap the card collapses to one line ("You said: more than double") and the lesson continues to Break; the reveal beat later shows the live number next to the learner's choice with ✓/✗ and one sentence. Phone: same card, above the tabs so it's visible without scrolling. · Data: `predict: Prediction`. · Reduced motion: identical (no motion involved).

**4. Break it** · Purpose: the learner causes the failure at a known moment (samwho, Raft) instead of waiting for a loop. · UI: the fault button moves from the panel into a beat: "Press ⚡ Stall the service" is the callout, anchored to the button; the script no longer loops on its own in v3 (scripted events become `armed` and fire when the beat is reached, or on the button); a small countdown chip on the node ("stalls in 3…") when a script will fire. Both worlds get the same fault (kept). · Data: `figures[].break: { action: string; beat: Beat }` and scripts marked `trigger: "beat" | "loop"`. · Reduced motion: the break is a step; the still frame after it shows the aftermath at a chosen offset (`stillAfterMs`).

**5. Fix it** · Purpose: show the new part doing its job on the same traffic. · UI: switching to the Fix tab keeps shared nodes, the new node enters with its build line as the first beat ("Cache: remembers the last 15 answers"), then 2–4 beats on the mechanism, each naming a dot kind on first appearance ("This violet donut is a stale answer"). · Data: same `beats` on the fix figure, with `term` keys. · Reduced motion: as Watch.

**6. Compare** · Purpose: the argument in numbers, stated once in words. · UI: the last beat of the fix points at the table and reads it as a sentence with live numbers ("Same traffic. Without the cache the slowest 1 in 20 waited 800 ms; with it, 310 ms."); the Change column is renamed **Diff** and only coloured for `fix` figures with a declared `headline` metric; for `explore` and `tradeoff` figures it shows the signed difference in neutral grey; rows the lesson calls out get an "explain" chevron. Then an invitation beat for the knob ("Drag Cache size to 0. Watch Database busy.") with a counterexample where the lesson has one (Red Blob). · Data: `headline: { metric: string; sentence: string }`, `invite?: Beat[]`. · Reduced motion: the sentence is computed from the still frames.

**7. Check yourself** · Purpose: retrieval with feedback (Bjork, Brilliant, Distill). · UI: on the Recap tab, before the takeaways, one or two tap questions; wrong answers get a one-line why and spotlight the node that answers it; right answers get the same line. Never blocks Next. Phone: card at the top of the panel. · Data: `checks: Check[]`. · Reduced motion: unchanged.

**8. Takeaways** · Purpose: consolidation. · UI: the existing three lines plus a one-line memorable rule in display type ("Queues grow faster than traffic.") and the prediction/check result ("You predicted 1 of 1, answered 2 of 2"). · Data: `takeaways.rule: string`.

**9. Next** · Purpose: keep the path. · UI: the Next-stop button follows the learner's chosen path (beginner/intermediate/advanced), with the next lesson's hook as its subtitle. · Data: `level`, `PATHS` in `lessons/index.ts`.

### Cross-cutting mechanisms

**Follow one request** (Victor's concrete rung). A dock button "Follow one request" (phone: in the ⋯ of the transport). The next request leaving the named client is tagged: drawn 1.6× with a halo, all other dots at 30%, speed forced to 0.5×, and a narration line updates at each hop: "Leaves Users", "Waits behind 3 others: 240 ms so far", "A worker takes it: 120 ms", "Back to Users: 390 ms in total, late by 0 ms". The trace ends with a mini timeline strip (wait | service | travel) under the stage. Beginners get one automatic trace as a beat in F1 and C1. · Data: `trace?: { client: string; narrate: Partial<Record<"leave"|"queue"|"serve"|"hit"|"miss"|"fail"|"return", (r: ReqView) => string>> }`. · Reduced motion: the trace is shown as a static numbered path with the timeline, built by running the sim headlessly until that request completes.

**Spotlight / dim.** A `focus` prop on the stage: `{ nodes?: string[]; links?: string[]; dots?: "waiting"|"inflight"|"late"|"ghost"|"failed"|"stale"|"turned"; metric?: string; knob?: string }`. SVG gets a `.dim` class on everything else; the canvas multiplies alpha for non-focused dots. Used by beats, by wrong-answer feedback, and by the glossary's "show me".

**Inline metric explainers.** Tap any table row (or the metric name) → desktop popover / phone inline expansion: (1) plain meaning (the existing `hint`), (2) the current number read as a sentence with the target ("Right now 95 of every 100 requests finish within 294 ms. The target is 400 ms."), (3) the sparkline with the target drawn as a line and the last beat marked, (4) "Why it moved" linking to the beat that explains it. · Data: `MetricSpec.explain?: (v: number | null, sim: Sim) => string`, `MetricSpec.target?: number | ((sim) => number)`; the table draws the target on the sparkline when present.

**Glossary.** `src/lib/glossary.ts`: `{ key, name, alias?, short (≤ 20 words), long?, showMe?: { lesson, focus } }`. Terms inside beat/caption text are marked `[[p95|the slowest 1 in 20]]`: rendered as plain words with a dotted underline; tap → the short definition and a "Show me" that applies the focus. A term becomes tappable only from the beat that names it (first naming is authored with `term:` on the beat). `/glossary` lists every term with the lesson it is first shown in. Aliases follow Hello Interview's pattern: "Cache-aside (lazy loading)".

**Difficulty labels and paths.** `level: "beginner" | "intermediate" | "advanced"` on every lesson, shown as a chip on the route map and in the bar. Beats and checks may carry `level` too: beginner lessons hide `advanced` beats (p99, retry budgets, virtual nodes) and advanced learners skip the build phase and the automatic trace (expertise reversal). Three paths in `lessons/index.ts`:
- Beginner "A request's journey": F1 → F2 → F3 → C1 → A1 → R1 (six lessons, every one has an automatic trace and a prediction).
- Intermediate "The lines": the five lines in order (all 18).
- Advanced "The hard parts": D2 → D3 → D4 → C4 → R2 → R3 → ★, plus an "In an interview, say…" line in the takeaways.
The chosen path is stored in localStorage (`syslab.path`) and drives the Next button and the route map's highlighting.

### Authoring data (what a lesson file declares)

```ts
// lessons/types.ts additions (sketch)
export type DotKind = "req" | "late" | "ok" | "stale" | "turned" | "failed" | "ghost" | "probe";

export interface Focus { nodes?: string[]; links?: [string, string][]; dots?: DotKind | "waiting"; metric?: string; knob?: string; action?: string }

export interface Beat {
  id: string;
  text: string;                               // ≤ 14 words, verb first; may contain [[term|plain words]] and {metric:label} / {queue:node}
  at?: number;                                // simulated ms since the figure started (first eligible tick)
  when?: (sim: Sim) => boolean;               // or a condition; the first of at/when that is true fires it
  focus?: Focus;                              // what the callout points at and what stays bright
  pause?: boolean;                            // hold both worlds until Next (default: true for level "beginner")
  holdMs?: number;                            // real ms the callout stays when not pausing (default 4000)
  term?: string;                              // glossary key first named here
  level?: "beginner" | "intermediate" | "advanced";
  stillAfterMs?: number;                      // reduced motion: render the frame this far after `at`
}

export interface Prediction {
  id: string; prompt: string; options: string[]; answer: number;
  reveal: string;                             // one line with live numbers, shown by the reveal beat
  revealBeat: string;                         // id of the beat that reveals it
}

export interface Check {
  id: string; prompt: string; options: string[]; answer: number;
  why: string;                                // ≤ 25 words, shown for right and wrong
  focus?: Focus;                              // spotlight on a wrong answer
  level?: Beat["level"];
}

export interface FigureDef {
  /* existing fields */
  build?: { node: string; line: string }[];   // nodes enter one by one with these lines
  beats?: Beat[];
  predict?: Prediction;
  break?: { action: string; countdownMs?: number };   // the fault that the beats arm
  headline?: { metric: string; sentence: string };    // the compare sentence; also the tested metric
  invite?: Beat[];                            // knob/counterexample invitations after the compare
  trace?: TraceSpec;
}

export interface Lesson {
  /* existing fields */
  level: "beginner" | "intermediate" | "advanced";
  hook: string;
  dots: DotKind[];                            // the local key
  checks: Check[];                            // 1–2
  takeaways: { use: string; catch: string; seen: string; rule: string; interview?: string };
  terms?: string[];
}
```

Scene scripts gain `trigger?: "loop" | "armed"`; v3 lessons use `armed` and the break beat fires them (the fault button still works and reports `isOn` as today).

---

## 4. Copy guidelines

**Hook** (one per lesson). A question the learner has felt, ≤ 16 words, no term from the lesson. "Why does a site get slow before it breaks?" not "What is queueing theory?".

**Why** (one sentence). States the mechanism in plain words; names no part that hasn't been shown. Keep the current ones; they are good.

**Build lines** (one per node, ≤ 9 words). Label, colon, what it does with a number: "Server: 4 workers, 120 ms each". Never what it is ("a horizontally scalable stateless tier").

**Beats** (≤ 14 words). Rules:
1. Start with a directing verb: Watch, Look at, Count, Find, Wait for, Press, Drag, Compare, Notice.
2. Name exactly one thing by its on-stage label (Users, Server, Database, the line in front of Database, the amber dots) and point at it with `focus`.
3. Give the number to look for when there is one ("when Users reaches 40 req/s", "Database busy >99%"); read live numbers with `{metric:…}` placeholders rather than hard-coding.
4. One beat, one change. If the sentence has "and", split it.
5. Plain words first, name second: "Dots line up in front of Server" → next beat "That line is the [[queue]]". After naming, use the name everywhere.
6. Dot vocabulary: colour + shape + meaning, in that order, once per lesson at first appearance: "the amber dot (running late)", "a hollow red ring (the user gave up)", "a violet donut (a stale answer)". Never say "the slow ones".
7. No adjectives of judgement ("massive", "catastrophic"). The number is the judgement.
8. Present tense, second person when the learner acts ("Press ⚡ Stall the service").

**Figure caption** (kept, ≤ 25 words). Describes the setup, not the outcome: the outcome is for the beats. "48 reads a second, 60 different keys, a few of them very popular. The database can do about 36 a second."

**Predict prompts.** One concrete, observable outcome with 2–3 options where the wrong ones are the common misconceptions; the reveal reads the live number and names the rule in ≤ 20 words.

**Checks.** Test the mechanism, not recall of a word. The feedback line explains with a number from the scene and is the same for right and wrong.

**Takeaways.** "Use it when" starts with a condition; "The catch" names a cost in the units of a metric; "Seen in" ≤ 5 names; "Rule" ≤ 8 words, memorable, no term that wasn't named in the lesson.

**Numbers.** Always a unit and, for a latency or a share, a target ("294 ms, target 400 ms"). Say "the slowest 1 in 20" in text and keep "p95" for the glossary and the advanced path. Time on screen is stated once per lesson in the dock as "1 s on screen = 100 ms".

### Example rewrites

#### F1 Latency & throughput (beginner)

- **Hook:** Why does a website get slow before it breaks?
- **Why:** A server can only work on a few requests at once. Past that, new ones wait in line, and waiting is most of what "slow" means.
- **Build:** Users: send 6 to 42 requests a second, rising and falling. · Server: 4 workers, each takes 120 ms.
- **Dots in this scene:** request · running late · answered.
- **Problem "See it slow down"** (caption: "Traffic rises to about 40 a second and falls back. Nothing is broken.")
  1. `at 300` Watch one blue dot leave Users and reach Server. *(focus: link Users→Server)*
  2. `when server busy ≥ 1` Each socket in Server is a [[worker]]. A dot fills one for 120 ms. *(focus: node Server, pause)*
  3. `when queue ≥ 2` Traffic is up. Dots line up in front of Server. That line is the [[queue]]. *(focus: dots waiting, pause, term: queue)*
  - **Predict** (before beat 4): "Traffic is about to double, from 20 to 40 a second. The line in front of Server will…" A. Double · B. More than double · C. Stay about the same. Answer B.
  4. `when any dot late` An amber dot has waited past 400 ms, the target. Nobody dropped it; it is just late. *(focus: dots late, term: latency target)*
  5. `at wave peak` Count the line: {queue:app} waiting. Traffic doubled; the line grew {queueRatio}×. *(focus: dots waiting, reveal of predict)*
- **Explore "Find the limit"** (caption: "Same server. You set the traffic and the number of workers.")
  1. Capacity is workers ÷ time per request: 4 ÷ 0.12 s ≈ 33 a second. *(focus: node Server, shows "≈33/s" badge on the server)*
  2. Drag Traffic to 30. Server busy reaches 90%. Watch the line form. *(focus: knob Traffic)*
  3. Now give it 6 workers: capacity 50 a second. The line disappears. *(focus: knob Workers)*
  - **Headline:** "Same 30 a second. With 6 workers the slowest 1 in 20 waits {p95:fix} instead of {p95:problem}."
- **Checks:** (1) "2 workers, 200 ms each. About how many requests a second can they finish?" 4 · **10** · 100. Why: "2 ÷ 0.2 s = 10 a second. Capacity is workers divided by time per request." (2) "A server is 90% busy. A new request most likely…" is served at once · **waits behind others** · is rejected. Why: "At 90% busy the line is already there most of the time; waiting, not failing, is what you see first."
- **Takeaways:** Use it when: every design; know each part's capacity and keep it well under 100% busy. · The catch: waiting grows faster than load; at 90% busy a request waits several times longer than at 50%. · Seen in: every web server, database and API has a fixed number of workers or connections. · **Rule: Queues grow faster than traffic.**

#### C1 Caching (beginner)

- **Hook:** The same ten questions get asked a thousand times. Why answer them a thousand times?
- **Why:** Databases are slow and hard to scale. Keep popular answers in fast memory and most reads never reach the database.
- **Build:** Users: 48 reads a second, 60 different keys, a few very popular. · App server: 8 workers, 20 ms. · Database: 4 workers, 110 ms, so about 36 reads a second.
- **Dots:** request · running late · answered.
- **Problem "Every read hits the database"**
  1. Follow one read: Users → App server → Database and back. *(trace, automatic for beginners)*
  2. Database can finish about 36 reads a second. 48 arrive. *(focus: node Database)*
  3. Watch the line in front of Database grow. Database busy: {util:db}. *(focus: dots waiting, pause)*
  4. Nothing fails. Everyone waits. The slowest 1 in 20 now waits {p95:problem}, target 400 ms. *(focus: metric Response time)*
  - **Predict:** "We add a box that remembers the last 15 answers. 60 different keys exist. What share of reads will skip the database?" About a quarter · **About three quarters** · Nearly all. Reveal: "{hit:fix} skipped it. A few keys are asked for far more than the rest."
- **Fix "Remember the answer"**
  1. Cache: remembers the last 15 answers. It starts empty. *(build line, focus: node Cache)*
  2. First read of a key: a [[miss]] (amber ring on Cache). Cache asks Database and keeps a copy. *(focus: node Cache + link Cache→Database, pause, term: miss)*
  3. Same key again: a [[hit]] (green ring). It never reaches Database. *(focus: node Cache, pause, term: hit)*
  4. The bar is how full Cache is. At 15 of 15, the least recently used copy is dropped to make room. *(focus: node Cache, term: eviction, level: intermediate)*
  5. Cache hits: {hit:fix}. Database busy fell from {util:db:problem} to {util:db:fix}. *(focus: metric Cache hits)*
  - **Headline:** "Same reads. The slowest 1 in 20 waits {p95:fix} instead of {p95:problem}, and Database is {util:db:fix} busy instead of {util:db:problem}."
  - **Invite:** Drag Cache size to 0, then to 40. Find the size where hits stop improving. *(focus: knob Cache size)*
- **Checks:** (1) "A cache hit means…" the database answered quickly · **the cache had a copy, so the database wasn't asked** · the answer was up to date. Why: "A hit never reaches the database; that is where the speed and the relief come from." (2) "Cache holds 15 answers but there are 60 keys. Hits can still be high because…" the cache is faster than the database · **a few keys are asked for far more often than the rest** · the database copies data into the cache. Why: "Popular keys stay in the cache; rare ones miss and don't matter much."
- **Takeaways:** Use it when: the same data is read far more often than it changes and a slightly old copy is acceptable. · The catch: a cache holds copies, so they can go out of date (C3 shows the violet donut); it is one more system to run and it starts empty after a restart. · Seen in: Redis and Memcached in front of databases, browser caches, CPU caches. · **Rule: Answer from a copy; ask the source only for what's new.**

#### A3 Retries & backoff (intermediate)

- **Hook:** A service hiccups for one second. Why is it still down a minute later?
- **Why:** Retrying a failed request once is smart. When every client retries instantly and all at once, a brief hiccup becomes a long outage.
- **Build:** Users: 22 requests a second; give up after 500 ms; then try again, up to 3 times. · Service: 4 workers, 100 ms.
- **Dots:** request · running late · answered · gave up (hollow red ring).
- **Problem "Retry at once"** (caption: "All calm: 22 in, 22 out. The service is about to stall for under a second.")
  1. Response time {p95:problem}, target 300 ms. Load multiplier ×1.0: one attempt per request. *(focus: metric Load multiplier, term: load multiplier)*
  - **Predict:** "The stall lasts 0.8 s. After it ends, the service will…" recover within a second or two · **take far longer** · never recover at this traffic.
  2. Press ⚡ Stall the service. *(focus: action stall; the script is armed; countdown chip on Service)*
  3. `when stalled` No worker takes anything. Watch the line in front of Service. *(focus: dots waiting, pause)*
  4. `when first ghost` A hollow red ring is a user who gave up. Their request is still in the line: a [[ghost]]. *(focus: dots ghost, pause, term: ghost)*
  5. `when amplify ≥ 1.5` Each user who gave up sends a new request at once. Load multiplier: {amplify:problem}×. *(focus: metric Load multiplier)*
  6. `when un-stalled` Service is back, but the line is ghosts and retries. Succeeded: {answered:problem}. The hiccup is now an outage. *(focus: node Service, reveal of predict)*
- **Fix "Wait, spread out, cap it"**
  1. Same stall. Now a user who gives up waits before retrying: 120 ms, then 240, then 480. That is [[backoff]]. *(focus: node Users shows a timer ring on waiting clients, pause, term: backoff)*
  2. Each wait is randomised a little so users don't all retry in the same instant: [[jitter]]. *(focus: dots on the Users→Service link, term: jitter)*
  3. Only 1 retry is allowed per 10 requests: a [[retry budget]]. Load multiplier stays near ×1. *(focus: metric Load multiplier, term: retry budget, level: intermediate)*
  4. Watch the line drain. Succeeded climbs back to {answered:fix}. *(focus: dots waiting)*
  - **Headline:** "Same 0.8 s stall. Retrying at once: {answered:problem} succeeded, load {amplify:problem}×. With backoff, jitter and a budget: {answered:fix}, load {amplify:fix}×."
  - **Invite:** Switch the strategy to "At once" and stall again. Then "Backoff + jitter" without the budget. *(focus: knob Retry strategy)*
- **Checks:** (1) "Which retry turns a hiccup into an outage?" one retry after a short wait · **everyone retrying immediately** · no retries at all. Why: "Immediate retries arrive while the service is still full, so they only lengthen the line." (2) "Jitter exists to…" make retries faster · **stop clients retrying in the same instant** · reduce the number of retries. Why: "Backoff alone makes everyone wait the same time and come back together; jitter spreads them out."
- **Takeaways:** Use it when: the failure might succeed next time (timeouts, 503s), with backoff, jitter and a cap. · The catch: retries multiply load exactly when the system is weakest; retrying at every layer multiplies it again. · Seen in: AWS SDK retry modes, gRPC retry policies, Envoy retry budgets. · **Rule: Retry later, not louder.** · Interview line (advanced): "I'd retry only idempotent calls with exponential backoff, full jitter and a retry budget, and I'd never retry at more than one layer."

Timing changes implied: the A3 loop shrinks from 7000 ms simulated (70 s real) to an armed stall the learner fires; D4's cut becomes armed too, with a visible countdown when the script fires it; metric window lag is explained once by the explainer ("averaged over the last 10 seconds on screen").

---

## 5. What to measure (localStorage only)

**Storage.** `syslab.v1.events`: a ring buffer of at most 600 events `{ t, lesson, kind, data }`, plus `syslab.v1.progress[slug]` with per-lesson rollups and `syslab.path`. No identifiers, no network, no timestamps finer than a second. A `/progress` page shows the learner their own numbers ("You predicted 7 of 9", "Lessons with every beat seen: 11") and has Export (JSON download) and Clear.

**Events** (kind → data):
- `open` (level, path), `tab` (from, to, beatsSeen/beatsTotal of the step left)
- `beat` (id, dwellMs, paused, replayed, skippedByTab)
- `predict` (id, chosen, correct, msToAnswer)
- `check` (id, chosen, correct, attempt)
- `metric_open` (label), `term_open` (key, from: beat|caption|glossary), `trace` (lesson, completed)
- `knob` (id, from, to), `fault` (id, on, viaBeat)
- `recap` (msSinceOpen), `next` (to, viaPath), `feel` (👍 | 🤔, chips: numbers | dots | words)

**How to read them when tuning a lesson** (a dev-only `/stats` route or `npm run stats <exported.json>`):
- Prediction accuracy per prompt: above ~85% means the prompt is too easy or the answer was visible; below ~35% means the beats before it don't set it up (or the option wording is the problem). Target 50–70%: that is where a prediction changes a belief.
- Check first-try accuracy: target 60–80% (desirable difficulty). A distractor nobody picks is dead weight; a distractor most people pick is a misconception the beats must address.
- Beat dwell: median under 1 s means the text is skipped (shorten or make it pause); replay rate over 20% means the callout points at the wrong thing or fires too early/late; `skippedByTab` over 30% on a step means the step is too long.
- Tab abandonment before the break beat: the hook isn't holding; look at the hook and beat 1.
- Knob/fault interaction rate: expected low (10–15% per Red Blob); if the invite beat doesn't move it, change the invite's verb and number, not the knob.
- Metric explainer opens by label: a label opened often is a label that needs renaming.
- `feel` 🤔 with chip "numbers" → fix the explainer/target; "dots" → the dot's first-appearance beat is missing; "words" → a term is used before it is named (grep the lesson for `[[` order).
- Prediction vs check correlation per lesson: a learner who predicted right and then fails the check means the check tests a different idea than the scene showed.

**Tuning loop.** Change one thing per lesson per round (a beat's timing, a prompt's wording, a target), re-export, compare the same four numbers (prediction accuracy, check accuracy, beat completion, 🤔 rate). Keep the lesson tests (`tests/lessons.test.ts`) as the guard that the numbers the beats read are still true.

---

## 6. Mapping to code

| Proposal | Files | Size |
|---|---|---|
| Fix the Change column semantics (neutral "Diff" for explore/trade-off; verdict only on the declared headline metric; stop marking "Servers in use" worse) | `live.tsx` (`Compare`, `Delta`), `lessons/types.ts` (`headline`), `metrics.ts` (`better` per lesson) | S |
| Show the target on the table and sparkline; "1 s on screen = 100 ms" in the dock | `live.tsx`, `metrics.ts` (`target`), `player.tsx`, `globals.css` | S |
| Lesson schema: `hook`, `level`, `dots`, `build`, `beats`, `predict`, `break`, `headline`, `invite`, `checks`, `takeaways.rule`, `terms` | `lessons/types.ts`, then each `lessons/*.ts` (content) | S schema · M–L content (18 lessons) |
| Beat engine: evaluate `at`/`when` on each tick, pause both worlds, hold/fade, re-trigger from the list, step-to-beat under reduced motion | `live.tsx` (`useBeats` next to `useLiveSims`; `stepUntil`/pause API), `player.tsx` (beat list, Next advances beats) | M |
| Anchored callouts: the stage exposes screen boxes for nodes/links/queue spots; callout component with leader line; phone one-line row | `stage.tsx` (export `layouts`/boxes via a ref or callback; `queueSpot` for the waiting line), `player.tsx` (`Callout`), `globals.css` | M |
| Spotlight/dim (`focus` prop): SVG `.dim` classes, canvas alpha for non-focused dots, metric row and knob highlight | `stage.tsx` (SVG + draw loop), `live.tsx` (row highlight), `globals.css` | M |
| Build phase: nodes enter one by one with lines; local dot key; armed traffic start | `player.tsx`, `stage.tsx` (visible-node set reusing the scale-in ring), `legend.tsx` (local `Key`), `engine.ts` (hold arrivals until started) | M |
| Armed scripts and the break beat with countdown chip | `sim/types.ts` + `engine.ts` (`trigger: "armed"`, `fire(id)`), lesson files (A3, D4, F2, F4, A2, D3 scripts), `stage.tsx` (countdown badge via `describe`) | S engine · S per lesson |
| Predict card with live reveal placeholders (`{metric:label}`, `{queue:node}`) | `player.tsx` (`Predict`), `live.tsx` (placeholder formatter reading `measure`), `lessons/types.ts` | M |
| Compare sentence + invite beats | `player.tsx`, `live.tsx` | S |
| Check yourself on the Recap tab, with spotlight on wrong answers | `player.tsx` (`Check`), `lessons/types.ts`, `globals.css` | M |
| Follow one request: tag a request, emit per-hop events, halo + dim, narration, timeline strip; headless static trace for reduced motion | `engine.ts` (request tagging and hop events), `stage.tsx` (halo, dim), `live.tsx` (trace state, 0.5× force), `player.tsx` (narration + strip), `globals.css` | L |
| Inline metric explainers (popover/inline, sentence with target, "why it moved" link) | `live.tsx` (row → button + popover), `metrics.ts` (`explain`, `target`), `globals.css` | M |
| Glossary: data, `[[term|plain]]` renderer, popover with "Show me", `/glossary` page | new `lib/glossary.ts`, new `components/term.tsx`, `player.tsx` (render beats/captions through it), new `app/glossary/page.tsx`, `globals.css` | M |
| Difficulty labels and paths: chips on the route map and bar, path picker, Next follows the path, beats/checks filtered by level | `lessons/index.ts` (`PATHS`), `route-map.tsx`, `player.tsx`, `globals.css`, localStorage | M |
| Reduced motion for beats and build (stepper; `stillAfterMs`; no fades) | `live.tsx`, `player.tsx`, `globals.css` (already disables animation) | S–M |
| Telemetry: ring buffer, hooks at each stage, `/progress` page with export/clear, dev `/stats` | new `lib/telemetry.ts`, `player.tsx`, new `app/progress/page.tsx`, optional `scripts/stats.ts` | S–M |
| Phone fixes surfaced by the audit: headline number row above the fold, callout row, un-clipped sub-labels ("stalled · 2 wai"), "+N" overflow legend | `globals.css`, `stage.tsx` (label width / side rules in compact mode), `player.tsx` | M |
| Timing: shorten loops (A3 7 s → armed; D4 5.2 s → armed; F1 wave 3.6 s → 2.4 s or a "peak in 5 s" chip), note pills become anchored beats | lesson files, `live.tsx` (`freshNote` replaced by beats) | S |
| Tests: every beat's `when` becomes true within the figure's run; every `{placeholder}` resolves; predictions' `answer` matches the engine (e.g. queue ratio > 2 in F1); checks have 2–3 options | `tests/lessons.test.ts` | S |

Suggested order: the S rows first (they fix things that currently teach something false: the Change verdicts, the missing target, the hidden clock, the armed stalls), then the beat engine + callouts + spotlight (the core of v3), then predict/check/explainers/glossary, then follow-one-request and paths, with telemetry switched on from the first beat-enabled lesson so the tuning loop starts with F1 and C1.
