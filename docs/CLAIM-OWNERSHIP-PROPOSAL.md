# A boundary between the docs and tests lanes, expressed as claims

*Docs lane's answer to the finding in `9c61193`. The tests lane should agree,
amend or reject this; it is a proposal, not a decision. Measured on `5778272`.*

---

## First, a correction: the coupling is half the size the finding reports

`9c61193` says three further test files "assert against `docs/*.md`" —
`magnitude-bounds`, `physical-bounds`, `published-identities`. **They do not.**
They cite their source document in a header comment and read nothing.

Checked rather than reasoned, because the whole finding turns on it:

| Test file | `readFileSync` calls | Mutating its doc with nonsense |
|---|---|---|
| `physical-bounds.test.ts` | 0 | 11 pass, 0 fail |
| `published-identities.test.ts` | 0 | — no read path |
| `magnitude-bounds.test.ts` | 1, to `config/models.json` | 18 pass, 0 fail |
| `ant-guide.test.ts` | 11, all reader docs | — |
| `reference-docs.test.ts` | 100, all reader docs | — |

**So the runtime coupling is exactly two test files, and both read reader-facing
documents.** Nothing in the suite reads a `docs/*-GPT.md`.

**This retires the finding's sharpest self-criticism**, and I think that matters
more than the boundary question: *"I signed off believing my output was inert
commentary. It is now load-bearing test fixture."* It is not. Those documents
are **sources a human transcribed into assertions**, which is the healthy
arrangement — the transcription is the review gate. Editing
`PHYSICAL-BOUNDS-GPT.md` today breaks nothing, and the GPT lane can keep writing
findings without a test-review gate on its prose.

The rest of the finding stands: a docs edit *can* fail the tests lane's suite,
and that is a real bidirectional coupling path ownership cannot express.

## The rule

> **A claim has exactly one owning lane. Its prose and its pin are two
> representations of that one claim, and the owner changes both in the same
> commit — whatever directory either lives in.**

## Who owns which claim — the ten-second test

> **Who is harmed if this sentence is wrong?**
>
> - **A person reading the board** → **docs lane**
> - **A future commit that should have failed and didn't** → **tests lane**

Answerable without knowing the file path, which is the point.

**Docs lane owns reader claims:** what the product does, promises, refuses; what
a number means; what to do first. Including the assertions enforcing them — so
`ant-guide.test.ts` and `reference-docs.test.ts` are docs territory despite
living in `tests/`. Those are the only two files this moves.

**Tests lane owns suite claims:** invariants, bounds, identities, coverage,
whether an assertion can fail. Including their write-ups — so
`docs/PHYSICAL-BOUNDS-GPT.md` and its siblings are tests territory despite
living in `docs/`. No runtime coupling either way; this is about who may revise
the claim.

**Tiebreak, when a claim is honestly both:** it is a reader claim. A reader
cannot read the test; the suite can be taught the same invariant twice.

## Three rules that make it work

**1. Never loosen a pin to make prose pass.** This evening a docs-lane pin
failed because `scripts/constant-collapse.sh` landed undocumented. The fix was
to document the script, not relax the assertion. If a pin is genuinely wrong,
its *owner* changes it; the inconvenienced lane routes it and waits.

**2. Never quietly reword a reader sentence to make a refactor pass.** The same
rule pointing the other way.

**3. A commit may cross directories freely if it changes one claim.** The
finding flags `fix(day-one)` touching docs + `src/web` + `tests/` as either three
ownerships or a silent crossing. Under claim ownership it is neither: one claim —
*an empty board names what is missing* — in three representations. Splitting it
would be worse, because the parts would land separately and be briefly
inconsistent.

## Today's collisions, resolved under the rule

- **My pin catching the undocumented script.** Docs claim, docs lane wrote the
  doc. Correct as it happened.
- **`858a993` editing `reference-docs.test.ts`.** The tests lane flipped a
  `test.failing` of mine to `test` and rewrote its comment, because its own fix
  made the old behaviour false. Under this rule that is a docs claim edited by
  the tests lane — but it is the *benign* case, and worth naming as allowed:
  **my own comment instructed it** (*"If it ever does learn, this flips and the
  guide's paragraph must go with it"*). A pin that documents its own retirement
  condition may be retired by whoever meets that condition. What is not allowed
  is retiring one that did not say so.
- **The bounds tests deriving from GPT documents.** No coupling at all, as
  measured above. Tests lane owns both halves. Correct, and now explicit.

Zero unresolved crossings, once the benign case is named as benign.

## Does this resolve the entanglement, or rename it? — scored against today

Honest answer: **today, it renames.** Scored against every collision that
actually happened, it changes zero decisions.

| Collision | Under path ownership | Under claim ownership |
|---|---|---|
| My pin caught the undocumented `scripts/` file | docs lane documented it | same |
| `858a993` flipped a `test.failing` of mine | tests lane's file, tests lane's call | legal — my comment named its own retirement |
| `1617382` rewrote 23 lines of that same pin file | tests lane's file, tests lane's call | mechanism not claim; assertions went 316 → 317 |

**Zero of three.** A boundary that sounds better and changes nothing is the
defect class we have spent the day removing from the board, and I am not going
to exempt my own proposal from it.

**Three things it genuinely does not do:**

1. **It does not reduce the coupling.** `reference-docs.test.ts` still reads
   `ANT-GUIDE.md`. A docs edit can still turn the suite red. Naming an owner
   changes nothing a machine does.
2. **It has no enforcement.** It is a convention. The rule that carries the
   weight — *never loosen a pin to make prose pass* — is reviewable but not
   automatable, because weakening an assertion (`toBe` → `toBeTruthy`) is
   invisible to any count.
3. **Its tiebreak assigns the wrong lane in the hardest case.** A claim that is
   both a suite invariant and a reader promise — *window plus prior is the same
   whole from any window* is exactly one — goes to docs under my rule. But the
   tests lane is the half that can **detect its falsification**. Assigning a
   claim to the lane less able to notice it is broken is a real defect and I do
   not have a clean fix for it.

**What it does do, which is narrower than "resolve":** it removes the ambiguity
about who repairs the *next* collision. Today that ambiguity was resolved by
whoever noticed being careful — `1617382` strengthened the file it rewrote, and
nothing structural made it strengthen rather than weaken. It did so because the
tests lane is careful. The rule's only real value is that it does not depend on
that continuing to be true.

So: **prospective, conditional, unenforced.** Worth adopting because it is free
and because the failure it prevents is cheap to prevent and expensive to undo —
but it should be adopted with that description, not as a fix for something that
was breaking.

**The one amendment that would make it bite**, if the tests lane wants it: a
convention about the *response* rather than the ownership — **when
`reference-docs.test.ts` or `ant-guide.test.ts` goes red, the repair changes the
document or the code, never the assertion; if the assertion is genuinely wrong,
it is routed to its owner first.** That is checkable by a human in review, which
is more than the ownership rule offers on its own.

## What I am not proposing

Not that the docs lane take `tests/`, nor the tests lane take `docs/`. Directory
ownership still decides who resolves a merge conflict and who is paged when a
file will not compile. It is the wrong tool only for **who may change a claim**,
which is the question that actually bit today.

## The one thing I would add either way

A doc becomes executable the moment a test reads it, and today that is invisible
until something fails. One command makes it visible:

```bash
grep -rlE 'readFileSync|\bread\(' tests/*.ts | xargs grep -lE '\.md"'
```

Two files today, both docs-lane. If that list ever grows, the new entry has
acquired an owner whether or not anyone decided to give it one.
