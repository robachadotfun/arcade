// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ArcadeRoles} from "./ArcadeRoles.sol";

/// @title FeeRouter
/// @notice Receives spin revenue in native USDC and splits it between reward funding and
///         the protocol treasury.
///
/// Kept deliberately separate from {PrizeVault}: revenue and prize inventory are different
/// pools with different rules. This contract can never touch the vault, so nothing here can
/// reach a reward somebody has already won.
contract FeeRouter is AccessControl, ReentrancyGuard {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @notice Destination that funds reward inventory.
    address public rewardFundingWallet;
    /// @notice Destination for protocol revenue.
    address public treasuryWallet;
    /// @notice Share of incoming revenue routed to reward funding, in basis points.
    uint16 public rewardFundingBps = 7_000;

    /// @notice Lifetime revenue received.
    uint256 public totalReceived;
    uint256 public totalToRewardFunding;
    uint256 public totalToTreasury;

    event RevenueReceived(address indexed from, uint256 amount);
    event RevenueSplit(uint256 toRewardFunding, uint256 toTreasury);
    event DestinationsUpdated(address rewardFundingWallet, address treasuryWallet);
    event SplitUpdated(uint16 rewardFundingBps);

    error ZeroAddress();
    error InvalidSplit(uint16 bps);
    error NothingToDistribute();
    error NativeTransferFailed(address to, uint256 amount);

    constructor(address admin, address treasurer, address rewardFundingWallet_, address treasuryWallet_) {
        if (rewardFundingWallet_ == address(0) || treasuryWallet_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ArcadeRoles.TREASURER, treasurer);
        rewardFundingWallet = rewardFundingWallet_;
        treasuryWallet = treasuryWallet_;
    }

    /// @dev Accumulates rather than forwarding on receipt, so a failing destination can
    ///      never make a spin settlement revert.
    receive() external payable {
        totalReceived += msg.value;
        emit RevenueReceived(msg.sender, msg.value);
    }

    /// @notice Splits the accumulated balance to the configured destinations.
    function distribute() external onlyRole(ArcadeRoles.TREASURER) nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToDistribute();

        uint256 toRewardFunding = (balance * rewardFundingBps) / BPS_DENOMINATOR;
        uint256 toTreasury = balance - toRewardFunding;

        totalToRewardFunding += toRewardFunding;
        totalToTreasury += toTreasury;

        if (toRewardFunding != 0) _sendNative(rewardFundingWallet, toRewardFunding);
        if (toTreasury != 0) _sendNative(treasuryWallet, toTreasury);

        emit RevenueSplit(toRewardFunding, toTreasury);
    }

    function setDestinations(address rewardFundingWallet_, address treasuryWallet_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (rewardFundingWallet_ == address(0) || treasuryWallet_ == address(0)) revert ZeroAddress();
        rewardFundingWallet = rewardFundingWallet_;
        treasuryWallet = treasuryWallet_;
        emit DestinationsUpdated(rewardFundingWallet_, treasuryWallet_);
    }

    function setSplit(uint16 rewardFundingBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (rewardFundingBps_ > BPS_DENOMINATOR) revert InvalidSplit(rewardFundingBps_);
        rewardFundingBps = rewardFundingBps_;
        emit SplitUpdated(rewardFundingBps_);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to, amount);
    }
}
