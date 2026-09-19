// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {PrizeVault} from "../src/PrizeVault.sol";
import {RewardRegistry} from "../src/RewardRegistry.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IRandomnessSource} from "../src/interfaces/IRandomnessSource.sol";
import {ArcadeRoles} from "../src/ArcadeRoles.sol";
import {MockERC20} from "./mocks/MockTokens.sol";

/// @notice Shared deployment and helpers for the Arcade test suite.
///
/// Native USDC on Arc has 18 decimals, so `x ether` in these tests reads as x USDC.
abstract contract ArcadeBase is Test {
    ArcadeMachineManager internal manager;
    CommitRevealRandomness internal randomness;
    PrizeVault internal vault;
    RewardRegistry internal registry;
    FeeRouter internal feeRouter;

    MockERC20 internal argus; // 18 decimals
    MockERC20 internal cirbtc; // 8 decimals — guards against decimal assumptions
    MockERC20 internal eurc; // 6 decimals

    address internal admin = makeAddr("admin");
    address internal machineAdmin = makeAddr("machineAdmin");
    address internal registryAdmin = makeAddr("registryAdmin");
    address internal treasurer = makeAddr("treasurer");
    address internal operator = makeAddr("randomnessOperator");
    address internal guardian = makeAddr("guardian");
    address internal rewardFunding = makeAddr("rewardFunding");
    address internal treasuryWallet = makeAddr("treasuryWallet");
    address internal player = makeAddr("player");
    address internal player2 = makeAddr("player2");

    uint256 internal constant SPIN_PRICE = 2 ether; // 2 USDC
    uint64 internal machineId;

    /// @dev Commitment pre-images, kept so tests can reveal them.
    bytes32[] internal seeds;
    bytes32[] internal salts;

    function setUp() public virtual {
        registry = new RewardRegistry(admin, registryAdmin, guardian);
        vault = new PrizeVault(admin, treasurer, guardian);
        randomness = new CommitRevealRandomness(admin, operator, guardian);
        feeRouter = new FeeRouter(admin, treasurer, rewardFunding, treasuryWallet);

        manager = new ArcadeMachineManager(
            admin,
            machineAdmin,
            guardian,
            registry,
            vault,
            IRandomnessSource(address(randomness)),
            address(feeRouter)
        );

        vm.startPrank(admin);
        vault.setSettler(address(manager), true);
        randomness.setConsumer(address(manager), true);
        vm.stopPrank();

        argus = new MockERC20("Argus", "ARGUS", 18);
        cirbtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        eurc = new MockERC20("EURC", "EURC", 6);

        vm.startPrank(registryAdmin);
        registry.registerToken(
            address(argus), "ARGUS", "Argus", 18, RewardRegistry.Tier.Featured, "ipfs://argus", bytes32("v1")
        );
        registry.registerToken(
            address(cirbtc), "cirBTC", "Circle Wrapped Bitcoin", 8, RewardRegistry.Tier.Verified, "", bytes32("v1")
        );
        registry.registerToken(
            address(eurc), "EURC", "EURC", 6, RewardRegistry.Tier.Verified, "", bytes32("v1")
        );
        vm.stopPrank();

        // Fund the vault generously so liability checks pass unless a test targets them.
        _fundVault(address(argus), 1_000_000e18);
        _fundVault(address(cirbtc), 100e8);
        _fundVault(address(eurc), 500_000e6);

        _publishCommitments(64);

        vm.prank(machineAdmin);
        machineId = manager.createMachine("Genesis", "Arc Mainnet mix");
        _publishDefaultVersion();

        vm.deal(player, 1_000 ether);
        vm.deal(player2, 1_000 ether);
        vm.deal(operator, 1_000 ether);
    }

    function _fundVault(address token, uint256 amount) internal {
        MockERC20(token).mint(treasurer, amount);
        vm.startPrank(treasurer);
        MockERC20(token).approve(address(vault), amount);
        vault.depositReward(token, amount);
        vm.stopPrank();
    }

    /// @dev Publishes `count` commitments, deriving deterministic pre-images so tests can
    ///      reveal them later. Real operators must use a CSPRNG.
    function _publishCommitments(uint256 count) internal {
        bytes32[] memory batch = new bytes32[](count);
        uint256 start = seeds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 seed = keccak256(abi.encode("seed", start + i));
            bytes32 salt = keccak256(abi.encode("salt", start + i));
            seeds.push(seed);
            salts.push(salt);
            batch[i] = keccak256(abi.encode(seed, salt));
        }
        vm.prank(operator);
        randomness.publishCommitments(batch);
    }

    /// @dev A four-tier table summing to 10,000 weight: 70% / 24% / 5% / 1%.
    function _defaultTiers() internal view returns (ArcadeMachineManager.RewardTier[] memory tiers) {
        tiers = new ArcadeMachineManager.RewardTier[](4);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 7_000,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 10e18,
            maxAmount: 40e18
        });
        tiers[1] = ArcadeMachineManager.RewardTier({
            token: address(eurc),
            weight: 2_400,
            rarity: ArcadeMachineManager.Rarity.Rare,
            minAmount: 1e6,
            maxAmount: 3e6
        });
        tiers[2] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 500,
            rarity: ArcadeMachineManager.Rarity.Ultra,
            minAmount: 200e18,
            maxAmount: 600e18
        });
        tiers[3] = ArcadeMachineManager.RewardTier({
            token: address(cirbtc),
            weight: 100,
            rarity: ArcadeMachineManager.Rarity.Jackpot,
            minAmount: 0.001e8,
            maxAmount: 0.004e8
        });
    }

    function _publishDefaultVersion() internal returns (uint32 version) {
        vm.prank(machineAdmin);
        version = manager.publishVersion(machineId, SPIN_PRICE, _defaultTiers(), 0);
    }

    function _currentVersion() internal view returns (uint32) {
        return manager.machineOf(machineId).currentVersion;
    }

    /// @dev Requests a spin as `who` at the machine's current version and price.
    function _spin(address who) internal returns (uint256 spinId) {
        uint32 version = _currentVersion();
        uint256 price = manager.versionOf(machineId, version).spinPrice;
        vm.prank(who);
        spinId = manager.requestSpin{value: price}(machineId, price, version);
    }

    /// @dev Advances past the anchor block and reveals the pre-image for a spin's request.
    function _reveal(uint256 spinId) internal {
        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        CommitRevealRandomness.Request memory r = randomness.requestOf(s.randomnessRequestId);
        vm.roll(uint256(r.anchorBlock) + 1);
        randomness.reveal(s.randomnessRequestId, seeds[r.commitmentIndex], salts[r.commitmentIndex]);
    }

    /// @dev Full happy path: request, reveal, settle.
    function _spinAndSettle(address who) internal returns (uint256 spinId) {
        spinId = _spin(who);
        _reveal(spinId);
        manager.settleSpin(spinId);
    }
}
