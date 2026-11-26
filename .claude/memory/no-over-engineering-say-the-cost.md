---
name: no-over-engineering-say-the-cost
description: best quality does not mean every rare case; say what extra scope costs in time and whether it blocks before recommending it; stop review rounds when the findings turn rare-case
metadata:
  type: feedback
---

"I want the skill to be as good as possible. But do not over-engineer it." (the owner, 2026-11-26, during #67). The quality bar of [[factory-gets-full-version]] stays, but it does not mean handling every rare case, and a session that takes a whole day for a small addition is itself a sign of over-engineering.

**Why:** On 2026-11-26 the planned work, a trial run of the rebuilt `/triage-review`, took 31 minutes. An install check for the two skills, which did not block the landing, then took over three hours. I had recommended it "in this PR" without saying that it would cost hours, built it through five agents in a row (build, check, repair, check, repair; 20 to 50 minutes each), spelled every rare ending out in the skill text, and kept opening new small decisions while the landing waited. The owner: "This session is already taking a whole day. That's ridiculously long", then "From the time it's taking I'm starting to feel that you really are over-engineering it."

**How to apply** (my reading of it):

- Before recommending anything beyond the agreed plan, say whether it blocks, and what it costs in time (how many agents, and their minutes). Offer "after the merge, as an issue" beside it with equal weight; the choice stays the owner's ([[simplicity-vs-maturity-is-users-call]]).
- For an addition, one build and one independent check is the default. A further repair-and-check round is for a defect that loses data or gives a wrong result in a normal case; findings about rare cases go on a list.
- A skill text states the normal path and one rule for the rest ("anything else is a stop"). It does not describe each rare ending.
- Park new small decisions on a list instead of opening them one after another while the agreed next step waits.
