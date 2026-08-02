# Running the fleet

Three things this project learned the hard way, in one place because they
currently live in twelve documents and a day of commit messages.

Written for whoever runs several agents at once next. You do not need to know
this codebase to use it — the failures are about running a fleet, not about
Ant Hill.

---

## 1. A claim is evidence only if you opened the artifact

Not a worker's quote of the artifact. Not its summary. Not your own earlier
summary. The file, the payload, or the pixels.

Agents are for **breadth** — sweeping a thousand transcripts, enumerating forty
fields. They are not a chain of custody. Whatever survives into your conclusion,
open yourself before it ships.

Sort every claim into three tiers, and do it **at triage, before you know which
one carries the argument**:

| Tier | What it is | Publishable |
|---|---|---|
| Direct | You ran it, read it, or measured it this session | Yes |
| Checked relay | An agent found it; you then opened the same artifact | Yes — say an agent found it |
| Unchecked relay | An agent asserts it; you have not opened it | **No.** Label it or cut it |

**Five checks before a number becomes a finding:**

1. **Population.** Two numbers disagreeing is only a bug if they count the same
   set. Three numbers measuring three things are allowed to differ.
2. **Scope of a quote.** A comment justifies the line beneath it, not the
   paragraph you wish it justified. Read the code under it.
3. **Freshness.** A count without a timestamp is an anecdote. Live systems move.
4. **The check itself.** Say what your verification command returns if the claim
   is *false*. If the answer is "the same thing", it is not a check.
5. **Magnitude.** For any number with no denominator, bound, or neighbour it must
   agree with: say what would have to be true for it to be *correct*. **If you
   would have accepted any value within an order of magnitude, you have not
   checked it.**

Check 5 is separate on purpose. The first four are about provenance — did you
open the artifact. A number can be measured by you, quoted correctly, and still
be meaningless.

**Why this needs to be procedural rather than a resolution to be careful:**
unchecked relays cluster exactly where a finding feels strongest. An agent's most
striking sentence is the most tempting to publish and the least likely to be
reopened, because it already reads as conclusive. Verification effort flows to
claims that look shaky — which are, by construction, the ones not carrying the
argument.

The tell that you have not really read something: **you can quote the line but
not its surroundings.**

Full working, with two worked failures: [`VERIFICATION-RULE-GPT.md`](./VERIFICATION-RULE-GPT.md).

---

## 2. Prove the test can fail

Writing the assertion is not the work. Proving it can fail is.

**The method:** after a test passes, break the code it covers and confirm the
test goes red. If it stays green, it discriminates nothing.

A test that passes against both the correct and the broken implementation is
worse than no test, because it converts an *absence* of coverage into a
*confident report* of coverage. Nobody looks there again.

This is not theoretical. Auditing one commit here by mutating the module under
it — five variants: revert the split, invert it, empty the remedy, stub the
function to return `[]`, promote every warning to error — three guards turned out
to be hollow:

- *"the builder is silent on a healthy fleet"* survived **all five**, including
  the stub. Empty in, empty out is true of a function that does nothing. Fixed by
  pairing it: the same builder must stay silent on a clean fleet **and** speak on
  a real fault, so silence is measured against a builder that demonstrably speaks.
- *"severity is only ever error or warning"* survived the mutant that promoted
  every warning to error — the type already guaranteed the union, so the
  assertion could only restate it.

Both looked like reasonable tests. Both were reassurance.

The same trap catches *verification methods*, not just tests. Someone here checked
"is this field consumed by the client?" with `grep -rl <field> | wc -l` and read
a non-zero count as yes. Both hits were inside comments — prose *about* the field,
in a file that never reads it. The claim happened to be right; the method could
not have told the difference.

---

## 3. Five agents, one working tree

This project ran five agents in a single checkout all day. It worked, on these
rules. Every one of them exists because breaking it cost someone work.

- **Stage by explicit path. Never `git add -A` or `git add <dir>`.** Another agent
  edits the same file between your check and your commit.
- **Re-read the branch immediately before any git action.** Not earlier in the
  session — immediately. Branches move under you.
- **Expect your staged work to land in someone else's commit.** It happened four
  times in one day here. It is survivable and mostly harmless; it is only
  dangerous when you assume it cannot happen and reach for `reset`.
- **Never `stash`, `reset`, or switch branches.** A soft reset once undid another
  agent's commit that had landed in the seconds between two commands. Recovered
  in one move because the reflog had it — but only because nothing was checked out
  differently in the meantime.
- **When one file is co-edited, stage hunks rather than the file.** Split the diff
  and apply only your own ranges to the index.
- **If you did not create it, do not delete it — surface it.** Several files that
  looked like junk turned out to be another lane's work in progress.

The mechanics of landing changes safely are in
[`../DEPLOY.md`](../DEPLOY.md#shared-checkout-hazard).

---

## 4. What actually went wrong

The successes above are only useful next to these.

**Background agents abandon work silently.** Twice today an agent given a token
investigation stopped without reporting, and nothing surfaced it — the work simply
never arrived. The same shape appeared twice more in doc audits: agents returned a
fragment of their reasoning ("Now let me examine…") instead of a report, and the
analysis was recovered only by explicitly resuming them and asking again. **A
dispatched agent going quiet does not look like a failure. It looks like nothing.**
If you dispatch work, track that it came back, and ask for the report again when
it did not.

**Two published review findings were withdrawn under challenge — and the
withdrawals were correct.** Both had the same cause: a worker quoted a comment,
and the reviewer published the conclusion without opening the file. In one case
the two lines directly beneath the quoted comment asserted the opposite of the
finding. The second happened *inside the document written to correct the first*.
Resolving to be careful did not survive one document. That is why section 1 is a
procedure and not advice.

**A wrong number sat on the board all day, past six lanes auditing that exact
surface.** A program rollup read `1.60B tokens`; one session read `391.4M`. It was
`sum(sessionTotal)` over genuinely those agents, so it passed every provenance
question anyone thought to ask. One reviewer measured it personally, quoted it in
a table, and wrote a finding *about that very cell* — flagging that it renders
truncated — without ever asking whether the value could be true. It was ~99% cache
re-reads counted once per turn: arithmetically correct, semantically not tokens
consumed. Nobody asked whether `391.4M` against a 1M context window was possible.
**Six independent auditors is not redundancy when they all ask the same
question.**

That is what check 5 is for, and why it could not be folded into the other four.
