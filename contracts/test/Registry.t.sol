// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcadeBase} from "./ArcadeBase.t.sol";
import {RewardRegistry} from "../src/RewardRegistry.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {PrizeVault} from "../src/PrizeVault.sol";
import {MockERC20, FeeOnTransferERC20} from "./mocks/MockTokens.sol";

contract RegistryTest is ArcadeBase {
    /// @dev The single most important registry check. Reward amounts are configured in a
    ///      token's own units, so a wrong `decimals` would mis-size every payout by orders
    ///      of magnitude. We refuse to take the operator's word for it.
    function test_rejectsDeclaredDecimalsThatDisagreeWithTheContract() public {
        MockERC20 token = new MockERC20("Six Decimals", "SIX", 6);

        vm.prank(registryAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(RewardRegistry.DecimalsMismatch.selector, address(token), 18, 6)
        );
        registry.registerToken(
            address(token), "SIX", "Six Decimals", 18, RewardRegistry.Tier.Verified, "", bytes32("v1")
        );
    }

    /// @dev Guards against the exact Arc hazard we found in research: many distinct tokens
    ///      share a ticker, including squatters on "USDC". The registry keys on the address
    ///      and verifies the symbol, so a mislabelled entry cannot be registered.
    function test_rejectsSymbolThatDisagreesWithTheContract() public {
        MockERC20 impostor = new MockERC20("UpSideDownCat", "USDC", 18);

        vm.prank(registryAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                RewardRegistry.SymbolMismatch.selector, address(impostor), "ARGUS", "USDC"
            )
        );
        registry.registerToken(
            address(impostor), "ARGUS", "Argus", 18, RewardRegistry.Tier.Featured, "", bytes32("v1")
        );
    }

    /// @dev A ticker squatter can still be registered under its *true* symbol. That is
    ///      correct: the registry records identity, and curation tiers convey risk.
    function test_squatterCanOnlyBeRegisteredUnderItsRealSymbol() public {
        MockERC20 impostor = new MockERC20("UpSideDownCat", "USDC", 18);
        vm.prank(registryAdmin);
        registry.registerToken(
            address(impostor),
            "USDC",
            "UpSideDownCat",
            18,
            RewardRegistry.Tier.Discovery,
            "",
            bytes32("flagged")
        );
        RewardRegistry.TokenRecord memory rec = registry.recordOf(address(impostor));
        assertEq(rec.name, "UpSideDownCat", "the record shows what it really is");
        assertEq(uint8(rec.tier), uint8(RewardRegistry.Tier.Discovery));
    }

    function test_cannotRegisterSameTokenTwice() public {
        vm.prank(registryAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(RewardRegistry.TokenAlreadyRegistered.selector, address(argus))
        );
        registry.registerToken(
            address(argus), "ARGUS", "Argus", 18, RewardRegistry.Tier.Featured, "", bytes32("v2")
        );
    }

    function test_updateCannotChangeDecimals() public {
        // `updateToken` has no decimals parameter at all — the only way to change it is a
        // new registration, which re-verifies against the contract.
        vm.prank(registryAdmin);
        registry.updateToken(address(argus), RewardRegistry.Tier.Verified, "ipfs://new", bytes32("v2"));
        assertEq(registry.decimalsOf(address(argus)), 18, "decimals are immutable after registration");
    }

    function test_pausedTokenCannotEnterANewRewardTable() public {
        vm.prank(guardian);
        registry.setPaused(address(argus), true);
        assertFalse(registry.isAwardable(address(argus)));

        vm.prank(machineAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(ArcadeMachineManager.TokenNotAwardable.selector, address(argus))
        );
        manager.publishVersion(machineId, SPIN_PRICE, _defaultTiers(), 0);
    }

    /// @dev Pausing a token must not retroactively strand a spin that is already in flight
    ///      against a version containing it.
    function test_pausingTokenDoesNotStrandInFlightSpins() public {
        uint256 spinId = _spin(player);

        vm.prank(guardian);
        registry.setPaused(address(argus), true);

        _reveal(spinId);
        manager.settleSpin(spinId);
        assertEq(uint8(manager.spinOf(spinId).status), uint8(ArcadeMachineManager.SpinStatus.Settled));
    }

    function test_guardianCanPauseButOnlyRegistryAdminCanUnpause() public {
        vm.prank(guardian);
        registry.setPaused(address(argus), true);

        vm.prank(guardian);
        vm.expectRevert();
        registry.setPaused(address(argus), false);

        vm.prank(registryAdmin);
        registry.setPaused(address(argus), false);
        assertTrue(registry.isAwardable(address(argus)));
    }

    function test_disabledTokenIsNotAwardable() public {
        vm.prank(registryAdmin);
        registry.setEnabled(address(argus), false);
        assertFalse(registry.isAwardable(address(argus)));
    }

    function test_nonAdminCannotRegister() public {
        MockERC20 token = new MockERC20("X", "X", 18);
        vm.prank(player);
        vm.expectRevert();
        registry.registerToken(
            address(token), "X", "X", 18, RewardRegistry.Tier.Verified, "", bytes32("v1")
        );
    }

    /// @dev Inventory accounting must measure the delta, not trust the requested amount.
    ///      Fee-on-transfer tokens are rejected upstream, but the vault must not depend on
    ///      that having worked.
    function test_vaultRecordsActualReceivedAmountForFeeOnTransferToken() public {
        FeeOnTransferERC20 fee = new FeeOnTransferERC20(500); // 5%
        fee.mint(treasurer, 1_000e18);

        vm.startPrank(treasurer);
        fee.approve(address(vault), 1_000e18);
        vault.depositReward(address(fee), 1_000e18);
        vm.stopPrank();

        assertEq(fee.balanceOf(address(vault)), 950e18, "5% was skimmed in transit");
        assertEq(
            vault.totalDeposited(address(fee)), 950e18, "inventory records what actually arrived"
        );
        assertTrue(vault.isSolvent(address(fee)));
    }

    function test_onlySettlerCanReserveRewards() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PrizeVault.NotSettler.selector, player));
        vault.reserveReward(address(argus), 1e18);
    }

    function test_onlySettlerCanDeliverRewards() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(PrizeVault.NotSettler.selector, player));
        vault.deliverReward(address(argus), player, 1e18);
    }

    function test_registryTracksTokenList() public view {
        assertEq(registry.tokenCount(), 3);
        address[] memory all = registry.allTokens();
        assertEq(all.length, 3);
        assertTrue(registry.isRegistered(address(argus)));
    }

    // --------------------------------------------------- machine config validation

    function test_rejectsRewardTableWithZeroWeight() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 0,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 1e18,
            maxAmount: 2e18
        });
        vm.prank(machineAdmin);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.ZeroWeight.selector, 0));
        manager.publishVersion(machineId, SPIN_PRICE, tiers, 0);
    }

    function test_rejectsInvertedAmountRange() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 5e18,
            maxAmount: 1e18
        });
        vm.prank(machineAdmin);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.InvalidAmountRange.selector, 0));
        manager.publishVersion(machineId, SPIN_PRICE, tiers, 0);
    }

    function test_rejectsZeroRewardAmount() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 0,
            maxAmount: 0
        });
        vm.prank(machineAdmin);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.InvalidAmountRange.selector, 0));
        manager.publishVersion(machineId, SPIN_PRICE, tiers, 0);
    }

    function test_rejectsEmptyRewardTable() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](0);
        vm.prank(machineAdmin);
        vm.expectRevert(ArcadeMachineManager.EmptyRewardTable.selector);
        manager.publishVersion(machineId, SPIN_PRICE, tiers, 0);
    }

    function test_rejectsDuplicateTokenRarityPair() public {
        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](2);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 1e18,
            maxAmount: 2e18
        });
        tiers[1] = tiers[0];
        vm.prank(machineAdmin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcadeMachineManager.DuplicateTier.selector,
                address(argus),
                ArcadeMachineManager.Rarity.Common
            )
        );
        manager.publishVersion(machineId, SPIN_PRICE, tiers, 0);
    }

    function test_rejectsPriceBelowMinimum() public {
        vm.prank(machineAdmin);
        vm.expectRevert(ArcadeMachineManager.PriceTooLow.selector);
        manager.publishVersion(machineId, 0.001 ether, _defaultTiers(), 0);
    }

    /// @dev Old versions must stay readable forever so a historical spin can be audited
    ///      against the exact table that was live when it was played.
    function test_previousVersionsRemainReadableAfterRepublish() public {
        uint32 v1 = _currentVersion();
        bytes32 hash1 = manager.versionOf(machineId, v1).configHash;
        uint256 tiers1 = manager.tiersOf(machineId, v1).length;

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](1);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 1,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 1e18,
            maxAmount: 1e18
        });
        vm.prank(machineAdmin);
        uint32 v2 = manager.publishVersion(machineId, 5 ether, tiers, 0);

        assertEq(v2, v1 + 1);
        assertEq(manager.versionOf(machineId, v1).configHash, hash1, "v1 hash unchanged");
        assertEq(manager.tiersOf(machineId, v1).length, tiers1, "v1 table unchanged");
        assertEq(manager.versionOf(machineId, v1).spinPrice, SPIN_PRICE, "v1 price unchanged");
        assertEq(manager.versionOf(machineId, v2).spinPrice, 5 ether);
    }

    function test_versionNotEffectiveUntilItsBlock() public {
        uint64 future = uint64(block.number + 100);
        vm.prank(machineAdmin);
        uint32 version = manager.publishVersion(machineId, SPIN_PRICE, _defaultTiers(), future);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(ArcadeMachineManager.VersionNotEffective.selector, future));
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, version);

        vm.roll(future);
        vm.prank(player);
        manager.requestSpin{value: SPIN_PRICE}(machineId, SPIN_PRICE, version);
    }

    function test_configHashChangesWithConfig() public {
        bytes32 h1 = manager.versionOf(machineId, _currentVersion()).configHash;
        vm.prank(machineAdmin);
        manager.publishVersion(machineId, 3 ether, _defaultTiers(), 0);
        bytes32 h2 = manager.versionOf(machineId, _currentVersion()).configHash;
        assertTrue(h1 != h2, "a different price yields a different config hash");
    }
}
