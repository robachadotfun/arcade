// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ArcadeMachineManager} from "../src/ArcadeMachineManager.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {PrizeVault} from "../src/PrizeVault.sol";
import {RewardRegistry} from "../src/RewardRegistry.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {IRandomnessSource} from "../src/interfaces/IRandomnessSource.sol";
import {ArcadeRoles} from "../src/ArcadeRoles.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Deploys the Arcade stack and wires the inter-contract permissions.
///
/// Roles are read from the environment so a real deployment can hand each one to a
/// different signer — ideally a multisig for `ARCADE_ADMIN`. Every role defaults to the
/// admin address, which is convenient on a testnet and **not** acceptable for mainnet.
/// The script prints a warning when it detects that collapsing.
///
/// ## Why the deploying wallet is admin for a moment
///
/// Wiring the stack — `setSettler`, `setConsumer` — needs `DEFAULT_ADMIN_ROLE`, and the
/// wallet broadcasting this script is the only one that can sign during it. If
/// `ARCADE_ADMIN` is a multisig, that wallet would hold no role and the wiring would revert.
///
/// So every contract is constructed with the deploying wallet as admin, wired, and then
/// `DEFAULT_ADMIN_ROLE` is granted to `ARCADE_ADMIN` and **renounced** by the deployer, in
/// the same broadcast. When the script finishes the deploying wallet holds no admin rights
/// anywhere, which the script asserts rather than assumes.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $ARC_MAINNET_RPC_URL --account <keystore-name> --broadcast
contract Deploy is Script {
    function run() external {
        address admin = vm.envAddress("ARCADE_ADMIN");
        address machineAdmin = _envOr("ARCADE_MACHINE_ADMIN", admin);
        address registryAdmin = _envOr("ARCADE_REGISTRY_ADMIN", admin);
        address treasurer = _envOr("ARCADE_TREASURER", admin);
        address randomnessOperator = _envOr("ARCADE_RANDOMNESS_OPERATOR", admin);
        address guardian = _envOr("ARCADE_GUARDIAN", admin);
        address rewardFundingWallet = _envOr("ARCADE_REWARD_FUNDING_WALLET", admin);
        address treasuryWallet = _envOr("ARCADE_TREASURY_WALLET", admin);

        vm.startBroadcast();

        // The wallet actually signing. Constructed as admin so it can wire the stack below,
        // then stripped of the role before the broadcast ends.
        (, address deployer,) = vm.readCallers();

        RewardRegistry registry = new RewardRegistry(deployer, registryAdmin, guardian);
        PrizeVault vault = new PrizeVault(deployer, treasurer, guardian);
        CommitRevealRandomness randomness =
            new CommitRevealRandomness(deployer, randomnessOperator, guardian);
        FeeRouter feeRouter = new FeeRouter(deployer, treasurer, rewardFundingWallet, treasuryWallet);

        ArcadeMachineManager manager = new ArcadeMachineManager(
            deployer,
            machineAdmin,
            guardian,
            registry,
            vault,
            IRandomnessSource(address(randomness)),
            address(feeRouter)
        );

        // The manager is the only contract allowed to reserve/deliver prizes or open
        // randomness requests.
        vault.setSettler(address(manager), true);
        randomness.setConsumer(address(manager), true);

        // Hand DEFAULT_ADMIN_ROLE to the real admin, then give it up.
        _handOff(
            [address(registry), address(vault), address(randomness), address(feeRouter), address(manager)],
            admin,
            deployer
        );

        vm.stopBroadcast();

        _assertHandedOff(
            [address(registry), address(vault), address(randomness), address(feeRouter), address(manager)],
            admin,
            deployer
        );

        console2.log("=== Arcade deployment ===");
        console2.log("chainId            ", block.chainid);
        console2.log("admin              ", admin);
        console2.log("RewardRegistry     ", address(registry));
        console2.log("PrizeVault         ", address(vault));
        console2.log("Randomness         ", address(randomness));
        console2.log("FeeRouter          ", address(feeRouter));
        console2.log("MachineManager     ", address(manager));
        console2.log("");
        console2.log("Next steps:");
        console2.log(" 1. Publish randomness commitments (publishCommitments)");
        console2.log(" 2. Deposit the operator bond (depositBond)");
        console2.log(" 3. Register verified reward tokens (registerToken)");
        console2.log(" 4. Deposit reward inventory (depositReward)");
        console2.log(" 5. Create a machine and publish a version");
        console2.log("");

        if (
            machineAdmin == admin && registryAdmin == admin && treasurer == admin
                && randomnessOperator == admin && guardian == admin
        ) {
            console2.log("WARNING: every role is held by one address.");
            console2.log("Do not run a mainnet deployment this way. Split the roles and");
            console2.log("put DEFAULT_ADMIN_ROLE behind a multisig before taking real funds.");
        }
    }

    /// @dev Grant first, then renounce. The reverse order would leave a contract with no
    ///      admin at all, permanently, if the grant then failed. A no-op when the admin is the
    ///      deploying wallet itself.
    function _handOff(address[5] memory targets, address admin, address deployer) private {
        if (admin == deployer) return;
        for (uint256 i; i < targets.length; ++i) {
            AccessControl target = AccessControl(targets[i]);
            bytes32 adminRole = target.DEFAULT_ADMIN_ROLE();
            target.grantRole(adminRole, admin);
            target.renounceRole(adminRole, deployer);
        }
    }

    /// @dev Fails the whole script if the handoff did not land exactly as intended, rather
    ///      than printing addresses for a deployment whose admin is not who you think it is.
    function _assertHandedOff(address[5] memory targets, address admin, address deployer) private view {
        for (uint256 i; i < targets.length; ++i) {
            AccessControl target = AccessControl(targets[i]);
            bytes32 adminRole = target.DEFAULT_ADMIN_ROLE();
            require(target.hasRole(adminRole, admin), "admin does not hold DEFAULT_ADMIN_ROLE");
            if (admin != deployer) {
                require(!target.hasRole(adminRole, deployer), "deployer still holds DEFAULT_ADMIN_ROLE");
            }
        }
    }

    function _envOr(string memory key, address fallbackValue) private view returns (address) {
        try vm.envAddress(key) returns (address value) {
            return value == address(0) ? fallbackValue : value;
        } catch {
            return fallbackValue;
        }
    }
}
