// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IChallenge.sol";

/// @title ChallengeERC20 - ERC-20 token variant of the Challenge contract
/// @notice Supports ERC-20 prize pools instead of native ETH. Same game logic as Challenge.sol.
/// @dev Uses SafeERC20 for all token interactions to handle non-standard tokens (USDT, etc.)
contract ChallengeERC20 is IChallenge, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @dev Constructor parameters packed into a struct to avoid stack-too-deep
    struct ConstructorParams {
        address token;
        uint256 prizeAmount;
        address defender;
        address feeCollector;
        address oracle;
        uint256 messagePrice;
        uint256 duration;
        bytes32 secretHash;
        uint256 protocolFeeBps;
        ChallengeType challengeType;
        uint256 rewardPerAttempt;
        address factory;
    }

    uint256 public constant POOL_BPS = 8000;
    uint256 public constant DEFENDER_BPS = 1000;
    uint256 public constant VICTORY_GRACE_PERIOD = 1 hours;
    uint256 public constant COMMIT_REVEAL_WINDOW = 5 minutes;

    IERC20 public immutable token;
    address public immutable override defender;
    address public immutable feeCollector;
    address public oracle;
    bytes32 public immutable secretHash;
    uint256 public immutable protocolFeeBps;
    uint256 public immutable override messagePrice;
    uint256 public immutable override expiresAt;
    ChallengeType public immutable override challengeType;
    address public immutable factory;
    uint256 public immutable rewardPerAttempt;

    uint256 public override prizePool;
    uint256 public defenderEarnings;
    uint256 public override totalAttempts;
    bool public override active;
    address public override winner;

    mapping(address => uint256) public pendingWithdrawals;
    mapping(uint256 => bytes32) public attemptStorageRoots;
    mapping(address => uint256) public attackerAttempts;
    mapping(uint256 => bytes32) public alignmentDataRoots;
    uint256 public alignmentSamples;

    // ============================================================
    //        COMMIT-REVEAL STATE (anti-front-running)
    // ============================================================

    struct Commit {
        bytes32 commitHash;
        uint256 timestamp;
        bool revealed;
    }

    mapping(address => Commit) public commits;

    // ============================================================
    //                       EVENTS
    // ============================================================

    event Withdrawal(address indexed to, uint256 amount);
    event AttackCommitted(address indexed attacker, bytes32 commitHash, uint256 timestamp);
    event CommitRevealed(address indexed attacker, bytes32 commitHash);
    event AlignmentDataPublished(address indexed challenge, bytes32 dataRoot, uint256 totalSamples);
    event AlignmentRewardPaid(address indexed attacker, uint256 reward);

    // ============================================================
    //                      MODIFIERS
    // ============================================================

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier whenActive() {
        require(active, "Challenge ended");
        require(block.timestamp < expiresAt, "Challenge expired");
        _;
    }

    // ============================================================
    //                     CONSTRUCTOR
    // ============================================================

    /// @notice Initialize an ERC-20 challenge. Token amount must be transferred separately by factory.
    /// @param p Constructor parameters struct
    constructor(ConstructorParams memory p) {
        require(p.token != address(0), "Invalid token");
        require(p.defender != address(0), "Invalid defender");
        require(p.feeCollector != address(0), "Invalid fee collector");
        require(p.oracle != address(0), "Invalid oracle");
        require(p.duration >= 1 hours, "Duration too short");
        require(p.duration <= 90 days, "Duration too long");
        require(p.protocolFeeBps <= 3000, "Protocol fee too high");

        // Factory defaults to msg.sender if not explicitly provided
        address _factory = p.factory != address(0) ? p.factory : msg.sender;
        require(_factory != address(0), "Invalid factory");

        token = IERC20(p.token);
        prizePool = p.prizeAmount;
        defender = p.defender;
        feeCollector = p.feeCollector;
        oracle = p.oracle;
        messagePrice = p.messagePrice;
        expiresAt = block.timestamp + p.duration;
        secretHash = p.secretHash;
        protocolFeeBps = p.protocolFeeBps;
        challengeType = p.challengeType;
        rewardPerAttempt = p.rewardPerAttempt;
        factory = _factory;
        active = true;
    }

    // ============================================================
    //          COMMIT-REVEAL: ANTI-FRONT-RUNNING
    // ============================================================

    /// @notice Phase 1: Attacker commits a hash of their message
    /// @dev For ERC-20 tournaments, the fee is collected via transferFrom at commit time.
    ///      Attacker must approve this contract for messagePrice before calling.
    /// @param commitHash The hash commitment
    function commitAttempt(bytes32 commitHash) external payable nonReentrant whenActive whenNotPaused {
        require(commitHash != bytes32(0), "Empty commit");
        require(msg.value == 0, "Native ETH not accepted");

        if (challengeType == ChallengeType.TOURNAMENT) {
            // Pull the fee from attacker via transferFrom
            token.safeTransferFrom(msg.sender, address(this), messagePrice);
        }

        // ALIGNMENT: check pool has enough to pay the reward
        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
        }

        Commit storage existing = commits[msg.sender];
        if (existing.commitHash != bytes32(0) && !existing.revealed) {
            require(
                block.timestamp > existing.timestamp + COMMIT_REVEAL_WINDOW,
                "Active commit exists, wait for reveal window to expire"
            );
        }

        commits[msg.sender] = Commit({
            commitHash: commitHash,
            timestamp: block.timestamp,
            revealed: false
        });

        emit AttackCommitted(msg.sender, commitHash, block.timestamp);
    }

    /// @notice Phase 2: Oracle reveals and records the attempt after TEE evaluation
    function revealAndRecord(
        address attacker,
        bytes32 messageHash,
        bytes32 salt,
        bytes32 storageRoot
    ) external nonReentrant whenActive whenNotPaused onlyOracle {
        require(attacker != address(0), "Invalid attacker");

        Commit storage commit = commits[attacker];
        require(commit.commitHash != bytes32(0), "No commit found");
        require(!commit.revealed, "Already revealed");
        require(block.timestamp <= commit.timestamp + COMMIT_REVEAL_WINDOW, "Reveal window expired");

        bytes32 expectedHash = keccak256(abi.encodePacked(messageHash, salt, attacker));
        require(expectedHash == commit.commitHash, "Commit hash mismatch");

        commit.revealed = true;
        emit CommitRevealed(attacker, commit.commitHash);

        if (challengeType == ChallengeType.TOURNAMENT) {
            _distributeTournamentFee(messagePrice);
        }

        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
            prizePool -= rewardPerAttempt;
            pendingWithdrawals[attacker] += rewardPerAttempt;
            emit AlignmentRewardPaid(attacker, rewardPerAttempt);
        }

        totalAttempts++;
        attackerAttempts[attacker]++;
        attemptStorageRoots[totalAttempts] = storageRoot;

        emit AttemptMade(attacker, totalAttempts, messagePrice, storageRoot);
    }

    /// @notice Legacy direct recording by oracle
    function recordAttempt(address attacker, bytes32 storageRoot) external payable override nonReentrant whenActive whenNotPaused {
        require(attacker != address(0), "Invalid attacker");
        require(msg.sender == oracle, "Only oracle");
        require(msg.value == 0, "Native ETH not accepted");

        if (challengeType == ChallengeType.TOURNAMENT) {
            // Oracle transfers the fee on behalf of the attacker
            token.safeTransferFrom(msg.sender, address(this), messagePrice);
            _distributeTournamentFee(messagePrice);
        }

        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
            prizePool -= rewardPerAttempt;
            pendingWithdrawals[attacker] += rewardPerAttempt;
            emit AlignmentRewardPaid(attacker, rewardPerAttempt);
        }

        totalAttempts++;
        attackerAttempts[attacker]++;
        attemptStorageRoots[totalAttempts] = storageRoot;

        emit AttemptMade(attacker, totalAttempts, 0, storageRoot);
    }

    // ============================================================
    //                    CORE LOGIC
    // ============================================================

    /// @notice Oracle calls when TEE-verified judgment determines attacker succeeded
    function claimVictory(address _winner, string calldata chatID) external override nonReentrant onlyOracle {
        require(active, "Challenge ended");
        require(_winner != address(0), "Invalid winner");
        require(block.timestamp < expiresAt + VICTORY_GRACE_PERIOD, "Victory window closed");

        active = false;
        winner = _winner;
        uint256 prize = prizePool;
        uint256 defEarnings = defenderEarnings;
        prizePool = 0;
        defenderEarnings = 0;

        pendingWithdrawals[_winner] += prize;
        if (defEarnings > 0) {
            pendingWithdrawals[defender] += defEarnings;
        }

        emit ChallengeWon(_winner, prize, totalAttempts, chatID);
    }

    /// @notice Defender reclaims funds when challenge expires without being broken
    function claimExpiry() external override nonReentrant {
        require(block.timestamp >= expiresAt, "Not expired");
        require(active, "Already ended");

        active = false;
        uint256 returnAmount = prizePool + defenderEarnings;
        prizePool = 0;
        defenderEarnings = 0;

        pendingWithdrawals[defender] += returnAmount;

        emit ChallengeExpired(defender, returnAmount);
    }

    /// @notice Withdraw pending ERC-20 balance (pull-over-push pattern)
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
    }

    // ============================================================
    //                    ALIGNMENT DATA
    // ============================================================

    /// @notice Publish alignment training data root hash (oracle only, ALIGNMENT challenges)
    function publishAlignmentData(bytes32 dataRoot, uint256 sampleCount) external onlyOracle {
        require(challengeType == ChallengeType.ALIGNMENT, "Not alignment challenge");
        require(dataRoot != bytes32(0), "Invalid data root");
        require(sampleCount > 0, "Invalid sample count");

        alignmentSamples += sampleCount;
        alignmentDataRoots[alignmentSamples] = dataRoot;

        emit AlignmentDataPublished(address(this), dataRoot, alignmentSamples);
    }

    // ============================================================
    //                    INTERNAL
    // ============================================================

    function _distributeTournamentFee(uint256 fee) internal {
        uint256 toPool = (fee * POOL_BPS) / 10000;
        uint256 toDefender = (fee * DEFENDER_BPS) / 10000;
        uint256 toProtocol = (fee * protocolFeeBps) / 10000;

        prizePool += toPool;
        defenderEarnings += toDefender;

        if (toProtocol > 0) {
            pendingWithdrawals[feeCollector] += toProtocol;
        }
    }

    // ============================================================
    //                    ADMIN
    // ============================================================

    function pause() external onlyFactory {
        _pause();
    }

    function unpause() external onlyFactory {
        _unpause();
    }

    function updateOracle(address _newOracle) external onlyFactory {
        require(_newOracle != address(0), "Invalid oracle");
        oracle = _newOracle;
    }

    // ============================================================
    //                    VIEW FUNCTIONS
    // ============================================================

    function timeRemaining() external view returns (uint256) {
        if (block.timestamp >= expiresAt) return 0;
        return expiresAt - block.timestamp;
    }

    function getTokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getAttemptStorageRoot(uint256 attemptNumber) external view returns (bytes32) {
        return attemptStorageRoots[attemptNumber];
    }

    function getAttackerAttempts(address attacker) external view returns (uint256) {
        return attackerAttempts[attacker];
    }

    function getCommit(address attacker) external view returns (bytes32 commitHash, uint256 timestamp, bool revealed) {
        Commit memory c = commits[attacker];
        return (c.commitHash, c.timestamp, c.revealed);
    }

    function hasValidCommit(address attacker) external view returns (bool) {
        Commit memory c = commits[attacker];
        return c.commitHash != bytes32(0)
            && !c.revealed
            && block.timestamp <= c.timestamp + COMMIT_REVEAL_WINDOW;
    }

    /// @notice Reject direct native ETH sends
    receive() external payable {
        revert("Native ETH not accepted");
    }
}
