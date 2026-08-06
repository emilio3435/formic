/* Attention, in one place — the discrete, actionable half of the console.

   The header is CONFIDENCE: continuous, measured quantities about the fleet,
   each carrying its own provenance, answering "can I trust this board, and what
   is this costing me". This is ATTENTION: discrete items, each carrying kind,
   severity, exact source, lifecycle, plain-English evidence, impact and a route,
   answering "what needs me, and why".

   The seam is one line: the header never links, and this never aggregates.
   Everything here is an ITEM — one thing, one source, one route — because a
   count of to-dos rendered as a metric is the defect this surface exists to
   remove.

   Pure derivation, no DOM, so the model and its renderer are testable apart the
   way pulseStripModel already splits them.

   It imports leaf modules only. app.js is the entry point and exports almost
   nothing, so the two resolvers that genuinely live there arrive as injected
   functions rather than being re-derived here — the shape notificationPlan
   already uses for `nameFor`, and for the same reason: a second derivation of
   one quantity is how two surfaces come to disagree about it. */

/* isTerminal, deliberately NOT isLive.

   "Still has current impact" is "this session has not ended", and isLive is
   narrower than that: it excludes `unverified`, a session the board can watch
   but cannot confirm. Demoting a finding because the sessions it names are
   unverified would bury exactly the rows the board is least sure about — and
   styles.css already carries the scar of that conflation ("Sharing --ended's
   clay is what made an unverifiable session LOOK finished before it was called
   finished"). Unverified is its own state, and it is not an ending. */
import { declaredQuiet, isTerminal } from "./agent-model.js";
import { fmtElapsed } from "./text-formatters.js";
import {
  agentName,
  agentsById,
  conciseText,
  investigationView,
  issueLifecycle,
  issuesOf,
  snapshotAgents,
} from "./presentation.js";

/* The blocking/noticed partition, named.

   S0-T2 puts `attentionClass` on the wire beside `attentionSignal`. It is
   be-dwell's and it is not shipping yet — but the partition is not new
   detection, it is a NAME for a split the server's attention detectors already
   compute one kind at a time. So this reads the server's word when there is
   one and otherwise applies S0-T2's rule to the `attentionSignal.kind` that is
   on the wire today.

   Server wins on the classification. That is the bandContextPct shape — the
   server's number, a client walk only as the fallback — and it is here for the
   same reason: one quantity must not have two answers.

   Without the fallback there is no handoff feed at all until be-dwell lands,
   and the whole point of shipping this before the header stops linking is that
   no window exists where a finding is unreachable. */
const BLOCKING_KINDS = new Set([
  "permission-requested",
  "input-requested",
  "fork-unresolved",
  "handoff-stated",
  "question-pending",
  "assumption-stated",
]);

const NOTICED_KINDS = new Set(["stalled-active"]);

/* `nothing-wanted`, `out-of-scope` and `not-readable` deliberately have no
   class. Absence, not a third value: "we looked and nothing wants you", "it is
   finished" and "there was nothing to read" are three different facts and none
   of them is an item. */

export function attentionClassOf(agent) {
  if (!agent) return null;
  /* The stand-down is a VETO both sides compute from the same two fields, not a
     second opinion about the classification. It runs on the server's word as
     well as on the derived one — applied to both, the two can never disagree;
     applied to one, a server that forgot would re-alert a lane the operator
     explicitly stood down. The atlas-hardening T6/T7 precedence is read here,
     never reopened: a `parked`/`done` declaration yields no class, and the one
     thing that reopens it is a needsInput hook strictly newer than the
     declaration, which declaredQuiet already tests. */
  if (declaredQuiet(agent)) return null;
  const declared = agent.attentionClass;
  if (declared === "blocking" || declared === "noticed") return declared;
  const kind = agent.attentionSignal && agent.attentionSignal.kind;
  if (BLOCKING_KINDS.has(kind)) return "blocking";
  if (NOTICED_KINDS.has(kind)) return "noticed";
  return null;
}

/* Item ids ARE the board's ids.

   A handoff item for an agent is `agent:<id>` — the exact id issuesOf mints for
   that same agent. So the S1 parity gate is an identity check rather than a
   mapping table, and the dedup between the two feeds falls out of a Set. */
const agentItemId = (agentId) => "agent:" + agentId;

const defaultProgramName = (program) => (program ? program.name || "" : "");

/* The honest degradation when app.js has not injected issueImpactLine: say what
   the server said, or say nothing rather than invent a consequence. */
const defaultImpact = (issue) =>
  (issue && typeof issue.impactSummary === "string" && issue.impactSummary.trim()) || "";

/* Evidence is the sentence the operator reads INSTEAD of opening the drawer, so
   it is bounded but never cut mid-word — conciseText is the client's one
   existing answer to that. The limit is the mockup's peek line at 452px, which
   wraps to two lines and no more. */
const EVIDENCE_LIMIT = 168;

/* A timestamp is only a duration if it is behind the clock.

   `since` drives the per-row wait ("1h 04m") and the standby hero. A server
   instant that is AHEAD of this browser is clock skew, not a negative wait, and
   liveElapsedText already carries the scar of that drift. Unmeasurable is null:
   the renderer withholds the reading rather than printing 0m, which is the
   S0-T1 rule — absent when unmeasurable, never `updatedAt`, never 0. */
function measuredSince(iso, now) {
  if (typeof iso !== "string" || !iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return ms > now ? null : iso;
}

/* severity "blocking" means A PERSON IS THE BLOCKER, and nothing else earns it
   — not a failed collector, not an error-severity system fault.

   That is not a softening of how bad those are. It is what makes the badge
   contract structural instead of a second rule the badge has to remember: ember
   is filled exactly when some item is severity "blocking", so if the button is
   red, someone stopped and is waiting for you. Urgency that is not a person
   lives in `kind` and in the evidence sentence. */
function handoffItem(agent, program, attentionClass, now, programNameFor) {
  const blocking = attentionClass === "blocking";
  const name = agentName(agent);
  const inProgram = programNameFor(program);
  const signal = agent.attentionSignal || {};
  return {
    id: agentItemId(agent.id),
    kind: "handoff",
    severity: blocking ? "blocking" : "warning",
    source: {
      agentId: agent.id,
      agentName: name,
      programId: agent.programId || (program && program.id) || "",
      programName: inProgram,
    },
    lifecycle: agent.hookLifecycle || "unknown",
    evidence: conciseText(signal.evidence || agent.statusReason || "", EVIDENCE_LIMIT),
    impact: blocking
      ? `${name} is stopped and cannot continue until you answer.`
      : `${name} has gone quiet. Nothing is waiting on you; the watcher is reporting it.`,
    /* PERMANENTLY NULL, and that is a ruling rather than a gap.

       docs/S0-T1-DEAD-TIME-MEASUREMENT.md measured every candidate for "when
       did this person-block begin" and none of them is an entry edge:
       `hookLifecycleAt` advanced 01:38:51 → 01:39:16 → 01:40:41 on a session
       that stayed needsInput throughout, so it is a write clock; the hook
       Notification repeats mid-wait, so it would RESET the age during a single
       block; Stop and UserPromptSubmit mark turn and return boundaries, not
       entry; and the cmux journal rolls away, so it is not durable history.

       So dead time is dropped, not deferred. The one thing this field may never
       become is a heartbeat, because a heartbeat here makes the oldest wait on
       the board read as the newest — which is worse than showing no age at all.
       An item's own age still exists where it is genuinely measured: a finding
       has an openedAt and an investigation has a createdAt, and both are
       durable server facts about a record rather than guesses about a person. */
    since: null,
    route: { kind: "agent", id: agent.id },
  };
}

/* The one line with a FACT in it.

   A degraded-source issue arrives carrying three layers of category and one
   layer of evidence, and until now the item took a category:

     title             "Cursor collection is degraded"
     summary           "1 collection problem makes Cursor session data
                        potentially incomplete."
     technicalDetails  ["cursor GUI conversations: unable to open database file"]

   Only the third says what is wrong. §4.2 requires evidence to be a plain-English
   whole sentence, and shipping the summary here put a category where the evidence
   belongs — so the operator read "Whoops" three times and never once learned that
   a database would not open. technicalDetails rendered only in the drawer, three
   clicks from the chip that was complaining.

   Read off the FIELD, not off today's wording: the collectors are being taught to
   phrase these as whole sentences naming the population they lost, and this picks
   that up for free when it lands. Multiple faults join rather than truncate to the
   first, because "which one" is exactly what a count already failed to say.

   Falls back to the summary when a source ships no detail — a category is a poor
   evidence line but an empty one is worse. */
function faultEvidence(issue) {
  const details = Array.isArray(issue.technicalDetails) ? issue.technicalDetails : [];
  const said = details.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim());
  return said.join(" · ") || issue.summary || issue.title || "";
}

function dataflowItem(issue, snap, now, programNameFor, impactFor) {
  const life = issueLifecycle(issue);
  const affected = (issue.affectedAgentIds || []).map((id) => agentsById(snap).get(id)).filter(Boolean);
  const one = affected.length === 1 ? affected[0] : null;
  return {
    id: issue.id,
    kind: "dataflow",
    severity: "warning",
    source: one
      ? {
        agentId: one.agent.id,
        agentName: agentName(one.agent),
        programId: one.agent.programId || (one.program && one.program.id) || "",
        programName: programNameFor(one.program),
      }
      : { collector: issue.kind === "system" ? "control-plane" : "" },
    lifecycle: life.state,
    evidence: conciseText(faultEvidence(issue), EVIDENCE_LIMIT),
    /* The pairing the raw string needs. `impact` names WHICH sessions the fault
       costs the operator and `since` names WHEN it started, so the fault sentence
       never stands alone as a library error with no consequence attached. */
    impact: impactFor(issue, snap),
    since: measuredSince(life.verificationStartedAt || life.openedAt, now),
    /* The same severity→drawer split findingFromIssue already uses, so an item
       and the strip finding it replaces open the same panel. */
    route: { kind: issue.severity === "error" ? "intervention" : "advisory", id: issue.id },
  };
}

function investigationItem(item, now) {
  const view = investigationView(item.state);
  const agents = Number.isFinite(item.affectedAgents) ? item.affectedAgents : null;
  const programs = Number.isFinite(item.affectedPrograms) ? item.affectedPrograms : null;
  return {
    id: item.issueId,
    kind: "investigation",
    severity: "warning",
    source: { collector: item.runModel || "" },
    lifecycle: view.work,
    evidence: conciseText(item.rationale || item.headline || "", EVIDENCE_LIMIT),
    impact: agents != null && programs != null
      ? `Covers ${agents} session${agents === 1 ? "" : "s"} across ${programs} program${programs === 1 ? "" : "s"}. It runs without you.`
      : "It runs without you; nothing here is waiting.",
    since: measuredSince(item.startedAt || item.createdAt, now),
    route: { kind: "investigation", id: item.issueId },
  };
}

/* The promotion predicate — the ONE gate between live and history.

   Every row of the truth table resolves its evidence through the item's own
   route, the same way resolveSelection does, so the predicate needs nothing but
   (item, snap) and can never read a field the drawer would not find. */
export function hasCurrentImpact(item, snap) {
  if (!item || !item.route) return false;

  if (item.route.kind === "agent") {
    const found = agentsById(snap).get(item.route.id);
    if (!found || isTerminal(found.agent)) return false;
    /* A person is the blocker, and nothing below outranks it.
       RE-DERIVED from the snapshot rather than read off item.severity: the
       predicate is handed a snap precisely so a row built on an earlier paint
       is judged against the current one. An agent that has since answered, or
       been stood down, is not still blocking anybody — trusting the item's own
       frozen severity would pin the first ember it ever earned. */
    return attentionClassOf(found.agent) !== null;
  }

  if (item.route.kind === "investigation") {
    /* A queue row's liveness IS its existence — it was built from state.queueItems
       this paint. Investigations carry no affected-agent set to go stale, and
       none of their four states is a clearance. */
    return true;
  }

  const issue = issuesOf(snap).find((i) => i.id === item.route.id);
  /* Source healthy / verified: the finding is gone from the current issues, so
     whatever produced it has cleared. Audit, not attention. */
  if (!issue) return false;
  const life = issueLifecycle(issue);
  if (life.state === "resolved") return false;

  const ids = issue.affectedAgentIds || [];
  const index = agentsById(snap);
  const liveAffected = ids.filter((id) => {
    const found = index.get(id);
    return Boolean(found) && !isTerminal(found.agent);
  }).length;

  /* Verifying is the WEAKER claim — "waiting for a fresh source snapshot to
     clear this" — so it has to point at something live to stay on the surface.
     A system-wide finding in verifying has nothing for the operator to do and
     belongs in history, which is why this row reads the count and not the
     has-any-ids test the row below it uses. */
  if (life.state === "verifying") return liveAffected > 0;

  /* Stale-without-current-impact. An EMPTY affected list is not stale — it is
     the system-wide case ("not tied to a specific agent"), which is exactly the
     dataflow fault this surface exists to carry. Only a finding that named
     agents and whose agents are all gone has lost its impact.

     "All gone" has to mean the board CAN SEE them and they have ended — not that
     it cannot see them at all. Measured on a board with a broken Cursor
     collector: the issue named 91 sessions, every one absent from the snapshot
     BECAUSE the collector that would have enumerated them had failed. That made
     liveAffected 0, and the one item explaining the gap was filed to history by
     the gap itself. The operator was left with a chip reading "Readings
     degraded" and a panel with nothing in it.

     So the test is agents the index KNOWS. A finding whose named agents are
     present and terminal has genuinely outlived its subject — the abandoned
     worktree advisory, the archived session — and is stale. A finding none of
     whose agents the board can resolve has not outlived anything; it has lost
     sight of the population, which for a source fault IS the impact. That is
     the same reasoning the empty-list case above already applies, reached from
     the other side: an unresolvable list is no more a stale list than an empty
     one. A source that recovers leaves issuesOf and is cleared above. */
  const knownAffected = ids.filter((id) => index.has(id)).length;
  if (ids.length > 0 && liveAffected === 0 && knownAffected > 0) return false;
  return true;
}

/* Why an item was demoted, in the words the parity table posts. */
function demotionReason(item, snap) {
  if (item.route.kind === "agent") {
    const found = agentsById(snap).get(item.route.id);
    if (!found) return "agent left the snapshot";
    if (isTerminal(found.agent)) return "session ended";
    return "no longer asking";
  }
  if (item.route.kind === "investigation") return "queue row cleared";
  const issue = issuesOf(snap).find((i) => i.id === item.route.id);
  if (!issue) return "source healthy — finding cleared";
  const life = issueLifecycle(issue);
  if (life.state === "resolved") return "resolved";
  if (life.state === "verifying") return "verifying with no live affected agent";
  return "stale — no live affected agent";
}

/* Oldest wait first: the row that has been stopped longest is the one that has
   cost the most, and an unmeasurable wait sorts last rather than first, because
   "we cannot say" must not outrank a measured hour. Ties break on id so a paint
   is stable across snapshots. */
function byWaitThenId(a, b) {
  if (a.since && b.since && a.since !== b.since) return a.since < b.since ? -1 : 1;
  if (a.since && !b.since) return -1;
  if (!a.since && b.since) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const SEVERITY_RANK = { blocking: 0, warning: 1 };
const KIND_RANK = { handoff: 0, dataflow: 1, investigation: 2 };

function feedOrder(a, b) {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity) return bySeverity;
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind) return byKind;
  return byWaitThenId(a, b);
}

/* Every candidate the three feeds produce, split by the one gate.

   The S1 acceptance gate has to account for every id in issuesOf(snap) ∪
   queueItems — each resolves to a live item or to a DOCUMENTED demotion — so the
   demotions cannot be dropped on the floor inside the filter. This is also what
   S5-T1's History route will read. */
export function notificationCandidates(snap, queueItems = [], now = Date.now(), deps = {}) {
  const programNameFor = deps.programNameFor || defaultProgramName;
  const impactFor = deps.impactFor || defaultImpact;
  const candidates = [];
  const taken = new Set();

  /* handoff — agents the attention layer has classified. Built FIRST so that an
     agent's `agent:<id>` finding resolves to its own row in its own drawer
     rather than to an advisory panel about it. */
  for (const { agent, program } of snapshotAgents(snap)) {
    const attentionClass = attentionClassOf(agent);
    if (!attentionClass) continue;
    const item = handoffItem(agent, program, attentionClass, now, programNameFor);
    candidates.push(item);
    taken.add(item.id);
  }

  /* dataflow — issuesOf, and only issuesOf.
     §4.2 reads "issuesOf(snap) + controlHealth.errors/staleSources", and the
     second half is already satisfied inside issuesOf, which synthesizes
     `system:collector-errors` from controlHealth.errors when the server ships no
     issues array. Going further and minting a client-side id for each error
     would put rows on this surface that route to a drawer resolveSelection
     cannot find — issuesOf carries that rule in its own comment, and it was
     written after seven un-actionable rows shipped to the live board. */
  for (const issue of issuesOf(snap)) {
    if (taken.has(issue.id)) continue;
    const item = dataflowItem(issue, snap, now, programNameFor, impactFor);
    candidates.push(item);
    taken.add(item.id);
  }

  /* investigation — the queue rows whose finding is not already on the list.
     Same rule pulseFindings uses: when the issue is present it carries the
     investigation in its own lifecycle, and two rows for one thing is how a
     list of discrete items starts aggregating. */
  for (const queued of Array.isArray(queueItems) ? queueItems : []) {
    if (!queued || taken.has(queued.issueId)) continue;
    const item = investigationItem(queued, now);
    candidates.push(item);
    taken.add(item.id);
  }

  const live = [];
  const demoted = [];
  for (const item of candidates) {
    if (hasCurrentImpact(item, snap)) live.push(item);
    else demoted.push({ id: item.id, item, reason: demotionReason(item, snap) });
  }
  live.sort(feedOrder);
  return { live, demoted };
}

export function notificationFeed(snap, queueItems = [], now = Date.now(), deps = {}) {
  return notificationCandidates(snap, queueItems, now, deps).live;
}

/* The badge's verdict, from the feed rather than from a parallel count.

   `blocked` is exactly "some item is severity blocking", which is exactly "a
   person is the blocker" — one derivation, so the ember on the button and the
   ember rail on the row can never disagree about whether anyone is waiting. */
export function feedTone(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.some((item) => item.severity === "blocking")) return "blocked";
  return list.length ? "noticed" : "clear";
}

/* The count the button carries: agents waiting on a PERSON.

   Not the length of the feed. A badge that counted every watched thing would
   read 9 on a board where nobody is blocked, and the number beside an ember
   button has to mean the same thing the ember means. */
export function blockingCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => item.severity === "blocking").length;
}

/* ---------- the panel's model ----------

   Split from the renderer the way pulseStripModel is, so the three sections,
   the verdict and the withheld hero are all assertable without a DOM. */

const VERDICT = { blocked: "Waiting on you", noticed: "Watch", clear: "All clear" };

/* The standby hero the rev-2 mockup put in the largest type on this panel is
   GONE, and no reading replaces it.

   It was the one number here with no measurable source. S0-T1 tried every
   candidate for the instant a person-block begins and found a write clock, a
   notification that repeats mid-wait, two boundaries that mark something else,
   and a journal that rolls away — so the sum of dead time across the fleet
   cannot be computed at all, and `pulse.standbyMs` is not shipping.

   Deliberately not replaced by a withheld-with-a-reason slot either. That was
   the right treatment while the field was merely unmeasured; once the answer is
   "this quantity is not obtainable from these sources", a permanent apology in
   the hero position is furniture. The count leads instead — a count is honest
   when a duration is not, and it is already the lede. */

/* Program groups, in the order their longest wait started. The feed is already
   sorted oldest-first, so first-seen order IS that order and no second sort can
   disagree with the list it groups. */
function groupByProgram(items) {
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const key = item.source.programId || item.source.programName || "";
    let group = index.get(key);
    if (!group) {
      group = { programId: item.source.programId || "", programName: item.source.programName || "Unassigned", items: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/* A notification surface is judged on the day it has nothing to say, so All
   clear does not go blank — it shows what the watcher is watching. "Watching,
   found nothing" and "not watching" are the two states an empty panel is
   otherwise ambiguous between, and only one of them is good news. */
function proofOfWatch(snap, now) {
  if (!snap) return null;
  const working = snap.totals && Number.isFinite(snap.totals.working) ? snap.totals.working : null;
  const programs = Array.isArray(snap.programs) ? snap.programs.length : null;
  const scannedMs = Date.parse(snap.generatedAt);
  return {
    working,
    programs,
    scanAgo: Number.isFinite(scannedMs) && now >= scannedMs ? fmtElapsed(now - scannedMs) : null,
  };
}

/* A surface that lists things has to say when its list is short.

   The Findings card used to carry this: an unreachable triage queue made its
   sublabel read "Triage queue unavailable (…) — findings may be missing", which
   was the one place the operator learned the count below it was a floor rather
   than a total. That card is retired, and the disclosure cannot retire with it —
   the strip still refuses to go calm on a queue error, so without this the board
   would apologise and never say what for.

   It belongs here rather than in the header for the same reason the findings
   did: it is a fact about THIS list. And unlike a collector fault it needs no
   minted id, because it is not a finding to open — it is this panel admitting
   that investigations it would otherwise show are missing. */
export function notificationPanelModel(snap, queueItems = [], now = Date.now(), deps = {}) {
  const { live, demoted } = notificationCandidates(snap, queueItems, now, deps);
  const blocking = live.filter((item) => item.severity === "blocking");
  const investigations = live.filter((item) => item.kind === "investigation");
  const watching = live.filter((item) => item.severity !== "blocking" && item.kind !== "investigation");
  const tone = feedTone(live);
  return {
    tone,
    /* The eyebrow speaks in calmVerdict's words, but it counts what THIS PANEL
       lists rather than what the board is watching generally. A "Watch" over an
       empty panel — the board eyeing a context peak the center has no item for —
       would be the surface describing something it does not show. */
    verdict: VERDICT[tone],
    count: blocking.length,
    lede: blocking.length
      ? `${blocking.length} agent${blocking.length === 1 ? "" : "s"} stopped`
      : "Nothing is stopped",
    rest: [
      watching.length ? `${watching.length} quiet` : "",
      investigations.length ? `${investigations.length} running below` : "",
    ].filter(Boolean).join(" · "),
    groups: groupByProgram(blocking),
    watching,
    investigations,
    incomplete: deps.queueError
      ? `Triage queue unavailable (${deps.queueError}) — investigations may be missing from this list.`
      : "",
    /* The all-clear proof is withheld while the list is admittedly short. "41
       agents working, nothing stopped" is a claim about the whole board, and it
       cannot be made from a population we know has a hole in it. */
    proof: live.length || deps.queueError ? null : proofOfWatch(snap, now),
    demoted,
  };
}

/* The agents delivery is allowed to interrupt someone for.

   Deliberately NARROWER than alerting(), which needsHumanIds read until S1-T5
   repointed it: alerting is true for any non-healthy non-terminal row, a strict
   superset of "a person is the blocker". Left alone, an out-of-page
   notification fired for a stalled advisory while the button correctly stayed
   amber — and the ember contract broke at the one moment the operator cannot
   see the screen to check it. */
export function blockingAgentIds(snap) {
  const ids = [];
  for (const { agent } of snapshotAgents(snap)) {
    if (attentionClassOf(agent) === "blocking") ids.push(agent.id);
  }
  return ids.sort();
}
