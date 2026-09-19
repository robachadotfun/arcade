// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcadeBase} from "./ArcadeBase.t.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {PrizeVault} from "../src/PrizeVault.sol";
import {IRandomnessSource} from "../src/interfaces/IRandomnessSource.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BlacklistERC20, FalseReturnERC20, MockERC20, RevertingReceiver, ReentrantToken} from "./mocks/MockTokens.sol";
import {RewardRegistry} from "../src/RewardRegistry.sol";

contract SpinLifecycleTest is ArcadeBase {
    function test_happyPath_paysSettlesAndDelivers() public {
        uint256 playerBalanceBefore = player.balance;
        uint256 spinId = _spin(player);

        ArcadeMachineManager.Spin memory pending = manager.spinOf(spinId);
        assertEq(pending.player, player);
        assertEq(pending.pricePaid, SPIN_PRICE);
        assertEq(uint8(pending.status), uint8(ArcadeMachineManager.SpinStatus.Pending));
        assertEq(playerBalanceBefore - player.balance, SPIN_PRICE, "player charged exactly the price");

        _reveal(spinId);
        manager.settleSpin(spinId);

        ArcadeMachineManager.Spin memory settled = manager.spinOf(spinId);
        assertEq(uint8(settled.status), uint8(ArcadeMachineManager.SpinStatus.Settled));
        assertTrue(settled.rewardToken != address(0), "a reward token was chosen");
        assertGt(settled.rewardAmount, 0, "a non-zero reward was awarded");
        assertTrue(settled.pushDelivered, "well-behaved token delivers immediately");
        assertEq(
            IERC20(settled.rewardToken).balanceOf(player), settled.rewardAmount, "player holds the reward"
        );
        assertEq(manager.totalSpinsSettled(), 1);
    }

    function test_revenueReachesFeeRouterOnlyOnSettlement() public {
        uint256 spinId = _spin(player);
        assertEq(address(feeRouter).balance, 0, "revenue is held until the spin resolves");

        _reveal(spinId);
        manager.settleSpin(spinId);
        assertEq(address(feeRouter).balance, SPIN_PRICE, "revenue forwarded on settlement");
    }

    function test_settleIsPermissionlessAndOutcomeIndependentOfCaller() public {
        uint256 spinId = _spin(player);
        _reveal(spinId);

        // Predict the outcome from the revealed word before anyone settles.
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        uint256 word = randomness.randomWord(s.randomnessRequestId);
        (, uint256 expectedAmount, address expectedToken,) =
            manager.resolveOutcome(machineId, s.machineVersion, word);

        // A random third party settles it.
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        (address token, uint256 amount) = manager.settleSpin(spinId);

        assertEq(token, expectedToken, "outcome does not depend on who settles");
        assertEq(amount, expectedAmount, "amount does not depend on who settles");
    }

    function test_cannotSettleTwice() public {
        uint256 spinId = _spinAndSettle(player);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.SpinNotPending.selector, spinId));
        manager.settleSpin(spinId);
    }

    function test_cannotSettleBeforeReveal() public {
        uint256 spinId = _spin(player);
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        vm.expectRevert(
            abi.encodeWithSelector(ArcadeMachineManager.RandomnessNotReady.selector, s.randomnessRequestId)
        );
        manager.settleSpin(spinId);
    }

    function test_rejectsWrongPayment() public {
        uint32 version = _currentVersion();
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(ArcadeMachineManager.IncorrectPayment.selector, SPIN_PRICE, 1 ether)
        );
        manager.requestSpin{value: 1 ether}(machineId, SPIN_PRICE, version);
    }

    /// @dev The price/version assertion protects a player whose transaction lands after a
    ///      new version is published in the same block.
    function test_rejectsStaleVersionExpectation() public {
        uint32 stale = _currentVersion();
        _publishDefaultVersion(); // bumps to stale + 1

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(ArcadeMachineManager.VersionNotEffective.selector, stale + 1)
        );
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, stale);
    }

    function test_pausedMachineRejectsNewSpinsButSettlesPendingOnes() public {
        uint256 spinId = _spin(player);

        vm.prank(guardian);
        manager.setMachinePaused(machineId, true);

        uint32 version = _currentVersion();
        vm.prank(player2);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.MachineIsPaused.selector, machineId));
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, version);

        // The in-flight spin is unaffected: a pause must never strand someone's money.
        _reveal(spinId);
        manager.settleSpin(spinId);
        assertEq(uint8(manager.spinOf(spinId).status), uint8(ArcadeMachineManager.SpinStatus.Settled));
    }

    function test_guardianCannotUnpauseMachine() public {
        vm.prank(guardian);
        manager.setMachinePaused(machineId, true);

        vm.prank(guardian);
        vm.expectRevert();
        manager.setMachinePaused(machineId, false);

        vm.prank(machineAdmin);
        manager.setMachinePaused(machineId, false);
        assertFalse(manager.machineOf(machineId).paused);
    }

    function test_globalPauseBlocksSpins() public {
        vm.prank(guardian);
        manager.pause();

        uint32 version = _currentVersion();
        vm.prank(player);
        vm.expectRevert();
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, version);
    }

    // ----------------------------------------------------------- inventory / solvency

    function test_refusesSpinWhenInventoryCannotCoverWorstCase() public {
        // A machine whose jackpot needs more cirBTC than the vault holds.
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(cirbtc),
            weight: 100,
            rarity: ArcadeMachineManager.Rarity.Jackpot,
            minAmount: 1_000e8,
            maxAmount: 5_000e8
        });

        vm.prank(machineAdmin);
        uint64 bigMachine = manager.createMachine("Overcommitted", "needs more than we hold");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(bigMachine, SPIN_PRICE, tiers, 0);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcadeMachineManager.InsufficientInventory.selector, address(cirbtc), 5_000e8, 100e8
            )
        );
        manager.requestSpin{value: SPIN_PRICE}(bigMachine, SPIN_PRICE, version);
    }

    /// @dev The liability check must scale with spins already in flight, not just one.
    function test_liabilityCheckAccountsForConcurrentPendingSpins() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(cirbtc),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 40e8,
            maxAmount: 40e8
        });

        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Tight", "two spins max");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        // Vault holds 100e8 cirBTC, worst case 40e8 => two concurrent spins fit, a third does not.
        vm.prank(player);
        manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        vm.prank(player);
        manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcadeMachineManager.InsufficientInventory.selector, address(cirbtc), 120e8, 100e8
            )
        );
        manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        assertEq(manager.outstandingSpins(id, version), 2);
    }

    function test_treasurerCannotWithdrawReservedRewards() public {
        // Force a reward to become reserved-but-unclaimed by blacklisting the winner.
        BlacklistERC20 blk = new BlacklistERC20();
        vm.prank(registryAdmin);
        registry.registerToken(
            address(blk), "BLK", "Blacklist Token", 18, RewardRegistry.Tier.Discovery, "", bytes32("v1")
        );
        blk.mint(treasurer, 1_000e18);
        vm.startPrank(treasurer);
        blk.approve(address(vault), 1_000e18);
        vault.depositReward(address(blk), 1_000e18);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(blk),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 100e18,
            maxAmount: 100e18
        });
        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Blocked", "blacklisting token");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        blk.setBlocked(player, true);

        vm.prank(player);
        uint256 spinId = manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        _reveal(spinId);
        manager.settleSpin(spinId);

        assertEq(vault.reserved(address(blk)), 100e18, "reward stays reserved when push fails");
        assertEq(vault.claimable(player, address(blk)), 100e18, "and becomes claimable");
        assertEq(vault.availableOf(address(blk)), 900e18, "reserved amount is not withdrawable");

        vm.prank(treasurer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrizeVault.InsufficientUnreserved.selector, address(blk), 1_000e18, 900e18
            )
        );
        vault.removeReward(address(blk), treasurer, 1_000e18);

        // The winner can still get paid once the token stops blocking them.
        blk.setBlocked(player, false);
        vm.prank(player);
        vault.claim(address(blk));
        assertEq(blk.balanceOf(player), 100e18);
        assertEq(vault.reserved(address(blk)), 0);
    }

    function test_pullFallbackWhenTransferReturnsFalse() public {
        FalseReturnERC20 fls = new FalseReturnERC20();
        vm.prank(registryAdmin);
        registry.registerToken(
            address(fls), "FLS", "False Token", 18, RewardRegistry.Tier.Discovery, "", bytes32("v1")
        );
        fls.mint(treasurer, 1_000e18);
        vm.startPrank(treasurer);
        fls.approve(address(vault), 1_000e18);
        vault.depositReward(address(fls), 1_000e18);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(fls),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 50e18,
            maxAmount: 50e18
        });
        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Falsey", "returns false");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        fls.setFailTransfers(true);
        vm.prank(player);
        uint256 spinId = manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        _reveal(spinId);
        manager.settleSpin(spinId);

        assertFalse(manager.spinOf(spinId).pushDelivered, "a false return is treated as failure");
        assertEq(vault.claimable(player, address(fls)), 50e18);

        fls.setFailTransfers(false);
        vm.prank(player);
        vault.claim(address(fls));
        assertEq(fls.balanceOf(player), 50e18);
    }

    function test_claimTwiceFails() public {
        FalseReturnERC20 fls = new FalseReturnERC20();
        vm.prank(registryAdmin);
        registry.registerToken(
            address(fls), "FLS", "False Token", 18, RewardRegistry.Tier.Discovery, "", bytes32("v1")
        );
        fls.mint(treasurer, 100e18);
        vm.startPrank(treasurer);
        fls.approve(address(vault), 100e18);
        vault.depositReward(address(fls), 100e18);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(fls),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 10e18,
            maxAmount: 10e18
        });
        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Falsey", "x");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        fls.setFailTransfers(true);
        vm.prank(player);
        uint256 spinId = manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        _reveal(spinId);
        manager.settleSpin(spinId);
        fls.setFailTransfers(false);

        vm.prank(player);
        vault.claim(address(fls));
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PrizeVault.NothingToClaim.selector, address(fls)));
        vault.claim(address(fls));
    }

    function test_onlyWinnerCanClaimTheirReward() public {
        FalseReturnERC20 fls = new FalseReturnERC20();
        vm.prank(registryAdmin);
        registry.registerToken(
            address(fls), "FLS", "False Token", 18, RewardRegistry.Tier.Discovery, "", bytes32("v1")
        );
        fls.mint(treasurer, 100e18);
        vm.startPrank(treasurer);
        fls.approve(address(vault), 100e18);
        vault.depositReward(address(fls), 100e18);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(fls),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 10e18,
            maxAmount: 10e18
        });
        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Falsey", "x");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        fls.setFailTransfers(true);
        vm.prank(player);
        uint256 spinId = manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        _reveal(spinId);
        manager.settleSpin(spinId);
        fls.setFailTransfers(false);

        vm.prank(player2);
        vm.expectRevert(abi.encodeWithSelector(PrizeVault.NothingToClaim.selector, address(fls)));
        vault.claim(address(fls));
    }

    // ------------------------------------------------------------------- refunds

    function test_refundWhenRandomnessAbandoned() public {
        uint256 spinId = _spin(player);
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);

        vm.prank(operator);
        randomness.depositBond{value: 100 ether}();

        uint256 deadline = randomness.abandonmentBlock(s.randomnessRequestId);
        vm.roll(deadline + 1);

        // Anyone can report the miss; the penalty is slashed to the consumer contract.
        randomness.reportMissedReveal(s.randomnessRequestId);
        assertEq(randomness.missedReveals(), 1);

        manager.refundAbandonedSpin(spinId);
        assertEq(uint8(manager.spinOf(spinId).status), uint8(ArcadeMachineManager.SpinStatus.Refunded));

        uint256 expected = SPIN_PRICE + randomness.missedRevealPenalty();
        assertEq(manager.refundable(player), expected, "refund includes the slashed penalty");

        uint256 before = player.balance;
        vm.prank(player);
        manager.withdrawRefund();
        assertEq(player.balance - before, expected, "player is made more than whole");
        assertEq(manager.outstandingSpins(machineId, s.machineVersion), 0, "liability released");
    }

    function test_cannotRefundBeforeAbandonment() public {
        uint256 spinId = _spin(player);
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcadeMachineManager.RandomnessNotAbandoned.selector, s.randomnessRequestId
            )
        );
        manager.refundAbandonedSpin(spinId);
    }

    function test_cannotSettleAfterRefund() public {
        uint256 spinId = _spin(player);
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        vm.roll(randomness.abandonmentBlock(s.randomnessRequestId) + 1);
        manager.refundAbandonedSpin(spinId);

        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.SpinNotPending.selector, spinId));
        manager.settleSpin(spinId);
    }

    /// @dev A player contract that rejects native transfers must not be able to wedge the
    ///      refund path — which is why refunds are credited and pulled, not pushed.
    function test_refundIsPulledSoRevertingReceiverCannotWedgeIt() public {
        RevertingReceiver rr = new RevertingReceiver();
        vm.deal(address(rr), 10 ether);

        uint32 version = _currentVersion();
        uint256 spinId = rr.requestSpin{value: SPIN_PRICE}(address(manager), machineId, SPIN_PRICE, version);

        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        vm.roll(randomness.abandonmentBlock(s.randomnessRequestId) + 1);

        // Crediting the refund succeeds even though the recipient rejects transfers.
        manager.refundAbandonedSpin(spinId);
        assertEq(manager.refundable(address(rr)), SPIN_PRICE);

        // Pulling it fails, but only for that account, and the credit is preserved.
        vm.expectRevert();
        rr.withdrawRefund(address(manager));
        assertEq(manager.refundable(address(rr)), SPIN_PRICE, "credit survives a failed pull");
    }

    // ---------------------------------------------------------------- reentrancy

    function test_reentrantTokenCannotDoubleSettle() public {
        ReentrantToken rnt = new ReentrantToken();
        vm.prank(registryAdmin);
        registry.registerToken(
            address(rnt), "RNT", "Reentrant", 18, RewardRegistry.Tier.Discovery, "", bytes32("v1")
        );
        rnt.mint(treasurer, 1_000e18);
        vm.startPrank(treasurer);
        rnt.approve(address(vault), 1_000e18);
        vault.depositReward(address(rnt), 1_000e18);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(rnt),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 25e18,
            maxAmount: 25e18
        });
        vm.prank(machineAdmin);
        uint64 id = manager.createMachine("Reentrant", "hostile token");
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(id, SPIN_PRICE, tiers, 0);

        vm.prank(player);
        uint256 spinId = manager.requestSpin{value: SPIN_PRICE}(id, SPIN_PRICE, version);
        _reveal(spinId);

        rnt.arm(address(manager), spinId);
        manager.settleSpin(spinId);

        // Exactly one payout, despite the reentrancy attempt during transfer.
        assertFalse(rnt.reentrancySucceeded(), "the reentrant settle call was rejected");
        assertEq(rnt.balanceOf(player), 25e18, "player paid exactly once");
        assertEq(manager.totalSpinsSettled(), 1, "settlement counted exactly once");
        assertEq(vault.reserved(address(rnt)), 0);
    }
}
