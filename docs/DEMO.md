# Demo video plan

**Target 2:45. Hard limit 3:00.** Judges are not required to watch past three
minutes and may score from the video alone, so the WebMCP advantage has to land
inside the first sixty seconds.

The through-line, said at the start and again at the end: **give an AI agent
real power over data it is never allowed to see.**

Narration below is **376 words**, about 2:30 at a measured 150 words a minute,
leaving room for the screen to do some of the talking. An
earlier draft ran to 505 words — 3:22 spoken, over the hard limit before a single
pause. Do not pad it back up.

**Setup before recording**

- Browser at 1280×800, dark theme, zoom 100%, bookmarks bar hidden.
- Cleanroom open and **empty**. Trust level at **Aggregates** (the default),
  minimum group size at **5** (the default). Tool Inspector **closed**.
- A payroll-looking spreadsheet open in another tab for the first shot.
- Rehearse once. Record narration in one take if possible; no music.

**Every number below was measured on the shipped build.** If one differs on the
day, read what is on screen — never the script.

---

## Sequence

### 0:00 – 0:12 · The problem

**Screen:** The spreadsheet. Cursor hovers over a "share with ChatGPT" upload
affordance and stops.

> "To get AI help with a spreadsheet, you upload it. But this one is payroll.
> For a lot of people, uploading isn't an option — so they get no help at all."

---

### 0:12 – 0:30 · The tension, and the resolution

**Screen:** Cut to Cleanroom, empty. The heading reads *The agent gets tools. It
never gets the file.* Open DevTools → Network → reload. **Nothing.** Point at the
`connect-src 'none'` line in the response headers. Close DevTools.

> "An agent is only useful with real power over your data. Your data is only
> safe if the agent never sees it. Cleanroom does both — because this page
> cannot make a network request at all. The browser enforces that. So the data
> can't go to the agent; the tools go to the data."

**Judge should notice:** the privacy claim is architectural and checkable in
five seconds, and WebMCP is the mechanism rather than a decoration.

---

### 0:30 – 0:50 · The agent does real work

**Screen:** Click **Load the sample dataset**. The ledger reads **955 B kept
local · 0 B released**. Switch to ChatGPT Desktop's in-app browser (or Chrome 149
with the flag) and ask: *"What's driving revenue here?"* Show `list_datasets`,
then `query_dataset`, then `add_chart`. **A chart appears on the page as it
works.**

> "It discovers the tools this page registers through WebMCP. Structure, then
> an aggregate query, then a chart onto the report I'm looking at. My file is
> nine hundred and fifty-five bytes. The agent has received six hundred and
> seventy-three — of aggregates. Never a row."

**Judge should notice:** human intent → tool discovery → tool call → the page
does real work → the human watches it happen.

> If a live agent misbehaves on the day, drive the same calls from the Tool
> Inspector and say so plainly: "same interface, by hand." Do not fake an agent.

---

### 0:50 – 1:05 · The threshold is already on

**Screen:** In the Inspector, change `groupBy` to `["rep"]` and call again.
**An empty result with a suppression notice.** Point at **Minimum group size: 5**
in the left rail.

> "Now by individual sales rep. Nothing. No rep closed five deals, and five is
> the threshold — so there's no answer here that describes one person. The
> agent can't turn that off. It isn't an argument it can pass."

**Judge should notice:** the privacy control ships **on**, and it is the
person's, not the model's.

---

### 1:05 – 1:35 · The privacy boundary is a dial

**Screen:** Open the Tool Inspector: **10 of 11 registered**. Click **Sealed** —
it drops to **5 of 11**, and `query_dataset` and the rest are gone. Click
**Raw** — **11 of 11**, and `sample_rows` has appeared.

> "This is the part I want you to see. The agent's tools *are* the privacy
> boundary, and I hold it. Sealed: every tool that computes from my data is
> unregistered, and the agent watches its own menu shrink. Raw: one more
> appears, the only tool that can ever show a record. Below Raw it doesn't
> exist. Not refused — not offered."

**Judge should notice:** WebMCP registration used as a policy surface. The
person changes what the agent *can* do, live, and the agent is told.

---

### 1:35 – 2:15 · The human decides

**Screen:** Ask the agent for actual records. It calls `sample_rows`. **The app
stops and asks**, quoting the agent's reason verbatim. Press **Don't allow**;
show the refusal in the ledger. Run it again and press **Allow this once** — two
rows appear and the **raw rows** counter ticks 0 → 2.

> "Even at Raw the application stops it. Not the model choosing to be careful —
> the app won't proceed until I answer, and it has to say why in its own words.
> I can refuse. When I agree, exactly two rows are released, and it's written
> down. Turn the dial down while it's still asking and the request is withdrawn
> with the tool."

**Judge should notice:** authority stays with the person, enforced by the
application rather than requested of the model.

---

### 2:15 – 2:32 · The receipt

**Screen:** The ledger. Point at the balance line, then scroll the itemised
list, including the refused call.

> "Here's where I stand. The whole file, still local. About a kilobyte released
> — every aggregate, the two rows I approved, and the request I refused. This is
> everything an agent has ever been given."

**Judge should notice:** the accountability artifact. Nobody else will have
built this.

---

### 2:32 – 2:45 · Why WebMCP

**Screen:** The full app: report populated, dial visible, ledger visible. Hold
still.

> "A server-side integration cannot do this, because the data is never on a
> server. WebMCP is the only way an agent can compute over data that never
> leaves your device — and the only way a page decides, live, what the agent is
> allowed to ask for."

**Final frame:** app name, tagline, live URL, repository URL.

---

## What to cut if over time

In this order: the DevTools shot at 0:12 (say it instead of showing it) → the
deny path at 1:35 (show approve only) → the threshold segment at 0:50. **Never
cut** the dial segment, the approval modal, or the balance line.

## Do not

- Use music, third-party logos, or any trademarked material.
- Show a real person's actual data. The sample dataset has invented names.
- Speed up or fake an agent response. If the agent misbehaves, say so and use
  the Inspector — honesty reads better than a suspiciously perfect take.
- Read a number off this script that disagrees with the screen.
