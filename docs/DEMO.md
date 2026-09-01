# Demo video plan

**Target 2:45. Hard limit 3:00.** Judges are not required to watch past three
minutes and may score from the video alone, so the WebMCP advantage has to land
inside the first sixty seconds.

The through-line, said once at the start and once at the end: **give an AI
agent real power over data it is never allowed to see.**

**Setup before recording**

- Browser at 1280×800, dark theme, zoom 100%, bookmarks bar hidden.
- Sample dataset ready via the "or load a sample dataset" link.
- Trust level at **Aggregates** (the default). Tool Inspector **closed**.
- Rehearse once. Record narration in one take if possible; no music.

---

## Sequence

### 0:00 – 0:15 · The problem

**Screen:** A spreadsheet open — obviously a payroll or customer file. Cursor
hovers over a "share with ChatGPT" style upload affordance and stops.

**Narration:**
> "To get AI help with a spreadsheet, you upload it. But this file is payroll.
> This one is patient records. For a lot of people, uploading isn't an option —
> so they get no help at all."

**Judge should notice:** the problem is real, common, and instantly recognisable.

---

### 0:15 – 0:28 · The tension

**Screen:** Cleanroom loads, empty. Drop the CSV in. The ledger on the right
reads **955 B kept local · 0 B released**.

**Narration:**
> "Here's the tension. An agent is only useful if it has real power over your
> data. And your data is only safe if the agent never sees it. Cleanroom gives
> you both."

**Judge should notice:** the product is framed as resolving a real conflict,
not adding a feature.

---

### 0:28 – 0:45 · The idea: the tools go to the data

**Screen:** Open DevTools → Network. Type a filter. **Nothing appears.** Show
the response headers with `connect-src 'none'` highlighted. Close DevTools.

**Narration:**
> "Your file is parsed here, in the tab, and this page cannot make a network
> request at all — the browser enforces that, and you can check it in five
> seconds. So the data can't go to the agent. Instead, the tools go to the
> data: this page registers WebMCP tools that run here, on my machine, and
> return only what they compute."

**WebMCP action:** none yet — this establishes *why* WebMCP is necessary.

**Judge should notice:** the privacy claim is architectural and verifiable, and
WebMCP is the mechanism, not a decoration.

---

### 0:45 – 1:15 · Agent action

**Screen:** ChatGPT Desktop's in-app browser (or Chrome 149 with the flag).
Ask: *"What's driving revenue in this data?"* Show the agent calling
`list_datasets`, then `query_dataset`, then `add_chart`. **A chart appears on the
page as it works.** The ledger's released figure ticks up by a few hundred
bytes.

**Narration:**
> "Now an agent. It discovers the tools this page registers. It lists the
> datasets — structure only, no cell values. It runs an aggregate query. And it
> builds a chart onto the report I'm looking at. The agent never received my
> file. It received about four hundred bytes of aggregates, and the ledger
> counted every one."

**WebMCP action:** `getTools` → `list_datasets` → `query_dataset` → `add_chart`.

**Judge should notice:** *This is the money shot.* Human intent → tool discovery
→ tool call → the page does real work → the human sees it live.

> If a live agent is unreliable on the day, fall back to the Tool Inspector and
> say so plainly: "same interface, driven by hand." Do not fake an agent.

---

### 1:15 – 1:45 · The privacy boundary is a dial

**Screen:** Open the Tool Inspector. Point at **8 tools**. In the left rail,
click **Sealed**. The count drops to **3** — `query_dataset` and the rest are
gone. Click **Raw**. The count rises to **9**, and `sample_rows` appears at the
bottom of the list.

**Narration:**
> "This is the part I want you to see. The agent's tools *are* the privacy
> boundary, and I hold it. Turn the dial to Sealed and every tool that computes
> from my data is unregistered — the agent gets a toolchange event and its menu
> shrinks to three. Turn it to Raw and one more tool appears: the only one that
> can ever show a record. Below Raw, that tool doesn't exist. Not refused —
> not offered."

**WebMCP action:** `toolchange`; registration and unregistration driven by a
person's decision rather than by app data.

**Judge should notice:** WebMCP used as a policy surface. The person changes
what the agent *can* do, live, and the agent is told.

---

### 1:45 – 2:15 · The human decision

**Screen:** With the dial at Raw, ask the agent something needing raw records.
It calls `sample_rows`. **The app stops and asks.** Show the modal with the
agent's stated reason quoted. Press **Don't allow**. Show the refusal. Run it
again and press **Allow this once** — two rows appear, and the ledger's **raw
rows** counter ticks 0 → 2.

**Narration:**
> "Even at Raw, the agent wants actual records and the application stops it.
> Not the model deciding to be careful: the app won't proceed until I answer.
> It has to tell me why, in writing, and I see its exact words. I can say no.
> When I say yes, exactly two rows are released, and it's recorded. And if I
> turn the dial down while it's asking, the request is withdrawn with the tool."

**WebMCP action:** `sample_rows` suspending inside `execute`; deny path, then
approve path.

**Judge should notice:** authority stays with the person; this is enforced by
the application, not requested of the model.

---

### 2:15 – 2:35 · The result

**Screen:** The ledger, full. Point at the balance line — **955 B kept local ·
1.4 KB released** — then scroll the itemised list, including the refused call.

**Narration:**
> "And here's where I stand. Nine hundred and fifty-five bytes kept local —
> the whole file. One and a half kilobytes released — every aggregate, the two
> rows I approved, and the request I turned down. Your file never left this
> tab. This is everything derived from it that an agent has ever been given."

**Judge should notice:** the accountability artifact. Nobody else will have
built this.

---

### 2:35 – 2:50 · Why WebMCP

**Screen:** Full app, report populated, ledger visible, dial visible. Hold still.

**Narration:**
> "A server-side integration can't do any of this, because the data is never on
> a server. WebMCP is the only way an agent can compute over data that never
> leaves your device — and the only way a page can decide, live, which
> capabilities the agent is offered. Cleanroom has no backend and no runtime
> dependencies beyond React. Four hundred and sixty-one tests, including ones
> that drive the real WebMCP interface. Real power over data the agent is never
> allowed to see."

**Final frame:** app name, tagline, live URL, repository URL.

---

## What to cut if over time

In this order: the DevTools proof at 0:28 (state it instead of showing it) →
the deny path at 1:45 (show approve only) → the closing test count. **Never
cut** the dial segment, the approval modal, or the balance line.

## Do not

- Use music, third-party logos, or any trademarked material.
- Show a real person's actual data. The sample dataset has invented names.
- Speed up or fake an agent response. If the agent misbehaves, say so and use
  the Inspector — honesty reads better than a suspiciously perfect take.
