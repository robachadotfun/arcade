// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ArcadeRoles
/// @notice Role identifiers shared across the Arcade contracts.
///
/// Roles are deliberately narrow. No single role can both change a machine's reward
/// table and settle a spin, and no role anywhere can alter an outcome once randomness
/// has been revealed.
library ArcadeRoles {
    /// @notice Creates and versions machines, sets reward tables. Cannot settle spins.
    bytes32 internal constant MACHINE_ADMIN = keccak256("arcade.role.machineAdmin");

    /// @notice Curates the reward registry (token allowlist). Cannot move funds.
    bytes32 internal constant REGISTRY_ADMIN = keccak256("arcade.role.registryAdmin");

    /// @notice Deposits reward inventory and withdraws only unreserved surplus.
    bytes32 internal constant TREASURER = keccak256("arcade.role.treasurer");

    /// @notice Publishes randomness commitments and reveals seeds. Cannot pick outcomes.
    bytes32 internal constant RANDOMNESS_OPERATOR = keccak256("arcade.role.randomnessOperator");

    /// @notice Emergency pause only. Cannot unpause, configure, or move funds.
    bytes32 internal constant GUARDIAN = keccak256("arcade.role.guardian");
}
