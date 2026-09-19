/**
 * Legal and risk copy.
 *
 * ## An important limitation, stated up front
 *
 * These documents are written as honest, readable product disclosures. They are **not legal
 * advice and not a substitute for counsel.** Arcade sells a randomised outcome for money,
 * which in many jurisdictions is a regulated activity, and the applicable rules differ by
 * region and change often.
 *
 * Before any production launch the operator must have these reviewed by a lawyer qualified
 * in every jurisdiction served, and must populate the jurisdiction controls in
 * `config/compliance.ts` from that review. Placeholders like "[OPERATOR]" are intentional —
 * inventing an operating entity, a governing law or a dispute forum would be worse than
 * leaving the blank visible.
 */

export type LegalSection = {
  heading: string
  paragraphs: string[]
  list?: string[]
}

export type LegalDocument = {
  slug: string
  title: string
  standfirst: string
  updated: string
  sections: LegalSection[]
}

const OPERATOR = '[OPERATOR LEGAL ENTITY]'

export const RISK_DISCLOSURE: LegalDocument = {
  slug: 'risk',
  title: 'Risk Disclosure',
  standfirst:
    'What can go wrong, in plain language. Read this before you spend anything.',
  updated: '18 September 2026',
  sections: [
    {
      heading: 'You are buying a randomised outcome',
      paragraphs: [
        'A spin is a purchase, not an investment. You pay a fixed amount of USDC and receive one token reward selected at random from the machine’s published reward table. The published odds describe exactly how often each band occurs.',
        'Most spins return a reward worth less than the spin price. That is what the odds mean. Arcade makes no promise of profit and there is no configuration in which spinning is a reliable way to make money.',
      ],
    },
    {
      heading: 'Reward tokens are volatile and often thinly traded',
      paragraphs: [
        'Arcade rewards are tokens trading on Arc. Several have modest liquidity, which means their price can move sharply and selling a meaningful amount may move the price against you or may not be possible at the quoted price.',
        'Arcade verifies a token’s contract — its address, its decimals and its transfer behaviour. It does not assess, and cannot vouch for, the quality, longevity or value of any asset. A token can lose most or all of its value after you receive it.',
      ],
    },
    {
      heading: 'Smart contract risk',
      paragraphs: [
        'Arcade runs on smart contracts that have not been independently audited. They ship with unit, fuzz and invariant tests, including a solvency invariant exercised across thousands of randomised call sequences, but testing is not an audit and does not rule out a defect.',
        'A bug could cause loss of funds. Do not spend more than you are willing to lose entirely.',
      ],
    },
    {
      heading: 'Randomness and operator behaviour',
      paragraphs: [
        'Arc does not currently offer a verifiable random function, so Arcade uses a commit–reveal scheme. The operator cannot choose or change your outcome, but between the anchor block and the reveal it can compute the outcome and could decline to publish it.',
        'Withholding denies a result rather than altering one. If a reveal never arrives, anyone can report it after the window closes: the spin is refunded in full and a penalty is slashed from the operator’s bond and paid to you. This is a mitigation, not an elimination, and it is described in full on the fairness page.',
      ],
    },
    {
      heading: 'Network and delivery risk',
      paragraphs: [
        'Transactions can fail, be delayed, or be dropped. Arc settlement is sub-second under normal conditions, but no network is always available.',
        'If a reward token cannot be transferred to you — because it pauses transfers or blocks your address — the reward stays reserved in the vault and becomes claimable by you. It cannot be withdrawn by anyone else, but you may have to wait for the token to allow the transfer.',
      ],
    },
    {
      heading: 'Regulatory risk',
      paragraphs: [
        'Paying for a randomised prize may be regulated as gambling, a lottery, or a prize competition depending on where you are. Rules differ significantly between jurisdictions and change.',
        'It is your responsibility to determine whether you may lawfully use Arcade where you live. Arcade may restrict access by jurisdiction at any time, and may do so without notice.',
      ],
    },
    {
      heading: 'No advice, no affiliation',
      paragraphs: [
        'Nothing in Arcade is financial, investment, legal or tax advice. Arcade is an independent application built on Arc and is not affiliated with, sponsored by, or endorsed by Circle or Arc.',
      ],
    },
  ],
}

export const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Use',
  standfirst: 'The agreement between you and the operator of this interface.',
  updated: '18 September 2026',
  sections: [
    {
      heading: 'Template notice',
      paragraphs: [
        `These terms are a working template prepared alongside the software. They have not been reviewed by a lawyer. ${OPERATOR} must have them reviewed by qualified counsel in every jurisdiction served, and must complete every bracketed placeholder, before accepting value from users.`,
        'Bracketed placeholders are left visible deliberately. Filling them in with invented entities, governing law or dispute forums would create a document that looks authoritative while being wrong.',
      ],
    },
    {
      heading: 'What Arcade is',
      paragraphs: [
        'Arcade is an interface to smart contracts deployed on the Arc network. When you spin, you interact directly with those contracts from your own wallet. The interface does not take custody of your funds, cannot move your assets, and never has access to your keys.',
        'A spin purchases one randomised token reward drawn from a machine’s published reward table. The reward may be worth less than the price of the spin.',
      ],
    },
    {
      heading: 'Eligibility',
      paragraphs: [
        'You must be of legal age in your jurisdiction, and at least the minimum age configured for this deployment, to use Arcade. Age is self-attested; the interface does not verify identity.',
        'You must not use Arcade if doing so would breach the law where you are, or if you are subject to sanctions that prohibit it.',
      ],
    },
    {
      heading: 'Your responsibilities',
      paragraphs: ['You are solely responsible for:'],
      list: [
        'the security of your wallet, keys and recovery material',
        'the transactions you sign, which are irreversible once confirmed',
        'any taxes arising from your use of Arcade',
        'determining whether Arcade is lawful for you to use',
      ],
    },
    {
      heading: 'No warranty',
      paragraphs: [
        'Arcade is provided as-is and as-available, without warranties of any kind. The smart contracts have not been independently audited. Nothing is guaranteed to be uninterrupted, error-free, or fit for a particular purpose.',
      ],
    },
    {
      heading: 'Limitation of liability',
      paragraphs: [
        `To the maximum extent permitted by law, ${OPERATOR} is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, arising from your use of Arcade. [JURISDICTION-SPECIFIC LIABILITY CAP AND CARVE-OUTS TO BE COMPLETED BY COUNSEL.]`,
      ],
    },
    {
      heading: 'Changes and availability',
      paragraphs: [
        'Machines may be paused, retired, or reconfigured at any time. Pausing a machine stops new spins; it never strands a spin already in flight, which remains settleable or refundable.',
        'Access may be restricted by jurisdiction at any time.',
      ],
    },
    {
      heading: 'Governing law',
      paragraphs: [
        'These terms are governed by [GOVERNING LAW TO BE DETERMINED BY COUNSEL]. Disputes are subject to [DISPUTE RESOLUTION FORUM TO BE DETERMINED BY COUNSEL].',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`${OPERATOR}, [REGISTERED ADDRESS], [CONTACT EMAIL].`],
    },
  ],
}

export const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy',
  standfirst: 'What Arcade collects, which is close to nothing.',
  updated: '18 September 2026',
  sections: [
    {
      heading: 'What Arcade does not collect',
      paragraphs: [
        'Arcade has no user accounts, no sign-up and no server-side user database. It does not ask for your name, email, phone number or any identity document.',
        'It never has access to your private keys or seed phrase, and it will never ask for them.',
      ],
    },
    {
      heading: 'What stays in your browser',
      paragraphs: [
        'These are stored locally on your device and are never transmitted to Arcade:',
      ],
      list: [
        'your acknowledgement of the entry notice',
        'session spend and spin counters used for the responsible-play limits',
        'a self-exclusion date, if you set one',
        'your wallet connection state',
      ],
    },
    {
      heading: 'What is public because it is onchain',
      paragraphs: [
        'Every spin is a public blockchain transaction. Your wallet address, the machine, the amount paid, the reward and the timestamp are permanently visible on Arc to anyone, including through the activity tape in this interface.',
        'This is inherent to a public blockchain and is not something Arcade can undo. If you do not want an activity pattern linked to an address, use an address you are comfortable being public.',
      ],
    },
    {
      heading: 'Third parties',
      paragraphs: [
        'To function, the interface talks to an Arc RPC endpoint, which necessarily sees your IP address and the requests your browser makes. Token market-data snapshots come from third-party sources, which are credited on the rewards page.',
        'Fonts are self-hosted through the application build, so loading a page does not call out to a font provider.',
      ],
    },
    {
      heading: 'Your choices',
      paragraphs: [
        'Clearing your browser’s site data removes everything Arcade stored locally. Note that this also clears session limits and any self-exclusion you set.',
      ],
    },
    {
      heading: 'Template notice',
      paragraphs: [
        `This notice describes the software as built. ${OPERATOR} must confirm it against the deployment’s actual hosting, analytics and logging arrangements, and against applicable data-protection law, before launch.`,
      ],
    },
  ],
}

export const RESPONSIBLE_PLAY: LegalDocument = {
  slug: 'responsible-play',
  title: 'Responsible Play',
  standfirst: 'Tools, limits, and an honest account of what they can and cannot do.',
  updated: '18 September 2026',
  sections: [
    {
      heading: 'Be clear about what this is',
      paragraphs: [
        'Arcade is a paid randomised-prize product. Every spin costs real money and most spins return less than they cost. It can be fun; it is not a way to make money, and treating it as one tends to end badly.',
        'If you find yourself spinning to recover losses, spending more than you planned, or hiding it from people close to you, those are signals worth taking seriously.',
      ],
    },
    {
      heading: 'The tools available',
      paragraphs: ['Arcade offers, on the play screen:'],
      list: [
        'a per-session spend limit in USDC',
        'a per-session spin count limit',
        'a visible running total for the current session',
        'self-exclusion, which blocks new spins from this browser for a set period',
      ],
    },
    {
      heading: 'What these tools cannot do',
      paragraphs: [
        'These controls live in your browser’s local storage. That keeps Arcade free of personal data, but it also means the limits are a personal guardrail rather than an enforced control: clearing site data, using a different browser, or using a different device resets them.',
        'This is a real limitation and it is stated rather than glossed over. If you need a control that cannot be bypassed, use a tool that operates at the device or network level, or seek support from an organisation equipped for it.',
      ],
    },
    {
      heading: 'Getting help',
      paragraphs: [
        'If gambling is affecting your life or someone else’s, support is available and it is free and confidential in many countries. Search for the national gambling helpline or support service for your country — deliberately not a single hard-coded number here, because the right service depends entirely on where you are and a stale number is worse than none.',
        'If you are in immediate distress, contact your local emergency services or a crisis line in your country.',
      ],
    },
    {
      heading: 'For operators',
      paragraphs: [
        `${OPERATOR} must review these measures against the requirements of every jurisdiction served. Many regimes mandate specific tooling — deposit limits, cooling-off periods, enforced self-exclusion registers, mandatory signposting to named support organisations — that local browser storage cannot satisfy.`,
      ],
    },
  ],
}

export const LEGAL_DOCUMENTS = [RISK_DISCLOSURE, TERMS, PRIVACY, RESPONSIBLE_PLAY]
