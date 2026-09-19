// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ArcadeRoles} from "./ArcadeRoles.sol";

/// @title RewardRegistry
/// @notice The allowlist of tokens that may be used as Arcade rewards.
///
/// Separating the registry from machine configuration and from inventory means a token can
/// be paused for safety without touching any machine's published odds, and a machine's
/// reward table can be audited independently of what the treasury happens to hold.
///
/// ## What "verified" means here
///
/// `Verified` records that Arcade checked the token **contract**: that this address is the
/// token it claims to be, that `decimals()` matches what the registry stores, and that
/// `transfer` moves the full amount without skimming a fee. It is **not** a statement about
/// the asset's quality, price, safety as an investment, or anyone's endorsement of it.
///
/// Tokens are qualified off-chain by `scripts/verify-arc-tokens.ts`, which probes live
/// transfer behaviour against Arc Mainnet before an address is ever proposed here.
contract RewardRegistry is AccessControl {
    /// @notice Curation tier shown in the UI. Ordering carries no quality judgement.
    enum Tier {
        None,
        /// @dev Listed on a machine and highlighted in the interface.
        Featured,
        /// @dev Contract and transfer behaviour verified by Arcade.
        Verified,
        /// @dev Newer or thinner asset, deliberately marked as higher risk.
        Discovery
    }

    struct TokenRecord {
        bool enabled;
        bool paused;
        Tier tier;
        /// @dev Cached at registration and asserted against the token contract.
        uint8 decimals;
        string symbol;
        string name;
        /// @dev Off-chain pointer (IPFS/HTTPS) to canonical project logo metadata.
        string logoUri;
        /// @dev Hash of the verification report entry that qualified this token.
        bytes32 verificationRef;
    }

    mapping(address token => TokenRecord) private _records;
    address[] private _tokens;
    mapping(address token => bool known) private _known;

    event TokenRegistered(
        address indexed token, string symbol, uint8 decimals, Tier tier, bytes32 verificationRef
    );
    event TokenUpdated(address indexed token, Tier tier, string logoUri, bytes32 verificationRef);
    event TokenEnabledSet(address indexed token, bool enabled);
    event TokenPausedSet(address indexed token, bool paused);

    error TokenAlreadyRegistered(address token);
    error TokenNotRegistered(address token);
    error DecimalsMismatch(address token, uint8 declared, uint8 onchain);
    error SymbolMismatch(address token, string declared, string onchain);
    error ZeroAddress();
    error DecimalsOutOfRange(uint8 decimals);

    constructor(address admin, address registryAdmin, address guardian) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ArcadeRoles.REGISTRY_ADMIN, registryAdmin);
        // The guardian's only power here is to pause a token for safety. Unpausing is
        // deliberately reserved for the registry admin.
        _grantRole(ArcadeRoles.GUARDIAN, guardian);
    }

    /// @notice Registers a token after asserting its onchain metadata matches what is declared.
    /// @dev The decimals assertion is the important one: reward amounts are configured in a
    ///      token's own units, so a wrong `decimals` value would mis-size every payout by
    ///      orders of magnitude. We refuse to take the operator's word for it.
    function registerToken(
        address token,
        string calldata symbol,
        string calldata name,
        uint8 decimals,
        Tier tier,
        string calldata logoUri,
        bytes32 verificationRef
    ) external onlyRole(ArcadeRoles.REGISTRY_ADMIN) {
        if (token == address(0)) revert ZeroAddress();
        if (_known[token]) revert TokenAlreadyRegistered(token);
        if (decimals > 36) revert DecimalsOutOfRange(decimals);

        uint8 onchainDecimals = IERC20Metadata(token).decimals();
        if (onchainDecimals != decimals) revert DecimalsMismatch(token, decimals, onchainDecimals);

        string memory onchainSymbol = IERC20Metadata(token).symbol();
        if (keccak256(bytes(onchainSymbol)) != keccak256(bytes(symbol))) {
            revert SymbolMismatch(token, symbol, onchainSymbol);
        }

        _records[token] = TokenRecord({
            enabled: true,
            paused: false,
            tier: tier,
            decimals: decimals,
            symbol: symbol,
            name: name,
            logoUri: logoUri,
            verificationRef: verificationRef
        });
        _known[token] = true;
        _tokens.push(token);

        emit TokenRegistered(token, symbol, decimals, tier, verificationRef);
    }

    /// @notice Updates presentation metadata. Cannot change `decimals` — that would silently
    ///         reinterpret every configured reward amount.
    function updateToken(address token, Tier tier, string calldata logoUri, bytes32 verificationRef)
        external
        onlyRole(ArcadeRoles.REGISTRY_ADMIN)
    {
        _requireKnown(token);
        TokenRecord storage rec = _records[token];
        rec.tier = tier;
        rec.logoUri = logoUri;
        rec.verificationRef = verificationRef;
        emit TokenUpdated(token, tier, logoUri, verificationRef);
    }

    function setEnabled(address token, bool enabled) external onlyRole(ArcadeRoles.REGISTRY_ADMIN) {
        _requireKnown(token);
        _records[token].enabled = enabled;
        emit TokenEnabledSet(token, enabled);
    }

    /// @notice Pauses a token for safety. Any role above guardian may pause; only the
    ///         registry admin may unpause.
    function setPaused(address token, bool paused) external {
        _requireKnown(token);
        if (paused) {
            if (
                !hasRole(ArcadeRoles.GUARDIAN, msg.sender)
                    && !hasRole(ArcadeRoles.REGISTRY_ADMIN, msg.sender)
            ) {
                revert AccessControlUnauthorizedAccount(msg.sender, ArcadeRoles.GUARDIAN);
            }
        } else {
            _checkRole(ArcadeRoles.REGISTRY_ADMIN, msg.sender);
        }
        _records[token].paused = paused;
        emit TokenPausedSet(token, paused);
    }

    // ----------------------------------------------------------------------- reading

    /// @notice True when a token may currently be awarded.
    function isAwardable(address token) external view returns (bool) {
        TokenRecord storage rec = _records[token];
        return rec.enabled && !rec.paused;
    }

    function recordOf(address token) external view returns (TokenRecord memory) {
        _requireKnown(token);
        return _records[token];
    }

    function decimalsOf(address token) external view returns (uint8) {
        _requireKnown(token);
        return _records[token].decimals;
    }

    function isRegistered(address token) external view returns (bool) {
        return _known[token];
    }

    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _tokens[index];
    }

    function allTokens() external view returns (address[] memory) {
        return _tokens;
    }

    function _requireKnown(address token) private view {
        if (!_known[token]) revert TokenNotRegistered(token);
    }
}
