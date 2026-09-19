// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRandomnessSource} from "./interfaces/IRandomnessSource.sol";
import {ArcadeRoles} from "./ArcadeRoles.sol";

/// @title CommitRevealRandomness
/// @notice Verifiable randomness for Arcade on networks without a VRF.
///
/// ## Why this exists
///
/// Arc Mainnet has no Chainlink VRF. Chainlink's Arc integration covers CCIP, Data
/// Feeds, Data Streams and Proof of Reserve — not VRF. Rather than describe a naive
/// `blockhash` scheme as "provably fair", Arcade uses an explicit commit–reveal
/// construction and states its assumptions plainly.
///
/// ## Construction
///
/// 1. The operator publishes a batch of commitments `H(seed, salt)` **in advance**.
///    Commitments are consumed in strict ascending order and each exactly once.
/// 2. A spin opens a request, which binds:
///      - the next unconsumed commitment index,
///      - the consumer's context (player, spin id, machine version),
///      - `blockhash(requestBlock - 1)`,
///      - a future **anchor block** = requestBlock + revealDelayBlocks.
/// 3. The operator reveals `(seed, salt)`. The contract checks the hash against the
///    pre-published commitment and derives:
///
///        randomWord = keccak256(seed, salt, requestEntropy, blockhash(anchorBlock))
///
/// ## What this guarantees
///
/// - **The operator cannot choose an outcome.** The seed was committed before the spin
///   existed, and the anchor blockhash did not exist at commit time. Revealing anything
///   other than the committed pre-image fails the hash check.
/// - **The player cannot predict an outcome.** The seed is hidden behind its commitment.
/// - **No re-rolls.** A commitment index is consumed once and a fulfilled request's word
///   is immutable. There is no admin function that can overwrite it.
/// - **Anyone can recompute the result** from public data after the reveal.
///
/// ## Residual trust assumption (stated, not hidden)
///
/// Between the anchor block and the reveal, the operator can compute the outcome and
/// could choose to **withhold** the reveal. Withholding cannot change a result, only
/// deny it. This is mitigated, not eliminated:
///
/// - After the reveal window, anyone may call {reportMissedReveal}. The request becomes
///   `Failed`, the consumer refunds the player in full, and a penalty is slashed from the
///   operator's bond and paid to the consumer for the player's benefit.
/// - Missed reveals are counted onchain in {missedReveals} and surfaced publicly.
///
/// A VRF adapter would remove this assumption. The {IRandomnessSource} boundary exists so
/// one can be swapped in without redeploying the machine, vault or registry.
contract CommitRevealRandomness is IRandomnessSource, AccessControl, ReentrancyGuard {
    /// @dev `blockhash` is only available for the 256 most recent blocks.
    uint256 private constant BLOCKHASH_HORIZON = 256;
    /// @dev Leaves headroom inside the horizon so a reveal near the edge still resolves.
    uint256 private constant MAX_REVEAL_WINDOW = 200;
    uint256 private constant MAX_REVEAL_DELAY = 16;

    struct Request {
        address consumer;
        uint64 requestBlock;
        uint64 anchorBlock;
        uint64 commitmentIndex;
        bytes32 entropy;
        RequestState state;
        uint256 randomWord;
    }

    /// @notice Pre-published commitments, consumed in strict ascending order.
    mapping(uint256 index => bytes32 commitment) public commitments;
    /// @notice Revealed pre-images, kept so anyone can recompute any past outcome.
    mapping(uint256 index => bytes32 revealedSeed) public revealedSeeds;
    mapping(uint256 index => bytes32 revealedSalt) public revealedSalts;

    /// @notice Total commitments published.
    uint256 public commitmentCount;
    /// @notice Next commitment index a request will consume.
    uint256 public nextCommitmentIndex;

    mapping(uint256 requestId => Request) private _requests;
    uint256 public requestCount;

    /// @notice Contracts allowed to open requests.
    mapping(address consumer => bool allowed) public isConsumer;

    /// @notice Blocks between the request and the anchor block whose hash is mixed in.
    uint64 public revealDelayBlocks = 2;
    /// @notice Blocks after the anchor during which a reveal is accepted.
    uint64 public revealWindowBlocks = 180;

    /// @notice Native-USDC bond held against the operator's obligation to reveal.
    uint256 public operatorBond;
    /// @notice Penalty slashed from the bond per missed reveal, paid to the consumer.
    uint256 public missedRevealPenalty = 5 ether;
    /// @notice Count of requests that expired without a reveal.
    uint256 public missedReveals;
    /// @notice Penalty already paid to the consumer for a given abandoned request.
    mapping(uint256 requestId => uint256 penalty) private _penaltyCredited;

    event CommitmentsPublished(uint256 fromIndex, uint256 toIndex, uint256 count);
    event RandomnessRequested(
        uint256 indexed requestId,
        address indexed consumer,
        uint256 commitmentIndex,
        uint64 anchorBlock,
        bytes32 entropy
    );
    event RandomnessRevealed(uint256 indexed requestId, uint256 commitmentIndex, uint256 randomWord);
    event RevealMissed(uint256 indexed requestId, uint256 commitmentIndex, uint256 penaltyPaid);
    event ConsumerSet(address indexed consumer, bool allowed);
    event BondDeposited(uint256 amount, uint256 total);
    event BondWithdrawn(uint256 amount, uint256 remaining);
    event RevealTimingUpdated(uint64 revealDelayBlocks, uint64 revealWindowBlocks);
    event MissedRevealPenaltyUpdated(uint256 penalty);

    error NotAConsumer(address caller);
    error NoCommitmentsAvailable();
    error RequestUnknown(uint256 requestId);
    error RequestNotPending(uint256 requestId);
    error RequestNotFulfilled(uint256 requestId);
    error TooEarlyToReveal(uint64 anchorBlock);
    error RevealWindowClosed(uint64 deadline);
    error RevealWindowStillOpen(uint64 deadline);
    error CommitmentMismatch(uint256 commitmentIndex);
    error AnchorBlockhashUnavailable(uint64 anchorBlock);
    error InvalidTiming();
    error BondTooSmall(uint256 requested, uint256 available);
    error NativeTransferFailed(address to, uint256 amount);
    error EmptyBatch();

    constructor(address admin, address randomnessOperator, address guardian) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ArcadeRoles.RANDOMNESS_OPERATOR, randomnessOperator);
        _grantRole(ArcadeRoles.GUARDIAN, guardian);
    }

    // ------------------------------------------------------------------ commitments

    /// @notice Publishes commitments that future spins will consume, in order.
    /// @dev Publishing ahead of demand is what makes the scheme sound: a commitment must
    ///      exist before the spin that uses it. Commitments are append-only — there is no
    ///      function to overwrite or delete one.
    function publishCommitments(bytes32[] calldata batch)
        external
        onlyRole(ArcadeRoles.RANDOMNESS_OPERATOR)
    {
        uint256 len = batch.length;
        if (len == 0) revert EmptyBatch();

        uint256 start = commitmentCount;
        for (uint256 i; i < len; ++i) {
            commitments[start + i] = batch[i];
        }
        commitmentCount = start + len;

        emit CommitmentsPublished(start, start + len - 1, len);
    }

    /// @notice Commitments published but not yet consumed by a request.
    function availableCommitments() public view returns (uint256) {
        return commitmentCount - nextCommitmentIndex;
    }

    // --------------------------------------------------------------------- requests

    /// @inheritdoc IRandomnessSource
    function requestRandomness(bytes32 consumerContext)
        external
        override
        returns (uint256 requestId)
    {
        if (!isConsumer[msg.sender]) revert NotAConsumer(msg.sender);
        if (availableCommitments() == 0) revert NoCommitmentsAvailable();

        uint256 commitmentIndex = nextCommitmentIndex++;
        requestId = ++requestCount;

        uint64 anchorBlock = uint64(block.number) + revealDelayBlocks;

        // Entropy known at request time. It cannot be influenced by the operator (who
        // already committed the seed) and is useless to the player (who cannot see it).
        //
        // forge-lint: disable-next-line(weak-prng)
        // The linter is right that these inputs are predictable, and that is fine: this
        // value is NOT the randomness. It is a per-request domain separator. The
        // unpredictability comes from the pre-committed seed (hidden behind its hash) and
        // the anchor blockhash (not yet mined), both mixed in at reveal time.
        bytes32 entropy = keccak256(
            abi.encode(
                consumerContext,
                msg.sender,
                requestId,
                commitmentIndex,
                blockhash(block.number - 1),
                block.timestamp
            )
        );

        _requests[requestId] = Request({
            consumer: msg.sender,
            requestBlock: uint64(block.number),
            anchorBlock: anchorBlock,
            commitmentIndex: uint64(commitmentIndex),
            entropy: entropy,
            state: RequestState.Pending,
            randomWord: 0
        });

        emit RandomnessRequested(requestId, msg.sender, commitmentIndex, anchorBlock, entropy);
    }

    /// @notice Reveals the committed pre-image and finalises the random word.
    /// @dev Callable by anyone holding the pre-image. Restricting it to the operator would
    ///      add nothing: the hash check is the only thing that matters, and a wider caller
    ///      set improves liveness.
    function reveal(uint256 requestId, bytes32 seed, bytes32 salt) external nonReentrant {
        Request storage r = _requests[requestId];
        if (r.consumer == address(0)) revert RequestUnknown(requestId);
        if (r.state != RequestState.Pending) revert RequestNotPending(requestId);

        if (block.number < r.anchorBlock) revert TooEarlyToReveal(r.anchorBlock);

        uint64 deadline = r.anchorBlock + revealWindowBlocks;
        if (block.number > deadline) revert RevealWindowClosed(deadline);

        uint256 index = r.commitmentIndex;
        if (keccak256(abi.encode(seed, salt)) != commitments[index]) {
            revert CommitmentMismatch(index);
        }

        bytes32 anchorHash = blockhash(r.anchorBlock);
        // Defensive: the window is kept inside the 256-block horizon, so this should be
        // unreachable. If it ever trips, failing is correct — the consumer refunds.
        if (anchorHash == bytes32(0)) revert AnchorBlockhashUnavailable(r.anchorBlock);

        uint256 word = uint256(keccak256(abi.encode(seed, salt, r.entropy, anchorHash)));

        r.state = RequestState.Fulfilled;
        r.randomWord = word;
        revealedSeeds[index] = seed;
        revealedSalts[index] = salt;

        emit RandomnessRevealed(requestId, index, word);
    }

    /// @notice Marks an un-revealed request as failed after its window closes, and slashes
    ///         the operator bond in the player's favour.
    /// @dev Permissionless on purpose: a stuck spin must be resolvable without the operator.
    function reportMissedReveal(uint256 requestId) external nonReentrant {
        Request storage r = _requests[requestId];
        if (r.consumer == address(0)) revert RequestUnknown(requestId);
        if (r.state != RequestState.Pending) revert RequestNotPending(requestId);

        uint64 deadline = r.anchorBlock + revealWindowBlocks;
        if (block.number <= deadline) revert RevealWindowStillOpen(deadline);

        r.state = RequestState.Failed;
        unchecked {
            ++missedReveals;
        }

        // Pay what the bond can cover; a short bond must not block the player's refund.
        uint256 penalty = missedRevealPenalty;
        if (penalty > operatorBond) penalty = operatorBond;
        if (penalty != 0) {
            operatorBond -= penalty;
            _penaltyCredited[requestId] = penalty;
            _sendNative(r.consumer, penalty);
        }

        emit RevealMissed(requestId, r.commitmentIndex, penalty);
    }

    // ----------------------------------------------------------------------- reading

    /// @inheritdoc IRandomnessSource
    function stateOf(uint256 requestId) external view override returns (RequestState) {
        return _requests[requestId].state;
    }

    /// @inheritdoc IRandomnessSource
    function randomWord(uint256 requestId) external view override returns (uint256) {
        Request storage r = _requests[requestId];
        if (r.state != RequestState.Fulfilled) revert RequestNotFulfilled(requestId);
        return r.randomWord;
    }

    /// @inheritdoc IRandomnessSource
    function abandonmentBlock(uint256 requestId) external view override returns (uint256) {
        Request storage r = _requests[requestId];
        if (r.consumer == address(0)) revert RequestUnknown(requestId);
        return uint256(r.anchorBlock) + revealWindowBlocks;
    }

    /// @inheritdoc IRandomnessSource
    function penaltyCreditedFor(uint256 requestId) external view override returns (uint256) {
        return _penaltyCredited[requestId];
    }

    /// @inheritdoc IRandomnessSource
    function mechanism() external pure override returns (string memory) {
        return "commit-reveal-v1: keccak256(seed, salt, requestEntropy, blockhash(anchorBlock))";
    }

    /// @notice Full request record, for the fairness page and independent verifiers.
    function requestOf(uint256 requestId) external view returns (Request memory) {
        Request memory r = _requests[requestId];
        if (r.consumer == address(0)) revert RequestUnknown(requestId);
        return r;
    }

    /// @notice Recomputes a random word from public inputs, so anyone can check a result
    ///         without trusting this contract's stored value.
    function recompute(bytes32 seed, bytes32 salt, bytes32 entropy, bytes32 anchorHash)
        external
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(seed, salt, entropy, anchorHash)));
    }

    // --------------------------------------------------------------------- admin

    function setConsumer(address consumer, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isConsumer[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @dev Timing changes affect only future requests. Each request stores its own anchor,
    ///      and the deadline is derived from the current window — so the window is bounded
    ///      below by the blockhash horizon to keep already-pending requests revealable.
    function setRevealTiming(uint64 delayBlocks, uint64 windowBlocks)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (delayBlocks == 0 || delayBlocks > MAX_REVEAL_DELAY) revert InvalidTiming();
        if (windowBlocks == 0 || windowBlocks > MAX_REVEAL_WINDOW) revert InvalidTiming();
        if (uint256(delayBlocks) + windowBlocks >= BLOCKHASH_HORIZON) revert InvalidTiming();

        revealDelayBlocks = delayBlocks;
        revealWindowBlocks = windowBlocks;
        emit RevealTimingUpdated(delayBlocks, windowBlocks);
    }

    function setMissedRevealPenalty(uint256 penalty) external onlyRole(DEFAULT_ADMIN_ROLE) {
        missedRevealPenalty = penalty;
        emit MissedRevealPenaltyUpdated(penalty);
    }

    /// @notice Tops up the operator bond with native USDC.
    function depositBond() external payable {
        operatorBond += msg.value;
        emit BondDeposited(msg.value, operatorBond);
    }

    /// @notice Withdraws surplus bond. Cannot withdraw more than is held.
    function withdrawBond(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (amount > operatorBond) revert BondTooSmall(amount, operatorBond);
        operatorBond -= amount;
        _sendNative(to, amount);
        emit BondWithdrawn(amount, operatorBond);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to, amount);
    }
}
