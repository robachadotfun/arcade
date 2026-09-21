# Arcade

**Play the economic layer.** An onchain gacha built on [Arc](https://www.arc.io), Circle's
stablecoin Layer 1. Pay a fixed price in USDC, spin once, and receive a token reward drawn at
random from a machine's published reward table. Every step is recorded onchain and anyone can
recompute the outcome from published data.

> Arcade is an independent application built on Arc. It is **not** affiliated with, sponsored
> by, or endorsed by Circle or Arc.

---

## Contents

- [What this is](#what-this-is)
- [The three things worth knowing](#the-three-things-worth-knowing)
- [Architecture](#architecture)
- [Setup](#setup)
- [Arc network configuration](#arc-network-configuration)
- [Running in each mode](#running-in-each-mode)
- [Contracts](#contracts)
- [Deployment](#deployment)
- [Reward token verification](#reward-token-verification)
- [Machine configuration and economic safety](#machine-configuration-and-economic-safety)
- [Randomness design](#randomness-design)
- [Testing](#testing)
- [Asset generation](#asset-generation)
- [Security assumptions](#security-assumptions)
- [Regulatory and legal review](#regulatory-and-legal-review)
- [Production checklist](#production-checklist)

---

## What this is

A complete, working MVP: five Solidity contracts with 61 tests, a verified reward registry
built from live Arc Mainnet data, and a Next.js application implementing the full spin
lifecycle with every failure path designed.

It runs against Arc Testnet or Arc Mainnet. There is **no demo or simulation mode**: every
outcome is decided by the machine manager contract and read back from chain state, and no
code path exists that can produce one without the chain. Arcade therefore needs a deployment
to do anything, and says exactly what is missing when it does not have one.

---

## The three things worth knowing

**1. Arc has no VRF, so Arcade does not claim one.**
Chainlink's Arc integration covers CCIP, Data Feeds, Data Streams and Proof of Reserve — not
VRF. Rather than describe a `blockhash` scheme as "provably fair", Arcade implements an
explicit commit–reveal construction, documents exactly what it guarantees, and states its one
residual trust assumption plainly. See [Randomness design](#randomness-design).

**2. Every reward token was verified against the chain, not a listing.**
Research on Arc found six ticker collisions among candidate assets, including two separate
tokens squatting the symbol `USDC`. `scripts/verify-arc-tokens.ts` reads each candidate's
metadata from Arc Mainnet and then *executes a real transfer against live state* through an
`eth_call` state override to confirm the full amount arrives. 34 candidates were checked; 13
passed. See [Reward token verification](#reward-token-verification).

**3. A machine cannot accept a spin it cannot pay.**
Before accepting a spin, the contract requires the vault to hold the worst-case payout for
*every* token in the reward table, for that spin plus every spin already in flight. The
treasurer can only ever withdraw unreserved surplus, so no role can withdraw a prize somebody
has already won. A solvency invariant is exercised across thousands of randomised call
sequences.

---

## Architecture

A single Next.js application with the contracts alongside it. A monorepo was considered and
rejected: the boundaries that matter here are module boundaries, and workspace tooling would
have added friction without buying isolation.

```
Arcade/
├── contracts/                  Foundry project
│   ├── src/
│   │   ├── ArcadeMachineManager.sol    machines, versioned reward tables, spin lifecycle
│   │   ├── PrizeVault.sol              reward custody + solvency invariant
│   │   ├── RewardRegistry.sol          token allowlist, asserts symbol/decimals onchain
│   │   ├── CommitRevealRandomness.sol  verifiable randomness without a VRF
│   │   ├── FeeRouter.sol               revenue split
│   │   ├── ArcadeRoles.sol             role identifiers
│   │   ├── interfaces/IRandomnessSource.sol   the swappable randomness boundary
│   │   └── probe/TransferProbe.sol     research-only; never deployed
│   ├── test/                   61 unit, fuzz and invariant tests
│   └── script/Deploy.s.sol
│
├── src/
│   ├── abi/                    generated typed ABIs (pnpm export:abis)
│   ├── app/                    routes
│   ├── components/             UI, incl. the Orbit Machine and admin console
│   ├── config/
│   │   ├── network.ts          Arc chain definitions + canonical addresses
│   │   ├── mode.ts             network + contract resolution
│   │   ├── rewards.ts          reward registry, derived from the verification report
│   │   ├── machines.ts         machine templates and reward tables
│   │   ├── compliance.ts       responsible-play limits
│   │   └── wagmi.ts            wallet configuration
│   ├── content/                FAQ and legal copy
│   ├── hooks/                  useSpin, useActivity, client-state helpers
│   └── lib/                    economics, formatting, activity
│
├── scripts/
│   ├── operator.ts             operator CLI — setup and the reveal daemon
│   ├── operator/               signer context and the randomness seed store
│   ├── verify-arc-tokens.ts    onchain token verification (the important one)
│   ├── export-abis.ts          contracts/out → typed TS modules
│   ├── generate-arcade-art.ts  isometric art pack (OpenAI, build-time only)
│   ├── fetch-token-logos.ts    real token logos + provenance manifest
│   ├── fetch-media.ts          licensed photography + attribution
│   ├── optimize-images.ts      PNG/JPEG -> web-sized WebP
│   └── data/                   candidate list and verification report
│
└── public/
    ├── generated/              24 isometric illustrations + manifest.json
    ├── tokens/                 real token logos + logo-manifest.json
    └── media/                  photographs + media-attribution.json
```

### Reusable systems

`Machine`, `Token`/`RewardAsset`, `Reward`/`RewardTier`, `Spin`, `Wallet`, `Transaction`,
`Network`, `MarketData` (snapshot type) and `FairnessProof` (`ActivityRecord`) are each
defined once and shared. The randomness adapter (`IRandomnessSource`) and the activity
indexer (`ActivitySource`) are interfaces specifically so they can be replaced.

---

## Setup

Requires **Node 22+**, **pnpm**, and **Foundry** for contract work.

```bash
git clone --recurse-submodules git@github.com:robachadotfun/arcade.git
cd arcade
pnpm install
cp .env.example .env.local     # then fill in a network and deployed addresses
pnpm dev
```

Already cloned without `--recurse-submodules`? Fetch the Foundry dependencies with:

```bash
git submodule update --init --recursive
```

`contracts/lib/` holds `forge-std` v1.16.2 and `openzeppelin-contracts` v5.6.1 as pinned git
submodules, so everyone builds against the same commits.

For contracts:

```bash
cd contracts
forge build
forge test -vv
```

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint, including the React Compiler rules |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (economics, compliance, formatting, commitment hashing) |
| `pnpm verify:all` | lint + typecheck + test + build |
| `pnpm machine:audit` | Reward-table risk review: odds, liabilities, break-even basket |
| `pnpm verify:tokens` | Re-verify reward candidates against Arc Mainnet |
| `pnpm export:abis` | Regenerate typed ABIs from `contracts/out` |
| `pnpm fetch:media` | Download licensed photography and rebuild attribution |
| `pnpm operator` | Operator CLI — setup, funding, and the reveal daemon |
| `pnpm fetch:logos` | Download real token logos and rebuild the logo manifest |
| `pnpm generate:art` | Generate the isometric art pack (needs `OPENAI_API_KEY`) |
| `pnpm optimize:images` | Convert art, photography and logos to web-sized WebP |
| `pnpm assets` | All of the above, in order |
| `pnpm contracts:test` | Foundry tests |

> **Dev server note.** `pnpm dev` uses Turbopack. If your environment cannot spawn
> Turbopack's pooled Node workers for the PostCSS pipeline, run
> `next dev --webpack` instead; production builds are unaffected.

---

## Arc network configuration

Every value below was taken from Arc's official documentation and confirmed live against the
RPC endpoints on 2026-09-18.

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain ID | `5042` | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| Native asset | USDC | USDC |

### The decimals trap

On Arc, USDC exists in two representations with **different precision**:

- **native USDC** — the gas asset, spent as `msg.value`: **18 decimals**
- **the USDC ERC-20 interface** at `0x3600000000000000000000000000000000000000`: **6 decimals**

Arc's own documentation warns against mixing them. Arcade prices spins in the **native**
asset, so every spin price in this codebase is an 18-decimal value and a spin needs one
signature with no ERC-20 approval. All amount formatting goes through `src/lib/format.ts`;
no call site is allowed to guess a decimal count.

### Wallet setup

Add Arc to any EVM wallet with the values above. Arcade uses the injected connector, so any
browser wallet works. Testnet USDC comes from the Circle faucet.

> **Why not RainbowKit?** RainbowKit 2.x peers on `wagmi@^2.9` and is incompatible with
> wagmi 3. More importantly, its modal carries its own visual identity, and this product is a
> bespoke surface — stripping that back out costs more than writing the small accessible
> connect dialog in `src/components/WalletButton.tsx`.

---

## Going live

A deployed stack is not a working one. `ArcadeMachineManager` will reject a spin until
randomness commitments exist and the vault can cover the worst case for every token on the
machine — and once it does accept spins, **something has to reveal the randomness**, or every
spin expires and is refunded with the operator bond slashed.

`pnpm operator` is that something. Run `pnpm operator status` at any point; it reports every
remaining blocker and ends with a plain answer to "can a spin happen right now?".

```bash
# 0. Set up a signer. The key is read with echo off — it does not reach your shell
#    history, your scrollback, or any file in this repository.
cast wallet import arcade-operator --interactive

# 1. Deploy. ARCADE_ADMIN should be a multisig for anything holding real value; the
#    deploying wallet is admin only for the length of the broadcast, then renounces.
#    The operator wallet needs these three roles for `pnpm operator` to work.
cd contracts
ARCADE_ADMIN=<multisig-or-your-address> \
ARCADE_RANDOMNESS_OPERATOR=<operator-address> \
ARCADE_MACHINE_ADMIN=<operator-address> \
ARCADE_REGISTRY_ADMIN=<operator-address> \
forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_MAINNET_RPC_URL \
  --account arcade-operator --broadcast

# 2. Put the five printed addresses in .env.local, plus NEXT_PUBLIC_ARCADE_MODE
#    and ARCADE_OPERATOR_ACCOUNT=arcade-operator. `pnpm operator` reads .env.local.

# 3. Bring the stack up.
pnpm operator commitments 500      # publish randomness commitments, ahead of demand
pnpm operator bond 500             # post the operator bond
pnpm operator register-tokens      # register the verified reward assets
pnpm operator fund ARGUS 200000    # deposit inventory — repeat per reward token
pnpm operator machines             # create machines, publish reward tables

# 4. Copy the printed NEXT_PUBLIC_ARCADE_MACHINE_IDS into .env.local and rebuild.

# 5. Keep this running for as long as Arcade accepts spins.
pnpm operator reveal
```

Reward inventory has to be acquired on the open market first — nothing here mints it, and
`fund` refuses rather than partially depositing if the signer's balance is short.

### Signing

The operator CLI resolves a signer in this order:

| Variable | Notes |
| --- | --- |
| `ARCADE_OPERATOR_KEYSTORE` | Path to a Web3 Secret Storage v3 JSON file |
| `ARCADE_OPERATOR_ACCOUNT` | A name under `~/.foundry/keystores` — **recommended** |
| `ARCADE_OPERATOR_PRIVATE_KEY` | Raw hex. Testnet and throwaway keys only |

With a keystore, the password is prompted for with echo disabled and the decrypted key
exists only in process memory for the life of one command. `ARCADE_OPERATOR_PASSWORD` exists
for unattended `reveal` runs; it puts a secret back in the environment, so it belongs in a
process manager's secret store rather than a shell profile.

**For mainnet, prefer a hardware wallet.** `forge script --ledger` keeps the key on the
device, where nothing in this repository can reach it. A raw key in an environment variable
is readable by every process that inherits the environment and sits in plaintext on disk.

### The seed store

Commit–reveal means pre-images have to survive between the commit and the reveal. They live
in `scripts/data/seeds/<chainId>-<randomness>.json`, written `0600` and gitignored.

Lose it and every unrevealed commitment becomes unrevealable: those spins expire and are
refunded with a penalty slashed per spin. Leak it before the matching spins resolve and the
holder can predict those outcomes — they still cannot change one, since the anchor blockhash
did not exist at commit time, but foreknowledge is enough to decide when to play. **Back it
up as carefully as the key.**

### Not configured

With `NEXT_PUBLIC_ARCADE_MODE` or any contract address unset, `resolveMode()` returns
`misconfigured`, the UI refuses to offer spins, and the header shows "Not configured" with
the missing variables named. There is nothing to fall back *to* — which is the point. A
player must never see a fabricated outcome while believing it is real.

---

## Contracts

| Contract | Responsibility |
| --- | --- |
| `ArcadeMachineManager` | Machines, append-only versioned reward tables, spin lifecycle. Freezes price/machine/version/player into each spin. Enforces maximum liability before accepting one. Settlement is permissionless. |
| `PrizeVault` | Holds reward inventory and the invariant `balance >= reserved` per token. Push with a pull fallback. |
| `RewardRegistry` | Token allowlist. Asserts `symbol()` and `decimals()` against the token contract at registration; decimals are immutable afterwards. |
| `CommitRevealRandomness` | Verifiable randomness. Implements `IRandomnessSource`. |
| `FeeRouter` | Splits revenue between reward funding and treasury. Accumulates rather than forwarding, so a failing destination cannot make settlement revert. |

### Roles

| Role | Can | Cannot |
| --- | --- | --- |
| `MACHINE_ADMIN` | Create machines, publish versions | Settle spins, move funds |
| `REGISTRY_ADMIN` | Curate the token allowlist | Move funds |
| `TREASURER` | Deposit inventory, withdraw **unreserved** surplus | Touch reserved prizes |
| `RANDOMNESS_OPERATOR` | Publish commitments, reveal seeds | Choose outcomes |
| `GUARDIAN` | Pause | Unpause, configure, move funds |

No role can alter a settled outcome. Pausing stops new spins and never strands one in flight.

### What is frozen when a spin is accepted

Price, machine id, machine version, player, and the randomness adapter that issued the
request. That last one matters: each spin stores its own `randomnessSource`, so swapping the
global adapter cannot redirect an in-flight spin at a different oracle — which would
otherwise be an admin-controlled re-roll.

---

## Deployment

```bash
cd contracts

export ARCADE_ADMIN=0x...                 # a multisig, for anything real
export ARCADE_RANDOMNESS_OPERATOR=0x...
export ARCADE_GUARDIAN=0x...
# ... see .env.example for the full role list

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_TESTNET_RPC_URL --broadcast --verify
```

The script wires the inter-contract permissions and warns if every role collapsed onto one
address. Then, in order:

1. **Publish randomness commitments.** `publishCommitments(bytes32[])`. Commitments must
   exist before the spins that consume them; keep the pool well ahead of demand.
2. **Deposit the operator bond.** `depositBond()` with native USDC. This is what gets slashed
   to compensate a player if a reveal is withheld.
3. **Register reward tokens.** Run `pnpm verify:tokens`, review the report, then
   `registerToken(...)` as `REGISTRY_ADMIN`.
4. **Deposit reward inventory.** `approve` then `depositReward(token, amount)`. The vault
   records the *measured delta*, so a fee-on-transfer token cannot inflate recorded inventory.
5. **Create a machine and publish a version.** `createMachine(...)` then
   `publishVersion(machineId, spinPrice, tiers, effectiveBlock)`. Review the admin risk panel
   first — it refuses to confirm a version with a blocking finding.
6. **Set the onchain machine ids** in `src/config/machines.ts` and the contract addresses in
   your environment.

---

## Reward token verification

`pnpm verify:tokens` is the gate on what can become a reward. For each candidate it:

1. confirms contract code exists at the address
2. reads `name` / `symbol` / `decimals` / `totalSupply` from the contract
3. finds a real holder from live `Transfer` logs
4. **executes `transfer` against live mainnet state** via an `eth_call` state override,
   measuring what actually arrives
5. flags ticker collisions using what the *contracts* report, not the labels
6. applies liquidity, volume, holder and age thresholds

Step 4 is the one that matters. Injecting `TransferProbe` bytecode at a holder's address lets
us call `transfer` with `msg.sender == holder` against live state without broadcasting a
transaction or moving funds — read-only, no keys, no cost. It detects fee-on-transfer skim,
blacklists, paused transfers and non-standard return values.

**Anything unverified fails closed.** Four candidates had no code-less holder in the scanned
window; their transfer behaviour is recorded as `UNVERIFIED` and they are ineligible.

Output is `scripts/data/arc-token-verified.json`, the only file permitted to seed the reward
registry. Results from the run on 2026-09-18 at block 21,389,832:

- **34 candidates checked, 13 eligible, 21 rejected**
- rejections included both `USDC` ticker-squatters, both `Architects` duplicates, and a
  name-adjacent `ARCADEX` token — none of which are affiliated with this project
- 30 of 34 received a live transfer probe; all clean at 0 bps fee

Re-run it whenever you change the candidate list. Arc mainnet opened on 2026-09-16 and its
ecosystem will churn for months, which is exactly why **no ranking is baked into the UI** —
ordering comes from live registry state.

### What "Verified by Arcade" means

That we checked the token **contract**: the right address, honest decimals, and transfers that
do not skim. It is **not** a statement about the asset's quality, price or prospects, and it
is not an endorsement.

---

## Machine configuration and economic safety

`src/lib/economics.ts` evaluates a machine before it can go live:

- **Expected value** — `Σ probability × mean amount × price`, against spin revenue
- **Payout ceiling** — expected payout must stay at or below 85% of revenue
- **Maximum liability** — worst-case payout per token, computed exactly as the contract does
- **Inventory coverage** — must cover 10 concurrent worst-case spins
- **Runway** — warns below 25 worst-case spins of inventory

A version with any *blocking* finding cannot be confirmed in the admin console.

**Prices are entered by hand, never fetched.** Arc reward assets are thin and volatile;
quietly pulling a spot price into a solvency decision would produce a confident number built
on unreliable data. USD figures inform a human decision. The hard check — the one enforced
onchain — works in **token units** with no price feed involved.

The machine tables in `src/config/machines.ts` are **development defaults**, clearly marked as
such. In a live mode the UI reads machines, versions and reward tables from the contract, and
each published version is sealed with its own `configHash`.

---

## Randomness design

### Why commit–reveal

Arc has no VRF. The alternatives were to misrepresent a `blockhash` scheme as provably fair,
or to build something honest and document it. This is the second.

### Construction

1. The operator publishes commitments `H(seed, salt)` onchain **in advance**. They are
   consumed in strict ascending order, each exactly once.
2. A spin binds the next unconsumed commitment to the player, the spin id, the machine
   version, the config hash, `blockhash(requestBlock - 1)`, and a future **anchor block**.
3. The operator reveals `(seed, salt)`. The contract checks the hash against the pre-published
   commitment and derives:

```
randomWord = keccak256(seed, salt, requestEntropy, blockhash(anchorBlock))

tierIndex  = keccak256(randomWord, "tier")   % totalWeight   -> weighted band
amount     = keccak256(randomWord, "amount") % (span + 1)    -> within that band
```

The band and the amount come from independent domains of the same word, so they are
uncorrelated. Both are pure functions of public data, which is why settlement is
permissionless: the answer is identical whoever calls it.

### What this guarantees

- **The operator cannot choose an outcome.** The seed was committed before the spin existed
  and the anchor block was not yet mined. Revealing anything else fails the hash check.
- **The player cannot predict an outcome.** The seed is hidden behind its commitment.
- **No re-rolls.** One commitment per request, consumed once. A revealed word is immutable and
  no admin function can overwrite it.
- **Anyone can recompute the result.** The contract exposes a pure `recompute(...)` so you can
  check its own stored answer.

### The residual trust assumption

Between the anchor block and the reveal, the operator can compute the outcome and could choose
to **withhold** it. Withholding denies a result; it cannot change one.

Mitigations, all mechanical:

- After the reveal window, **anyone** may call `reportMissedReveal`. The request becomes
  `Failed`, the player is refunded in full, and a penalty is slashed from the operator's bond
  and paid to them.
- Missed reveals are counted onchain in `missedReveals` and published.

A VRF would remove this assumption. `IRandomnessSource` exists so one can be dropped in
without redeploying the machine, vault or registry — and without affecting spins in flight.

### The animation decides nothing

`OrbitMachine` takes a `settledIndex` prop and animates toward it. In a live mode that index
derives from the random word already fixed onchain. Closing the tab mid-spin changes nothing;
the spin remains settleable by anyone.

---

## Testing

```bash
pnpm verify:all        # lint + typecheck + unit tests + production build
pnpm contracts:test    # 61 Foundry tests
```

### Contract tests — 61 passing

**Spin lifecycle (21)** — happy path; revenue only forwarded on settlement; permissionless
settlement producing a caller-independent outcome; double-settle rejected; settle-before-reveal
rejected; wrong payment rejected; stale version expectation rejected; paused machine rejects new
spins but still settles in-flight ones; guardian cannot unpause; global pause.

**Inventory and solvency** — spin refused when inventory cannot cover the worst case; liability
check scales with concurrent pending spins; treasurer cannot withdraw reserved rewards;
pull fallback when a token blacklists the winner or returns `false`; double-claim rejected;
only the winner can claim.

**Refunds** — refund on abandoned randomness including the slashed bond penalty; refund blocked
before abandonment; settle rejected after refund; refunds are *credited and pulled*, so a
player contract with a reverting `receive` cannot wedge the path.

**Reentrancy** — a hostile token reentering `settleSpin` from its transfer hook is rejected and
the player is paid exactly once.

**Randomness (16)** — commitments consumed in order and exactly once; reveal requires the
committed pre-image (wrong seed *and* wrong salt both rejected); reveal window boundaries;
revealed word immutable with no admin override; **independent recomputation from published
data**; requests fail when commitments run out; penalty capped by the available bond; timing
constrained inside the blockhash horizon; **swapping the randomness source does not affect
pending spins**; outcome distribution tracks configured weights over 20,000 samples; fuzz tests
proving rewards always land inside the published band and resolution is deterministic.

**Registry (23)** — declared decimals that disagree with the contract are rejected; declared
symbol that disagrees is rejected (the `USDC`-squatter case); a squatter can only be registered
under its *real* symbol; decimals immutable after registration; paused token cannot enter a new
table but does not strand in-flight spins; vault records the *measured* amount for a
fee-on-transfer token; full machine-config validation; previous versions remain readable after
republish.

**Invariants (6, over 8,192 calls)** — the vault never owes more than it holds; reserved always
covers outstanding claims; settlement and refund counts are exact; resolved spins never exceed
requested; commitments consumed at most once and exactly one per request; the manager can always
cover credited refunds.

The invariant handler drives randomised sequences of spins, reveals, settlements, abandonments,
claims, deposits and adversarial treasurer sweeps.

### Frontend tests — 49 passing

Machine odds sum to 1 and every configured token is in the verified registry; the economics
module blocks negative-margin, over-ceiling, unverified-token, empty-table and
inventory-short configurations; session limit boundaries and self-exclusion precedence;
decimal formatting across 6/8/18-decimal tokens including that a small cirBTC reward never
renders as `0.00`; sub-1% odds stay legible; and the commitment digest the operator tooling
publishes matches the one `CommitRevealRandomness.reveal` recomputes — pinned against
Solidity, because a mismatch there would make every published commitment unrevealable.

### Manual verification performed

The full lifecycle driven end to end against a local fork of Arc Mainnet: contracts
deployed, all 13 reward assets registered (which re-asserts `symbol()`/`decimals()` against
the real token contracts), inventory funded, four machines created with reward tables
published, then a real `requestSpin` paying 2 USDC — the reveal daemon picked the request up
unprompted, revealed it, and settlement pushed 18,059.89 ARCAT to the player's wallet. The
stored random word was then recomputed independently from the revealed seed, salt, entropy
and anchor blockhash, and matched. Session counters verified to record exactly one spin,
spend-limit blocking confirmed, and responsive layouts checked at 375 / 768 / 1440 px.

Three genuine bugs were found and fixed this way, all invisible to the type checker: an
infinite render loop where a storage write invalidated the snapshot its own effect depended
on; a temporal-dead-zone crash from a hoisted function reading a `const` before
initialisation; and a `RewardRegistry` guardian role that was documented but never granted.

---

## Asset generation

### Generated art

```bash
export OPENAI_API_KEY=sk-...    # server-only, never committed
pnpm generate:art               # fills any gaps
pnpm generate:art --force       # regenerate everything
pnpm optimize:images            # PNG -> web-sized WebP
```

21 **isometric technical illustrations** in `public/generated/`, generated with
`gpt-image-2.5-sunburst` and recorded in a manifest alongside the exact prompt that produced
each one, so the set is reproducible.

They are illustrations rather than photographs on purpose: the Arcade machine, the
commitment rack, the prize vault and the four rarity pedestals are all *drawn objects* in
true 30° axonometric projection, restricted to the Arc palette. The shared art direction
explicitly forbids icons, pictograms, text and symbols — every surface is blank — because a
generated pictogram reads as stock filler, and a generated glyph on a token disc would look
like a logo that does not exist.

| Group | Assets |
| --- | --- |
| Hero | `hero-orbit`, `hero-atmosphere` |
| Machines | `genesis-machine`, `velocity-machine`, `bluechip-machine`, `discovery-machine`, `machine-zero` |
| Fairness | `fairness-commitment`, `fairness-reveal`, `reward-chamber`, `verification` |
| Rewards | `rewards-array`, `vault`, `treasury` |
| Rarity | `rarity-common`, `rarity-rare`, `rarity-ultra`, `rarity-jackpot` |
| Structure | `settlement`, `network-arc` |
| Empty states | `empty-tape`, `empty-wallet` |

Each machine gets its own illustration rather than a recoloured copy of one: Genesis is broad
and open, Velocity resolves into a motion arc, Blue Chip is heavy and stepped, Discovery has
three concentric tracks, and Machine Zero is deliberately half-assembled on a drafting plane.

#### How they sit on the page

They are not framed. Each illustration renders at its **natural aspect ratio** with no border,
no panel and no crop, composited with `mix-blend-mode: multiply`.

That only works because `pnpm optimize:images` first remaps each illustration's own ground to
pure white: it samples the four corners, takes the median, and scales the channels so that
colour becomes `#ffffff`. Multiply against white is a no-op, so the rectangle disappears
entirely and the isometric page grid shows straight through the artwork. Skip that step and
the cream ground multiplies against the ivory paper into a visibly darker box — which is
precisely the pasted-in look the frameless treatment is for.

The consequence is that an asset's own proportions decide its height, so layouts cap width
rather than forcing a band. It also assumes a light page background; on a dark surface
multiply would go muddy.

The two photographs get the equivalent treatment by different means — a photograph has real
tone everywhere, so instead of blending it is edge-feathered with a radial mask and pulled
toward the ivory palette.

**The site does not need any of it.** Every structural visual — the interactive orbit machine,
the hero geometry, the fairness diagram, the odds rail — is hand-drawn SVG, and the isometric
ground grid behind sections is the `iso-grid` CSS utility rather than an image. With the key
absent, `pnpm generate:art` exits cleanly, `ArcadeArt` renders nothing for a missing asset,
and every page still reads correctly.

**Key handling.** `OPENAI_API_KEY` is read only inside that Node script. It is never exposed
through a `NEXT_PUBLIC_*` variable, never imported by anything under `src/`, never bundled
into client JavaScript, and never logged or written to the manifest. The site makes no OpenAI
calls at runtime.

### Token logos

```bash
pnpm fetch:logos
```

Downloads each verified reward token's **real published logo** into `public/tokens/`, keyed by
contract address, and records the source of every file in `public/tokens/logo-manifest.json`.
12 of the 13 verified assets have one.

Two rules:

- **Nothing is drawn or approximated.** On a chain where six candidate tickers collide —
  including two tokens squatting `USDC` — a plausible-looking fake mark is a direct route to
  confusing two different assets.
- **A token with no published logo keeps a typographic monogram.** `cirBTC` publishes no mark
  through any source checked, so it gets initials, and the manifest records *why* as a checked
  finding rather than an oversight.

Logos are matched by **address, never by ticker**, and `TokenGlyph` falls back to the monogram
at runtime if a file ever goes missing.

### Photography

```bash
pnpm fetch:media
```

Two Creative Commons photographs used as sparing editorial accents, with
`public/media/media-attribution.json` written from licence metadata read out of the Wikimedia
Commons API **at download time** rather than transcribed — a wrong credit on a CC BY image is
a licence breach, not a typo. The script refuses to save a file whose licence it cannot
confirm or that has no named author, and `EditorialImage` refuses to render an image with no
attribution record.

| File | Creator | Licence |
| --- | --- | --- |
| `machined-ring.webp` | Olivier Cleynen | CC BY-SA 3.0 |
| `architecture-curve.webp` | Kidfly182 | CC BY 4.0 |

Credits render beside each image and in full on `/contracts`.

### Image optimisation

`pnpm optimize:images` converts everything to WebP at a sensible ceiling width and rewrites
the manifests to match. The current pack goes from **32 MB to 1.2 MB (96% smaller)**; originals are replaced rather
than kept, since both the art and the photography are regenerable. For generated art it also
performs the ground-whitening described above.

`pnpm assets` runs the whole chain: photography, logos, art, optimisation.

## Security assumptions

**The contracts have not been independently audited.** They ship with 61 unit, fuzz and
invariant tests, including a solvency invariant across 8,192 randomised calls. That is
meaningful evidence and it is not an audit.

Assumptions Arcade relies on:

1. **The randomness operator may withhold but cannot alter.** Bounded by refunds and bond
   slashing; not eliminated. See [Randomness design](#randomness-design).
2. **Reward tokens behave as verified at the time they were registered.** An upgradeable token
   could change behaviour afterwards. Mitigations: registry pause, and the vault's pull
   fallback so a hostile token cannot wedge settlement or burn a reward.
3. **Role holders are honest within their role.** The role split limits blast radius — the
   treasurer cannot touch reserved prizes, the machine admin cannot settle, the guardian can
   only pause. `DEFAULT_ADMIN_ROLE` should be a multisig.
4. **`blockhash` is available for the anchor block.** The reveal window is constrained inside
   the 256-block horizon; if it ever lapses, reveal fails and the player is refunded.
5. **The admin console's shared secret is not a production auth system.** See the checklist.
6. **Event-log activity reading is adequate only at low volume.** Replace with a real indexer
   via the `ActivitySource` interface.

Implemented defences: `SafeERC20`, `ReentrancyGuard` on every value-moving path, role-based
access control, emergency pause, append-only machine versions, measured-delta deposits,
pull-based refunds and claims, per-spin randomness-source pinning, and no unchecked external
calls.

---

## Regulatory and legal review

> **A production launch requires jurisdiction-specific legal review.**

Arcade sells a **randomised outcome for money**. Depending on jurisdiction that may be
regulated as gambling, a lottery, a game of chance or a prize competition. The rules differ
sharply between regions and change often.

Before accepting value from real users, an operator must:

1. Obtain legal advice covering **every jurisdiction served**.
2. Populate `NEXT_PUBLIC_ARCADE_BLOCKED_REGIONS` from that advice, and **enforce it at the
   edge** — the client-side check is advisory only.
3. Replace self-attested age with whatever verification the jurisdiction requires.
4. Replace browser-local session limits with server-enforced controls where mandated —
   deposit limits, cooling-off periods, enforced self-exclusion registers.
5. Have counsel complete and review `src/content/legal.ts`. Bracketed placeholders like
   `[OPERATOR LEGAL ENTITY]` and `[GOVERNING LAW]` are **deliberately left visible**:
   inventing an operating entity or governing law would create a document that looks
   authoritative while being wrong.
6. Signpost the correct national support services for each market.

The interface never disguises what is happening: the entry notice states that you are paying
for a randomised outcome, the play screen restates the exact cost before signing, and the risk
disclosure says plainly that most spins return less than they cost.

---

## Production checklist

**Contracts**
- [ ] Independent security audit
- [ ] `DEFAULT_ADMIN_ROLE` held by a multisig
- [ ] Every role split across separate signers
- [ ] Operator bond funded well above `missedRevealPenalty`
- [ ] Commitment pool automated and monitored for depletion
- [ ] Reveal automation with alerting on missed reveals

**Configuration**
- [ ] `pnpm verify:tokens` re-run; report reviewed
- [ ] Every machine version passes the admin risk panel with no blocking findings
- [ ] Inventory runway monitored with top-up alerting
- [ ] Machine `onchainId` values set in `src/config/machines.ts`

**Application**
- [ ] `NEXT_PUBLIC_ARCADE_MODE=mainnet` with all five addresses set
- [ ] Dedicated RPC provider (public endpoints rate-limit log queries)
- [ ] Real indexer behind `ActivitySource`
- [ ] `/admin` moved off the shared secret to SIWE or SSO with an audit trail
- [ ] `ARCADE_ADMIN_KEY` rotated or removed

**Legal**
- [ ] Jurisdiction review complete and blocklist enforced at the edge
- [ ] Terms, Privacy, Risk Disclosure and Responsible Play reviewed by counsel
- [ ] All `[PLACEHOLDER]` values completed
- [ ] Support signposting correct per market

**Verify**
- [ ] `pnpm verify:all` green
- [ ] `pnpm contracts:test` green
- [ ] Tested on mobile, tablet and desktop
- [ ] Wrong-network, insufficient-funds, rejected-transaction, interrupted-transaction,
      refresh-during-pending, empty-vault, failed-transfer, duplicate-settlement, admin-pause
      and machine-version-change paths all exercised

---

## Licence

Application code is provided as-is for evaluation. Third-party photography retains its own
licences, recorded in `public/media/media-attribution.json`. Arcade is an independent
application built on Arc and is not affiliated with or endorsed by Circle or Arc.
