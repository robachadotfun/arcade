// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {PrizeVault} from "../src/PrizeVault.sol";
import {RewardRegistry} from "../src/RewardRegistry.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IRandomnessSource} from "../src/interfaces/IRandomnessSource.sol";
import {MockERC20} from "./mocks/MockTokens.sol";

/// @notice Drives the system through randomised, realistic sequences of user and operator
///         actions. Every action is wrapped so a legitimate revert (an exhausted commitment
///         pool, a spin that is not yet revealable) does not end the run — the point is to
///         keep hammering the state machine looking for a broken invariant.
contract ArcadeHandler is Test {
    ArcadeMachineManager public manager;
    CommitRevealRandomness public randomness;
    PrizeVault public vault;
    MockERC20 public argus;
    MockERC20 public cirbtc;

    uint64 public machineId;
    address public operator;
    address[] public players;

    bytes32[] public seeds;
    bytes32[] public salts;

    uint256[] public pendingSpins;

    /// @notice Sum of rewards the system has told players they won, per token.
    mapping(address => uint256) public awardedTotal;
    uint256 public ghostSettled;
    uint256 public ghostRefunded;

    constructor(
        ArcadeMachineManager manager_,
        CommitRevealRandomness randomness_,
        PrizeVault vault_,
        MockERC20 argus_,
        MockERC20 cirbtc_,
        uint64 machineId_,
        address operator_,
        address[] memory players_
    ) {
        manager = manager_;
        randomness = randomness_;
        vault = vault_;
        argus = argus_;
        cirbtc = cirbtc_;
        machineId = machineId_;
        operator = operator_;
        players = players_;
    }

    function _publishCommitments(uint256 count) public {
        bytes32[] memory batch = new bytes32[](count);
        uint256 start = seeds.length;
        for (uint256 i; i < count; ++i) {
            bytes32 seed = keccak256(abi.encode("iseed", start + i));
            bytes32 salt = keccak256(abi.encode("isalt", start + i));
            seeds.push(seed);
            salts.push(salt);
            batch[i] = keccak256(abi.encode(seed, salt));
        }
        vm.prank(operator);
        randomness.publishCommitments(batch);
    }

    function requestSpin(uint256 playerSeed) external {
        address who = players[playerSeed % players.length];
        uint32 version = manager.machineOf(machineId).currentVersion;
        uint256 price = manager.versionOf(machineId, version).spinPrice;

        if (randomness.availableCommitments() == 0) _publishCommitments(32);

        vm.deal(who, price);
        vm.prank(who);
        try manager.requestSpin{value: price}(machineId, price, version) returns (uint256 spinId) {
            pendingSpins.push(spinId);
        } catch {
            // Expected when inventory cannot cover another worst case. That refusal IS the
            // solvency guard working, so it is not a failure.
        }
    }

    function revealAndSettle(uint256 pickSeed) external {
        if (pendingSpins.length == 0) return;
        uint256 idx = pickSeed % pendingSpins.length;
        uint256 spinId = pendingSpins[idx];

        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        if (s.status != ArcadeMachineManager.SpinStatus.Pending) {
            _removePending(idx);
            return;
        }

        CommitRevealRandomness.Request memory r = randomness.requestOf(s.randomnessRequestId);
        if (block.number < r.anchorBlock) vm.roll(uint256(r.anchorBlock) + 1);

        if (randomness.stateOf(s.randomnessRequestId) == IRandomnessSource.RequestState.Pending) {
            try randomness.reveal(s.randomnessRequestId, seeds[r.commitmentIndex], salts[r.commitmentIndex])
            {} catch {
                return;
            }
        }

        try manager.settleSpin(spinId) returns (address token, uint256 amount) {
            awardedTotal[token] += amount;
            ghostSettled += 1;
            _removePending(idx);
        } catch {
            return;
        }
    }

    /// @dev Lets the reveal window lapse, then unwinds the spin. Exercises the refund path.
    function abandonAndRefund(uint256 pickSeed) external {
        if (pendingSpins.length == 0) return;
        uint256 idx = pickSeed % pendingSpins.length;
        uint256 spinId = pendingSpins[idx];

        ArcadeMachineManager.Spin memory s = manager.spinOf(spinId);
        if (s.status != ArcadeMachineManager.SpinStatus.Pending) {
            _removePending(idx);
            return;
        }

        vm.roll(randomness.abandonmentBlock(s.randomnessRequestId) + 1);
        try manager.refundAbandonedSpin(spinId) {
            ghostRefunded += 1;
            _removePending(idx);
        } catch {
            return;
        }
    }

    function claimReward(uint256 playerSeed, bool useCirbtc) external {
        address who = players[playerSeed % players.length];
        address token = useCirbtc ? address(cirbtc) : address(argus);
        vm.prank(who);
        try vault.claim(token) {} catch {}
    }

    /// @dev The treasurer repeatedly tries to sweep the maximum they believe is free. If the
    ///      vault's accounting were wrong anywhere, this is what would break solvency.
    function treasurerSweep(bool useCirbtc, uint256 amountSeed) external {
        address token = useCirbtc ? address(cirbtc) : address(argus);
        uint256 free = vault.availableOf(token);
        if (free == 0) return;
        uint256 amount = (amountSeed % free) + 1;

        // The test setup grants this handler the treasurer role, so no prank is needed.
        try vault.removeReward(token, address(0xDEAD), amount) {} catch {}
    }

    function depositMore(bool useCirbtc, uint256 amountSeed) external {
        MockERC20 token = useCirbtc ? cirbtc : argus;
        uint256 amount = (amountSeed % 1_000e18) + 1;
        token.mint(address(this), amount);
        token.approve(address(vault), amount);
        try vault.depositReward(address(token), amount) {} catch {}
    }

    function _removePending(uint256 idx) private {
        pendingSpins[idx] = pendingSpins[pendingSpins.length - 1];
        pendingSpins.pop();
    }

    function pendingCount() external view returns (uint256) {
        return pendingSpins.length;
    }
}

contract SolvencyInvariantTest is StdInvariant, Test {
    ArcadeMachineManager internal manager;
    CommitRevealRandomness internal randomness;
    PrizeVault internal vault;
    RewardRegistry internal registry;
    FeeRouter internal feeRouter;
    ArcadeHandler internal handler;

    MockERC20 internal argus;
    MockERC20 internal cirbtc;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal guardian = makeAddr("guardian");

    /// @dev Cached in storage: `makeAddr` is not a view function, so invariant checks
    ///      cannot derive these on the fly.
    address[4] internal fuzzPlayers;

    function setUp() public {
        registry = new RewardRegistry(admin, admin, guardian);
        vault = new PrizeVault(admin, admin, guardian);
        randomness = new CommitRevealRandomness(admin, operator, guardian);
        feeRouter = new FeeRouter(admin, admin, makeAddr("rf"), makeAddr("tw"));

        manager = new ArcadeMachineManager(
            admin,
            admin,
            guardian,
            registry,
            vault,
            IRandomnessSource(address(randomness)),
            address(feeRouter)
        );

        argus = new MockERC20("Argus", "ARGUS", 18);
        cirbtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);

        vm.startPrank(admin);
        vault.setSettler(address(manager), true);
        randomness.setConsumer(address(manager), true);
        registry.registerToken(
            address(argus), "ARGUS", "Argus", 18, RewardRegistry.Tier.Featured, "", bytes32("v1")
        );
        registry.registerToken(
            address(cirbtc), "cirBTC", "Circle Wrapped Bitcoin", 8, RewardRegistry.Tier.Verified, "", bytes32("v1")
        );
        vm.stopPrank();

        // Deliberately modest inventory, so the liability guard is exercised rather than
        // trivially satisfied.
        argus.mint(admin, 20_000e18);
        cirbtc.mint(admin, 5e8);
        vm.startPrank(admin);
        argus.approve(address(vault), type(uint256).max);
        cirbtc.approve(address(vault), type(uint256).max);
        vault.depositReward(address(argus), 20_000e18);
        vault.depositReward(address(cirbtc), 5e8);
        vm.stopPrank();

        ArcadeMachineManager.RewardTier[] memory tiers = new ArcadeMachineManager.RewardTier[](3);
        tiers[0] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 8_000,
            rarity: ArcadeMachineManager.Rarity.Common,
            minAmount: 10e18,
            maxAmount: 50e18
        });
        tiers[1] = ArcadeMachineManager.RewardTier({
            token: address(argus),
            weight: 1_900,
            rarity: ArcadeMachineManager.Rarity.Ultra,
            minAmount: 100e18,
            maxAmount: 300e18
        });
        tiers[2] = ArcadeMachineManager.RewardTier({
            token: address(cirbtc),
            weight: 100,
            rarity: ArcadeMachineManager.Rarity.Jackpot,
            minAmount: 0.01e8,
            maxAmount: 0.05e8
        });

        vm.startPrank(admin);
        uint64 machineId = manager.createMachine("Invariant", "randomised driver");
        manager.publishVersion(machineId, 2 ether, tiers, 0);
        vm.stopPrank();

        fuzzPlayers = [makeAddr("p1"), makeAddr("p2"), makeAddr("p3"), makeAddr("p4")];
        address[] memory players = new address[](4);
        for (uint256 i; i < fuzzPlayers.length; ++i) {
            players[i] = fuzzPlayers[i];
        }

        handler = new ArcadeHandler(
            manager, randomness, vault, argus, cirbtc, machineId, operator, players
        );
        handler._publishCommitments(128);

        // The handler plays the treasurer, so it can try to sweep inventory.
        vm.prank(admin);
        vault.grantRole(keccak256("arcade.role.treasurer"), address(handler));

        vm.deal(operator, 1_000 ether);
        vm.prank(operator);
        randomness.depositBond{value: 500 ether}();

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = ArcadeHandler.requestSpin.selector;
        selectors[1] = ArcadeHandler.revealAndSettle.selector;
        selectors[2] = ArcadeHandler.abandonAndRefund.selector;
        selectors[3] = ArcadeHandler.claimReward.selector;
        selectors[4] = ArcadeHandler.treasurerSweep.selector;
        selectors[5] = ArcadeHandler.depositMore.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice The vault must always hold at least what it owes. This is the single most
    ///         important property in the system: if it can be broken, a player who won can
    ///         be left unable to collect.
    function invariant_vaultNeverOwesMoreThanItHolds() public view {
        assertGe(
            argus.balanceOf(address(vault)),
            vault.reserved(address(argus)),
            "ARGUS: vault owes more than it holds"
        );
        assertGe(
            cirbtc.balanceOf(address(vault)),
            vault.reserved(address(cirbtc)),
            "cirBTC: vault owes more than it holds"
        );
        assertTrue(vault.isSolvent(address(argus)));
        assertTrue(vault.isSolvent(address(cirbtc)));
    }

    /// @notice Reserved inventory must always be at least the sum of what individual winners
    ///         can still claim. Otherwise a claim would fail, or would underflow.
    function invariant_reservedCoversOutstandingClaims() public view {
        address[4] memory players = fuzzPlayers;

        uint256 argusClaims;
        uint256 cirbtcClaims;
        for (uint256 i; i < players.length; ++i) {
            argusClaims += vault.claimable(players[i], address(argus));
            cirbtcClaims += vault.claimable(players[i], address(cirbtc));
        }

        assertGe(vault.reserved(address(argus)), argusClaims, "ARGUS claims exceed reserved");
        assertGe(vault.reserved(address(cirbtc)), cirbtcClaims, "cirBTC claims exceed reserved");
    }

    /// @notice A spin is settled at most once, so the contract's counter must match the
    ///         handler's independently kept tally.
    function invariant_settlementCountIsExact() public view {
        assertEq(manager.totalSpinsSettled(), handler.ghostSettled(), "double or lost settlement");
        assertEq(manager.totalSpinsRefunded(), handler.ghostRefunded(), "double or lost refund");
    }

    /// @notice Every spin the manager knows about is in exactly one terminal-or-pending state,
    ///         and the outstanding counter never underflows into nonsense.
    function invariant_outstandingSpinsNeverExceedTotal() public view {
        assertLe(
            manager.totalSpinsSettled() + manager.totalSpinsRefunded(),
            manager.spinCount(),
            "more resolved spins than were ever requested"
        );
    }

    /// @notice A commitment index is consumed at most once, so requests can never exceed the
    ///         commitments published. This is what rules out re-rolls.
    function invariant_commitmentsConsumedAtMostOnce() public view {
        assertLe(
            randomness.nextCommitmentIndex(),
            randomness.commitmentCount(),
            "consumed more commitments than were published"
        );
        assertEq(
            randomness.nextCommitmentIndex(),
            randomness.requestCount(),
            "each request must consume exactly one commitment"
        );
    }

    /// @notice The manager must always hold enough native USDC to pay out every credited
    ///         refund. Revenue is only forwarded on settlement, never on request.
    function invariant_managerCanCoverCreditedRefunds() public view {
        address[4] memory players = fuzzPlayers;
        uint256 owed;
        for (uint256 i; i < players.length; ++i) {
            owed += manager.refundable(players[i]);
        }
        assertGe(address(manager).balance, owed, "manager cannot cover credited refunds");
    }
}
