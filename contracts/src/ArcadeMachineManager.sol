// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IRandomnessSource} from "./interfaces/IRandomnessSource.sol";
import {RewardRegistry} from "./RewardRegistry.sol";
import {PrizeVault} from "./PrizeVault.sol";
import {ArcadeRoles} from "./ArcadeRoles.sol";

/// @title ArcadeMachineManager
/// @notice Machines, their versioned reward tables, and the spin lifecycle.
///
/// ## Payment
///
/// Spins are paid in **native USDC** (`msg.value`). On Arc, USDC is the native gas asset
/// with 18 decimals, so a spin needs one signature and no ERC-20 approval. The separate
/// USDC ERC-20 interface (6 decimals, `0x3600…0000`) is a different representation and is
/// deliberately not used for payment here — mixing the two is a well-known Arc footgun.
///
/// ## What is frozen when a spin is accepted
///
/// `requestSpin` copies the price, the machine id, the machine **version** and the payer
/// into immutable spin storage, and opens a randomness request. From that moment:
///
/// - the price cannot change for that spin,
/// - the reward table cannot change for that spin (versions are append-only),
/// - the player cannot be substituted,
/// - the outcome cannot be re-rolled — a randomness request maps to exactly one
///   pre-published commitment, consumed once,
/// - no role, including `DEFAULT_ADMIN_ROLE`, can alter a settled result.
///
/// Pausing a machine stops *new* spins. It never strands an in-flight one: a pending spin
/// can always be settled, or refunded if randomness is abandoned.
contract ArcadeMachineManager is AccessControl, ReentrancyGuard, Pausable {
    /// @notice Rarity band. Presentational, but published alongside the odds so the UI
    ///         never has to infer it and can label it in text as well as colour.
    enum Rarity {
        Common,
        Rare,
        Ultra,
        Jackpot
    }

    enum SpinStatus {
        None,
        Pending,
        Settled,
        Refunded
    }

    struct RewardTier {
        address token;
        /// @dev Relative probability weight. Odds are weight / totalWeight.
        uint96 weight;
        Rarity rarity;
        /// @dev Reward bounds in the token's own decimals. minAmount == maxAmount is a fixed reward.
        uint256 minAmount;
        uint256 maxAmount;
    }

    struct MachineVersion {
        uint256 spinPrice;
        uint96 totalWeight;
        uint64 effectiveBlock;
        bytes32 configHash;
        /// @dev Worst-case payout per token in this version, for the liability check.
        bool sealed_;
    }

    struct Machine {
        bool exists;
        bool paused;
        uint32 currentVersion;
        string name;
        string description;
    }

    struct Spin {
        address player;
        uint64 machineId;
        uint32 machineVersion;
        uint256 pricePaid;
        uint64 requestBlock;
        uint256 randomnessRequestId;
        /// @dev The adapter that issued this request. Pinned per spin so that swapping the
        ///      global source can never redirect an in-flight spin at a different oracle —
        ///      which would otherwise be an admin-controlled re-roll.
        address randomnessSource;
        SpinStatus status;
        address rewardToken;
        uint256 rewardAmount;
        bool pushDelivered;
    }

    RewardRegistry public immutable registry;
    PrizeVault public immutable vault;
    IRandomnessSource public randomness;
    address public feeRouter;

    mapping(uint64 machineId => Machine) private _machines;
    /// @dev Append-only: (machineId, version) => tiers. A published version is never mutated.
    mapping(uint64 machineId => mapping(uint32 version => RewardTier[])) private _tiers;
    mapping(uint64 machineId => mapping(uint32 version => MachineVersion)) private _versions;
    /// @dev Distinct tokens referenced by a version, for the liability check.
    mapping(uint64 machineId => mapping(uint32 version => address[])) private _versionTokens;
    mapping(uint64 machineId => mapping(uint32 version => mapping(address token => uint256 worstCase)))
        private _worstCase;

    /// @notice Spins requested but not yet settled or refunded, per machine version.
    mapping(uint64 machineId => mapping(uint32 version => uint256 count)) public outstandingSpins;

    mapping(uint256 spinId => Spin) private _spins;
    uint256 public spinCount;
    uint64 public machineCount;

    /// @notice Native-USDC compensation credited to a player when randomness was abandoned.
    mapping(address player => uint256 amount) public refundable;

    /// @notice Lifetime counters for the public pages. Only ever incremented by settlement.
    uint256 public totalSpinsSettled;
    uint256 public totalSpinsRefunded;

    event MachineCreated(uint64 indexed machineId, string name, string description);
    event MachineUpdated(uint64 indexed machineId, string name, string description);
    event MachineVersionPublished(
        uint64 indexed machineId,
        uint32 indexed version,
        uint256 spinPrice,
        uint96 totalWeight,
        uint64 effectiveBlock,
        bytes32 configHash,
        uint256 tierCount
    );
    event MachinePaused(uint64 indexed machineId, bool paused);
    event SpinRequested(
        uint256 indexed spinId,
        address indexed player,
        uint64 indexed machineId,
        uint32 machineVersion,
        uint256 pricePaid,
        uint256 randomnessRequestId
    );
    event SpinSettled(
        uint256 indexed spinId,
        address indexed player,
        uint64 indexed machineId,
        address rewardToken,
        uint256 rewardAmount,
        uint256 randomWord,
        uint8 rarity,
        bool pushDelivered
    );
    event SpinRefunded(uint256 indexed spinId, address indexed player, uint256 amount, string reason);
    event RefundWithdrawn(address indexed player, uint256 amount);
    event RandomnessSourceSet(address indexed source);
    event FeeRouterSet(address indexed router);
    event SpinRevenueForwarded(address indexed router, uint256 amount);

    error MachineUnknown(uint64 machineId);
    error MachineIsPaused(uint64 machineId);
    error NoActiveVersion(uint64 machineId);
    error VersionNotEffective(uint64 effectiveBlock);
    error IncorrectPayment(uint256 expected, uint256 provided);
    error EmptyRewardTable();
    error TooManyTiers(uint256 count);
    error ZeroWeight(uint256 tierIndex);
    error InvalidAmountRange(uint256 tierIndex);
    error TokenNotAwardable(address token);
    error DuplicateTier(address token, Rarity rarity);
    error SpinUnknown(uint256 spinId);
    error SpinNotPending(uint256 spinId);
    error RandomnessNotReady(uint256 requestId);
    error RandomnessNotAbandoned(uint256 requestId);
    error InsufficientInventory(address token, uint256 required, uint256 available);
    error NothingRefundable();
    error ZeroAddress();
    error NativeTransferFailed(address to, uint256 amount);
    error PriceTooLow();

    /// @dev Bounded so the per-spin liability check and the settlement loop stay cheap.
    uint256 private constant MAX_TIERS = 24;
    /// @dev A spin must cost something; a zero price would break the economic model.
    uint256 private constant MIN_SPIN_PRICE = 0.01 ether;

    constructor(
        address admin,
        address machineAdmin,
        address guardian,
        RewardRegistry registry_,
        PrizeVault vault_,
        IRandomnessSource randomness_,
        address feeRouter_
    ) {
        if (
            address(registry_) == address(0) || address(vault_) == address(0)
                || address(randomness_) == address(0)
        ) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ArcadeRoles.MACHINE_ADMIN, machineAdmin);
        _grantRole(ArcadeRoles.GUARDIAN, guardian);

        registry = registry_;
        vault = vault_;
        randomness = randomness_;
        feeRouter = feeRouter_;
    }

    // ------------------------------------------------------------------- machines

    function createMachine(string calldata name, string calldata description)
        external
        onlyRole(ArcadeRoles.MACHINE_ADMIN)
        returns (uint64 machineId)
    {
        machineId = ++machineCount;
        _machines[machineId] =
            Machine({exists: true, paused: false, currentVersion: 0, name: name, description: description});
        emit MachineCreated(machineId, name, description);
    }

    function updateMachineText(uint64 machineId, string calldata name, string calldata description)
        external
        onlyRole(ArcadeRoles.MACHINE_ADMIN)
    {
        _requireMachine(machineId);
        Machine storage m = _machines[machineId];
        m.name = name;
        m.description = description;
        emit MachineUpdated(machineId, name, description);
    }

    /// @notice Publishes a new, immutable reward table for a machine.
    ///
    /// @dev Every tier is validated against the registry here, so a disabled or paused token
    ///      cannot enter a reward table. The resulting version is sealed: the only way to
    ///      change a machine's economics is to publish a new version, which leaves the old
    ///      one permanently readable for anyone auditing a historical spin.
    ///
    /// @param effectiveBlock Block from which the version may be spun. Pass 0 for immediate.
    /// @return version The new version number.
    function publishVersion(
        uint64 machineId,
        uint256 spinPrice,
        RewardTier[] calldata tiers,
        uint64 effectiveBlock
    ) external onlyRole(ArcadeRoles.MACHINE_ADMIN) returns (uint32 version) {
        _requireMachine(machineId);
        if (spinPrice < MIN_SPIN_PRICE) revert PriceTooLow();
        if (tiers.length == 0) revert EmptyRewardTable();
        if (tiers.length > MAX_TIERS) revert TooManyTiers(tiers.length);

        version = _machines[machineId].currentVersion + 1;

        uint96 totalWeight = _storeTiers(machineId, version, tiers);
        uint64 effective = effectiveBlock == 0 ? uint64(block.number) : effectiveBlock;
        bytes32 configHash = keccak256(abi.encode(machineId, version, spinPrice, effectiveBlock, tiers));

        _versions[machineId][version] = MachineVersion({
            spinPrice: spinPrice,
            totalWeight: totalWeight,
            effectiveBlock: effective,
            configHash: configHash,
            sealed_: true
        });
        _machines[machineId].currentVersion = version;

        emit MachineVersionPublished(
            machineId, version, spinPrice, totalWeight, effective, configHash, tiers.length
        );
    }

    /// @dev Validates and persists a version's reward table, returning the total weight.
    ///      Split out of {publishVersion} to keep that function's stack shallow.
    function _storeTiers(uint64 machineId, uint32 version, RewardTier[] calldata tiers)
        private
        returns (uint96 totalWeight)
    {
        address[] storage tokens = _versionTokens[machineId][version];
        uint256 len = tiers.length;

        for (uint256 i; i < len; ++i) {
            RewardTier calldata t = tiers[i];
            if (t.weight == 0) revert ZeroWeight(i);
            if (t.minAmount == 0 || t.maxAmount < t.minAmount) revert InvalidAmountRange(i);
            if (!registry.isAwardable(t.token)) revert TokenNotAwardable(t.token);

            // Reject an exact (token, rarity) duplicate: it is almost always a config
            // mistake, and it makes a published odds table confusing to read.
            for (uint256 j; j < i; ++j) {
                if (tiers[j].token == t.token && tiers[j].rarity == t.rarity) {
                    revert DuplicateTier(t.token, t.rarity);
                }
            }

            totalWeight += t.weight;
            _tiers[machineId][version].push(t);

            // Track the worst case per distinct token, for the solvency check.
            uint256 known = _worstCase[machineId][version][t.token];
            if (known == 0) tokens.push(t.token);
            if (t.maxAmount > known) _worstCase[machineId][version][t.token] = t.maxAmount;
        }
    }

    /// @notice Pauses or resumes new spins on a machine. Guardians may pause; only the
    ///         machine admin may resume.
    function setMachinePaused(uint64 machineId, bool paused) external {
        _requireMachine(machineId);
        if (paused) {
            if (
                !hasRole(ArcadeRoles.GUARDIAN, msg.sender)
                    && !hasRole(ArcadeRoles.MACHINE_ADMIN, msg.sender)
            ) revert AccessControlUnauthorizedAccount(msg.sender, ArcadeRoles.GUARDIAN);
        } else {
            _checkRole(ArcadeRoles.MACHINE_ADMIN, msg.sender);
        }
        _machines[machineId].paused = paused;
        emit MachinePaused(machineId, paused);
    }

    /// @notice Global emergency stop on new spins. Guardians pause, admin resumes.
    function pause() external {
        if (!hasRole(ArcadeRoles.GUARDIAN, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ArcadeRoles.GUARDIAN);
        }
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ----------------------------------------------------------------- spin: request

    /// @notice Pays for one spin and opens its randomness request.
    /// @dev `expectedPrice` and `expectedVersion` are asserted so a version published in the
    ///      same block cannot silently change what the player agreed to pay or play.
    function requestSpin(uint64 machineId, uint256 expectedPrice, uint32 expectedVersion)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 spinId)
    {
        _requireMachine(machineId);
        Machine storage m = _machines[machineId];
        if (m.paused) revert MachineIsPaused(machineId);

        uint32 version = m.currentVersion;
        if (version == 0) revert NoActiveVersion(machineId);
        if (expectedVersion != version) revert VersionNotEffective(version);

        MachineVersion storage mv = _versions[machineId][version];
        if (block.number < mv.effectiveBlock) revert VersionNotEffective(mv.effectiveBlock);
        if (msg.value != mv.spinPrice || expectedPrice != mv.spinPrice) {
            revert IncorrectPayment(mv.spinPrice, msg.value);
        }

        // Maximum-liability check. Before accepting this spin we require the vault to be
        // able to pay the worst case for *every* token in the table, for this spin and all
        // spins already in flight on this version. This is what stops an operator from
        // configuring — or a burst of players from creating — an insolvent machine.
        _assertCanCoverAnotherSpin(machineId, version);

        spinId = ++spinCount;

        bytes32 context = keccak256(abi.encode(msg.sender, spinId, machineId, version, mv.configHash));
        IRandomnessSource source = randomness;
        uint256 requestId = source.requestRandomness(context);

        _spins[spinId] = Spin({
            player: msg.sender,
            machineId: machineId,
            machineVersion: version,
            pricePaid: msg.value,
            requestBlock: uint64(block.number),
            randomnessRequestId: requestId,
            randomnessSource: address(source),
            status: SpinStatus.Pending,
            rewardToken: address(0),
            rewardAmount: 0,
            pushDelivered: false
        });

        unchecked {
            ++outstandingSpins[machineId][version];
        }

        emit SpinRequested(spinId, msg.sender, machineId, version, msg.value, requestId);
    }

    /// @dev Reverts unless the vault can cover worst-case payouts for in-flight spins plus one.
    function _assertCanCoverAnotherSpin(uint64 machineId, uint32 version) private view {
        address[] storage tokens = _versionTokens[machineId][version];
        uint256 pending = outstandingSpins[machineId][version] + 1;
        uint256 len = tokens.length;

        for (uint256 i; i < len; ++i) {
            address token = tokens[i];
            uint256 required = _worstCase[machineId][version][token] * pending;
            uint256 available = vault.availableOf(token);
            if (available < required) revert InsufficientInventory(token, required, available);
        }
    }

    // ---------------------------------------------------------------- spin: settle

    /// @notice Settles a spin once its randomness has been revealed.
    /// @dev Permissionless. The outcome is a pure function of the revealed random word and
    ///      the frozen machine version, so it does not matter who calls this — the result is
    ///      identical either way. That is the point.
    function settleSpin(uint256 spinId) external nonReentrant returns (address token, uint256 amount) {
        Spin storage s = _spins[spinId];
        if (s.player == address(0)) revert SpinUnknown(spinId);
        if (s.status != SpinStatus.Pending) revert SpinNotPending(spinId);

        uint256 requestId = s.randomnessRequestId;
        IRandomnessSource source = IRandomnessSource(s.randomnessSource);
        if (source.stateOf(requestId) != IRandomnessSource.RequestState.Fulfilled) {
            revert RandomnessNotReady(requestId);
        }
        uint256 word = source.randomWord(requestId);

        uint64 machineId = s.machineId;
        uint32 version = s.machineVersion;

        (uint256 tierIndex, uint256 rewardAmount) = _resolveOutcome(machineId, version, word);
        RewardTier storage tier = _tiers[machineId][version][tierIndex];
        token = tier.token;
        amount = rewardAmount;

        // Status is written before any external call, so a reentrant settle finds it settled.
        s.status = SpinStatus.Settled;
        s.rewardToken = token;
        s.rewardAmount = amount;
        unchecked {
            ++totalSpinsSettled;
            --outstandingSpins[machineId][version];
        }

        vault.reserveReward(token, amount);
        bool pushed = vault.deliverReward(token, s.player, amount);
        s.pushDelivered = pushed;

        _forwardRevenue(s.pricePaid);

        emit SpinSettled(
            spinId, s.player, machineId, token, amount, word, uint8(tier.rarity), pushed
        );
    }

    /// @notice Maps a random word onto a reward tier and an amount within its band.
    /// @dev Pure and public so anyone can reproduce a historical outcome offline from the
    ///      revealed word alone. Independent domains are derived for the tier choice and the
    ///      amount so the two are not correlated.
    function resolveOutcome(uint64 machineId, uint32 version, uint256 word)
        external
        view
        returns (uint256 tierIndex, uint256 amount, address token, uint8 rarity)
    {
        (tierIndex, amount) = _resolveOutcome(machineId, version, word);
        RewardTier storage tier = _tiers[machineId][version][tierIndex];
        return (tierIndex, amount, tier.token, uint8(tier.rarity));
    }

    function _resolveOutcome(uint64 machineId, uint32 version, uint256 word)
        private
        view
        returns (uint256 tierIndex, uint256 amount)
    {
        MachineVersion storage mv = _versions[machineId][version];
        RewardTier[] storage tiers = _tiers[machineId][version];

        uint256 totalWeight = mv.totalWeight;
        uint256 pick = uint256(keccak256(abi.encode(word, "tier"))) % totalWeight;

        uint256 cumulative;
        uint256 len = tiers.length;
        for (uint256 i; i < len; ++i) {
            cumulative += tiers[i].weight;
            if (pick < cumulative) {
                tierIndex = i;
                break;
            }
        }

        RewardTier storage chosen = tiers[tierIndex];
        uint256 span = chosen.maxAmount - chosen.minAmount;
        if (span == 0) {
            amount = chosen.minAmount;
        } else {
            uint256 offset = uint256(keccak256(abi.encode(word, "amount"))) % (span + 1);
            amount = chosen.minAmount + offset;
        }
    }

    // ---------------------------------------------------------------- spin: refund

    /// @notice Refunds a spin whose randomness was never revealed.
    /// @dev Permissionless once the randomness source reports the request abandoned. The
    ///      player gets their full spin price back, plus any penalty the randomness contract
    ///      slashed from the operator bond.
    function refundAbandonedSpin(uint256 spinId) external nonReentrant {
        Spin storage s = _spins[spinId];
        if (s.player == address(0)) revert SpinUnknown(spinId);
        if (s.status != SpinStatus.Pending) revert SpinNotPending(spinId);

        uint256 requestId = s.randomnessRequestId;
        IRandomnessSource source = IRandomnessSource(s.randomnessSource);
        IRandomnessSource.RequestState state = source.stateOf(requestId);

        if (state != IRandomnessSource.RequestState.Failed) {
            // Not yet marked failed: only allow the unwind once the window has truly passed.
            if (block.number <= source.abandonmentBlock(requestId)) {
                revert RandomnessNotAbandoned(requestId);
            }
        }

        s.status = SpinStatus.Refunded;
        unchecked {
            ++totalSpinsRefunded;
            --outstandingSpins[s.machineId][s.machineVersion];
        }

        // Credited rather than pushed: a player with a reverting fallback must not be able
        // to make this call fail, and must not be able to leave the spin stuck as Pending.
        //
        // Any penalty the randomness source slashed from the operator bond for this request
        // was sent to this contract; it belongs to the player who was denied their outcome.
        uint256 compensation = source.penaltyCreditedFor(requestId);
        uint256 owed = s.pricePaid + compensation;
        refundable[s.player] += owed;

        emit SpinRefunded(spinId, s.player, owed, "randomness abandoned");
    }

    /// @notice Withdraws refunds and operator-bond compensation.
    function withdrawRefund() external nonReentrant returns (uint256 amount) {
        amount = refundable[msg.sender];
        if (amount == 0) revert NothingRefundable();
        refundable[msg.sender] = 0;
        _sendNative(msg.sender, amount);
        emit RefundWithdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------- revenue

    /// @dev Revenue only leaves on settlement, never at request time, so a refundable spin's
    ///      payment is still in this contract when the refund is credited.
    function _forwardRevenue(uint256 amount) private {
        address router = feeRouter;
        if (router == address(0) || amount == 0) return;
        (bool ok,) = router.call{value: amount}("");
        // A broken router must not block settlement; the funds simply stay here.
        if (ok) emit SpinRevenueForwarded(router, amount);
    }

    /// @notice Accepts operator-bond penalties forwarded by the randomness contract.
    receive() external payable {}

    // ------------------------------------------------------------------- reading

    function machineOf(uint64 machineId) external view returns (Machine memory) {
        _requireMachine(machineId);
        return _machines[machineId];
    }

    function versionOf(uint64 machineId, uint32 version) external view returns (MachineVersion memory) {
        return _versions[machineId][version];
    }

    function tiersOf(uint64 machineId, uint32 version) external view returns (RewardTier[] memory) {
        return _tiers[machineId][version];
    }

    function versionTokens(uint64 machineId, uint32 version) external view returns (address[] memory) {
        return _versionTokens[machineId][version];
    }

    function worstCaseFor(uint64 machineId, uint32 version, address token)
        external
        view
        returns (uint256)
    {
        return _worstCase[machineId][version][token];
    }

    function spinOf(uint256 spinId) external view returns (Spin memory) {
        Spin memory s = _spins[spinId];
        if (s.player == address(0)) revert SpinUnknown(spinId);
        return s;
    }

    /// @notice Maximum native-USDC liability outstanding across a machine version, in
    ///         worst-case token units. Used by the admin risk panel.
    function maxLiabilityOf(uint64 machineId, uint32 version)
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts)
    {
        tokens = _versionTokens[machineId][version];
        amounts = new uint256[](tokens.length);
        uint256 pending = outstandingSpins[machineId][version];
        for (uint256 i; i < tokens.length; ++i) {
            amounts[i] = _worstCase[machineId][version][tokens[i]] * pending;
        }
    }

    // --------------------------------------------------------------------- admin

    /// @notice Points at a different randomness adapter (e.g. a VRF adapter, once one exists
    ///         on Arc). Only affects spins requested afterwards: a pending spin keeps reading
    ///         its own request id, so this cannot be used to re-roll anything in flight.
    function setRandomnessSource(IRandomnessSource source) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(source) == address(0)) revert ZeroAddress();
        randomness = source;
        emit RandomnessSourceSet(address(source));
    }

    function setFeeRouter(address router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeRouter = router;
        emit FeeRouterSet(router);
    }

    function _requireMachine(uint64 machineId) private view {
        if (!_machines[machineId].exists) revert MachineUnknown(machineId);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to, amount);
    }
}
