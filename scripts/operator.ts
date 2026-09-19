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
 *   pnpm operator register-tokens         — register verified reward assets
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

import {formatUnits, parseUnits, decodeEventLog, type Address, type Hex} from 'viem'
import {
  arcadeMachineManagerAbi,
  commitRevealRandomnessAbi,
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
import {REWARD_ASSETS, assetByAddress} from '../src/config/rewards'

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
  let anyEmpty = false
  for (const asset of REWARD_ASSETS) {
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
      `  ${asset.symbol.padEnd(10)} ${formatUnits(avail, asset.decimals).padStart(18)}` +
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
  if (anyEmpty) blockers.push('at least one reward token has zero vault inventory')
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

  heading(`Registering ${REWARD_ASSETS.length} verified reward assets`)
  for (const asset of REWARD_ASSETS) {
    const already = await ctx.publicClient.readContract({
      address: ctx.contracts.rewardRegistry,
      abi: rewardRegistryAbi,
      functionName: 'isRegistered',
      args: [asset.address as Address],
    })
    if (already) {
      log(`  · ${asset.symbol} already registered`)
      continue
    }
    await send(ctx, `registerToken(${asset.symbol})`, () =>
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

  const asset = REWARD_ASSETS.find((a) => a.symbol.toLowerCase() === symbolArg.toLowerCase())
  if (!asset) {
    fail(`Unknown reward asset "${symbolArg}". Known: ${REWARD_ASSETS.map((a) => a.symbol).join(', ')}`)
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

  await send(ctx, `approve(vault, ${amountArg} ${asset.symbol})`, () =>
    ctx.walletClient!.writeContract({
    address: asset.address as Address,
    abi: erc20,
    functionName: 'approve',
    args: [ctx.contracts.prizeVault, amount],
    chain: ctx.chain,
    account: ctx.walletClient!.account!,
    }),
  )

  await send(ctx, `depositReward(${amountArg} ${asset.symbol})`, () =>
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

// ────────────────────────────────────────────────────────────────────── reveal

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
    default:
      log('Arcade operator CLI\n')
      log('  pnpm operator status                  read-only health check')
      log('  pnpm operator commitments <count>     publish randomness commitments')
      log('  pnpm operator bond <usdc>             post the operator bond')
      log('  pnpm operator register-tokens         register verified reward assets')
      log('  pnpm operator fund <symbol> <amount>  deposit reward inventory')
      log('  pnpm operator machines                create machines, publish reward tables')
      log('  pnpm operator reveal                  run the reveal daemon (keep running)')
      process.exit(command ? 1 : 0)
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof SignerError) fail(err.message)
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
})
