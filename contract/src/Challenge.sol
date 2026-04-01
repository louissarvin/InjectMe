// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IChallenge.sol";

/// @title Challenge - Individual AI challenge escrow and game logic
/// @notice Supports commit-reveal scheme for MEV-resistant attack submissions.
///         Attacker commits hash first (proves priority), then reveals message to oracle.
contract Challenge is IChallenge, ReentrancyGuard, Pausable {
    uint256 public constant POOL_BPS = 8000;
    uint256 public constant DEFENDER_BPS = 1000;
    uint256 public constant VICTORY_GRACE_PERIOD = 1 hours;

    /// @notice Commit-reveal: reveal must happen within this window after commit
    uint256 public constant COMMIT_REVEAL_WINDOW = 5 minutes;

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
        bytes32 commitHash; // keccak256(abi.encodePacked(message, salt, attacker))
        uint256 timestamp; // When the commit was made
        bool revealed; // Whether this commit has been revealed
    }

    /// @notice Active commit per attacker (one at a time)
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

    constructor(
        address _defender,
        address _feeCollector,
        address _oracle,
        uint256 _messagePrice,
        uint256 _duration,
        bytes32 _secretHash,
        uint256 _protocolFeeBps,
        ChallengeType _challengeType,
        uint256 _rewardPerAttempt
    ) payable {
        require(_defender != address(0), "Invalid defender");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_oracle != address(0), "Invalid oracle");
        require(_duration >= 1 hours, "Duration too short");
        require(_duration <= 90 days, "Duration too long");
        require(_protocolFeeBps <= 3000, "Protocol fee too high");

        defender = _defender;
        feeCollector = _feeCollector;
        oracle = _oracle;
        prizePool = msg.value;
        messagePrice = _messagePrice;
        expiresAt = block.timestamp + _duration;
        secretHash = _secretHash;
        protocolFeeBps = _protocolFeeBps;
        challengeType = _challengeType;
        rewardPerAttempt = _rewardPerAttempt;
        factory = msg.sender;
        active = true;
    }

    // ============================================================
    //          COMMIT-REVEAL: ANTI-FRONT-RUNNING
    // ============================================================

    /// @notice Phase 1: Attacker commits a hash of their message (pays fee for tournaments)
    /// @dev The commit proves the attacker had the message at this timestamp.
    ///      Nobody can see the actual message until reveal.
    ///      commitHash = keccak256(abi.encodePacked(message, salt, attacker))
    /// @param commitHash The hash commitment
    function commitAttempt(bytes32 commitHash) external payable nonReentrant whenActive whenNotPaused {
        require(commitHash != bytes32(0), "Empty commit");

        // For tournaments, attacker pays the message fee at commit time (locked with the commit)
        if (challengeType == ChallengeType.TOURNAMENT) {
            require(msg.value == messagePrice, "Incorrect fee");
        } else {
            // BOUNTY and ALIGNMENT: no fee from attacker
            require(msg.value == 0, "No fee required");
        }

        // ALIGNMENT: check pool has enough to pay the reward
        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
        }

        // Check if attacker has an active unrevealed commit
        Commit storage existing = commits[msg.sender];
        if (existing.commitHash != bytes32(0) && !existing.revealed) {
            // Old commit expired? Allow overwrite. Otherwise reject.
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

    /// @notice Phase 2: Oracle reveals and records the attempt after TEE evaluation.
    ///         Verifies the revealed message matches the commit hash.
    /// @param attacker The attacker who committed
    /// @param messageHash Hash of the actual message (for commit verification)
    /// @param salt Random salt used in the commit
    /// @param storageRoot 0G Storage Merkle root of the archived attempt
    function revealAndRecord(
        address attacker,
        bytes32 messageHash,
        bytes32 salt,
        bytes32 storageRoot
    ) external nonReentrant whenActive whenNotPaused onlyOracle {
        require(attacker != address(0), "Invalid attacker");

        // Verify commit exists and is valid
        Commit storage commit = commits[attacker];
        require(commit.commitHash != bytes32(0), "No commit found");
        require(!commit.revealed, "Already revealed");
        require(block.timestamp <= commit.timestamp + COMMIT_REVEAL_WINDOW, "Reveal window expired");

        // Verify the reveal matches the commit
        bytes32 expectedHash = keccak256(abi.encodePacked(messageHash, salt, attacker));
        require(expectedHash == commit.commitHash, "Commit hash mismatch");

        // Mark as revealed
        commit.revealed = true;
        emit CommitRevealed(attacker, commit.commitHash);

        // Process the fee (tournament fees were paid at commit time)
        if (challengeType == ChallengeType.TOURNAMENT) {
            _distributeTournamentFee(messagePrice);
        }

        // ALIGNMENT: pay reward from prize pool
        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
            prizePool -= rewardPerAttempt;
            pendingWithdrawals[attacker] += rewardPerAttempt;
            emit AlignmentRewardPaid(attacker, rewardPerAttempt);
        }

        // Record the attempt
        totalAttempts++;
        attackerAttempts[attacker]++;
        attemptStorageRoots[totalAttempts] = storageRoot;

        emit AttemptMade(attacker, totalAttempts, messagePrice, storageRoot);
    }

    /// @notice Legacy direct recording (for bounties or when commit-reveal is bypassed by oracle)
    /// @dev Kept for backward compatibility. Oracle can still directly record if needed.
    function recordAttempt(address attacker, bytes32 storageRoot) external payable override nonReentrant whenActive whenNotPaused {
        require(attacker != address(0), "Invalid attacker");
        require(msg.sender == oracle, "Only oracle");

        if (challengeType == ChallengeType.TOURNAMENT) {
            require(msg.value == messagePrice, "Incorrect fee");
            _distributeTournamentFee(msg.value);
        } else {
            // BOUNTY and ALIGNMENT: no fee from attacker
            require(msg.value == 0, "No fee required");
        }

        // ALIGNMENT: pay reward from prize pool
        if (challengeType == ChallengeType.ALIGNMENT) {
            require(prizePool >= rewardPerAttempt, "Prize pool depleted");
            prizePool -= rewardPerAttempt;
            pendingWithdrawals[attacker] += rewardPerAttempt;
            emit AlignmentRewardPaid(attacker, rewardPerAttempt);
        }

        totalAttempts++;
        attackerAttempts[attacker]++;
        attemptStorageRoots[totalAttempts] = storageRoot;

        emit AttemptMade(attacker, totalAttempts, msg.value, storageRoot);
    }

    /// @notice Publish alignment training data root hash (oracle only, ALIGNMENT challenges)
    /// @param dataRoot Merkle root of the published alignment training data
    /// @param sampleCount Number of samples in this data batch
    function publishAlignmentData(bytes32 dataRoot, uint256 sampleCount) external onlyOracle {
        require(challengeType == ChallengeType.ALIGNMENT, "Not alignment challenge");
        require(dataRoot != bytes32(0), "Invalid data root");
        require(sampleCount > 0, "Invalid sample count");

        alignmentSamples += sampleCount;
        alignmentDataRoots[alignmentSamples] = dataRoot;

        emit AlignmentDataPublished(address(this), dataRoot, alignmentSamples);
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

    /// @notice Withdraw pending balance (pull-over-push pattern)
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "Withdraw failed");
        emit Withdrawal(msg.sender, amount);
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

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getAttemptStorageRoot(uint256 attemptNumber) external view returns (bytes32) {
        return attemptStorageRoots[attemptNumber];
    }

    function getAttackerAttempts(address attacker) external view returns (uint256) {
        return attackerAttempts[attacker];
    }

    /// @notice Get commit details for an attacker
    function getCommit(address attacker) external view returns (bytes32 commitHash, uint256 timestamp, bool revealed) {
        Commit memory c = commits[attacker];
        return (c.commitHash, c.timestamp, c.revealed);
    }

    /// @notice Check if an attacker has a valid (unexpired, unrevealed) commit
    function hasValidCommit(address attacker) external view returns (bool) {
        Commit memory c = commits[attacker];
        return c.commitHash != bytes32(0)
            && !c.revealed
            && block.timestamp <= c.timestamp + COMMIT_REVEAL_WINDOW;
    }

    receive() external payable {
        revert("Direct ETH not accepted");
    }
}
