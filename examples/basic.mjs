import { applyTournamentAction, getBracket } from "../src/index.ts";

let tournament = {
  id: "demo", title: "Example tournament", entrantIds: ["alpha", "beta", "gamma"],
  results: [], votes: {}, revision: 0, createdAt: "0", updatedAt: "0",
};

while (!getBracket(tournament).championId) {
  const match = getBracket(tournament).matches.find(m => m.status === "ready");
  // In an application, collect these independent choices from your two voters.
  for (const voter of ["voterA", "voterB"]) {
    tournament = applyTournamentAction(tournament, {
      action: "vote", matchId: match.id, voter, winnerId: match.a,
    }, String(tournament.revision + 1));
  }
}

console.log(JSON.stringify({
  championId: getBracket(tournament).championId,
  completedMatches: tournament.results.length,
}, null, 2));
