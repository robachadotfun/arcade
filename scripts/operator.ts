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
import {readFileSync} from 'node:fs'
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

  heading('Can a spin happen right now?')
  const blockers: string[] = []
  if (available === 0n) blockers.push('no randomness commitments available')
  if (bond === 0n) blockers.push('no operator bond posted')
  if (Number(registered) === 0) blockers.push('no reward tokens registered')
  if (anyEmpty) blockers.push('a reward token a live machine pays has zero vault inventory')
  if (MACHINES.every((m) => m.onchainId === null)) blockers.push('no machine ids mapped')
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
    // Reward funding is what replaces paid-out inventory. Taking too much of it leaves the
    // vault unable to cover the next spin, which stops the machine rather than enriching it.
    if (next < 3_000) {
      log(`\n  WARNING: ${next / 100}% to reward funding. Payouts run at roughly 71% of revenue,`)
      log('  so anything below that leaves inventory shrinking every spin.')
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
  const amountFlag = process.argv.indexOf('--amount')
  const confirm = process.argv.includes('--confirm')

  heading('ARCADE buyback and burn')
  log(`  token              ${ARCADE_TOKEN.address}`)
  log(`  burn address       ${BURN_ADDRESS}`)
  log(`  pool (Uniswap v4)  ${ARCADE_POOL_ID}`)

  const burnedBefore = await ctx.publicClient.readContract({
    address: ARCADE_TOKEN.address,
    abi: ERC20_MINI,
    functionName: 'balanceOf',
    args: [BURN_ADDRESS],
  })
  log(`  already burned     ${formatUnits(burnedBefore, ARCADE_TOKEN.decimals)} ARCADE`)

  const wallet = await ctx.publicClient.getBalance({address: ctx.account!})
  const budget =
    amountFlag === -1
      ? wallet / 2n
      : parseUnits(process.argv[amountFlag + 1] ?? '0', NATIVE_USDC_DECIMALS)

  heading('Budget')
  log(`  wallet             ${formatUnits(wallet, NATIVE_USDC_DECIMALS)} USDC`)
  log(`  to spend           ${formatUnits(budget, NATIVE_USDC_DECIMALS)} USDC`)
  if (budget === 0n) fail('Nothing to spend. Run `pnpm operator distribute` first, or pass --amount.')
  if (budget > wallet) fail('Requested more than the wallet holds.')

  if (!router) {
    heading('Blocked: no router configured')
    log('  ARCADE trades only in a Uniswap v4 pool, and no v4 router address is published in')
    log('  a source this repository can verify. Set ARCADE_BUYBACK_ROUTER to a router you')
    log('  have checked yourself, then re-run. Nothing is guessed here on purpose: a wrong')
    log('  address would take the USDC with it.')
    log('')
    log('  Until then the split can still be set, so revenue accrues in the treasury wallet')
    log('  ready to be spent:  pnpm operator fees --bps 5000')
    return
  }

  const code = await ctx.publicClient.getBytecode({address: router})
  if (!code || code === '0x') fail(`ARCADE_BUYBACK_ROUTER ${router} has no contract code.`)
  log(`  router             ${router} (${code.length / 2 - 1} bytes)`)

  heading('Simulation')
  log('  The swap is simulated before anything is sent. A router that cannot execute it')
  log('  fails here, costing nothing.')
  log('')
  log('  Not implemented: the v4 calldata shape depends on the router you supply — Universal')
  log('  Router, a periphery swap helper and a custom keeper all differ. Tell me which one')
  log('  ARCADE_BUYBACK_ROUTER points at and the encoder goes in, with the simulation wired')
  log('  to it. Everything around it — budget, guards, burn transfer, accounting — is here.')
  if (!confirm) log('\n  (--confirm was not passed; nothing would have been broadcast anyway)')
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
    if (requested.length < total) await new Promise((r) => setTimeout(r, 120))
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

  // A request is only revealable inside its window, so looking back further than the window
  // (plus slack for a restart) would only re-examine requests that are already resolved.
  const lookback = BigInt(delay) + BigInt(window) * 2n + 500n
  const seen = new Set<string>()

  async function tick(): Promise<void> {
    const head = await ctx.publicClient.getBlockNumber()
    const fromBlock = head > lookback ? head - lookback : 0n

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

  for (;;) {
    try {
      await tick()
    } catch (err) {
      log(`  ! tick failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 2_000))
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
      process.exit(command ? 1 : 0)
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof SignerError) fail(err.message)
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
})
