// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title InjectMe L1 Bridge Helper
/// @notice Convenience wrapper around the OP Stack L1StandardBridge for
///         depositing native 0G tokens from L1 (0G Chain) to the InjectMe L3.
///
///         The OP Stack already deploys L1StandardBridgeProxy as part of its
///         contract suite. This contract is OPTIONAL and exists to provide:
///           1. A simpler deposit interface for frontend integrations
///           2. Event logging for the InjectMe backend oracle to track deposits
///           3. Optional minimum deposit enforcement
///
///         For production use, interact directly with L1StandardBridgeProxy.
///
/// @dev    This contract does NOT hold funds. All value is forwarded to the
///         OP Stack bridge in the same transaction.
///
/// @custom:security This contract is non-upgradeable by design. If the bridge
///         proxy address changes, deploy a new instance.
interface IL1StandardBridge {
    /// @notice Deposit ETH (or native token) to L2, crediting the sender.
    /// @param _minGasLimit Minimum gas limit for the L2 deposit tx.
    /// @param _extraData   Arbitrary data forwarded to L2.
    function depositETH(uint32 _minGasLimit, bytes calldata _extraData) external payable;

    /// @notice Deposit ETH (or native token) to a specific L2 recipient.
    /// @param _to          L2 recipient address.
    /// @param _minGasLimit Minimum gas limit for the L2 deposit tx.
    /// @param _extraData   Arbitrary data forwarded to L2.
    function depositETHTo(address _to, uint32 _minGasLimit, bytes calldata _extraData) external payable;
}

contract InjectMeL1Bridge {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @notice Address of the OP Stack L1StandardBridgeProxy on 0G Chain.
    IL1StandardBridge public immutable l1Bridge;

    /// @notice Minimum deposit amount in wei (prevents dust deposits).
    uint256 public immutable minDeposit;

    /// @notice Gas limit passed to the L2 deposit transaction.
    uint32 public constant L2_GAS_LIMIT = 100_000;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// @notice Emitted on every deposit for the InjectMe backend to index.
    event InjectMeDeposit(
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error DepositBelowMinimum(uint256 sent, uint256 minimum);
    error ZeroAddress();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _l1Bridge   Address of the deployed L1StandardBridgeProxy.
    /// @param _minDeposit Minimum deposit in wei (e.g., 0.001 0G = 1e15).
    constructor(address _l1Bridge, uint256 _minDeposit) {
        if (_l1Bridge == address(0)) revert ZeroAddress();
        l1Bridge = IL1StandardBridge(_l1Bridge);
        minDeposit = _minDeposit;
    }

    // -----------------------------------------------------------------------
    // Deposit Functions
    // -----------------------------------------------------------------------

    /// @notice Deposit native 0G tokens to the InjectMe L3 (credited to sender).
    function deposit() external payable {
        _deposit(msg.sender);
    }

    /// @notice Deposit native 0G tokens to a specific L3 recipient.
    /// @param _to L3 recipient address.
    function depositTo(address _to) external payable {
        if (_to == address(0)) revert ZeroAddress();
        _deposit(_to);
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _deposit(address _to) internal {
        if (msg.value < minDeposit) {
            revert DepositBelowMinimum(msg.value, minDeposit);
        }

        // Forward the full value to the OP Stack bridge.
        // The bridge handles the cross-chain message to credit _to on L3.
        if (_to == msg.sender) {
            l1Bridge.depositETH{value: msg.value}(L2_GAS_LIMIT, "");
        } else {
            l1Bridge.depositETHTo{value: msg.value}(_to, L2_GAS_LIMIT, "");
        }

        emit InjectMeDeposit(msg.sender, _to, msg.value, block.timestamp);
    }

    // -----------------------------------------------------------------------
    // Prevent accidental direct transfers
    // -----------------------------------------------------------------------

    receive() external payable {
        _deposit(msg.sender);
    }
}
