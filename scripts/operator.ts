/**
 * operator.ts — the Arcade operator CLI.
 *
 * Deploying the contracts is not enough to make Arcade work. A deployed stack accepts no
 * spins until randomness commitments exist, an operator bond is posted, reward tokens are
 * registered, inventory is funded, and machines have published versions. And once it does
 * accept spins, **something has to reveal the randomness** — without that every spin sits
 * pending until its window closes and is refunded with a penalty.
 *
 * This CLI is that something. It is deliberately one file of explicit steps rather than a
 * one-shot "go live" button: each step is separately runnable, separately verifiable, and
 * tells you what it is about to do.
 *
 * ## Commands
 *
 *   pnpm operator status                  — read-only health check of the whole stack
 *   pnpm operator commitments <count>     — generate seed pairs and publish their hashes
 *   pnpm operator bond <usdc>             — post the operator bond
 *   pnpm operator register-tokens [--all] — register assets the live machines pay out
 *   pnpm operator fund <symbol> <amount>  — deposit reward inventory into the vault
 *   pnpm operator machines                — create machines and publish reward tables
 *   pnpm operator reveal                  — run the reveal daemon (long-running)
 *
 * `status` needs no key. Everything else sends transactions and needs
 * `ARCADE_OPERATOR_PRIVATE_KEY`; see `operator/context.ts` for how that is handled.
 *
 * ## Order matters
 *
 * commitments and bond can happen any time before the first spin. Tokens must be registered
 * before inventory can be deposited for them, and inventory must exist before a machine that
 * pays them will accept a spin — `ArcadeMachineManager` checks worst-case liability for every
 * token on every spin and rejects one it could not cover. `status` reports where you are.
 */

// Must stay the first import: it loads .env.local before config modules read it.
import './operator/env'
import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {formatUnits, parseUnits, decodeEventLog, type Address, type Hex} from 'viem'
import {
  arcadeMachineManagerAbi,
  commitRevealRandomnessAbi,
  feeRouterAbi,
  prizeVaultAbi,
  rewardRegistryAbi,
} from '../src/abi'
import {
  assertChain,
  fail,
  loadContext,
  log,
  NATIVE_USDC_DECIMALS,
  ConfigError,
  type OperatorContext,
} from './operator/context'
import {SignerError} from './operator/signer'
import {
  byIndex,
  commitmentFor,
  generatePairs,
  loadStore,
  saveStore,
  storePath,
  unpublished,
} from './operator/seedstore'
import {MACHINES, RARITY_ORDER, type MachineConfig} from '../src/config/machines'
import {ARCADE_POOL_ID, ARCADE_TOKEN, BURN_ADDRESS} from '../src/config/token'
import {REWARD_ASSETS, assetByAddress, labelFor} from '../src/config/rewards'

/** The three ERC-20 calls this file needs, rather than a full ABI import. */
const ERC20_MINI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{type: 'uint256'}],
  },
] as const

// ─────────────────────────────────────────────────────────────────────── helpers

function heading(text: string): void {
  log(`\n${text}\n${'─'.repeat(text.length)}`)
}

/**
 * Announces a transaction, waits for it, and fails loudly if it reverts.
 *
 * Takes a callback rather than a request object because viem narrows `writeContract` on the
 * literal `functionName` at the call site; handing it a pre-built object collapses the
 * payable and nonpayable overloads and loses `value`.
 */
async function send(
  ctx: OperatorContext,
  description: string,
  run: () => Promise<Hex>,
): Promise<Hex> {
  if (!ctx.walletClient) throw new ConfigError('No signer configured.')
  log(`  → ${description}`)
  const hash = await run()
  const receipt = await ctx.publicClient.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted: ${hash}`)
  }
  log(`    ✓ ${hash}  (block ${receipt.blockNumber})`)
  return hash
}

// ─────────────────────────────────────────────────────────────────────── status

async function status(): Promise<void> {
  const ctx = await loadContext({requireSigner: false})
  await assertChain(ctx)

  heading(`Arcade on ${ctx.chain.name} (chain ${ctx.chain.id})`)
  log(`  signer              ${ctx.account ?? 'none configured (read-only)'}`)
  if (ctx.signerSource) log(`                      via ${ctx.signerSource}`)
  log(`  machine manager     ${ctx.contracts.machineManager}`)
  log(`  randomness          ${ctx.contracts.randomness}`)

  const pc = ctx.publicClient
  const R = {address: ctx.contracts.randomness, abi: commitRevealRandomnessAbi} as const

  const [available, committed, consumed, bond, delay, window] = await Promise.all([
    pc.readContract({...R, functionName: 'availableCommitments'}),
    pc.readContract({...R, functionName: 'commitmentCount'}),
    pc.readContract({...R, functionName: 'nextCommitmentIndex'}),
    pc.readContract({...R, functionName: 'operatorBond'}),
    pc.readContract({...R, functionName: 'revealDelayBlocks'}),
    pc.readContract({...R, functionName: 'revealWindowBlocks'}),
  ])

  heading('Randomness')
  log(`  commitments published   ${committed}`)
  log(`  consumed                ${consumed}`)
  log(`  available for spins     ${available}${available === 0n ? '   ← NO SPINS POSSIBLE' : ''}`)
  log(`  operator bond           ${formatUnits(bond, NATIVE_USDC_DECIMALS)} USDC${bond === 0n ? '   ← unbonded' : ''}`)
  log(`  reveal delay / window   ${delay} / ${window} blocks`)

  const store = loadStore(ctx.chain.id, ctx.contracts.randomness)
  const localUnrevealed = store.entries.filter((e) => e.index !== null && e.revealedFor === null)
  log(`  local seed store        ${store.entries.length} pairs (${localUnrevealed.length} published, unrevealed)`)
  log(`                          ${storePath(ctx.chain.id, ctx.contracts.randomness)}`)
  if (Number(committed) > store.entries.filter((e) => e.index !== null).length) {
    log('  ⚠ more commitments are published onchain than this store can reveal.')
    log('    Those spins will be refunded with a penalty. Restore the matching store.')
  }

  heading('Reward registry')
  const registered = await pc.readContract({
    address: ctx.contracts.rewardRegistry,
    abi: rewardRegistryAbi,
    functionName: 'tokenCount',
  })
  log(`  tokens registered       ${registered} (of ${REWARD_ASSETS.length} verified locally)`)

  heading('Vault inventory')
  // Only assets a live machine can actually pay out. A verified token no live machine
  // references needs no inventory, and counting it as a blocker reports a working
  // deployment as broken.
  const inPlay = new Set<string>()
  for (const machine of MACHINES) {
    if (machine.status === 'disabled') continue
    for (const tier of machine.tiers) inPlay.add(tier.token.toLowerCase())
  }
  let anyEmpty = false
  for (const asset of REWARD_ASSETS.filter((a) => inPlay.has(a.address.toLowerCase()))) {
    const [avail, isReg] = await Promise.all([
      pc.readContract({
        address: ctx.contracts.prizeVault,
        abi: prizeVaultAbi,
        functionName: 'availableOf',
        args: [asset.address as Address],
      }),
      pc.readContract({
        address: ctx.contracts.rewardRegistry,
        abi: rewardRegistryAbi,
        functionName: 'isRegistered',
        args: [asset.address as Address],
      }),
    ])
    if (avail === 0n) anyEmpty = true
    log(
      `  ${labelFor(asset).padEnd(10)} ${formatUnits(avail, asset.decimals).padStart(18)}` +
        `   ${isReg ? 'registered' : 'NOT REGISTERED'}`,
    )
  }

  heading('Machines')
  const count = await pc.readContract({
    address: ctx.contracts.machineManager,
    abi: arcadeMachineManagerAbi,
    functionName: 'machineCount',
  })
  log(`  created onchain         ${count}`)
  const mapping: string[] = []
  for (const machine of MACHINES) {
    if (machine.onchainId === null) {
      log(`  ${machine.slug.padEnd(14)} not mapped — set NEXT_PUBLIC_ARCADE_MACHINE_IDS`)
      continue
    }
    const onchain = await pc.readContract({
      address: ctx.contracts.machineManager,
      abi: arcadeMachineManagerAbi,
      functionName: 'machineOf',
      args: [BigInt(machine.onchainId)],
    })
    mapping.push(`${machine.slug}:${machine.onchainId}`)
    log(
      `  ${machine.slug.padEnd(14)} #${machine.onchainId}  v${onchain.currentVersion}` +
        `  ${onchain.exists ? (onchain.paused ? 'PAUSED' : 'live') : 'DOES NOT EXIST'}`,
    )
  }
  if (mapping.length > 0) log(`\n  NEXT_PUBLIC_ARCADE_MACHINE_IDS=${mapping.join(',')}`)

  /*
   * Compare the local reward table against the one actually published.
   *
   * Everything above reads config to decide what to check. That is fine for inventory, but it
   * made "every precondition is met" mean "the config is satisfiable", not "the chain pays
   * what this file says". A token funded in the vault and added to config still is not paid
   * out until a version carrying it is published, and status said yes anyway.
   */
  heading('Config vs chain')
  let drift = false
  for (const machine of MACHINES) {
    if (machine.status === 'disabled' || machine.onchainId === null) continue
    const onchain = await pc.readContract({
      address: ctx.contracts.machineManager,
      abi: arcadeMachineManagerAbi,
      functionName: 'machineOf',
      args: [BigInt(machine.onchainId)],
    })
    const published = await pc.readContract({
      address: ctx.contracts.machineManager,
      abi: arcadeMachineManagerAbi,
      functionName: 'versionTokens',
      args: [BigInt(machine.onchainId), onchain.currentVersion],
    })
    const onchainSet = new Set(published.map((a) => a.toLowerCase()))
    const configSet = new Set(machine.tiers.map((t) => t.token.toLowerCase()))

    const missing = [...configSet].filter((a) => !onchainSet.has(a))
    const extra = [...onchainSet].filter((a) => !configSet.has(a))

    if (missing.length === 0 && extra.length === 0) {
      log(`  ${machine.slug.padEnd(14)} v${onchain.currentVersion} matches config`)
      continue
    }
    drift = true
    log(`  ${machine.slug.padEnd(14)} v${onchain.currentVersion} DIFFERS from config`)
    for (const a of missing) {
      const asset = assetByAddress(a as Address)
      log(`    in config, not published:  ${asset ? labelFor(asset) : a}`)
    }
    for (const a of extra) {
      const asset = assetByAddress(a as Address)
      log(`    published, not in config:  ${asset ? labelFor(asset) : a}`)
    }
  }
  if (drift) log('\n  Run `pnpm operator machines` to publish the config as a new version.')

  heading('Can a spin happen right now?')
  const blockers: string[] = []
  if (available === 0n) blockers.push('no randomness commitments available')
  if (bond === 0n) blockers.push('no operator bond posted')
  if (Number(registered) === 0) blockers.push('no reward tokens registered')
  if (anyEmpty) blockers.push('a reward token a live machine pays has zero vault inventory')
  if (MACHINES.every((m) => m.onchainId === null)) blockers.push('no machine ids mapped')
  if (drift) blockers.push('the published reward table does not match config (see above)')
  if (blockers.length === 0) {
    log('  Yes — every precondition is met. Keep `pnpm operator reveal` running.')
  } else {
    for (const b of blockers) log(`  ✗ ${b}`)
  }
}

// ──────────────────────────────────────────────────────────────── commitments

async function commitments(countArg: string | undefined): Promise<void> {
  const count = Number.parseInt(countArg ?? '', 10)
  if (!Number.isInteger(count) || count <= 0 || count > 500) {
    fail('Usage: pnpm operator commitments <count>   (1–500 per batch)')
  }

  const ctx = await loadContext()
  await assertChain(ctx)

  const store = loadStore(ctx.chain.id, ctx.contracts.randomness)

  // Reuse any pairs generated but never published — otherwise a failed publish would orphan
  // them and quietly grow the store forever.
  const pending = unpublished(store)
  const fresh = pending.length >= count ? [] : generatePairs(store, count - pending.length)
  const batch = [...pending, ...fresh].slice(0, count)

  // Persist BEFORE publishing. If the transaction lands and the process dies, the pre-images
  // still exist; the reverse would be unrecoverable.
  saveStore(store)
  log(`  ${batch.length} pairs ready (${fresh.length} newly generated), store saved.`)

  const before = await ctx.publicClient.readContract({
    address: ctx.contracts.randomness,
    abi: commitRevealRandomnessAbi,
    functionName: 'commitmentCount',
  })

  const hash = await send(ctx, `publishCommitments(${batch.length})`, () =>
    ctx.walletClient!.writeContract({
    address: ctx.contracts.randomness,
    abi: commitRevealRandomnessAbi,
    functionName: 'publishCommitments',
    args: [batch.map((e) => e.commitment)],
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )

  // Read the assigned indices from the event rather than assuming they start where we think.
  const receipt = await ctx.publicClient.getTransactionReceipt({hash})
  let fromIndex: bigint | null = null
  for (const entry of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: commitRevealRandomnessAbi,
        data: entry.data,
        topics: entry.topics,
      })
      if (decoded.eventName === 'CommitmentsPublished') {
        fromIndex = (decoded.args as {fromIndex: bigint}).fromIndex
      }
    } catch {
      // Not one of ours.
    }
  }
  if (fromIndex === null) {
    fail(
      `publishCommitments succeeded (${hash}) but no CommitmentsPublished event was found.\n` +
        `The pre-images are saved locally but their indices are unknown. Reconcile before spinning: ` +
        `commitmentCount was ${before} before this call.`,
    )
  }

  batch.forEach((entry, i) => {
    entry.index = Number(fromIndex) + i
  })
  saveStore(store)
  log(`  ✓ indices ${fromIndex}…${Number(fromIndex) + batch.length - 1} recorded locally.`)
}

// ─────────────────────────────────────────────────────────────────────── bond

async function bond(amountArg: string | undefined): Promise<void> {
  if (!amountArg) fail('Usage: pnpm operator bond <usdc>')
  const value = parseUnits(amountArg, NATIVE_USDC_DECIMALS)

  const ctx = await loadContext()
  await assertChain(ctx)

  await send(ctx, `depositBond(${amountArg} USDC)`, () =>
    ctx.walletClient!.writeContract({
    address: ctx.contracts.randomness,
    abi: commitRevealRandomnessAbi,
    functionName: 'depositBond',
    value,
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )
}

// ────────────────────────────────────────────────────────────── register tokens

async function registerTokens(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  // Only what the live machines actually pay out. Registering all thirteen costs twelve
  // extra transactions for tokens no machine references, and every one of those is real gas.
  // `--all` registers the full verified set, for when more machines are coming.
  const all = process.argv.includes('--all')
  const needed = new Set<string>()
  for (const machine of MACHINES) {
    if (machine.status === 'disabled') continue
    for (const tier of machine.tiers) needed.add(tier.token.toLowerCase())
  }
  const assets = all ? REWARD_ASSETS : REWARD_ASSETS.filter((a) => needed.has(a.address.toLowerCase()))

  if (assets.length === 0) {
    fail('No live machine references any verified reward asset. Nothing to register.')
  }

  heading(
    all
      ? `Registering all ${assets.length} verified reward assets`
      : `Registering ${assets.length} asset(s) used by live machines (--all for every verified asset)`,
  )
  for (const asset of assets) {
    const already = await ctx.publicClient.readContract({
      address: ctx.contracts.rewardRegistry,
      abi: rewardRegistryAbi,
      functionName: 'isRegistered',
      args: [asset.address as Address],
    })
    if (already) {
      log(`  · ${labelFor(asset)} already registered`)
      continue
    }
    await send(ctx, `registerToken(${labelFor(asset)} / on-chain ${asset.symbol})`, () =>
      ctx.walletClient!.writeContract({
      address: ctx.contracts.rewardRegistry,
      abi: rewardRegistryAbi,
      functionName: 'registerToken',
      args: [
        asset.address as Address,
        asset.symbol,
        asset.name,
        asset.decimals,
        // Registry tier is informational metadata. Actual rarity is decided by the reward
        // table a machine publishes, so there is nothing meaningful to assert here.
        0,
        asset.logoUri ?? '',
        // Ties the registration to the verification run that qualified this token.
        verificationRef(asset.address),
      ],
      chain: ctx.chain,
      account: ctx.walletClient!.account!,
      }),
    )
  }
}

/**
 * A stable reference to the verification record, so an onchain registration points back at
 * the evidence that justified it rather than being an unsourced assertion.
 */
function verificationRef(address: string): Hex {
  return commitmentFor(
    `0x${address.slice(2).padStart(64, '0')}` as Hex,
    `0x${'00'.repeat(32)}` as Hex,
  )
}

// ─────────────────────────────────────────────────────────────────────── fund

async function fund(symbolArg: string | undefined, amountArg: string | undefined): Promise<void> {
  if (!symbolArg || !amountArg) fail('Usage: pnpm operator fund <symbol> <amount>')

  // Accept either the on-chain ticker or the display label, so an admitted collision can be
  // funded by the name the audit prints rather than the ambiguous real one.
  const wanted = symbolArg.toLowerCase()
  const asset = REWARD_ASSETS.find(
    (a) => a.symbol.toLowerCase() === wanted || labelFor(a).toLowerCase() === wanted,
  )
  if (!asset) {
    fail(`Unknown reward asset "${symbolArg}". Known: ${REWARD_ASSETS.map((a) => labelFor(a)).join(', ')}`)
  }

  const ctx = await loadContext()
  await assertChain(ctx)

  const amount = parseUnits(amountArg, asset.decimals)

  // The vault pulls with transferFrom, so it needs an allowance first.
  const erc20 = [
    {
      type: 'function',
      name: 'approve',
      stateMutability: 'nonpayable',
      inputs: [
        {name: 'spender', type: 'address'},
        {name: 'amount', type: 'uint256'},
      ],
      outputs: [{name: '', type: 'bool'}],
    },
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{name: 'account', type: 'address'}],
      outputs: [{name: '', type: 'uint256'}],
    },
  ] as const

  const held = await ctx.publicClient.readContract({
    address: asset.address as Address,
    abi: erc20,
    functionName: 'balanceOf',
    args: [ctx.account!],
  })
  if (held < amount) {
    fail(
      `Signer holds ${formatUnits(held, asset.decimals)} ${asset.symbol} but ${amountArg} was requested.\n` +
        'Reward inventory has to be acquired on the open market first — nothing here can mint it.',
    )
  }

  await send(ctx, `approve(vault, ${amountArg} ${labelFor(asset)})`, () =>
    ctx.walletClient!.writeContract({
    address: asset.address as Address,
    abi: erc20,
    functionName: 'approve',
    args: [ctx.contracts.prizeVault, amount],
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )

  await send(ctx, `depositReward(${amountArg} ${labelFor(asset)})`, () =>
    ctx.walletClient!.writeContract({
    address: ctx.contracts.prizeVault,
    abi: prizeVaultAbi,
    functionName: 'depositReward',
    args: [asset.address as Address, amount],
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )
}

// ──────────────────────────────────────────────────────────────────── machines

async function machines(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  const mapping: string[] = []

  for (const machine of MACHINES) {
    if (machine.status === 'disabled') {
      log(`  · ${machine.slug} is disabled in config, skipping`)
      continue
    }

    heading(machine.name)

    let machineId = machine.onchainId

    if (machineId === null) {
      const hash = await send(ctx, `createMachine(${machine.name})`, () =>
        ctx.walletClient!.writeContract({
        address: ctx.contracts.machineManager,
        abi: arcadeMachineManagerAbi,
        functionName: 'createMachine',
        args: [machine.name, machine.description],
        chain: ctx.chain,
        account: ctx.walletClient!.account!,
        }),
      )
      const receipt = await ctx.publicClient.getTransactionReceipt({hash})
      machineId = readMachineId(receipt.logs)
      if (machineId === null) {
        fail(`createMachine succeeded (${hash}) but no MachineCreated event was found.`)
      }
      log(`    machine id ${machineId}`)
    } else {
      log(`  · already mapped to #${machineId}`)
    }

    await publishTable(ctx, machine, machineId)
    mapping.push(`${machine.slug}:${machineId}`)
  }

  heading('Add this to .env.local, then rebuild')
  log(`NEXT_PUBLIC_ARCADE_MACHINE_IDS=${mapping.join(',')}`)
}

function readMachineId(logs: ReadonlyArray<{data: Hex; topics: readonly Hex[]}>): number | null {
  for (const entry of logs) {
    try {
      const decoded = decodeEventLog({
        abi: arcadeMachineManagerAbi,
        data: entry.data,
        topics: entry.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName === 'MachineCreated') {
        return Number((decoded.args as {machineId: bigint}).machineId)
      }
    } catch {
      // Not one of ours.
    }
  }
  return null
}

/** Publishes the reward table from config, converting decimal strings to token units. */
async function publishTable(
  ctx: OperatorContext,
  machine: MachineConfig,
  machineId: number,
): Promise<void> {
  const tiers = machine.tiers.map((tier) => {
    const asset = assetByAddress(tier.token)
    if (!asset) {
      throw new Error(
        `${machine.slug}: tier token ${tier.token} is not in the verified reward set. ` +
          'Publishing a table referencing an unverified token would be exactly the thing ' +
          'the registry exists to prevent.',
      )
    }
    return {
      token: tier.token as Address,
      weight: BigInt(tier.weight),
      rarity: RARITY_ORDER.indexOf(tier.rarity),
      minAmount: parseUnits(tier.minAmount, asset.decimals),
      maxAmount: parseUnits(tier.maxAmount, asset.decimals),
    }
  })

  const spinPrice = parseUnits(machine.spinPriceUsdc, NATIVE_USDC_DECIMALS)

  // effectiveBlock 0 means "immediately" to the contract.
  await send(ctx, `publishVersion(#${machineId}, ${tiers.length} tiers, ${machine.spinPriceUsdc} USDC)`, () =>
    ctx.walletClient!.writeContract({
    address: ctx.contracts.machineManager,
    abi: arcadeMachineManagerAbi,
    functionName: 'publishVersion',
    args: [BigInt(machineId), spinPrice, tiers, 0n],
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────── bootstrap

/**
 * Brings a fresh deployment all the way to accepting spins, in one command.
 *
 * Every step is idempotent and checks chain state before acting, so this is safe to re-run
 * after a failure, a rate limit, or a top-up. It never re-publishes a machine that exists,
 * never re-registers a token, and never bonds twice.
 *
 * ## What it will not do
 *
 * It cannot buy reward inventory. Acquiring tokens is a trade on a market, not an operator
 * call, and `fund` refuses rather than partially depositing when the wallet is short. So the
 * one step this cannot finish for you is the one that needs tokens in hand — it reports
 * exactly what is missing.
 *
 * When inventory is short it stops before publishing. A sealed table that pays a token the
 * vault does not hold takes a working machine off line, because the contract rejects every
 * spin it cannot cover at worst case.
 *
 * Inventory is sized from the machine's own worst case: the contract gates each spin on
 * `worstCase x (outstanding + 1)`, so `--concurrency N` funds enough for N simultaneous
 * spins. The default of 3 is a deliberate floor, not a recommendation.
 */
async function bootstrap(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  const cFlag = process.argv.indexOf('--concurrency')
  const concurrency = cFlag === -1 ? 3 : Math.max(1, Number.parseInt(process.argv[cFlag + 1] ?? '3', 10))
  const bondFlag = process.argv.indexOf('--bond')
  const bondTarget = bondFlag === -1 ? '20' : (process.argv[bondFlag + 1] ?? '20')
  const commitFlag = process.argv.indexOf('--commitments')
  const commitTarget = commitFlag === -1 ? 200 : Number.parseInt(process.argv[commitFlag + 1] ?? '200', 10)

  heading(`Bootstrapping Arcade on ${ctx.chain.name}`)
  log(`  signer             ${ctx.account}`)
  log(`  target concurrency ${concurrency} simultaneous spins`)

  const R = {address: ctx.contracts.randomness, abi: commitRevealRandomnessAbi} as const

  // ------------------------------------------------------------ 1. commitments
  heading('1. Randomness commitments')
  const available = await ctx.publicClient.readContract({...R, functionName: 'availableCommitments'})
  if (Number(available) >= commitTarget) {
    log(`  ${available} already available, target ${commitTarget} — skipping`)
  } else {
    const needed = commitTarget - Number(available)
    log(`  ${available} available, publishing ${needed} more`)
    await commitments(String(Math.min(needed, 500)))
  }

  // ------------------------------------------------------------------- 2. bond
  heading('2. Operator bond')
  const bonded = await ctx.publicClient.readContract({...R, functionName: 'operatorBond'})
  if (bonded > 0n) {
    log(`  ${formatUnits(bonded, NATIVE_USDC_DECIMALS)} USDC already posted — skipping`)
  } else {
    await bond(bondTarget)
  }

  // --------------------------------------------------------------- 3. registry
  heading('3. Reward registry')
  await registerTokens()

  // -------------------------------------------------------------- 4. inventory
  heading('4. Vault inventory')
  const live = MACHINES.filter((m) => m.status !== 'disabled')
  const needByToken = new Map<string, {asset: (typeof REWARD_ASSETS)[number]; units: number}>()
  for (const machine of live) {
    for (const tier of machine.tiers) {
      const asset = assetByAddress(tier.token)
      if (!asset) continue
      const key = asset.address.toLowerCase()
      // Worst case for a token is its largest single payout across the table.
      const worst = Math.max(
        needByToken.get(key)?.units ?? 0,
        Number.parseFloat(tier.maxAmount) * concurrency,
      )
      needByToken.set(key, {asset, units: worst})
    }
  }

  const erc20 = [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{name: 'a', type: 'address'}],
      outputs: [{type: 'uint256'}],
    },
  ] as const

  const short: string[] = []
  for (const {asset, units} of needByToken.values()) {
    const have = await ctx.publicClient.readContract({
      address: ctx.contracts.prizeVault,
      abi: prizeVaultAbi,
      functionName: 'availableOf',
      args: [asset.address as Address],
    })
    const haveUnits = Number(formatUnits(have, asset.decimals))
    if (haveUnits >= units) {
      log(`  ${labelFor(asset).padEnd(10)} ${haveUnits.toFixed(4)} in vault, need ${units} — ok`)
      continue
    }

    const missing = units - haveUnits
    const wallet = await ctx.publicClient.readContract({
      address: asset.address as Address,
      abi: erc20,
      functionName: 'balanceOf',
      args: [ctx.account!],
    })
    const walletUnits = Number(formatUnits(wallet, asset.decimals))

    if (walletUnits >= missing) {
      log(`  ${labelFor(asset).padEnd(10)} depositing ${missing.toFixed(4)} from wallet`)
      await fund(labelFor(asset), missing.toFixed(Math.min(asset.decimals, 6)))
    } else {
      short.push(
        `  ${labelFor(asset).padEnd(10)} need ${missing.toFixed(4)} more, wallet holds ${walletUnits.toFixed(4)}`,
      )
      log(`  ${labelFor(asset).padEnd(10)} SHORT — need ${missing.toFixed(4)}, wallet has ${walletUnits.toFixed(4)}`)
    }
  }

  // --------------------------------------------------------------- 5. machines
  //
  // Only when every token is funded. publishVersion seals a reward table and makes it the
  // version new spins use, so publishing a table that pays a token the vault does not hold
  // takes a working machine OFF LINE until that token is deposited — the contract rejects
  // every spin with InsufficientInventory. That happened once; it must not happen again.
  heading('5. Machines')
  if (short.length > 0) {
    log('  SKIPPED — publishing now would seal a table the vault cannot cover, and the')
    log('  machine would reject every spin until it is funded. Fund these first:')
    for (const line of short) log(line)
  } else {
    await machines()
  }

  // ----------------------------------------------------------------- 6. verdict
  heading('Bootstrap complete')
  if (short.length > 0) {
    log('  Inventory is short, so no reward table was published. The machine is unchanged.')
    for (const line of short) log(line)
    log('')
    log('  Buy them on a market, then re-run this command — it resumes where it stopped.')
  } else {
    log('  Every precondition is met. Start the daemon and leave it running:')
    log('')
    log('    pnpm operator reveal')
  }
}

// ────────────────────────────────────────────────────────────────────── solvency

/**
 * Works out how much revenue can be diverted to buyback without draining the operation.
 *
 * ## The model
 *
 * Every spin takes `R` in USDC and gives away `P` of reward tokens, which have to be bought
 * back at market to keep the vault able to cover the next spin. Gas `G` is paid per spin by
 * the operator. If a fraction `f` of revenue is routed to reward funding and the rest to
 * buyback, operating capital moves by:
 *
 *     ΔC = f·R − P − G
 *
 * Solvency needs `ΔC ≥ 0`, so `f ≥ (P + G) / R`. Anything below that is a slow drain dressed
 * up as a tokenomics feature: the machine keeps running until the vault cannot cover a spin,
 * then stops.
 *
 * ## Why expected value is not enough
 *
 * `P` is a mean. A single spin can pay the largest amount in the table, which here exceeds
 * revenue several times over. A thin bankroll can be wiped out by an early jackpot even when
 * the long-run maths is fine, so this also reports how many worst-case payouts the capital
 * absorbs — the number that actually decides whether a small float survives.
 */
async function solvency(): Promise<void> {
  const ctx = await loadContext({requireSigner: false})

  const capFlag = process.argv.indexOf('--capital')
  const capital = capFlag === -1 ? 100 : Number.parseFloat(process.argv[capFlag + 1] ?? '100')
  const bpsFlag = process.argv.indexOf('--bps')
  const proposedBps = bpsFlag === -1 ? null : Number.parseInt(process.argv[bpsFlag + 1] ?? '', 10)

  const priceFlag = process.argv.indexOf('--prices')
  if (priceFlag === -1) {
    fail(
      'solvency needs prices: the payout side is denominated in tokens.\\n' +
        'Usage: pnpm operator solvency --capital 100 --prices scripts/data/prices.json',
    )
  }
  const parsed = JSON.parse(readFileSync(resolve(process.argv[priceFlag + 1] ?? ''), 'utf8')) as {
    prices?: Record<string, number>
    source?: string
  }
  const prices: Record<string, number> = {}
  for (const [a, v] of Object.entries(parsed.prices ?? {})) {
    if (typeof v === 'number' && v > 0) prices[a.toLowerCase()] = v
  }

  const live = MACHINES.filter((m) => m.status !== 'disabled')
  if (live.length === 0) fail('No live machines.')

  heading('Solvency of the revenue split')
  log(`  capital            $${capital.toFixed(2)}`)
  log(`  prices             ${parsed.source ?? 'supplied'}`)

  // Measured on this deployment: 0.015526 USDC of settle gas across 3 spins. Reveal is a
  // comparable write and is estimated at the same cost, so this is a floor, not a ceiling.
  const GAS_PER_SPIN = 0.0052 * 2

  let totalRevenue = 0
  let totalExpected = 0
  let worstSingle = 0

  for (const machine of live) {
    const revenue = Number.parseFloat(machine.spinPriceUsdc)
    const weights = machine.tiers.reduce((a, t) => a + t.weight, 0)
    let expected = 0
    for (const tier of machine.tiers) {
      const asset = assetByAddress(tier.token)
      const price = asset ? prices[asset.address.toLowerCase()] : undefined
      if (price === undefined) {
        fail(`No price for ${asset ? labelFor(asset) : tier.token}. Every reward token needs one.`)
      }
      const p = tier.weight / weights
      const mean = (Number.parseFloat(tier.minAmount) + Number.parseFloat(tier.maxAmount)) / 2
      expected += p * mean * price
      worstSingle = Math.max(worstSingle, Number.parseFloat(tier.maxAmount) * price)
    }
    totalRevenue += revenue
    totalExpected += expected

    heading(machine.name)
    log(`  revenue per spin   $${revenue.toFixed(4)}`)
    log(`  expected payout    $${expected.toFixed(4)}  (${((expected / revenue) * 100).toFixed(1)}%)`)
    log(`  gas per spin       $${GAS_PER_SPIN.toFixed(4)}  (settle measured, reveal estimated)`)
    log(`  largest single win $${worstSingle.toFixed(4)}  (${(worstSingle / revenue).toFixed(1)}x revenue)`)
  }

  const R = totalRevenue / live.length
  const P = totalExpected / live.length
  const minFraction = (P + GAS_PER_SPIN) / R
  const minBps = Math.ceil(minFraction * 10_000)

  heading('The split')
  log(`  break-even reward funding   ${(minFraction * 100).toFixed(1)}%  (${minBps} bps)`)
  log(`  so the most that can go to buyback is ${(100 - minFraction * 100).toFixed(1)}%, with ZERO buffer`)
  log('')

  const recommendations = [8_500, 8_000, 7_500]
  log('  reward     buyback    net per spin    spins until $' + capital.toFixed(0) + ' is gone')
  log('  ' + '─'.repeat(64))
  for (const bps of [...recommendations, 5_000]) {
    const f = bps / 10_000
    const net = f * R - P - GAS_PER_SPIN
    const runway = net >= 0 ? '—  (capital grows)' : `${Math.floor(capital / -net)}`
    log(
      `  ${String(bps / 100).padStart(4)}%     ${String((10_000 - bps) / 100).padStart(4)}%` +
        `     ${(net >= 0 ? '+' : '') + net.toFixed(4)} USDC` +
        `      ${runway}`,
    )
  }

  heading('Variance')
  const absorb = Math.floor(capital / worstSingle)
  log(`  largest single payout is $${worstSingle.toFixed(2)}, so $${capital.toFixed(0)} absorbs ${absorb} of them`)
  log('  back to back before the vault cannot cover the next spin.')
  log('')
  log('  Expected value is a long-run average. With a float this size the thing that ends a')
  log('  run is an early cluster of big wins, not the mean.')

  if (proposedBps !== null) {
    const f = proposedBps / 10_000
    const net = f * R - P - GAS_PER_SPIN
    heading(`Verdict on ${proposedBps} bps`)
    if (net < 0) {
      log(`  REFUSE. Every spin loses $${(-net).toFixed(4)} of capital.`)
      log(`  $${capital.toFixed(0)} is exhausted after about ${Math.floor(capital / -net)} spins, then the machine stops.`)
    } else {
      log(`  Sustainable. Every spin adds $${net.toFixed(4)} to capital.`)
      log(`  Buyback receives $${((1 - f) * R).toFixed(4)} per spin.`)
    }
  }

  log('')
  log(`  contracts: ${ctx.contracts.feeRouter}`)
}

/**
 * Break-even reward-funding share, in bps, from the live tables and a price snapshot.
 *
 * Returns null when prices are unavailable — an unknown break-even must not silently read as
 * a safe one, so the caller treats null as "cannot check" rather than "fine".
 */
async function breakEvenBps(): Promise<number | null> {
  const path = resolve('scripts/data/prices.json')
  if (!existsSync(path)) return null
  const prices: Record<string, number> = {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {prices?: Record<string, number>}
    for (const [a, v] of Object.entries(parsed.prices ?? {})) {
      if (typeof v === 'number' && v > 0) prices[a.toLowerCase()] = v
    }
  } catch {
    return null
  }

  const live = MACHINES.filter((m) => m.status !== 'disabled')
  if (live.length === 0) return null

  const GAS_PER_SPIN = 0.0104
  let ratioSum = 0
  for (const machine of live) {
    const revenue = Number.parseFloat(machine.spinPriceUsdc)
    const weights = machine.tiers.reduce((a, t) => a + t.weight, 0)
    let expected = 0
    for (const tier of machine.tiers) {
      const asset = assetByAddress(tier.token)
      const price = asset ? prices[asset.address.toLowerCase()] : undefined
      if (price === undefined) return null
      const mean = (Number.parseFloat(tier.minAmount) + Number.parseFloat(tier.maxAmount)) / 2
      expected += (tier.weight / weights) * mean * price
    }
    ratioSum += (expected + GAS_PER_SPIN) / revenue
  }
  return Math.ceil((ratioSum / live.length) * 10_000)
}

// ───────────────────────────────────────────────────────────────────────── fees

/**
 * Sets the fee-router split, and optionally the destinations.
 *
 * `--bps 5000` sends half of settled revenue to the treasury wallet, which is what a buyback
 * programme spends from. The router itself cannot swap or burn — it only forwards native
 * USDC — so routing is step one and `buyback` is step two.
 */
async function fees(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)
  const router = ctx.contracts.feeRouter

  const bpsFlag = process.argv.indexOf('--bps')
  const treasuryFlag = process.argv.indexOf('--treasury')

  const [bps, rewardWallet, treasuryWallet] = await Promise.all([
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'rewardFundingBps'}),
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'rewardFundingWallet'}),
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'treasuryWallet'}),
  ])

  heading('Fee router')
  log(`  split now          ${Number(bps) / 100}% reward funding / ${(10_000 - Number(bps)) / 100}% treasury`)
  log(`  reward funding ->  ${rewardWallet}`)
  log(`  treasury ->        ${treasuryWallet}`)

  if (bpsFlag === -1 && treasuryFlag === -1) {
    log('\n  Nothing to change. Pass --bps <0-10000> and/or --treasury <address>.')
    return
  }

  if (treasuryFlag !== -1) {
    const next = process.argv[treasuryFlag + 1]
    if (!next || !/^0x[0-9a-fA-F]{40}$/.test(next)) fail('--treasury needs an address')
    await send(ctx, `setDestinations(reward=${rewardWallet}, treasury=${next})`, () =>
      ctx.walletClient!.writeContract({
        address: router,
        abi: feeRouterAbi,
        functionName: 'setDestinations',
        args: [rewardWallet as Address, next as Address],
        chain: ctx.chain,
        account: ctx.walletClient!.account!,
      }),
    )
  }

  if (bpsFlag !== -1) {
    const next = Number.parseInt(process.argv[bpsFlag + 1] ?? '', 10)
    if (!Number.isInteger(next) || next < 0 || next > 10_000) fail('--bps must be 0-10000')
    /*
     * Reward funding replaces paid-out inventory. Set it below what payouts actually cost
     * and every spin quietly consumes capital until the vault cannot cover one, at which
     * point the machine stops taking spins.
     *
     * The break-even point is computed from the live reward tables and a price snapshot
     * rather than hardcoded, because it moves whenever a table or a token price does. An
     * earlier version of this warned below 3000 bps, which was backwards: on the current
     * tables the danger line is above 7100.
     */
    const breakEven = await breakEvenBps()
    if (breakEven !== null && next < breakEven) {
      const force = process.argv.includes('--force')
      log('')
      log(`  ${next / 100}% to reward funding is below break-even of ${(breakEven / 100).toFixed(1)}%.`)
      log('  Payouts plus gas cost more than that, so every spin would consume capital.')
      log('  Run `pnpm operator solvency --capital <your float>` for the runway.')
      if (!force) {
        fail('Refusing to set an insolvent split. Pass --force if this is deliberate.')
      }
      log('  --force given; proceeding anyway.')
    }
    await send(ctx, `setSplit(${next} bps)`, () =>
      ctx.walletClient!.writeContract({
        address: router,
        abi: feeRouterAbi,
        functionName: 'setSplit',
        args: [next],
        chain: ctx.chain,
        account: ctx.walletClient!.account!,
      }),
    )
  }
}

// ────────────────────────────────────────────────────────────────────── buyback

/**
 * Buys $ARCADE with treasury revenue and sends it to the burn address.
 *
 * ## Why this needs a router you supply
 *
 * ARCADE has no Uniswap v3 pool against USDC — all three fee tiers are empty. Its only
 * liquidity is a **v4** pool, so the v3 SwapRouter that bought the reward inventory cannot
 * trade it. No v4 router address is published in any source this repository can verify, and
 * guessing one means sending real USDC to a contract nobody checked.
 *
 * So the router comes from `ARCADE_BUYBACK_ROUTER`, and this command does three things before
 * it will spend anything:
 *
 *   1. refuses an address with no code,
 *   2. simulates the exact swap with `eth_call` and refuses if it reverts,
 *   3. requires `--confirm` for the first real broadcast.
 *
 * A wrong address therefore fails as a simulation error, not as a lost transfer.
 *
 * ## Why "burn" is in quotes everywhere
 *
 * ARCADE has no `burn()`; the call reverts. Tokens go to an address whose key cannot exist.
 * `totalSupply()` is unchanged; the circulating amount is not. The UI counter says so, and so
 * does this.
 */
async function buyback(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  const router = process.env.ARCADE_BUYBACK_ROUTER as Address | undefined
  const confirm = process.argv.includes('--confirm')
  const shareFlag = process.argv.indexOf('--share')
  const share = shareFlag === -1 ? 50 : Number.parseFloat(process.argv[shareFlag + 1] ?? '50')
  if (!(share > 0 && share <= 100)) fail('--share must be between 0 and 100')

  heading('ARCADE buyback and burn')
  log(`  token              ${ARCADE_TOKEN.address}`)
  log(`  burn address       ${BURN_ADDRESS}`)
  log(`  pool (Uniswap v4)  ${ARCADE_POOL_ID}`)
  log(`  share of profit    ${share}%`)

  const burnedBefore = await ctx.publicClient.readContract({
    address: ARCADE_TOKEN.address,
    abi: ERC20_MINI,
    functionName: 'balanceOf',
    args: [BURN_ADDRESS],
  })
  log(`  already burned     ${formatUnits(burnedBefore, ARCADE_TOKEN.decimals)} ARCADE`)

  /*
   * Spend a share of PROFIT, not of revenue.
   *
   * A fixed cut of revenue cannot tell a good month from a bad one: it takes the same amount
   * whether the machine made money or gave a jackpot away, so a bad run compounds into a
   * drained vault. Profit is revenue minus what was actually paid out and the gas it cost, so
   * a share of it is self-limiting by construction — when there is no profit there is nothing
   * to spend, and the float is never the thing being spent.
   *
   * Measured from chain state rather than modelled, and against a high-water mark so repeated
   * runs cannot spend the same profit twice.
   */
  const {prices, source} = readPrices()
  if (Object.keys(prices).length === 0) {
    fail('buyback needs --prices: profit depends on what the payouts were worth.')
  }

  const measured = await measureResult(ctx, prices)
  if (!measured.allPriced) {
    fail('A reward token that has been paid out has no price in the snapshot. Refusing to guess profit.')
  }

  const profit = measured.revenue - measured.payoutUsd - measured.gas

  heading('Realised result')
  log(`  prices             ${source}`)
  log(`  spins settled      ${measured.settled}`)
  log(`  revenue            ${measured.revenue.toFixed(4)} USDC`)
  log(`  payouts            ${measured.payoutUsd.toFixed(4)} USDC`)
  log(`  settle gas         ${measured.gas.toFixed(6)} USDC`)
  log(`  profit to date     ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDC`)

  const ledger = readBuybackLedger()
  const entitled = (profit * share) / 100
  const budgetUsd = entitled - ledger.spentUsd

  heading('Budget')
  log(`  ${share}% of profit       ${entitled.toFixed(4)} USDC`)
  log(`  already spent      ${ledger.spentUsd.toFixed(4)} USDC (${ledger.runs} run${ledger.runs === 1 ? '' : 's'})`)
  log(`  available now      ${budgetUsd.toFixed(4)} USDC`)

  if (profit <= 0) {
    log('\n  No profit to date. Nothing to buy back — which is the point of using profit')
    log('  rather than revenue: a losing run spends nothing.')
    return
  }
  if (budgetUsd <= 0.01) {
    log('\n  Nothing new to spend since the last run.')
    return
  }

  const wallet = await ctx.publicClient.getBalance({address: ctx.account!})
  const walletUsd = Number(formatUnits(wallet, NATIVE_USDC_DECIMALS))
  if (walletUsd < budgetUsd) {
    log(`\n  Wallet holds ${walletUsd.toFixed(4)} USDC, less than the budget.`)
    log('  Run `pnpm operator distribute` to sweep settled revenue first.')
    return
  }

  if (!router) {
    heading('Blocked: no router configured')
    log('  ARCADE trades only in a Uniswap v4 pool, and no v4 router address is published in')
    log('  a source this repository can verify. Set ARCADE_BUYBACK_ROUTER to a router you')
    log('  have checked yourself. Nothing is guessed here: a wrong address would take the')
    log('  USDC with it.')
    log('')
    log(`  The budget above (${budgetUsd.toFixed(4)} USDC) is what would be spent.`)
    return
  }

  const code = await ctx.publicClient.getBytecode({address: router})
  if (!code || code === '0x') fail(`ARCADE_BUYBACK_ROUTER ${router} has no contract code.`)
  log(`\n  router             ${router} (${code.length / 2 - 1} bytes)`)

  heading('Swap')
  log('  Not implemented: the v4 calldata shape depends on which router this is — Universal')
  log('  Router, a periphery helper and a custom keeper all differ. Tell me which one and the')
  log('  encoder goes in, simulated before it spends. Everything else is here: measured')
  log('  profit, the high-water mark, the budget, and the burn transfer.')
  if (!confirm) log('\n  (--confirm not passed; nothing would have been broadcast anyway)')
}

/** Cumulative USDC already spent on buybacks, so profit is never spent twice. */
type BuybackLedger = {spentUsd: number; runs: number; updatedAt: string}

function buybackLedgerPath(): string {
  return resolve('scripts/data/buyback-ledger.json')
}

function readBuybackLedger(): BuybackLedger {
  const path = buybackLedgerPath()
  if (!existsSync(path)) return {spentUsd: 0, runs: 0, updatedAt: 'never'}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BuybackLedger>
    return {
      spentUsd: typeof parsed.spentUsd === 'number' ? parsed.spentUsd : 0,
      runs: typeof parsed.runs === 'number' ? parsed.runs : 0,
      updatedAt: parsed.updatedAt ?? 'unknown',
    }
  } catch {
    // A corrupt ledger must not read as "nothing spent yet" — that would authorise spending
    // the same profit again.
    fail(`Buyback ledger at ${path} is unreadable. Fix or remove it deliberately.`)
  }
}

// ────────────────────────────────────────────────────────────────── distribute

/**
 * Sweeps settled revenue out of the fee router to its configured destinations.
 *
 * Revenue reaches the router automatically on every settlement, but it stays there until
 * someone calls this — there is no automatic sweep, by design: an unattended transfer of
 * every spin's takings is a worse default than a balance an operator moves deliberately.
 *
 * The split and destinations are the router's own configuration; this only triggers the
 * transfer. Check `pnpm operator status` or the printed values below before running it.
 */
async function distribute(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  const router = ctx.contracts.feeRouter
  const [balance, bps, rewardWallet, treasuryWallet] = await Promise.all([
    ctx.publicClient.getBalance({address: router}),
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'rewardFundingBps'}),
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'rewardFundingWallet'}),
    ctx.publicClient.readContract({address: router, abi: feeRouterAbi, functionName: 'treasuryWallet'}),
  ])

  heading('Fee router')
  log(`  balance            ${formatUnits(balance, NATIVE_USDC_DECIMALS)} USDC`)
  log(`  split              ${Number(bps) / 100}% reward funding / ${(10_000 - Number(bps)) / 100}% treasury`)
  log(`  reward funding ->  ${rewardWallet}`)
  log(`  treasury ->        ${treasuryWallet}`)
  if (String(rewardWallet).toLowerCase() === String(treasuryWallet).toLowerCase()) {
    log('  both destinations are the same wallet, so the split has no practical effect')
  }

  if (balance === 0n) {
    log('\n  Nothing to distribute.')
    return
  }

  await send(ctx, `distribute(${formatUnits(balance, NATIVE_USDC_DECIMALS)} USDC)`, () =>
    ctx.walletClient!.writeContract({
      address: router,
      abi: feeRouterAbi,
      functionName: 'distribute',
      chain: ctx.chain,
      account: ctx.walletClient!.account!,
    }),
  )
}

/** Gap between log requests while scanning history. Tunable for a throttled endpoint. */
const SCAN_INTERVAL_MS = Number.parseInt(process.env.ARC_SCAN_INTERVAL_MS ?? '120', 10)

/** What a scan of the whole history measured. Shared by `pnl` and `buyback`. */
type Measured = {
  spins: number
  settled: number
  revenue: number
  payoutUsd: number
  gas: number
  allPriced: boolean
  byToken: Map<string, bigint>
}

/**
 * Measures the deployment's whole history: revenue, payouts, settle gas.
 *
 * Bounded by `spinCount()` and refuses to return a partial scan — understating payouts would
 * overstate profit, which is the one direction a number that authorises spending must never
 * be wrong in.
 */
async function measureResult(
  ctx: OperatorContext,
  prices: Record<string, number>,
): Promise<Measured> {
  const pc = ctx.publicClient
  const manager = ctx.contracts.machineManager

  const total = Number(
    await pc.readContract({address: manager, abi: arcadeMachineManagerAbi, functionName: 'spinCount'}),
  )
  const head = await pc.getBlockNumber()
  const CHUNK = 5_000n
  const requested: Array<Record<string, unknown>> = []
  const settled: Array<Record<string, unknown>> = []
  let toBlock = head
  let chunks = 0

  while (chunks < 2_000 && requested.length < total) {
    const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : 0n
    const logs = await pc.getLogs({
      address: manager,
      events: [SPIN_REQUESTED_EVENT, SPIN_SETTLED_EVENT],
      fromBlock,
      toBlock,
    })
    for (const entry of logs) {
      const e = entry as unknown as {eventName?: string}
      if (e.eventName === 'SpinRequested') requested.push(entry as Record<string, unknown>)
      else if (e.eventName === 'SpinSettled') settled.push(entry as Record<string, unknown>)
    }
    chunks += 1
    if (fromBlock === 0n) break
    toBlock = fromBlock - 1n
    // Arc's public RPC throttles hard. Raise ARC_SCAN_INTERVAL_MS when it is busy — a slow
    // scan is fine, an aborted one is fine, a wrong one is not.
    if (requested.length < total) await new Promise((r) => setTimeout(r, SCAN_INTERVAL_MS))
  }

  if (requested.length < total) {
    fail(
      `Found ${requested.length} of ${total} spins after ${chunks} chunks. Refusing to report a\n` +
        'partial result — it would overstate profit.\n' +
        'Retry with ARC_SCAN_INTERVAL_MS=800, or point ARC_MAINNET_RPC_URL at a dedicated endpoint.',
    )
  }

  const revenueWei = requested.reduce((acc, l) => {
    const a = (l as {args?: {pricePaid?: bigint}}).args
    return acc + (a?.pricePaid ?? 0n)
  }, 0n)

  const byToken = new Map<string, bigint>()
  for (const l of settled) {
    const a = (l as {args?: {rewardToken?: string; rewardAmount?: bigint}}).args
    if (!a?.rewardToken) continue
    const key = a.rewardToken.toLowerCase()
    byToken.set(key, (byToken.get(key) ?? 0n) + (a.rewardAmount ?? 0n))
  }

  let payoutUsd = 0
  let allPriced = true
  for (const [addr, amount] of byToken) {
    const asset = assetByAddress(addr as Address)
    const units = asset ? Number(formatUnits(amount, asset.decimals)) : Number(amount)
    const price = prices[addr]
    if (price === undefined) allPriced = false
    else payoutUsd += units * price
  }

  let gasWei = 0n
  const txs = new Set<string>()
  for (const l of settled) {
    const h = (l as {transactionHash?: string}).transactionHash
    if (h) txs.add(h)
  }
  for (const h of [...txs].slice(0, 200)) {
    try {
      const r = await pc.getTransactionReceipt({hash: h as `0x${string}`})
      gasWei += r.gasUsed * r.effectiveGasPrice
    } catch {
      // A receipt that cannot be read is left out rather than estimated.
    }
  }

  return {
    spins: requested.length,
    settled: settled.length,
    revenue: Number(formatUnits(revenueWei, NATIVE_USDC_DECIMALS)),
    payoutUsd,
    gas: Number(formatUnits(gasWei, NATIVE_USDC_DECIMALS)),
    allPriced,
    byToken,
  }
}

/** Reads a `--prices` file, or returns an empty map. */
function readPrices(): {prices: Record<string, number>; source: string} {
  const flag = process.argv.indexOf('--prices')
  if (flag === -1) return {prices: {}, source: 'none supplied'}
  const path = process.argv[flag + 1]
  if (!path) fail('--prices needs a file path')
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as {
    prices?: Record<string, number>
    source?: string
    capturedAt?: string
  }
  const prices: Record<string, number> = {}
  for (const [addr, v] of Object.entries(parsed.prices ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) prices[addr.toLowerCase()] = v
  }
  return {prices, source: `${parsed.source ?? path} (${parsed.capturedAt ?? 'undated'})`}
}

// ─────────────────────────────────────────────────────────────────────────── pnl

const SPIN_SETTLED_EVENT = {
  type: 'event',
  name: 'SpinSettled',
  inputs: [
    {name: 'spinId', type: 'uint256', indexed: true},
    {name: 'player', type: 'address', indexed: true},
    {name: 'machineId', type: 'uint64', indexed: true},
    {name: 'rewardToken', type: 'address', indexed: false},
    {name: 'rewardAmount', type: 'uint256', indexed: false},
    {name: 'randomWord', type: 'uint256', indexed: false},
    {name: 'rarity', type: 'uint8', indexed: false},
    {name: 'pushDelivered', type: 'bool', indexed: false},
  ],
} as const

/**
 * Realised profit and loss, measured from chain state.
 *
 * ## Why this exists
 *
 * `machine:audit` answers "should this be profitable" from a reward table and a price file.
 * It is a model. It cannot say whether the machine actually made money, because that depends
 * on what was really paid out.
 *
 * This reads what happened: every spin's price from `SpinRequested`, every payout's token and
 * amount from `SpinSettled`, the undistributed balance in the fee router, and the gas the
 * settle transactions cost. Those are facts.
 *
 * ## What it still cannot tell you
 *
 * Revenue is native USDC, so it is already a dollar figure. Payouts are tokens, and valuing
 * them needs prices — which this project refuses to fetch, for the same reason as everywhere
 * else: a scraped quote for a thin Arc asset is a confident number resting on a trade that
 * may not clear. `--prices <file>` values them from a snapshot supplied deliberately. Without
 * one it reports units and says the result is not computable.
 *
 * Gas for buying inventory is not counted: those trades are not distinguishable on-chain from
 * any other transfer out of the operator wallet.
 */
async function pnl(): Promise<void> {
  const ctx = await loadContext({requireSigner: false})
  await assertChain(ctx)
  const pc = ctx.publicClient
  const manager = ctx.contracts.machineManager

  const flag = process.argv.indexOf('--prices')
  const prices: Record<string, number> = {}
  let priceSource = 'none supplied'
  if (flag !== -1) {
    const path = process.argv[flag + 1]
    if (!path) fail('--prices needs a file path')
    const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as {
      prices?: Record<string, number>
      source?: string
      capturedAt?: string
    }
    for (const [addr, v] of Object.entries(parsed.prices ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) prices[addr.toLowerCase()] = v
    }
    priceSource = `${parsed.source ?? path} (${parsed.capturedAt ?? 'undated'})`
  }

  heading(`Arcade P&L on ${ctx.chain.name}`)
  log(`  prices             ${priceSource}`)

  /*
   * The scan must be complete — a partial one understates payouts and overstates profit,
   * the one direction a number someone acts on must never be wrong in.
   *
   * `spinCount()` says exactly how many spins exist, so the walk stops the moment it has
   * found them all rather than guessing a lookback. Without that bound this scanned back
   * toward genesis in 5,000-block steps and was rate-limited off the public endpoint long
   * before it finished.
   */
  const total = Number(
    await pc.readContract({address: manager, abi: arcadeMachineManagerAbi, functionName: 'spinCount'}),
  )
  const head = await pc.getBlockNumber()
  const CHUNK = 5_000n
  const requested: Array<Record<string, unknown>> = []
  const settled: Array<Record<string, unknown>> = []
  let toBlock = head
  let chunks = 0
  const MAX_CHUNKS = 2_000

  while (chunks < MAX_CHUNKS && requested.length < total) {
    const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : 0n
    const logs = await pc.getLogs({
      address: manager,
      events: [SPIN_REQUESTED_EVENT, SPIN_SETTLED_EVENT],
      fromBlock,
      toBlock,
    })
    for (const entry of logs) {
      const e = entry as unknown as {eventName?: string}
      if (e.eventName === 'SpinRequested') requested.push(entry as Record<string, unknown>)
      else if (e.eventName === 'SpinSettled') settled.push(entry as Record<string, unknown>)
    }
    chunks += 1
    if (fromBlock === 0n) break
    toBlock = fromBlock - 1n
    // Paced: the public endpoint rate-limits, and a wrong P&L is worse than a slow one.
    // Arc's public RPC throttles hard. Raise ARC_SCAN_INTERVAL_MS when it is busy — a slow
    // scan is fine, an aborted one is fine, a wrong one is not.
    if (requested.length < total) await new Promise((r) => setTimeout(r, SCAN_INTERVAL_MS))
  }

  if (requested.length < total) {
    fail(
      `Found ${requested.length} of ${total} spins after ${chunks} chunks. Refusing to report a\n` +
        'partial P&L — it would understate payouts. Use a dedicated RPC and re-run.',
    )
  }

  const revenueWei = requested.reduce((acc, l) => {
    const a = (l as {args?: {pricePaid?: bigint}}).args
    return acc + (a?.pricePaid ?? 0n)
  }, 0n)
  const revenue = Number(formatUnits(revenueWei, NATIVE_USDC_DECIMALS))

  heading('Revenue')
  log(`  spins requested    ${requested.length}`)
  log(`  spins settled      ${settled.length}`)
  log(`  gross revenue      ${revenue.toFixed(4)} USDC`)
  const routerBalance = await pc.getBalance({address: ctx.contracts.feeRouter})
  const managerBalance = await pc.getBalance({address: manager})
  log(`  in feeRouter       ${Number(formatUnits(routerBalance, NATIVE_USDC_DECIMALS)).toFixed(4)} USDC (undistributed)`)
  log(`  in manager         ${Number(formatUnits(managerBalance, NATIVE_USDC_DECIMALS)).toFixed(4)} USDC (in-flight / refundable)`)

  heading('Paid out')
  const byToken = new Map<string, bigint>()
  for (const l of settled) {
    const a = (l as {args?: {rewardToken?: string; rewardAmount?: bigint}}).args
    if (!a?.rewardToken) continue
    const key = a.rewardToken.toLowerCase()
    byToken.set(key, (byToken.get(key) ?? 0n) + (a.rewardAmount ?? 0n))
  }

  let payoutUsd = 0
  let allPriced = true
  if (byToken.size === 0) log('  nothing settled yet')
  for (const [addr, amount] of byToken) {
    const asset = assetByAddress(addr as Address)
    const units = asset ? Number(formatUnits(amount, asset.decimals)) : Number(amount)
    const price = prices[addr]
    if (price === undefined) allPriced = false
    else payoutUsd += units * price
    log(
      `  ${(asset ? labelFor(asset) : addr.slice(0, 10)).padEnd(10)} ` +
        `${units.toLocaleString('en-US', {maximumFractionDigits: 6}).padStart(16)}` +
        (price === undefined ? '   (no price supplied)' : `   $${(units * price).toFixed(4)}`),
    )
  }

  heading('Operator gas')
  let gasWei = 0n
  const txs = new Set<string>()
  for (const l of settled) {
    const h = (l as {transactionHash?: string}).transactionHash
    if (h) txs.add(h)
  }
  for (const h of [...txs].slice(0, 200)) {
    try {
      const r = await pc.getTransactionReceipt({hash: h as `0x${string}`})
      gasWei += r.gasUsed * r.effectiveGasPrice
    } catch {
      // A receipt that cannot be read is left out rather than estimated.
    }
  }
  const gas = Number(formatUnits(gasWei, NATIVE_USDC_DECIMALS))
  log(`  settle transactions ${txs.size}`)
  log(`  gas paid            ${gas.toFixed(6)} USDC`)
  log('  reveal gas and inventory purchases are not included')

  heading('Result')
  if (byToken.size === 0) {
    log('  No settled spins. Nothing to measure yet.')
  } else if (!allPriced) {
    log('  Payout value is not computable: a reward token had no price in the snapshot.')
    log('  Revenue and the token units above are exact.')
  } else {
    const net = revenue - payoutUsd - gas
    const ratio = revenue > 0 ? payoutUsd / revenue : 0
    log(`  revenue            ${revenue.toFixed(4)} USDC`)
    log(`  payouts            ${payoutUsd.toFixed(4)} USDC  (${(ratio * 100).toFixed(1)}% of revenue)`)
    log(`  settle gas         ${gas.toFixed(6)} USDC`)
    log(`  net                ${net >= 0 ? '+' : ''}${net.toFixed(4)} USDC`)
    if (settled.length < 100) {
      log('')
      log(`  ${settled.length} settled spins is far too small a sample to read as a trend. One`)
      log("  jackpot swings it entirely; steer by the audit's modelled ratio until the count")
      log('  is in the thousands.')
    }
  }
}

// ────────────────────────────────────────────────────────────────────── reveal

const SPIN_REQUESTED_EVENT = {
  type: 'event',
  name: 'SpinRequested',
  inputs: [
    {name: 'spinId', type: 'uint256', indexed: true},
    {name: 'player', type: 'address', indexed: true},
    {name: 'machineId', type: 'uint64', indexed: true},
    {name: 'machineVersion', type: 'uint32', indexed: false},
    {name: 'pricePaid', type: 'uint256', indexed: false},
    {name: 'randomnessRequestId', type: 'uint256', indexed: false},
  ],
} as const

/**
 * Settles the spin that consumed a freshly revealed randomness request.
 *
 * Settlement is permissionless and the outcome is a pure function of the revealed word, so it
 * does not matter who calls it. Someone has to, though, and it must not be the player: the
 * browser used to attempt it on a timer, which meant a wallet prompt every few seconds until
 * randomness landed. The daemon is already watching and already signing, so it does the job
 * and the player signs exactly once, for the spin itself.
 *
 * A failure here is logged and left alone rather than retried into the ground — the spin stays
 * settleable by anyone, including the player from the UI.
 */
async function settleSpinFor(
  ctx: OperatorContext,
  requestId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<void> {
  const logs = await ctx.publicClient.getLogs({
    address: ctx.contracts.machineManager,
    event: SPIN_REQUESTED_EVENT,
    fromBlock,
    toBlock,
  })

  const match = logs.find(
    (entry) => (entry.args as {randomnessRequestId?: bigint}).randomnessRequestId === requestId,
  )
  const spinId = (match?.args as {spinId?: bigint} | undefined)?.spinId
  if (spinId === undefined) {
    log(`    ! revealed request ${requestId} but found no spin that consumed it`)
    return
  }

  const spin = await ctx.publicClient.readContract({
    address: ctx.contracts.machineManager,
    abi: arcadeMachineManagerAbi,
    functionName: 'spinOf',
    args: [spinId],
  })
  // 1 = Pending. Anything else is already resolved.
  if (spin.status !== 1) return

  try {
    await send(ctx, `settleSpin(${spinId})`, () =>
      ctx.walletClient!.writeContract({
        address: ctx.contracts.machineManager,
        abi: arcadeMachineManagerAbi,
        functionName: 'settleSpin',
        args: [spinId],
        chain: ctx.chain,
        account: ctx.walletClient!.account!,
      }),
    )
  } catch (err) {
    log(`    ! settle of spin ${spinId} failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)
  }
}

/**
 * How fast the daemon looks for new requests, at its fastest.
 *
 * Arc produces a block every ~0.53s, so a 2s tick added up to two seconds of dead time to
 * every spin — the single largest avoidable delay between paying and seeing a reward. At
 * 300ms the loop is faster than the chain it watches.
 *
 * This is a floor, not a fixed rate: the loop backs off on its own when the endpoint rate
 * limits and returns here when it stops. So this value does not have to be padded for the
 * worst minute of the day, which is what picking a single safe interval would cost.
 */
const POLL_MS = Number.parseInt(process.env.ARC_REVEAL_POLL_MS ?? '300', 10)

/** Slowest the loop will back off to when the endpoint is refusing work. */
const POLL_MAX_MS = Number.parseInt(process.env.ARC_REVEAL_POLL_MAX_MS ?? '4000', 10)

/**
 * The reveal daemon.
 *
 * Watches for randomness requests, waits for each one's anchor block, and reveals the
 * pre-image. **This must be running for spins to settle.** A request that is never revealed
 * expires; anyone can then report the miss, which refunds the player in full and slashes the
 * bond — correct behaviour, and a direct cost to the operator for being offline.
 *
 * It re-scans from a bounded lookback on every tick rather than holding a subscription, so a
 * restart or a dropped websocket cannot silently skip a request. Reveals are idempotent in
 * effect: a request that is no longer Pending is skipped.
 *
 * After each reveal it also settles the spin that consumed it, so the player signs once and
 * only once — for the spin itself.
 */
async function reveal(): Promise<void> {
  const ctx = await loadContext()
  await assertChain(ctx)

  const store = loadStore(ctx.chain.id, ctx.contracts.randomness)
  if (store.entries.length === 0) {
    fail('The seed store is empty. Run `pnpm operator commitments <count>` first.')
  }

  const [delay, window] = await Promise.all([
    ctx.publicClient.readContract({
      address: ctx.contracts.randomness,
      abi: commitRevealRandomnessAbi,
      functionName: 'revealDelayBlocks',
    }),
    ctx.publicClient.readContract({
      address: ctx.contracts.randomness,
      abi: commitRevealRandomnessAbi,
      functionName: 'revealWindowBlocks',
    }),
  ])

  heading('Reveal daemon')
  log(`  randomness   ${ctx.contracts.randomness}`)
  log(`  signer       ${ctx.account}  (${ctx.signerSource})`)
  log(`  delay        ${delay} blocks    window ${window} blocks`)
  log(`  seed store   ${store.entries.filter((e) => e.index !== null && e.revealedFor === null).length} unrevealed pairs`)
  log('\n  Watching. Ctrl-C to stop — spins requested while this is down may expire.\n')

  /*
   * A request is only revealable inside its window, so looking back further than the window
   * only re-examines requests that are already resolved. A small margin is kept on top so a
   * slow tick cannot let one slip out of view between scans.
   *
   * That full range is scanned on the first tick and periodically afterwards, to catch
   * anything a dropped connection missed. Between sweeps only new blocks are read: at the
   * tick rate below, re-reading 862 blocks every time would be most of a second of work
   * spent re-deriving what the previous tick already knew, which is latency a player feels.
   */
  const lookback = BigInt(delay) + BigInt(window) + 50n
  const seen = new Set<string>()
  let lastScanned: bigint | null = null
  let tickCount = 0
  /** Full re-sweep every this many ticks, as a safety net against a missed range. */
  const SWEEP_EVERY = 200

  async function tick(): Promise<void> {
    const head = await ctx.publicClient.getBlockNumber()
    const sweeping = lastScanned === null || tickCount % SWEEP_EVERY === 0
    const fromBlock = sweeping
      ? head > lookback
        ? head - lookback
        : 0n
      : // Re-read the previous head too: a log in the block being read as `head` last tick
        // may not have been indexed yet when that request was served.
        lastScanned!
    tickCount += 1
    if (head < fromBlock) return

    const logs = await ctx.publicClient.getLogs({
      address: ctx.contracts.randomness,
      event: {
        type: 'event',
        name: 'RandomnessRequested',
        inputs: [
          {name: 'requestId', type: 'uint256', indexed: true},
          {name: 'consumer', type: 'address', indexed: true},
          {name: 'commitmentIndex', type: 'uint256', indexed: false},
          {name: 'anchorBlock', type: 'uint64', indexed: false},
          {name: 'entropy', type: 'bytes32', indexed: false},
        ],
      },
      fromBlock,
      toBlock: head,
    })

    // Only advance after getLogs returned: if it threw, the range must be read again.
    lastScanned = head

    for (const entry of logs) {
      const args = entry.args as {
        requestId?: bigint
        commitmentIndex?: bigint
        anchorBlock?: bigint
      }
      const requestId = args.requestId
      const commitmentIndex = args.commitmentIndex
      const anchorBlock = args.anchorBlock
      if (requestId === undefined || commitmentIndex === undefined || anchorBlock === undefined) {
        continue
      }

      const key = requestId.toString()

      // Not yet at the anchor block: the contract would revert with TooEarlyToReveal.
      if (head < anchorBlock) continue

      const request = await ctx.publicClient.readContract({
        address: ctx.contracts.randomness,
        abi: commitRevealRandomnessAbi,
        functionName: 'requestOf',
        args: [requestId],
      })
      // RequestState: 0 None, 1 Pending, 2 Fulfilled, 3 Failed.
      if (request.state !== 1) {
        seen.add(key)
        continue
      }

      if (head > anchorBlock + BigInt(window)) {
        if (!seen.has(key)) {
          log(`  ✗ request ${key} expired unrevealed (window closed at block ${anchorBlock + BigInt(window)}).`)
          log('    The player can be refunded by anyone calling reportMissedReveal.')
          seen.add(key)
        }
        continue
      }

      const pair = byIndex(store, Number(commitmentIndex))
      if (!pair) {
        if (!seen.has(key)) {
          log(`  ✗ request ${key} consumed commitment ${commitmentIndex}, which is not in this store.`)
          log('    Cannot reveal it. Restore the store that holds that pre-image.')
          seen.add(key)
        }
        continue
      }

      try {
        await send(ctx, `reveal(request ${key}, commitment ${commitmentIndex})`, () =>
          ctx.walletClient!.writeContract({
          address: ctx.contracts.randomness,
          abi: commitRevealRandomnessAbi,
          functionName: 'reveal',
          args: [requestId, pair.seed, pair.salt],
          chain: ctx.chain,
          account: ctx.walletClient!.account!,
          }),
        )
        pair.revealedFor = Number(requestId)
        saveStore(store)
        await settleSpinFor(ctx, requestId, fromBlock, head)
      } catch (err) {
        // Another caller may have revealed it first — reveal is permissionless by design.
        log(`    ! reveal of ${key} failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)
      }
    }
  }

  /*
   * Adaptive pacing.
   *
   * A fixed interval has to be chosen for the worst case, which means running slowly all the
   * time to survive the occasional bad minute — and reveal latency is the thing a player
   * actually feels. So the loop runs fast, backs off when the endpoint pushes back, and
   * walks the interval down again once it stops.
   *
   * Only rate limiting widens the gap. An ordinary failure is a fixed pause: retrying a
   * genuine error faster does not help, and treating it as congestion would slow the loop
   * for a reason that has nothing to do with load.
   */
  let interval = POLL_MS
  for (;;) {
    try {
      await tick()
      // Successful tick: ease back toward the floor rather than snapping, so one good tick
      // in a bad patch does not put the loop straight back into the limiter.
      interval = Math.max(POLL_MS, Math.floor(interval * 0.7))
      await new Promise((r) => setTimeout(r, interval))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const rateLimited = /\b429\b|rate limit|exceeds defined limit/i.test(message)
      if (rateLimited) {
        interval = Math.min(POLL_MAX_MS, Math.max(POLL_MS * 2, interval * 2))
        log(`  … endpoint is rate limiting; backing off to ${interval}ms`)
      } else {
        log(`  ! tick failed: ${message.slice(0, 160)}`)
      }
      await new Promise((r) => setTimeout(r, rateLimited ? interval : 4_000))
    }
  }
}

// ───────────────────────────────────────────────────────────────────────── main

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case 'status':
      return status()
    case 'commitments':
      return commitments(rest[0])
    case 'bond':
      return bond(rest[0])
    case 'register-tokens':
      return registerTokens()
    case 'fund':
      return fund(rest[0], rest[1])
    case 'machines':
      return machines()
    case 'reveal':
      return reveal()
    case 'pnl':
      return pnl()
    case 'distribute':
      return distribute()
    case 'bootstrap':
      return bootstrap()
    case 'buyback':
      return buyback()
    case 'fees':
      return fees()
    case 'solvency':
      return solvency()
    default:
      log('Arcade operator CLI\n')
      log('  pnpm operator status                  read-only health check')
      log('  pnpm operator commitments <count>     publish randomness commitments')
      log('  pnpm operator bond <usdc>             post the operator bond')
      log('  pnpm operator register-tokens [--all] register reward assets used by live machines')
      log('  pnpm operator fund <symbol> <amount>  deposit reward inventory')
      log('  pnpm operator machines                create machines, publish reward tables')
      log('  pnpm operator reveal                  run the reveal daemon (keep running)')
      log('  pnpm operator pnl [--prices <file>]   measured revenue, payouts, net result')
      log('  pnpm operator distribute              sweep fee-router revenue to its wallets')
      log('  pnpm operator bootstrap [--concurrency N]  run the whole setup, resumable')
      log('  pnpm operator buyback [--amount N]     buy ARCADE with treasury USDC and burn it')
      log('  pnpm operator fees --bps N [--treasury A]  set the revenue split / destination')
      log('  pnpm operator solvency --capital N --prices F  what split the float can afford')
      process.exit(command ? 1 : 0)
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof SignerError) fail(err.message)
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
})
