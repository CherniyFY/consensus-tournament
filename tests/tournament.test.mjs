import assert from "node:assert/strict";
import test from "node:test";
import { applyTournamentAction, getBracket, tournamentDefinitions, TournamentError } from "../src/index.ts";

const make = n => ({ id: "t", title: "Final", entrantIds: Array.from({ length: n }, (_, i) => `N${i + 1}`), results: [], votes: {}, revision: 0, createdAt: "0", updatedAt: "0" });
const pick = (t, match, winnerId) => {
  t = applyTournamentAction(t, { action: "vote", matchId: match.id, voter: "voterA", winnerId }, `${t.revision + 1}`);
  return applyTournamentAction(t, { action: "vote", matchId: match.id, voter: "voterB", winnerId }, `${t.revision + 1}`);
};

test("2–16 seeds, byes, arbitrary winner paths: only second actual loss eliminates", () => {
  for (let n = 2; n <= 16; n++) for (let run = 0; run < 16; run++) {
    let t = make(n), random = n * 1009 + run * 2381 + 17, played = 0;
    const rand = max => { random = (random * 1664525 + 1013904223) >>> 0; return random % max; };
    while (!getBracket(t).championId) {
      const before = getBracket(t), ready = before.matches.filter(m => m.status === "ready");
      assert.ok(ready.length > 0, `No ready match for ${n} seeds`);
      const match = ready[rand(ready.length)];
      assert.ok(before.losses[match.a] < 2 && before.losses[match.b] < 2);
      const winner = rand(2) ? match.a : match.b, loser = winner === match.a ? match.b : match.a;
      t = pick(t, match, winner); played++;
      const after = getBracket(t);
      for (const id of t.entrantIds) assert.equal(after.losses[id], before.losses[id] + (id === loser ? 1 : 0));
      assert.ok(played <= n * 2 - 1);
    }
    const end = getBracket(t);
    assert.equal(end.eliminated.length, n - 1);
    assert.ok(end.losses[end.championId] <= 1);
    for (const id of end.eliminated) assert.equal(end.losses[id], 2);
    assert.equal(played, n * 2 - (end.resetRequired ? 1 : 2));
    assert.deepEqual(make(n).results, []);
  }
});

test("two entrants still get a reset if the previously unbeaten finalist loses", () => {
  let t = make(2);
  t = pick(t, getBracket(t).matches.find(m => m.id === "W1-1"), "N1");
  assert.equal(getBracket(t).losses.N2, 1);
  t = pick(t, getBracket(t).matches.find(m => m.id === "GF"), "N2");
  let bracket = getBracket(t);
  assert.equal(bracket.championId, null);
  assert.deepEqual(bracket.losses, { N1: 1, N2: 1 });
  assert.equal(bracket.matches.find(m => m.id === "RESET").status, "ready");
  t = pick(t, bracket.matches.find(m => m.id === "RESET"), "N1");
  assert.equal(getBracket(t).championId, "N1");
});

test("unbeaten final win finishes immediately with no phantom reset or bye loss", () => {
  let t = make(3);
  assert.equal(getBracket(t).matches.filter(m => m.status === "bye").length, 1);
  assert.deepEqual(Object.values(getBracket(t).losses), [0, 0, 0]);
  while (!getBracket(t).championId) { const m = getBracket(t).matches.find(m => m.status === "ready"); t = pick(t, m, m.a); }
  assert.equal(getBracket(t).matches.find(m => m.id === "RESET").status, "inactive");
  assert.equal(t.results.length, 4);
});

test("disagreement waits for explicit joint decision; a tie cannot advance", () => {
  let t = make(2), m = getBracket(t).matches.find(m => m.status === "ready");
  assert.throws(() => applyTournamentAction(t, { action: "decide", matchId: m.id, winnerId: m.a }, "1"));
  t = applyTournamentAction(t, { action: "vote", matchId: m.id, voter: "voterA", winnerId: m.a }, "1");
  t = applyTournamentAction(t, { action: "vote", matchId: m.id, voter: "voterB", winnerId: m.b }, "2");
  assert.equal(t.results.length, 0);
  assert.equal(getBracket(t).matches.find(x => x.id === m.id).status, "ready");
  assert.throws(() => applyTournamentAction(t, { action: "vote", matchId: m.id, voter: "voterB", winnerId: "tie" }, "3"));
  t = applyTournamentAction(t, { action: "decide", matchId: m.id, winnerId: m.b }, "3");
  assert.equal(t.results[0].decidedBy, "joint");
  assert.equal(t.results[0].winnerId, m.b);
  assert.throws(() => applyTournamentAction(t, { action: "vote", matchId: m.id, voter: "voterB", winnerId: m.a }, "4"));
});

test("undo is latest-result only and invalidates pending descendant picks", () => {
  let t = make(2), m = getBracket(t).matches.find(m => m.status === "ready");
  t = pick(t, m, m.a);
  const final = getBracket(t).matches.find(m => m.id === "GF");
  t = applyTournamentAction(t, { action: "vote", matchId: final.id, voter: "voterA", winnerId: final.b }, "3");
  t = applyTournamentAction(t, { action: "undo", matchId: m.id }, "4");
  assert.deepEqual(t.results, []);
  assert.deepEqual(t.votes, {});
  assert.equal(getBracket(t).matches.find(m => m.id === "GF").status, "waiting");
  t = pick(t, getBracket(t).matches.find(m => m.status === "ready"), "N1");
  t = pick(t, getBracket(t).matches.find(m => m.id === "GF"), "N1");
  assert.throws(() => applyTournamentAction(t, { action: "undo", matchId: "W1-1" }, "5"));
  assert.equal(getBracket(applyTournamentAction(t, { action: "undo", matchId: "GF" }, "6")).championId, null);
});

test("invalid entrant sets, results, and voter labels are rejected", () => {
  for (const count of [0, 1, 17, 2.5, NaN]) assert.throws(() => tournamentDefinitions(count), TournamentError);
  for (const entrantIds of [["a", "a"], ["", "a"], ["a", 2]]) {
    assert.throws(() => getBracket({ ...make(2), entrantIds }), TournamentError);
  }
  const t = make(2), match = getBracket(t).matches.find(m => m.status === "ready");
  assert.throws(() => applyTournamentAction(t, { action: "vote", matchId: match.id, voter: "other", winnerId: match.a }, "1"), TournamentError);
  assert.throws(() => applyTournamentAction(t, { action: "vote", matchId: "missing", voter: "voterA", winnerId: match.a }, "1"), TournamentError);
  const result = { matchId: match.id, winnerId: match.a, decidedBy: "agreement", resolvedAt: "1" };
  assert.throws(() => getBracket({ ...t, results: [result, result] }), TournamentError);
  assert.throws(() => getBracket({ ...t, results: [{ ...result, winnerId: "unknown" }] }), TournamentError);
  assert.throws(() => getBracket({ ...t, results: [{ ...result, matchId: "GF" }] }), TournamentError);
  assert.throws(() => getBracket({ ...t, results: [{ ...result, matchId: "missing" }] }), TournamentError);
});

test("a pending vote can change without mutating any earlier snapshot", () => {
  const t = make(2), original = structuredClone(t);
  const match = getBracket(t).matches.find(m => m.status === "ready");
  const first = applyTournamentAction(t, { action: "vote", matchId: match.id, voter: "voterA", winnerId: match.a }, "1");
  const firstCopy = structuredClone(first);
  const second = applyTournamentAction(first, { action: "vote", matchId: match.id, voter: "voterA", winnerId: match.b }, "2");
  assert.deepEqual(t, original);
  assert.deepEqual(first, firstCopy);
  assert.equal(second.votes[match.id].voterA, match.b);
  assert.equal(second.results.length, 0);
  assert.equal(second.revision, 2);
  assert.equal(second.updatedAt, "2");
});
