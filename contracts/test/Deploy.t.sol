// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice Runs the real deployment script, in both admin configurations.
///
/// The script used to construct every contract with `ARCADE_ADMIN` as sole admin and then
/// wire them from the deploying wallet — which reverts the moment `ARCADE_ADMIN` is a
/// multisig, i.e. in exactly the configuration recommended for mainnet. The unit suite never
/// caught it because it builds the stack by hand rather than through the script.
///
/// `Deploy.run()` asserts its own post-conditions (admin holds DEFAULT_ADMIN_ROLE on all five
/// contracts; the deploying wallet holds it on none), so completing without a revert is the
/// assertion.
contract DeployTest is Test {
    function _clearRoleOverrides() private {
        // Every optional role defaults to ARCADE_ADMIN when unset or zero.
        string[7] memory optional = [
            "ARCADE_MACHINE_ADMIN",
            "ARCADE_REGISTRY_ADMIN",
            "ARCADE_TREASURER",
            "ARCADE_RANDOMNESS_OPERATOR",
            "ARCADE_GUARDIAN",
            "ARCADE_REWARD_FUNDING_WALLET",
            "ARCADE_TREASURY_WALLET"
        ];
        for (uint256 i; i < optional.length; ++i) {
            vm.setEnv(optional[i], vm.toString(address(0)));
        }
    }

    /// Both configurations, run sequentially in ONE test on purpose.
    ///
    /// `vm.setEnv` is process-global and forge runs test functions in parallel. As two
    /// separate tests, each would race the other over `ARCADE_ADMIN` and could silently run
    /// the wrong configuration — which is exactly what happened in the first version of this
    /// file, and it went unnoticed because the fixed script passes both ways.
    function test_Deploy_BothAdminConfigurations() public {
        _clearRoleOverrides();

        // Mainnet: a separate admin, typically a multisig. The case that used to revert.
        vm.setEnv("ARCADE_ADMIN", vm.toString(makeAddr("multisig")));
        new Deploy().run();

        // Single wallet: the deployer stays admin. With no explicit broadcaster, forge
        // broadcasts as the default sender.
        vm.setEnv("ARCADE_ADMIN", vm.toString(DEFAULT_SENDER));
        new Deploy().run();
    }
}
