# consensus-tournament

An immutable TypeScript engine for seeded double-elimination tournaments with
two independent voters. Matching votes advance an entrant; disagreements wait
for an explicit joint decision. Useful for comparing proposals, designs, or
other shortlists.

Supports 2–16 ordered entrants, automatic byes, a grand-final reset, loss counts,
and undo of the latest completed match. No dependencies, network access,
database, or bundled data.

## Run

Requires Node.js 22.13 or newer. Node 22 needs the type-stripping flag shown
below; no install or compilation step is required.

```sh
npm test
npm run example
```

Or run directly:

```sh
node --experimental-strip-types --test tests/*.test.mjs
node --experimental-strip-types examples/basic.mjs
```

## Example

```js
import { applyTournamentAction, getBracket } from "./src/index.ts";

let tournament = {
  id: "demo", title: "Proposals", entrantIds: ["alpha", "beta"],
  results: [], votes: {}, revision: 0, createdAt: "0", updatedAt: "0",
};
const match = getBracket(tournament).matches.find(m => m.status === "ready");

for (const voter of ["voterA", "voterB"]) {
  tournament = applyTournamentAction(tournament, {
    action: "vote", matchId: match.id, voter, winnerId: "alpha",
  }, String(tournament.revision + 1));
}
console.log(getBracket(tournament).losses); // { alpha: 0, beta: 1 }
```

Save this example as an `.mjs` file in the repository root and run it with
`node --experimental-strip-types your-example.mjs`.

## API

`tournamentDefinitions(count)` returns match definitions for 2–16 entrants.
Definitions describe bracket, round, and the seed or earlier match feeding
each side. Input order is seed order; entrant IDs must be unique, nonempty
strings. Display names belong in the calling application.

`getBracket(tournament)` returns `matches`, per-entrant `losses`,
`eliminated`, `championId`, and `resetRequired`. A match is `waiting`, `ready`,
`done`, `bye`, or `inactive`. Byes do not count as losses. A grand-final win by
the previously unbeaten finalist ends the tournament; a loss requires the
`RESET` match. Completion takes `2n−2` or `2n−1` played matches for `n` entrants.

`applyTournamentAction(tournament, action, now)` returns a new snapshot with an
incremented `revision` and supplied `updatedAt`; it does not mutate the input.
`now` is a caller-supplied timestamp string. Actions are:

- `{ action: "vote", matchId, voter: "voterA" | "voterB", winnerId }` records
  or replaces one vote. Two matching votes complete the match.
- `{ action: "decide", matchId, winnerId }` resolves two disagreeing votes.
- `{ action: "undo", matchId }` reverses only the latest completed match and
  clears votes invalidated by the changed bracket.

Invalid transitions throw `TournamentError`. Snapshot types and action types
are exported from `src/index.ts`. The engine expects typed, trusted snapshots;
validate untrusted input at your application boundary. Store revisions with a
compare-and-swap write when multiple clients can update the same tournament.
Voter labels identify the two positions and do not provide authentication.

## Validation

Tests cover seeded brackets for every size from 2 through 16 over multiple
winner paths, byes, exact loss accounting, both final outcomes, agreement,
disagreement resolution, undo, and rejected transitions.

## License

MIT. See [LICENSE](LICENSE).
