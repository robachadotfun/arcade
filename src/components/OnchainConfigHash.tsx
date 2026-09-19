'use client'

import {useReadContract} from 'wagmi'
import {arcadeMachineManagerAbi} from '@/abi'
import {resolveMode} from '@/config/mode'
import type {MachineConfig} from '@/config/machines'

/**
 * The authoritative identity of a machine's reward table, read from the chain.
 *
 * `publishVersion` computes `keccak256(machineId, version, spinPrice, effectiveBlock, tiers)`
 * and seals it into the version record. That hash is what a player can verify a payout
 * against, so it is the only fingerprint worth showing — a locally-computed one would be an
 * assertion about a file nobody else can see.
 *
 * The three states are kept distinct on purpose, because they mean different things:
 *
 *   - not deployed  — this machine has no onchain id yet, so there is no table to hash
 *   - unavailable   — the read failed; the table exists but we could not fetch it
 *   - the hash      — read from contract storage
 *
 * Collapsing "we could not read it" into "there is none" is exactly the kind of small lie
 * this product is built to avoid.
 */
export function useOnchainVersion(machine: MachineConfig) {
  const status = resolveMode()
  const manager = status.kind === 'ready' ? status.contracts.machineManager : undefined
  const machineId = machine.onchainId

  const machineRead = useReadContract({
    address: manager,
    abi: arcadeMachineManagerAbi,
    functionName: 'machineOf',
    args: machineId === null ? undefined : [BigInt(machineId)],
    query: {enabled: Boolean(manager) && machineId !== null},
  })

  const version = machineRead.data?.currentVersion

  const versionRead = useReadContract({
    address: manager,
    abi: arcadeMachineManagerAbi,
    functionName: 'versionOf',
    args: machineId === null || version === undefined ? undefined : [BigInt(machineId), version],
    query: {enabled: Boolean(manager) && machineId !== null && version !== undefined},
  })

  return {
    deployed: machineId !== null && Boolean(manager),
    version,
    configHash: versionRead.data?.configHash,
    spinPrice: versionRead.data?.spinPrice,
    paused: machineRead.data?.paused,
    loading: machineRead.isLoading || versionRead.isLoading,
    error: machineRead.error ?? versionRead.error,
  }
}

/** Renders the onchain config hash, truncated, or an honest reason it is absent. */
export function OnchainConfigHash({
  machine,
  className = '',
  truncate = true,
}: {
  machine: MachineConfig
  className?: string
  truncate?: boolean
}) {
  const {deployed, configHash, loading, error} = useOnchainVersion(machine)

  const text = !deployed
    ? 'Not deployed'
    : loading
      ? 'Reading…'
      : error
        ? 'Unavailable'
        : configHash
          ? truncate
            ? `${configHash.slice(0, 10)}…${configHash.slice(-6)}`
            : configHash
          : 'No version published'

  return (
    <span className={`font-mono ${className}`} title={configHash ?? undefined}>
      {text}
    </span>
  )
}

/** The machine's onchain version number, for a label like `Version 3`. */
export function OnchainVersionLabel({machine}: {machine: MachineConfig}) {
  const {deployed, version, loading, error} = useOnchainVersion(machine)
  if (!deployed) return <>Not deployed</>
  if (loading) return <>Reading…</>
  if (error) return <>Version unavailable</>
  if (version === undefined) return <>No version</>
  return <>Version {version}</>
}
