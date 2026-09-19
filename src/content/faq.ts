export type FaqItem = {
  question: string
  answer: string
}

/**
 * FAQ copy.
 *
 * Written to answer the questions honestly, including the uncomfortable ones. The answer to
 * "are rewards guaranteed to be worth more than a spin" is no, and it says no.
 */
export const HOME_FAQ: FaqItem[] = [
  {
    question: 'What is Arcade?',
    answer:
      'An onchain gacha built on Arc. You pay a fixed price in USDC, one spin happens, and you receive a token reward drawn at random from the machine’s published reward table. Every step is recorded onchain and can be checked by anyone.',
  },
  {
    question: 'What does one spin cost?',
    answer:
      'It depends on the machine. Genesis and Discovery are 2 USDC, Velocity is 3 USDC, Blue Chip is 5 USDC. The exact price is shown before you sign, and the price is locked into the spin the moment it is accepted — it cannot change underneath you.',
  },
  {
    question: 'What can I win?',
    answer:
      'Tokens that actually trade on Arc Mainnet. Each machine lists its full reward set, the possible amount range for every asset, and the probability of each band, before you spin.',
  },
  {
    question: 'Where do rewards come from?',
    answer:
      'A prize vault funded ahead of time. A machine cannot accept a spin unless the vault already holds enough of every asset in its reward table to cover the worst-case payout for that spin and every spin still in flight. The contract enforces this, so a machine cannot promise what it cannot pay.',
  },
  {
    question: 'How is the outcome chosen?',
    answer:
      'By commit–reveal. Before your spin exists, the operator publishes a batch of sealed commitments onchain. Your spin consumes the next one in strict order and binds it to your address, the machine version and a future block. The seed is then revealed, and the result is the hash of the seed, the salt, your request’s entropy and that block’s hash. Anyone can recompute it.',
  },
  {
    question: 'Can Arcade change my result?',
    answer:
      'No. The seed was committed before your spin existed, so it cannot be adapted to the outcome, and revealing anything other than the committed pre-image fails the onchain hash check. Once revealed, the value is immutable — there is no admin function anywhere that can overwrite it. The operator can refuse to reveal, which denies a result rather than changing it; if that happens you are refunded in full and compensated from the operator’s bond.',
  },
  {
    question: 'What happens if a reward transfer fails?',
    answer:
      'Your reward stays yours. If the push transfer fails — a token pauses, or blacklists your address — the amount remains reserved in the vault and becomes claimable by you. It is not withdrawable by the treasury and it is not lost. You pull it whenever the token allows.',
  },
  {
    question: 'What network does Arcade use?',
    answer:
      'Arc, Circle’s Layer 1, chain ID 5042. Arc Mainnet opened on 16 September 2026.',
  },
  {
    question: 'What currency pays for spins?',
    answer:
      'Native USDC — the gas asset on Arc, which uses 18 decimals. Because it is the native asset, a spin needs one signature and no ERC-20 approval. Note that the separate USDC ERC-20 interface on Arc uses 6 decimals; Arcade does not mix the two.',
  },
  {
    question: 'How can I verify a spin?',
    answer:
      'The fairness page lists every spin with its id, machine version, config hash, request transaction, revealed seed and salt, the anchor block, the resulting random word, and the settlement transaction. You can recompute the word yourself from the published inputs, or call the contract’s own recompute function and compare.',
  },
  {
    question: 'Are rewards guaranteed to be worth more than a spin?',
    answer:
      'No. Most spins return less than the spin cost — that is what the published odds describe. Reward tokens are volatile and some are thinly traded, so a reward’s value can also fall after you receive it. Arcade makes no promise of profit and you should not treat a spin as an investment.',
  },
  {
    question: 'Is Arcade affiliated with Circle or Arc?',
    answer:
      'No. Arcade is an independent application built on Arc. It is not affiliated with, sponsored by, or endorsed by Circle or Arc.',
  },
]

export const FAIRNESS_FAQ: FaqItem[] = [
  {
    question: 'Why not Chainlink VRF?',
    answer:
      'Because it is not available on Arc. Chainlink’s Arc integration covers CCIP, Data Feeds, Data Streams and Proof of Reserve — not VRF. Rather than call a blockhash scheme “provably fair”, Arcade ships an explicit commit–reveal construction and states its assumptions. The randomness adapter is a swappable interface, so a reputable VRF can be dropped in without redeploying the machines, the vault or the registry.',
  },
  {
    question: 'What is the residual trust assumption?',
    answer:
      'Selective withholding. Between the anchor block and the reveal, the operator can compute the outcome and could choose not to publish it. That cannot change a result, only deny one. After the reveal window closes, anyone can report the miss: the request is marked failed, you are refunded in full, and a penalty is slashed from the operator’s bond and paid to you. Missed reveals are counted onchain and published.',
  },
  {
    question: 'Could the operator grind the seed to pick a favourable outcome?',
    answer:
      'No. Commitments are published in advance and consumed in strict ascending order, so the operator cannot choose which seed serves which spin. The final word also mixes in the hash of a block that did not exist when the seed was committed, so a seed cannot be precomputed to target an outcome.',
  },
  {
    question: 'Could I predict my own outcome before spinning?',
    answer:
      'No. The seed is hidden behind its commitment hash until after your spin is accepted, and the anchor blockhash does not exist yet when you sign. Choosing when to submit gains you nothing, because you cannot see the seed.',
  },
  {
    question: 'Does the animation decide anything?',
    answer:
      'No, and this matters. The orbit animation reads a result that is already fixed onchain. It cannot influence, delay or reinterpret it. If you close the tab mid-spin, the outcome is unchanged and still settleable by anyone — including you, later.',
  },
  {
    question: 'Have the contracts been audited?',
    answer:
      'No. The contracts in this repository have not been independently audited. They ship with unit, fuzz and invariant tests, and the solvency invariant is exercised across thousands of randomised call sequences, but that is not a substitute for an audit and is not presented as one.',
  },
]
