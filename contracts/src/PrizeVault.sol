// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcadeRoles} from "./ArcadeRoles.sol";

/// @title PrizeVault
/// @notice Custodies Arcade's reward inventory and enforces solvency.
///
/// ## The invariant this contract exists to hold
///
///     tokenBalance(t) >= reserved(t)     for every token t
///
/// `reserved(t)` is the sum of rewards that have been won but not yet delivered. The
/// treasurer can only ever withdraw `balance - reserved`, so there is no code path — and
/// no role — that lets an administrator withdraw a prize somebody has already won.
///
/// ## Push with a pull fallback
///
/// Settlement tries to transfer the reward immediately. If that transfer fails for any
/// reason (a token pauses, blacklists the winner, or reverts on a zero-value transfer),
/// the amount stays reserved and becomes claimable by the winner instead. A failing
/// token can never wedge settlement or silently burn someone's reward.
contract PrizeVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Reward amounts owed but not yet delivered, per token.
    mapping(address token => uint256 amount) public reserved;
    /// @notice Per-winner claimable balances created when a push transfer fails.
    mapping(address winner => mapping(address token => uint256 amount)) public claimable;
    /// @notice Lifetime totals, for the public transparency pages.
    mapping(address token => uint256 amount) public totalDeposited;
    mapping(address token => uint256 amount) public totalDistributed;

    event RewardDeposited(address indexed token, address indexed from, uint256 amount, uint256 balance);
    event RewardRemoved(address indexed token, address indexed to, uint256 amount, uint256 balance);
    event RewardReserved(address indexed token, uint256 amount, uint256 totalReserved);
    event RewardDelivered(address indexed token, address indexed to, uint256 amount);
    event RewardCredited(address indexed token, address indexed to, uint256 amount, string reason);
    event RewardClaimed(address indexed token, address indexed to, uint256 amount);
    event SettlerSet(address indexed settler, bool allowed);

    error NotSettler(address caller);
    error InsufficientUnreserved(address token, uint256 requested, uint256 available);
    error InsufficientReserved(address token, uint256 requested, uint256 reserved);
    error NothingToClaim(address token);
    error ZeroAmount();
    error ZeroAddress();

    /// @notice Contracts allowed to reserve and deliver rewards (the machine manager).
    mapping(address settler => bool allowed) public isSettler;

    modifier onlySettler() {
        if (!isSettler[msg.sender]) revert NotSettler(msg.sender);
        _;
    }

    constructor(address admin, address treasurer, address guardian) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ArcadeRoles.TREASURER, treasurer);
        _grantRole(ArcadeRoles.GUARDIAN, guardian);
    }

    function setSettler(address settler, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (settler == address(0)) revert ZeroAddress();
        isSettler[settler] = allowed;
        emit SettlerSet(settler, allowed);
    }

    // ------------------------------------------------------------------- inventory

    /// @notice Deposits reward inventory.
    /// @dev Measures the delta rather than trusting `amount`, so a fee-on-transfer token
    ///      cannot inflate recorded inventory above what actually arrived. Such tokens are
    ///      rejected upstream by the registry, but inventory accounting must not depend on
    ///      that having worked.
    function depositReward(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 erc20 = IERC20(token);

        uint256 before = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = erc20.balanceOf(address(this)) - before;

        totalDeposited[token] += received;
        emit RewardDeposited(token, msg.sender, received, erc20.balanceOf(address(this)));
    }

    /// @notice Withdraws surplus inventory. Reserved rewards are untouchable.
    function removeReward(address token, address to, uint256 amount)
        external
        onlyRole(ArcadeRoles.TREASURER)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        uint256 free = availableOf(token);
        if (amount > free) revert InsufficientUnreserved(token, amount, free);

        IERC20(token).safeTransfer(to, amount);
        emit RewardRemoved(token, to, amount, IERC20(token).balanceOf(address(this)));
    }

    /// @notice Inventory not already owed to a winner.
    function availableOf(address token) public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 owed = reserved[token];
        return bal > owed ? bal - owed : 0;
    }

    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Reserves a won reward, moving it out of withdrawable inventory.
    function reserveReward(address token, uint256 amount) external onlySettler {
        if (amount == 0) revert ZeroAmount();
        uint256 free = availableOf(token);
        if (amount > free) revert InsufficientUnreserved(token, amount, free);

        reserved[token] += amount;
        emit RewardReserved(token, amount, reserved[token]);
    }

    /// @notice Delivers a reserved reward, falling back to a claimable credit on failure.
    /// @return delivered True if the push transfer succeeded; false if it was credited instead.
    function deliverReward(address token, address to, uint256 amount)
        external
        onlySettler
        nonReentrant
        returns (bool delivered)
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 owed = reserved[token];
        if (amount > owed) revert InsufficientReserved(token, amount, owed);

        // Released here for both branches: either it leaves the vault, or it becomes an
        // explicit per-winner claim. `reserved` must never double-count it.
        reserved[token] = owed - amount;

        // Low-level call so a hostile or broken token cannot revert settlement. A spin's
        // outcome is already final at this point; delivery is a separate concern.
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        bool transferOk = ok && (ret.length == 0 || abi.decode(ret, (bool)));

        if (transferOk) {
            totalDistributed[token] += amount;
            emit RewardDelivered(token, to, amount);
            return true;
        }

        // Re-reserve: the winner is still owed this, they just have to pull it.
        reserved[token] += amount;
        claimable[to][token] += amount;
        emit RewardCredited(token, to, amount, "push transfer failed");
        return false;
    }

    /// @notice Credits a reward directly as claimable, without attempting a push.
    function creditReward(address token, address to, uint256 amount, string calldata reason)
        external
        onlySettler
    {
        if (amount == 0) revert ZeroAmount();
        uint256 owed = reserved[token];
        if (amount > owed) revert InsufficientReserved(token, amount, owed);
        claimable[to][token] += amount;
        emit RewardCredited(token, to, amount, reason);
    }

    /// @notice Pulls a credited reward. Only the winner can call this for themselves.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][token];
        if (amount == 0) revert NothingToClaim(token);

        // Zeroed before the transfer, and `reserved` is reduced in the same step, so a
        // reentrant claim finds nothing left to take.
        claimable[msg.sender][token] = 0;
        reserved[token] -= amount;
        totalDistributed[token] += amount;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit RewardClaimed(token, msg.sender, amount);
    }

    /// @notice Claims several tokens in one transaction.
    function claimMany(address[] calldata tokens) external nonReentrant returns (uint256 claimedCount) {
        uint256 len = tokens.length;
        for (uint256 i; i < len; ++i) {
            address token = tokens[i];
            uint256 amount = claimable[msg.sender][token];
            if (amount == 0) continue;

            claimable[msg.sender][token] = 0;
            reserved[token] -= amount;
            totalDistributed[token] += amount;

            IERC20(token).safeTransfer(msg.sender, amount);
            emit RewardClaimed(token, msg.sender, amount);
            unchecked {
                ++claimedCount;
            }
        }
    }

    /// @notice Solvency check used by tests, monitoring and the admin risk panel.
    function isSolvent(address token) external view returns (bool) {
        return IERC20(token).balanceOf(address(this)) >= reserved[token];
    }
}
