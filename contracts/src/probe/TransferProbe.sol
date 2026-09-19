// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TransferProbe
/// @notice Read-only research helper. This contract is NEVER deployed on any network.
///
/// It is injected as an `eth_call` state override at the address of a *real token holder*,
/// which lets us execute `token.transfer(...)` with `msg.sender == holder` against live
/// mainnet state without broadcasting a transaction or spending funds.
///
/// Injecting code at an address does not clear that address's token balances, so the
/// probe observes genuine transfer behaviour: fee-on-transfer skim, blacklist reverts,
/// paused transfers, and non-standard return values.
///
/// Used by `scripts/verify-arc-tokens.ts` to qualify reward assets before they are
/// allowed into the Arcade reward registry.
contract TransferProbe {
    struct Result {
        bool callSucceeded;
        bool returnedTrue;
        uint256 amountSent;
        uint256 amountReceived;
        uint256 senderBalanceBefore;
        uint256 senderBalanceAfter;
    }

    /// @notice Transfers `amount` of `token` to `sink` and reports what actually arrived.
    /// @dev Reverts are caught so a restricted token yields data instead of an opaque failure.
    function probeTransfer(address token, address sink, uint256 amount)
        external
        returns (Result memory r)
    {
        r.amountSent = amount;
        r.senderBalanceBefore = _balanceOf(token, address(this));
        uint256 sinkBefore = _balanceOf(token, sink);

        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(0xa9059cbb, sink, amount));

        r.callSucceeded = ok;
        // A compliant ERC-20 returns exactly one word equal to 1.
        r.returnedTrue = ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;

        r.senderBalanceAfter = _balanceOf(token, address(this));
        r.amountReceived = _balanceOf(token, sink) - sinkBefore;
    }

    function _balanceOf(address token, address who) private view returns (uint256 bal) {
        (bool ok, bytes memory ret) =
            token.staticcall(abi.encodeWithSelector(0x70a08231, who));
        if (ok && ret.length >= 32) bal = abi.decode(ret, (uint256));
    }
}
