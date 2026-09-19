// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A well-behaved ERC-20 with configurable decimals.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Skims a fee on every transfer. Must be rejected by the registry and must never
///         be able to corrupt vault inventory accounting.
contract FeeOnTransferERC20 is ERC20 {
    uint256 public feeBps;

    constructor(uint256 feeBps_) ERC20("Fee Token", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        if (fee != 0) super._update(from, address(0xFEE), fee);
    }
}

/// @notice Reverts on transfer to a blacklisted address, simulating a token that blocks a
///         winner after their spin has already settled.
contract BlacklistERC20 is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blacklist Token", "BLK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool value) external {
        blocked[who] = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to], "recipient blocked");
        super._update(from, to, value);
    }
}

/// @notice Returns false from transfer instead of reverting.
contract FalseReturnERC20 is ERC20 {
    bool public failTransfers;

    constructor() ERC20("False Token", "FLS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfers) return false;
        return super.transfer(to, amount);
    }
}

/// @notice A player contract whose native-USDC receive hook always reverts, used to prove
///         refunds are credited (pull) rather than pushed.
contract RevertingReceiver {
    receive() external payable {
        revert("no thanks");
    }

    function requestSpin(address manager, uint64 machineId, uint256 price, uint32 version)
        external
        payable
        returns (uint256)
    {
        (bool ok, bytes memory ret) = manager.call{value: msg.value}(
            abi.encodeWithSignature("requestSpin(uint64,uint256,uint32)", machineId, price, version)
        );
        require(ok, "requestSpin failed");
        return abi.decode(ret, (uint256));
    }

    function withdrawRefund(address manager) external {
        (bool ok,) = manager.call(abi.encodeWithSignature("withdrawRefund()"));
        require(ok, "withdraw failed");
    }
}

/// @notice Attempts to reenter settleSpin from a token transfer hook.
contract ReentrantToken is ERC20 {
    address public manager;
    uint256 public targetSpinId;
    bool public attacking;
    /// @notice Recorded so a test can assert the reentrant call was actually rejected.
    bool public reentrancySucceeded;

    constructor() ERC20("Reentrant", "RNT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address manager_, uint256 spinId) external {
        manager = manager_;
        targetSpinId = spinId;
        attacking = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attacking && manager != address(0)) {
            attacking = false;
            // Outcome intentionally ignored: the assertion is that it cannot succeed.
            (bool reentered,) =
                manager.call(abi.encodeWithSignature("settleSpin(uint256)", targetSpinId));
            reentrancySucceeded = reentered;
        }
    }
}
