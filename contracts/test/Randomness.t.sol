// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcadeBase} from "./ArcadeBase.t.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {IRandomnessSource} from "../src/interfaces/IRandomnessSource.sol";

/// @notice Tests the properties the fairness page actually claims.
contract RandomnessTest is ArcadeBase {
    function test_commitmentsAreConsumedInOrderAndExactlyOnce() public {
        uint256 startIndex = randomness.nextCommitmentIndex();

        uint256 a = _spin(player);
        uint256 b = _spin(player2);

        uint256 reqA = manager.spinOf(a).randomnessRequestId;
        uint256 reqB = manager.spinOf(b).randomnessRequestId;

        assertEq(randomness.requestOf(reqA).commitmentIndex, startIndex);
        assertEq(randomness.requestOf(reqB).commitmentIndex, startIndex + 1);
        assertEq(randomness.nextCommitmentIndex(), startIndex + 2);
    }

    function test_revealRequiresTheCommittedPreimage() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;
        CommitRevealRandomness.Request memory r = randomness.requestOf(reqId);
        vm.roll(uint256(r.anchorBlock) + 1);

        // A different seed cannot satisfy the pre-published commitment.
        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.CommitmentMismatch.selector, r.commitmentIndex)
        );
        randomness.reveal(reqId, keccak256("wrong seed"), salts[r.commitmentIndex]);

        // Nor can the right seed with the wrong salt.
        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.CommitmentMismatch.selector, r.commitmentIndex)
        );
        randomness.reveal(reqId, seeds[r.commitmentIndex], keccak256("wrong salt"));

        randomness.reveal(reqId, seeds[r.commitmentIndex], salts[r.commitmentIndex]);
        assertEq(
            uint8(randomness.stateOf(reqId)), uint8(IRandomnessSource.RequestState.Fulfilled)
        );
    }

    function test_cannotRevealBeforeAnchorBlock() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;
        CommitRevealRandomness.Request memory r = randomness.requestOf(reqId);

        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.TooEarlyToReveal.selector, r.anchorBlock)
        );
        randomness.reveal(reqId, seeds[r.commitmentIndex], salts[r.commitmentIndex]);
    }

    function test_cannotRevealAfterWindowCloses() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;
        CommitRevealRandomness.Request memory r = randomness.requestOf(reqId);

        uint64 deadline = r.anchorBlock + randomness.revealWindowBlocks();
        vm.roll(uint256(deadline) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.RevealWindowClosed.selector, deadline)
        );
        randomness.reveal(reqId, seeds[r.commitmentIndex], salts[r.commitmentIndex]);
    }

    function test_revealedWordIsImmutableAndNoRerollIsPossible() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;
        _reveal(spinId);

        uint256 word = randomness.randomWord(reqId);
        CommitRevealRandomness.Request memory r = randomness.requestOf(reqId);

        // A second reveal of the same request is rejected outright.
        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.RequestNotPending.selector, reqId)
        );
        randomness.reveal(reqId, seeds[r.commitmentIndex], salts[r.commitmentIndex]);

        // Even the contract admin has no path to change it.
        // There is no such function, so this call finds no selector and fails.
        vm.prank(admin);
        (bool found,) =
            address(randomness).call(abi.encodeWithSignature("setRandomWord(uint256,uint256)", reqId, 1));
        assertFalse(found, "no admin function exists that can overwrite a revealed word");

        assertEq(randomness.randomWord(reqId), word, "the word never changes");
    }

    /// @dev The whole point of "every spin in the open": a third party can recompute the
    ///      result from published data without trusting our stored value.
    function test_anyoneCanRecomputeTheWordFromPublishedData() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;
        CommitRevealRandomness.Request memory before = randomness.requestOf(reqId);

        vm.roll(uint256(before.anchorBlock) + 1);
        bytes32 anchorHash = blockhash(before.anchorBlock);
        randomness.reveal(reqId, seeds[before.commitmentIndex], salts[before.commitmentIndex]);

        uint256 stored = randomness.randomWord(reqId);
        uint256 recomputed = randomness.recompute(
            randomness.revealedSeeds(before.commitmentIndex),
            randomness.revealedSalts(before.commitmentIndex),
            before.entropy,
            anchorHash
        );
        assertEq(recomputed, stored, "published inputs reproduce the stored word");
    }

    function test_requestsRevertWhenCommitmentsRunOut() public {
        // Drain every published commitment.
        uint256 available = randomness.availableCommitments();
        for (uint256 i; i < available; ++i) {
            _spin(player);
        }
        assertEq(randomness.availableCommitments(), 0);

        uint32 version = _currentVersion();
        vm.prank(player);
        vm.expectRevert(CommitRevealRandomness.NoCommitmentsAvailable.selector);
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, version);
    }

    function test_onlyRegisteredConsumersCanRequest() public {
        address rogue = makeAddr("rogue");
        vm.prank(rogue);
        vm.expectRevert(abi.encodeWithSelector(CommitRevealRandomness.NotAConsumer.selector, rogue));
        randomness.requestRandomness(keccak256("ctx"));
    }

    function test_onlyOperatorCanPublishCommitments() public {
        bytes32[] memory batch = new bytes32[](1);
        batch[0] = keccak256("x");
        vm.prank(player);
        vm.expectRevert();
        randomness.publishCommitments(batch);
    }

    function test_penaltyIsCappedByAvailableBond() public {
        uint256 spinId = _spin(player);
        uint256 reqId = manager.spinOf(spinId).randomnessRequestId;

        // Bond smaller than the configured penalty.
        vm.prank(operator);
        randomness.depositBond{value: 1 ether}();
        assertEq(randomness.missedRevealPenalty(), 5 ether);

        vm.roll(randomness.abandonmentBlock(reqId) + 1);
        randomness.reportMissedReveal(reqId);

        assertEq(randomness.penaltyCreditedFor(reqId), 1 ether, "penalty capped at the bond");
        assertEq(randomness.operatorBond(), 0);

        manager.refundAbandonedSpin(spinId);
        assertEq(manager.refundable(player), SPIN_PRICE + 1 ether);
    }

    function test_bondWithdrawalCannotExceedBond() public {
        vm.prank(operator);
        randomness.depositBond{value: 3 ether}();

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(CommitRevealRandomness.BondTooSmall.selector, 4 ether, 3 ether)
        );
        randomness.withdrawBond(admin, 4 ether);
    }

    function test_revealTimingMustStayInsideBlockhashHorizon() public {
        vm.prank(admin);
        vm.expectRevert(CommitRevealRandomness.InvalidTiming.selector);
        randomness.setRevealTiming(2, 255);

        vm.prank(admin);
        vm.expectRevert(CommitRevealRandomness.InvalidTiming.selector);
        randomness.setRevealTiming(0, 100);

        vm.prank(admin);
        randomness.setRevealTiming(3, 150);
        assertEq(randomness.revealDelayBlocks(), 3);
        assertEq(randomness.revealWindowBlocks(), 150);
    }

    /// @dev Swapping the global randomness source must not redirect an in-flight spin.
    ///      Otherwise the swap would be an admin-controlled re-roll.
    function test_swappingSourceDoesNotAffectPendingSpins() public {
        uint256 spinId = _spin(player);
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        assertEq(s.randomnessSource, address(randomness));

        CommitRevealRandomness replacement = new CommitRevealRandomness(admin, operator, guardian);
        vm.startPrank(admin);
        replacement.setConsumer(address(manager), true);
        manager.setRandomnessSource(IRandomnessSource(address(replacement)));
        vm.stopPrank();

        // The pending spin still reads its original source and settles normally.
        _reveal(spinId);
        manager.settleSpin(spinId);
        assertEq(uint8(manager.spinOf(spinId).status), uint8(ArcadeMachineManager.SpinStatus.Settled));
    }

    /// @dev Outcomes should track the configured weights. 70/24/5/1 over many samples.
    function test_outcomeDistributionTracksConfiguredWeights() public view {
        uint32 version = _currentVersion();
        uint256 samples = 20_000;
        uint256[4] memory byRarity;

        for (uint256 i; i < samples; ++i) {
            uint256 word = uint256(keccak256(abi.encode("distribution", i)));
            (,,, uint8 rarity) = manager.resolveOutcome(machineId, version, word);
            byRarity[rarity] += 1;
        }

        // Generous tolerances: this asserts the mapping is not skewed, not that the PRNG
        // is perfect. Expected shares are 70% / 24% / 5% / 1%.
        assertApproxEqAbs(byRarity[0] * 10_000 / samples, 7_000, 300, "common ~70%");
        assertApproxEqAbs(byRarity[1] * 10_000 / samples, 2_400, 300, "rare ~24%");
        assertApproxEqAbs(byRarity[2] * 10_000 / samples, 500, 150, "ultra ~5%");
        assertApproxEqAbs(byRarity[3] * 10_000 / samples, 100, 100, "jackpot ~1%");
    }

    /// @dev Rewards must always land inside the published band for the chosen tier.
    function testFuzz_rewardAlwaysWithinPublishedBand(uint256 word) public view {
        uint32 version = _currentVersion();
        (uint256 tierIndex, uint256 amount,,) = manager.resolveOutcome(machineId, version, word);
        ArcadeMachineManager.RewardTier[] memory tiers = manager.tiersOf(machineId, version);

        assertLt(tierIndex, tiers.length);
        assertGe(amount, tiers[tierIndex].minAmount, "at or above the published minimum");
        assertLe(amount, tiers[tierIndex].maxAmount, "at or below the published maximum");
    }

    /// @dev Resolution must be deterministic: the same word always gives the same outcome.
    function testFuzz_resolutionIsDeterministic(uint256 word) public view {
        uint32 version = _currentVersion();
        (uint256 i1, uint256 a1, address t1,) = manager.resolveOutcome(machineId, version, word);
        (uint256 i2, uint256 a2, address t2,) = manager.resolveOutcome(machineId, version, word);
        assertEq(i1, i2);
        assertEq(a1, a2);
        assertEq(t1, t2);
    }
}
