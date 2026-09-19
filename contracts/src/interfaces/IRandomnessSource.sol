// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IRandomnessSource
/// @notice Adapter boundary between Arcade's settlement logic and whatever randomness
///         infrastructure a given network actually offers.
///
/// Arc Mainnet has no Chainlink VRF at the time of writing (Chainlink's Arc integration
/// covers CCIP, Data Feeds, Data Streams and Proof of Reserve). Arcade therefore ships
/// `CommitRevealRandomness`. If a reputable VRF later becomes available on Arc, a new
/// adapter implementing this interface can be deployed and pointed at without touching
/// the machine, vault or registry contracts.
///
/// Contract invariant every implementation must uphold:
///   a fulfilled request's `randomWord` is fixed forever and derivable from public data.
interface IRandomnessSource {
    enum RequestState {
        None,
        Pending,
        Fulfilled,
        Failed
    }

    /// @notice Opens a randomness request bound to `consumerContext`.
    /// @dev Only callable by an authorised consumer. `consumerContext` is mixed into the
    ///      final word so two requests in the same block cannot collide.
    /// @return requestId Identifier used to read the result back.
    function requestRandomness(bytes32 consumerContext) external returns (uint256 requestId);

    /// @notice Current state of a request.
    function stateOf(uint256 requestId) external view returns (RequestState);

    /// @notice The random word for a fulfilled request.
    /// @dev MUST revert unless the request is `Fulfilled`. MUST return the same value forever.
    function randomWord(uint256 requestId) external view returns (uint256);

    /// @notice Block after which a still-pending request is considered abandoned and the
    ///         consumer may unwind it (refund the player).
    function abandonmentBlock(uint256 requestId) external view returns (uint256);

    /// @notice Compensation (in native USDC) this source has already paid the consumer on
    ///         behalf of `requestId`, e.g. slashed from an operator bond for a missed reveal.
    /// @dev Returns 0 when the mechanism has no such concept (a VRF adapter, for instance).
    ///      The consumer credits this to the affected player on top of their refund.
    function penaltyCreditedFor(uint256 requestId) external view returns (uint256);

    /// @notice Human-readable description of the mechanism, surfaced on the fairness page.
    function mechanism() external view returns (string memory);
}
