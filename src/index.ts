export type Voter = "voterA" | "voterB";

export type TournamentResult = { matchId: string; winnerId: string; decidedBy: "agreement" | "joint"; resolvedAt: string };
export type Tournament = {
  id: string; title: string; entrantIds: string[]; results: TournamentResult[];
  votes: Record<string, Partial<Record<Voter, string>>>; revision: number;
  createdAt: string; updatedAt: string;
};
export type MatchSource = { seed: number } | { matchId: string; outcome: "winner" | "loser" };
export type MatchDefinition = { id: string; bracket: "winners" | "losers" | "final"; round: number; label: string; sources: [MatchSource, MatchSource] };
export type TournamentMatch = MatchDefinition & {
  a: string | null; b: string | null; winnerId: string | null; loserId: string | null;
  status: "waiting" | "ready" | "done" | "bye" | "inactive";
  votes: Partial<Record<Voter, string>>;
};
export class TournamentError extends Error {}

const from = (matchId: string, outcome: "winner" | "loser" = "winner"): MatchSource => ({ matchId, outcome });

/** Standard seeded double elimination: alternating lower-bracket drop and reduction rounds. */
export function tournamentDefinitions(count: number): MatchDefinition[] {
  if (!Number.isInteger(count) || count < 2 || count > 16) throw new TournamentError("Choose between 2 and 16 entrants.");
  const size = 2 ** Math.ceil(Math.log2(count)), rounds = Math.log2(size);
  let seeds = [1, 2];
  for (let n = 4; n <= size; n *= 2) seeds = seeds.flatMap(s => [s, n + 1 - s]);
  const matches: MatchDefinition[] = [];
  for (let round = 1; round <= rounds; round++) {
    const total = size / 2 ** round;
    for (let i = 0; i < total; i++) matches.push({
      id: `W${round}-${i + 1}`, bracket: "winners", round, label: `Winners bracket · round ${round}`,
      sources: round === 1 ? [{ seed: seeds[i * 2] - 1 }, { seed: seeds[i * 2 + 1] - 1 }] : [from(`W${round - 1}-${i * 2 + 1}`), from(`W${round - 1}-${i * 2 + 2}`)],
    });
  }
  for (let round = 1; round <= 2 * rounds - 2; round++) {
    const k = Math.ceil(round / 2), total = size / 2 ** (k + 1);
    for (let i = 0; i < total; i++) {
      let sources: [MatchSource, MatchSource];
      if (round === 1) sources = [from(`W1-${i * 2 + 1}`, "loser"), from(`W1-${i * 2 + 2}`, "loser")];
      else if (round % 2 === 0) sources = [from(`L${round - 1}-${i + 1}`), from(`W${k + 1}-${(total > 1 ? i ^ 1 : i) + 1}`, "loser")];
      else sources = [from(`L${round - 1}-${i * 2 + 1}`), from(`L${round - 1}-${i * 2 + 2}`)];
      matches.push({ id: `L${round}-${i + 1}`, bracket: "losers", round, label: `Losers bracket · round ${round}`, sources });
    }
  }
  const finalists: [MatchSource, MatchSource] = [from(`W${rounds}-1`), rounds === 1 ? from("W1-1", "loser") : from(`L${2 * rounds - 2}-1`)];
  matches.push({ id: "GF", bracket: "final", round: 1, label: "Grand final", sources: finalists });
  matches.push({ id: "RESET", bracket: "final", round: 2, label: "Final reset", sources: finalists });
  return matches;
}

export function getBracket(tournament: Tournament) {
  if (tournament.entrantIds.some(id => typeof id !== "string" || id.length === 0)) throw new TournamentError("Entrant IDs must be nonempty strings.");
  if (new Set(tournament.entrantIds).size !== tournament.entrantIds.length) throw new TournamentError("Entrant IDs must be unique.");
  const definitions = tournamentDefinitions(tournament.entrantIds.length);
  const resultMap = new Map(tournament.results.map(r => [r.matchId, r]));
  if (resultMap.size !== tournament.results.length) throw new TournamentError("Duplicate match result.");
  const matches: TournamentMatch[] = [], byId = new Map<string, TournamentMatch>();
  const losses: Record<string, number> = Object.fromEntries(tournament.entrantIds.map(id => [id, 0]));
  function resolve(source: MatchSource): { waiting: boolean; id: string | null } {
    if ("seed" in source) return { waiting: false, id: tournament.entrantIds[source.seed] ?? null };
    const match = byId.get(source.matchId);
    if (!match || match.status === "waiting" || match.status === "ready" || match.status === "inactive") return { waiting: true, id: null };
    return { waiting: false, id: source.outcome === "winner" ? match.winnerId : match.loserId };
  }
  for (const definition of definitions) {
    const sources = definition.sources.map(resolve);
    const match: TournamentMatch = { ...definition, a: sources[0].id, b: sources[1].id, winnerId: null, loserId: null, status: "waiting", votes: tournament.votes[definition.id] ?? {} };
    const result = resultMap.get(match.id);
    const final = byId.get("GF");
    if (match.id === "RESET" && (!final || final.status !== "done" || final.winnerId === final.a)) match.status = "inactive";
    else if (!sources.some(s => s.waiting)) {
      if (!match.a || !match.b) { match.status = "bye"; match.winnerId = match.a || match.b; }
      else if (result) {
        if (result.winnerId !== match.a && result.winnerId !== match.b) throw new TournamentError("The winner must be an entrant in this match.");
        match.status = "done"; match.winnerId = result.winnerId; match.loserId = result.winnerId === match.a ? match.b : match.a; losses[match.loserId]++;
      } else match.status = "ready";
    }
    if (result && match.status !== "done") throw new TournamentError("A match cannot finish before its predecessors.");
    matches.push(match); byId.set(match.id, match);
  }
  for (const result of tournament.results) if (!byId.has(result.matchId)) throw new TournamentError("Unknown match.");
  const final = byId.get("GF")!, reset = byId.get("RESET")!;
  const championId = reset.status === "done" ? reset.winnerId : final.status === "done" && final.winnerId === final.a ? final.winnerId : null;
  return { matches, losses, championId, resetRequired: final.status === "done" && final.winnerId === final.b, eliminated: tournament.entrantIds.filter(id => losses[id] >= 2) };
}

export type TournamentAction =
  | { action: "vote"; matchId: string; voter: Voter; winnerId: string }
  | { action: "decide"; matchId: string; winnerId: string }
  | { action: "undo"; matchId: string };

/** Immutable transition; persist the returned revision with a compare-and-swap write. */
export function applyTournamentAction(tournament: Tournament, action: TournamentAction, now: string): Tournament {
  const next: Tournament = { ...tournament, entrantIds: [...tournament.entrantIds], results: tournament.results.map(r => ({ ...r })), votes: Object.fromEntries(Object.entries(tournament.votes).map(([id, v]) => [id, { ...v }])), revision: tournament.revision + 1, updatedAt: now };
  const bracket = getBracket(tournament);
  if (action.action === "undo") {
    const latest = next.results.at(-1);
    if (!latest || latest.matchId !== action.matchId) throw new TournamentError("Only the most recently completed match can be undone.");
    next.results.pop(); delete next.votes[action.matchId];
    const remaining = getBracket(next);
    const ready = new Map(remaining.matches.filter(m => m.status === "ready" || m.status === "done").map(m => [m.id, m]));
    for (const [id, votes] of Object.entries(next.votes)) {
      const match = ready.get(id);
      if (!match) delete next.votes[id];
      else for (const voter of ["voterA", "voterB"] as Voter[]) if (votes[voter] && votes[voter] !== match.a && votes[voter] !== match.b) delete votes[voter];
    }
    return next;
  }
  const match = bracket.matches.find(m => m.id === action.matchId);
  if (!match || match.status !== "ready") throw new TournamentError("This match is not ready or is already complete.");
  if (action.winnerId !== match.a && action.winnerId !== match.b) throw new TournamentError("Choose one of the two entrants in this match.");
  const picks = next.votes[match.id] ?? {};
  if (action.action === "vote") {
    if (action.voter !== "voterA" && action.voter !== "voterB") throw new TournamentError("Choose voterA or voterB.");
    picks[action.voter] = action.winnerId; next.votes[match.id] = picks;
    if (picks.voterA && picks.voterA === picks.voterB) next.results.push({ matchId: match.id, winnerId: picks.voterA, decidedBy: "agreement", resolvedAt: now });
  } else {
    if (!picks.voterA || !picks.voterB || picks.voterA === picks.voterB) throw new TournamentError("An explicit decision requires two different votes.");
    next.results.push({ matchId: match.id, winnerId: action.winnerId, decidedBy: "joint", resolvedAt: now });
  }
  getBracket(next);
  return next;
}
