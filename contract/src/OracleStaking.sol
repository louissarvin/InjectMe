// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OracleStaking - Decentralized oracle network via staking
/// @notice Operators stake native 0G tokens to become oracle candidates.
///         Judgments require M-of-N confirmations from active oracles.
/// @dev Active oracle set is the top N stakers by amount. Consensus is
///      multi-sig style: M confirmations required before execution.
contract OracleStaking is Ownable, ReentrancyGuard {
    // ============================================================
    //                       STRUCTS
    // ============================================================

    struct Operator {
        uint256 stakedAmount;
        uint256 pendingUnstake;
        uint256 unstakeRequestedAt;
        uint256 rewards;
        bool isActive;
        uint256 judgmentsSubmitted;
        uint256 judgmentsSlashed;
    }

    struct Judgment {
        address challenge;
        address proposedWinner;
        string chatID;
        uint256 confirmations;
        bool executed;
        uint256 submittedAt;
        address submitter;
    }

    // ============================================================
    //                       CONSTANTS
    // ============================================================

    uint256 public constant UNSTAKE_TIMELOCK = 7 days;
    uint256 public constant MAX_ACTIVE_ORACLES = 50;

    // ============================================================
    //                       STATE
    // ============================================================

    uint256 public minStake;
    uint256 public activeOracleCount;
    uint256 public confirmationsRequired;
    uint256 public nextJudgmentId;

    mapping(address => Operator) public operators;
    mapping(uint256 => Judgment) public judgments;
    mapping(uint256 => mapping(address => bool)) public judgmentConfirmed;

    address[] public activeOracleList;

    // ============================================================
    //                       EVENTS
    // ============================================================

    event Staked(address indexed operator, uint256 amount, uint256 totalStake);
    event UnstakeRequested(address indexed operator, uint256 amount, uint256 unlockTime);
    event UnstakeCompleted(address indexed operator, uint256 amount);
    event OperatorActivated(address indexed operator, uint256 stakedAmount);
    event OperatorDeactivated(address indexed operator);
    event JudgmentSubmitted(uint256 indexed judgmentId, address indexed challenge, address proposedWinner, address submitter);
    event JudgmentConfirmed(uint256 indexed judgmentId, address indexed confirmer, uint256 confirmations);
    event JudgmentExecuted(uint256 indexed judgmentId, address indexed challenge, address winner);
    event OperatorSlashed(address indexed operator, uint256 amount, bytes32 evidenceHash);
    event RewardsClaimed(address indexed operator, uint256 amount);
    event RewardsDistributed(uint256 totalAmount, uint256 recipientCount);
    event MinStakeUpdated(uint256 oldMinStake, uint256 newMinStake);
    event ConfirmationsRequiredUpdated(uint256 oldRequired, uint256 newRequired);

    // ============================================================
    //                     CONSTRUCTOR
    // ============================================================

    /// @param _minStake Minimum stake amount to become an oracle candidate
    /// @param _confirmationsRequired M-of-N confirmations needed for judgments
    constructor(uint256 _minStake, uint256 _confirmationsRequired) Ownable(msg.sender) {
        require(_minStake > 0, "Min stake must be > 0");
        require(_confirmationsRequired > 0, "Confirmations must be > 0");
        minStake = _minStake;
        confirmationsRequired = _confirmationsRequired;
    }

    // ============================================================
    //                    STAKING
    // ============================================================

    /// @notice Stake native 0G tokens to become an oracle candidate
    function stake() external payable nonReentrant {
        require(msg.value > 0, "Must stake > 0");

        Operator storage op = operators[msg.sender];
        op.stakedAmount += msg.value;

        // Auto-activate if meets minimum and not already active
        if (!op.isActive && op.stakedAmount >= minStake) {
            _activateOperator(msg.sender);
        }

        emit Staked(msg.sender, msg.value, op.stakedAmount);
    }

    /// @notice Request to unstake tokens (begins timelock)
    /// @param amount Amount to unstake
    function unstake(uint256 amount) external nonReentrant {
        Operator storage op = operators[msg.sender];
        require(amount > 0, "Amount must be > 0");
        require(op.stakedAmount >= amount, "Insufficient stake");

        // If active, cannot unstake below minimum
        if (op.isActive) {
            require(op.stakedAmount - amount >= minStake, "Cannot unstake below minimum while active");
        }

        op.stakedAmount -= amount;
        op.pendingUnstake += amount;
        op.unstakeRequestedAt = block.timestamp;

        emit UnstakeRequested(msg.sender, amount, block.timestamp + UNSTAKE_TIMELOCK);
    }

    /// @notice Complete unstaking after timelock expires
    function completeUnstake() external nonReentrant {
        Operator storage op = operators[msg.sender];
        require(op.pendingUnstake > 0, "No pending unstake");
        require(
            block.timestamp >= op.unstakeRequestedAt + UNSTAKE_TIMELOCK,
            "Timelock not expired"
        );

        uint256 amount = op.pendingUnstake;
        op.pendingUnstake = 0;
        op.unstakeRequestedAt = 0;

        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        emit UnstakeCompleted(msg.sender, amount);
    }

    /// @notice Deactivate self as oracle (voluntary exit)
    function deactivate() external {
        Operator storage op = operators[msg.sender];
        require(op.isActive, "Not active");
        _deactivateOperator(msg.sender);
    }

    // ============================================================
    //                  JUDGMENT SYSTEM
    // ============================================================

    /// @notice Submit a victory judgment for a challenge
    /// @param challengeAddress The challenge contract address
    /// @param proposedWinner The address of the proposed winner
    /// @param chatID The chat ID for reference
    /// @return judgmentId The ID of the new judgment
    function submitJudgment(
        address challengeAddress,
        address proposedWinner,
        string calldata chatID
    ) external nonReentrant returns (uint256) {
        require(operators[msg.sender].isActive, "Not active oracle");
        require(challengeAddress != address(0), "Invalid challenge");
        require(proposedWinner != address(0), "Invalid winner");

        uint256 judgmentId = nextJudgmentId++;

        Judgment storage j = judgments[judgmentId];
        j.challenge = challengeAddress;
        j.proposedWinner = proposedWinner;
        j.chatID = chatID;
        j.confirmations = 1;
        j.submittedAt = block.timestamp;
        j.submitter = msg.sender;

        judgmentConfirmed[judgmentId][msg.sender] = true;

        operators[msg.sender].judgmentsSubmitted++;

        emit JudgmentSubmitted(judgmentId, challengeAddress, proposedWinner, msg.sender);
        emit JudgmentConfirmed(judgmentId, msg.sender, 1);

        return judgmentId;
    }

    /// @notice Confirm an existing judgment
    /// @param judgmentId The judgment to confirm
    function confirmJudgment(uint256 judgmentId) external nonReentrant {
        require(operators[msg.sender].isActive, "Not active oracle");

        Judgment storage j = judgments[judgmentId];
        require(j.challenge != address(0), "Judgment not found");
        require(!j.executed, "Already executed");
        require(!judgmentConfirmed[judgmentId][msg.sender], "Already confirmed");

        judgmentConfirmed[judgmentId][msg.sender] = true;
        j.confirmations++;

        operators[msg.sender].judgmentsSubmitted++;

        emit JudgmentConfirmed(judgmentId, msg.sender, j.confirmations);
    }

    /// @notice Execute a judgment after sufficient confirmations
    /// @param judgmentId The judgment to execute
    function executeJudgment(uint256 judgmentId) external nonReentrant {
        Judgment storage j = judgments[judgmentId];
        require(j.challenge != address(0), "Judgment not found");
        require(!j.executed, "Already executed");
        require(j.confirmations >= confirmationsRequired, "Insufficient confirmations");

        j.executed = true;

        // Call claimVictory on the challenge contract
        // Note: the OracleStaking contract must be set as the oracle on the challenge
        (bool success,) = j.challenge.call(
            abi.encodeWithSignature("claimVictory(address,string)", j.proposedWinner, j.chatID)
        );
        require(success, "Judgment execution failed");

        emit JudgmentExecuted(judgmentId, j.challenge, j.proposedWinner);
    }

    // ============================================================
    //                    SLASHING
    // ============================================================

    /// @notice Slash an operator's stake (owner only, with evidence)
    /// @param operator The operator to slash
    /// @param evidence Evidence hash for the slash reason
    function slash(address operator, bytes32 evidence) external onlyOwner nonReentrant {
        require(evidence != bytes32(0), "Evidence required");
        Operator storage op = operators[operator];
        require(op.stakedAmount > 0, "Nothing to slash");

        uint256 slashAmount = op.stakedAmount / 2; // Slash 50%
        if (slashAmount == 0) slashAmount = op.stakedAmount;

        op.stakedAmount -= slashAmount;
        op.judgmentsSlashed++;

        // Deactivate if below minimum
        if (op.isActive && op.stakedAmount < minStake) {
            _deactivateOperator(operator);
        }

        // Send slashed funds to owner (protocol treasury)
        (bool sent,) = owner().call{value: slashAmount}("");
        require(sent, "Slash transfer failed");

        emit OperatorSlashed(operator, slashAmount, evidence);
    }

    // ============================================================
    //                    REWARDS
    // ============================================================

    /// @notice Distribute rewards to active oracles (owner only, funded via msg.value)
    function distributeRewards() external payable onlyOwner nonReentrant {
        require(msg.value > 0, "No rewards to distribute");
        require(activeOracleCount > 0, "No active oracles");

        uint256 rewardPerOracle = msg.value / activeOracleCount;
        uint256 distributed;

        for (uint256 i = 0; i < activeOracleList.length; i++) {
            address op = activeOracleList[i];
            if (operators[op].isActive) {
                operators[op].rewards += rewardPerOracle;
                distributed += rewardPerOracle;
            }
        }

        // Any dust stays in the contract
        emit RewardsDistributed(distributed, activeOracleCount);
    }

    /// @notice Claim accumulated rewards
    function claimRewards() external nonReentrant {
        Operator storage op = operators[msg.sender];
        uint256 amount = op.rewards;
        require(amount > 0, "No rewards");

        op.rewards = 0;

        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "Reward transfer failed");

        emit RewardsClaimed(msg.sender, amount);
    }

    // ============================================================
    //                    ADMIN
    // ============================================================

    /// @notice Update minimum stake requirement
    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake > 0, "Min stake must be > 0");
        emit MinStakeUpdated(minStake, _minStake);
        minStake = _minStake;
    }

    /// @notice Update confirmations required for judgments
    function setConfirmationsRequired(uint256 _required) external onlyOwner {
        require(_required > 0, "Must be > 0");
        emit ConfirmationsRequiredUpdated(confirmationsRequired, _required);
        confirmationsRequired = _required;
    }

    // ============================================================
    //                    INTERNAL
    // ============================================================

    function _activateOperator(address operator) internal {
        require(activeOracleCount < MAX_ACTIVE_ORACLES, "Max oracles reached");

        operators[operator].isActive = true;
        activeOracleList.push(operator);
        activeOracleCount++;

        emit OperatorActivated(operator, operators[operator].stakedAmount);
    }

    function _deactivateOperator(address operator) internal {
        operators[operator].isActive = false;
        activeOracleCount--;

        // Remove from active list
        for (uint256 i = 0; i < activeOracleList.length; i++) {
            if (activeOracleList[i] == operator) {
                activeOracleList[i] = activeOracleList[activeOracleList.length - 1];
                activeOracleList.pop();
                break;
            }
        }

        emit OperatorDeactivated(operator);
    }

    // ============================================================
    //                    VIEW FUNCTIONS
    // ============================================================

    /// @notice Get the list of active oracle addresses
    function getActiveOracles() external view returns (address[] memory) {
        address[] memory active = new address[](activeOracleCount);
        uint256 idx;
        for (uint256 i = 0; i < activeOracleList.length; i++) {
            if (operators[activeOracleList[i]].isActive) {
                active[idx++] = activeOracleList[i];
            }
        }
        return active;
    }

    /// @notice Check if an address is an active oracle
    function isActiveOracle(address addr) external view returns (bool) {
        return operators[addr].isActive;
    }

    /// @notice Get operator details
    function getOperator(address addr) external view returns (
        uint256 stakedAmount,
        uint256 pendingUnstakeAmount,
        uint256 unstakeRequestedAt,
        uint256 rewards,
        bool isActive,
        uint256 submitted,
        uint256 slashed
    ) {
        Operator memory op = operators[addr];
        return (
            op.stakedAmount,
            op.pendingUnstake,
            op.unstakeRequestedAt,
            op.rewards,
            op.isActive,
            op.judgmentsSubmitted,
            op.judgmentsSlashed
        );
    }

    /// @notice Get judgment details
    function getJudgment(uint256 judgmentId) external view returns (
        address challenge,
        address proposedWinner,
        string memory chatID,
        uint256 confirmationCount,
        bool executed,
        uint256 submittedAt,
        address submitter
    ) {
        Judgment memory j = judgments[judgmentId];
        return (
            j.challenge,
            j.proposedWinner,
            j.chatID,
            j.confirmations,
            j.executed,
            j.submittedAt,
            j.submitter
        );
    }

    /// @notice Check if an oracle has confirmed a judgment
    function hasConfirmed(uint256 judgmentId, address oracleAddr) external view returns (bool) {
        return judgmentConfirmed[judgmentId][oracleAddr];
    }

    /// @notice Get the number of active oracles
    function getActiveOracleCount() external view returns (uint256) {
        return activeOracleCount;
    }

    receive() external payable {
        revert("Direct ETH not accepted");
    }
}
