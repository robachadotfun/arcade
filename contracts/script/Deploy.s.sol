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

/// @notice Deploys the Arcade stack and wires the inter-contract permissions.
///
/// Roles are read from the environment so a real deployment can hand each one to a
/// different signer — ideally a multisig for `ARCADE_ADMIN`. Every role defaults to the
/// admin address, which is convenient on a testnet and **not** acceptable for mainnet.
/// The script prints a warning when it detects that collapsing.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $ARC_TESTNET_RPC_URL --broadcast --verify
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

        RewardRegistry registry = new RewardRegistry(admin, registryAdmin, guardian);
        PrizeVault vault = new PrizeVault(admin, treasurer, guardian);
        CommitRevealRandomness randomness =
            new CommitRevealRandomness(admin, randomnessOperator, guardian);
        FeeRouter feeRouter = new FeeRouter(admin, treasurer, rewardFundingWallet, treasuryWallet);

        ArcadeMachineManager manager = new ArcadeMachineManager(
            admin,
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

        vm.stopBroadcast();

        console2.log("=== Arcade deployment ===");
        console2.log("chainId            ", block.chainid);
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

    function _envOr(string memory key, address fallbackValue) private view returns (address) {
        try vm.envAddress(key) returns (address value) {
            return value == address(0) ? fallbackValue : value;
        } catch {
            return fallbackValue;
        }
    }
}
