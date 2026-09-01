# Demo video plan

**Target 2:45. Hard limit 3:00.** Judges are not required to watch past three
minutes and may score from the video alone, so the WebMCP advantage has to land
inside the first sixty seconds.

**Setup before recording**

- Browser at 1280×800, dark theme, zoom 100%, bookmarks bar hidden.
- Sample dataset ready via the "or load a sample dataset" link.
- Tool Inspector **closed** at the start.
- Rehearse once. Record narration in one take if possible; no music.

---

## Sequence

### 0:00 – 0:18 · The problem

**Screen:** A spreadsheet open — obviously a payroll or customer file. Cursor
hovers over a "share with ChatGPT" style upload affordance and stops.

**Narration:**
> "To get AI help with a spreadsheet, you upload it. But this file is payroll.
> This one is patient records. For a lot of people, uploading isn't an option —
> so they get no help at all. Cleanroom removes the upload."

**Judge should notice:** the problem is real, common, and instantly recognisable.

---

### 0:18 – 0:38 · The containment guarantee

**Screen:** Cleanroom loads. Drop the CSV in. Open DevTools → Network. Type a
filter. **Nothing appears.** Then show the response headers with
`connect-src 'none'` highlighted.

**Narration:**
> "Your file is parsed here, in the tab. And this page cannot make a network
> request at all — the content security policy removes fetch, XHR and
> websockets. There's no backend. That's not a promise; it's enforced by the
> browser, and you can check it in five seconds."

**WebMCP action:** none yet — this establishes *why* WebMCP is necessary.

**Judge should notice:** the privacy claim is architectural and verifiable.

---

### 0:38 – 1:10 · The agent discovers and uses the tools

**Screen:** ChatGPT Desktop's in-app browser (or Chrome 149 with the flag).
Ask: *"What's driving revenue in this data?"* Show the agent calling
`list_datasets`, then `query_dataset`, then `add_chart`. **A chart appears on the
page as it works.**

**Narration:**
> "Now an agent. It discovers eleven tools this page registers through WebMCP.
> It lists the datasets — structure only, no cell values. It runs an aggregate
> query. And it builds a chart onto the report I'm looking at. The agent never
> received my file. It called tools that ran here, on my machine."

**WebMCP action:** `getTools` → `list_datasets` → `query_dataset` → `add_chart`.

**Judge should notice:** *This is the money shot.* Human intent → tool discovery
→ tool call → the page does real work → the human sees it live.

> If a live agent is unreliable on the day, fall back to the Tool Inspector and
> say so plainly: "same interface, driven by hand." Do not fake an agent.

---

### 1:10 – 1:28 · Tools track the app's state

**Screen:** Open the Tool Inspector. Point at "9 registered". Remove the
dataset — the count drops to 2. Load it again — back to 9.

**Narration:**
> "The tool surface isn't static. With no data loaded, the agent is offered two
> tools. Load a file and seven more appear — that's the WebMCP toolchange event.
> The agent's menu always describes what this app can actually do right now."

**WebMCP action:** `toolchange`, registration and unregistration.

**Judge should notice:** non-trivial, spec-aware WebMCP usage.

---

### 1:28 – 2:05 · The strongest moment: the human gate

**Screen:** Ask the agent something needing raw records. It calls `sample_rows`.
**The app stops and asks.** Show the modal with the agent's stated reason
quoted. Press **Don't allow**. Show the refusal. Then run it again and press
**Allow this once** — two rows appear, and the ledger's **raw rows** counter
ticks 0 → 2.

**Narration:**
> "Here's the important part. The agent wants to see actual records — and the
> application stops it. Not the model deciding to be careful: the app refuses to
> proceed until I answer. It has to tell me why, in writing, and I see its exact
> words. I can say no. And when I do say yes, exactly two rows are released, and
> it's recorded."

**WebMCP action:** `sample_rows` suspending inside `execute`; deny path, then
approve path.

**Judge should notice:** authority stays with the person; this is enforced by
the application, not requested of the model.

---

### 2:05 – 2:28 · The egress ledger

**Screen:** The ledger, full. Point at the totals, then scroll the itemised
list — including the refused call.

**Narration:**
> "And this is the ledger. Every tool call the agent made, what it received down
> to the character, and the two raw rows I approved. Including the request I
> turned down. Your file never left this tab — this is everything derived from
> it that an agent ever saw."

**Judge should notice:** the accountability artifact. Nobody else will have
built this.

---

### 2:28 – 2:45 · Close

**Screen:** Full app, report populated, ledger visible. Hold still.

**Narration:**
> "Cleanroom is a hundred percent client-side, has no backend, and no runtime
> dependencies beyond React. Four hundred and twenty-three tests, including ones
> that drive the real WebMCP interface. WebMCP isn't a feature here — it's the
> only way this app could exist. The data can't come to the agent, so the tools
> go to the data."

**Final frame:** app name, live URL, repository URL.

---

## What to cut if over time

In this order: the 1:10–1:28 toolchange segment (compress to one sentence over
the earlier footage) → the DevTools proof (state it instead of showing it) →
the deny path at 1:28 (show approve only). **Never cut** the approval modal or
the ledger.

## Do not

- Use music, third-party logos, or any trademarked material.
- Show a real person's actual data. The sample dataset has invented names.
- Speed up or fake an agent response. If the agent misbehaves, say so and use
  the Inspector — honesty reads better than a suspiciously perfect take.
