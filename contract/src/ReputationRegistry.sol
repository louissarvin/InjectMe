// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReputationRegistry - On-chain reputation tracking for InjectMe attackers and defenders
/// @notice Tracks cumulative stats and computes reputation scores in basis points (BPS).
///         Only authorized callers (oracle backend, factory) can write. Anyone can read.
/// @dev Scores are computed on-chain using BPS (10000 = 100%). No division-by-zero risk:
///      all score functions return 10000 (perfect) when denominators are zero.
contract ReputationRegistry is Ownable, ReentrancyGuard {
    // ============================================================
    //                       STRUCTS
    // ============================================================

    struct AttackerReputation {
        uint256 totalAttempts;
        uint256 successfulBreaches;
        uint256 challengesParticipated;
        uint256 totalEarnings;
        uint256 lastActiveAt;
    }

    struct DefenderReputation {
        uint256 totalChallengesCreated;
        uint256 challengesSurvived;
        uint256 challengesBreached;
        uint256 totalPrizeDefended;
        uint256 totalPrizeLost;
        uint256 lastActiveAt;
    }

    // ============================================================
    //                       STATE
    // ============================================================

    address public oracle;
    address public factory;

    mapping(address => AttackerReputation) private _attackerReps;
    mapping(address => DefenderReputation) private _defenderReps;

    /// @notice Track which challenges an attacker has participated in (for dedup)
    mapping(address => mapping(address => bool)) public attackerChallengeParticipation;

    // ============================================================
    //                       EVENTS
    // ============================================================

    event AttackerAttemptRecorded(address indexed attacker, address indexed challenge);
    event AttackerVictoryRecorded(address indexed attacker, address indexed challenge, uint256 prize);
    event DefenderCreatedRecorded(address indexed defender, address indexed challenge, uint256 prize);
    event DefenderSurvivedRecorded(address indexed defender, address indexed challenge, uint256 prizeDefended);
    event DefenderBreachedRecorded(address indexed defender, address indexed challenge, uint256 prizeLost);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event FactoryUpdated(address indexed oldFactory, address indexed newFactory);

    // ============================================================
    //                      MODIFIERS
    // ============================================================

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyOracleOrFactory() {
        require(msg.sender == oracle || msg.sender == factory, "Only oracle or factory");
        _;
    }

    // ============================================================
    //                     CONSTRUCTOR
    // ============================================================

    /// @param _oracle Backend oracle address that submits reputation updates
    constructor(address _oracle) Ownable(msg.sender) {
        require(_oracle != address(0), "Invalid oracle");
        oracle = _oracle;
    }

    // ============================================================
    //                  ADMIN FUNCTIONS
    // ============================================================

    /// @notice Set the factory address (one-time, same pattern as AgentNFT.setFactory)
    /// @param _factory The ChallengeFactory contract address
    function setFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Invalid factory");
        require(factory == address(0), "Factory already set");
        factory = _factory;
        emit FactoryUpdated(address(0), _factory);
    }

    /// @notice Update the oracle address
    /// @param _oracle New oracle address
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    // ============================================================
    //              ATTACKER REPUTATION UPDATES
    // ============================================================

    /// @notice Record an attacker's attempt on a challenge
    /// @param attacker The attacker address
    /// @param challenge The challenge contract address
    function recordAttackerAttempt(address attacker, address challenge) external nonReentrant onlyOracle {
        require(attacker != address(0), "Invalid attacker");
        require(challenge != address(0), "Invalid challenge");

        AttackerReputation storage rep = _attackerReps[attacker];
        rep.totalAttempts++;
        rep.lastActiveAt = block.timestamp;

        // Track unique challenge participation
        if (!attackerChallengeParticipation[attacker][challenge]) {
            attackerChallengeParticipation[attacker][challenge] = true;
            rep.challengesParticipated++;
        }

        emit AttackerAttemptRecorded(attacker, challenge);
    }

    /// @notice Record an attacker's successful breach of a challenge
    /// @param attacker The attacker address
    /// @param challenge The challenge contract address
    /// @param prize The prize amount won
    function recordAttackerVictory(address attacker, address challenge, uint256 prize) external nonReentrant onlyOracle {
        require(attacker != address(0), "Invalid attacker");
        require(challenge != address(0), "Invalid challenge");

        AttackerReputation storage rep = _attackerReps[attacker];
        rep.successfulBreaches++;
        rep.totalEarnings += prize;
        rep.lastActiveAt = block.timestamp;

        // Also count participation if not already tracked
        if (!attackerChallengeParticipation[attacker][challenge]) {
            attackerChallengeParticipation[attacker][challenge] = true;
            rep.challengesParticipated++;
        }

        emit AttackerVictoryRecorded(attacker, challenge, prize);
    }

    // ============================================================
    //              DEFENDER REPUTATION UPDATES
    // ============================================================

    /// @notice Record a defender creating a new challenge
    /// @param defender The defender address
    /// @param challenge The challenge contract address
    /// @param prize The initial prize pool amount
    function recordDefenderCreated(
        address defender,
        address challenge,
        uint256 prize
    ) external nonReentrant onlyOracleOrFactory {
        require(defender != address(0), "Invalid defender");
        require(challenge != address(0), "Invalid challenge");

        DefenderReputation storage rep = _defenderReps[defender];
        rep.totalChallengesCreated++;
        rep.lastActiveAt = block.timestamp;

        // Prize defended starts as full amount (reduced if breached)
        rep.totalPrizeDefended += prize;

        emit DefenderCreatedRecorded(defender, challenge, prize);
    }

    /// @notice Record a defender's challenge surviving (expired without breach)
    /// @param defender The defender address
    /// @param challenge The challenge contract address
    /// @param prizeDefended The total prize that was defended
    function recordDefenderSurvived(
        address defender,
        address challenge,
        uint256 prizeDefended
    ) external nonReentrant onlyOracle {
        require(defender != address(0), "Invalid defender");
        require(challenge != address(0), "Invalid challenge");

        DefenderReputation storage rep = _defenderReps[defender];
        rep.challengesSurvived++;
        rep.lastActiveAt = block.timestamp;

        // Update defended total to reflect final prize (may have grown from fees)
        // Subtract original and add final to handle prize pool growth
        rep.totalPrizeDefended += prizeDefended;

        emit DefenderSurvivedRecorded(defender, challenge, prizeDefended);
    }

    /// @notice Record a defender's challenge being breached
    /// @param defender The defender address
    /// @param challenge The challenge contract address
    /// @param prizeLost The prize amount lost to the attacker
    function recordDefenderBreached(
        address defender,
        address challenge,
        uint256 prizeLost
    ) external nonReentrant onlyOracle {
        require(defender != address(0), "Invalid defender");
        require(challenge != address(0), "Invalid challenge");

        DefenderReputation storage rep = _defenderReps[defender];
        rep.challengesBreached++;
        rep.totalPrizeLost += prizeLost;
        rep.lastActiveAt = block.timestamp;

        emit DefenderBreachedRecorded(defender, challenge, prizeLost);
    }

    // ============================================================
    //              BATCH OPERATIONS (gas efficiency)
    // ============================================================

    /// @notice Batch record multiple attacker attempts in one transaction
    /// @param attackers Array of attacker addresses
    /// @param challengeAddrs Array of challenge addresses (parallel with attackers)
    function batchRecordAttackerAttempts(
        address[] calldata attackers,
        address[] calldata challengeAddrs
    ) external nonReentrant onlyOracle {
        require(attackers.length == challengeAddrs.length, "Array length mismatch");
        require(attackers.length > 0, "Empty batch");
        require(attackers.length <= 50, "Batch too large");

        for (uint256 i = 0; i < attackers.length; i++) {
            require(attackers[i] != address(0), "Invalid attacker");
            require(challengeAddrs[i] != address(0), "Invalid challenge");

            AttackerReputation storage rep = _attackerReps[attackers[i]];
            rep.totalAttempts++;
            rep.lastActiveAt = block.timestamp;

            if (!attackerChallengeParticipation[attackers[i]][challengeAddrs[i]]) {
                attackerChallengeParticipation[attackers[i]][challengeAddrs[i]] = true;
                rep.challengesParticipated++;
            }

            emit AttackerAttemptRecorded(attackers[i], challengeAddrs[i]);
        }
    }

    // ============================================================
    //              SCORE COMPUTATION (VIEW)
    // ============================================================

    /// @notice Get attacker reputation score in BPS (10000 = 100%)
    /// @dev Score = (successfulBreaches * 10000) / challengesParticipated
    ///      Measures breach rate across unique challenges participated in.
    ///      Returns 0 if no challenges participated (no track record).
    /// @param attacker The attacker address
    /// @return score Reputation score in basis points
    function getAttackerScore(address attacker) external view returns (uint256 score) {
        AttackerReputation memory rep = _attackerReps[attacker];
        if (rep.challengesParticipated == 0) return 0;
        // Rounding: floors toward zero (conservative for attacker)
        score = (rep.successfulBreaches * 10000) / rep.challengesParticipated;
    }

    /// @notice Get defender reputation score in BPS (10000 = 100%)
    /// @dev Score = (challengesSurvived * 10000) / totalResolved
    ///      Where totalResolved = challengesSurvived + challengesBreached.
    ///      Returns 10000 if no resolved challenges (benefit of doubt to defender).
    /// @param defender The defender address
    /// @return score Reputation score in basis points
    function getDefenderScore(address defender) external view returns (uint256 score) {
        DefenderReputation memory rep = _defenderReps[defender];
        uint256 totalResolved = rep.challengesSurvived + rep.challengesBreached;
        if (totalResolved == 0) return 10000;
        // Rounding: floors toward zero (conservative for defender)
        score = (rep.challengesSurvived * 10000) / totalResolved;
    }

    // ============================================================
    //              VIEW FUNCTIONS
    // ============================================================

    /// @notice Get full attacker reputation struct
    /// @param attacker The attacker address
    /// @return The AttackerReputation struct
    function getAttackerReputation(address attacker) external view returns (AttackerReputation memory) {
        return _attackerReps[attacker];
    }

    /// @notice Get full defender reputation struct
    /// @param defender The defender address
    /// @return The DefenderReputation struct
    function getDefenderReputation(address defender) external view returns (DefenderReputation memory) {
        return _defenderReps[defender];
    }

    /// @notice Check if an attacker has participated in a specific challenge
    /// @param attacker The attacker address
    /// @param challenge The challenge address
    /// @return True if the attacker participated
    function hasParticipated(address attacker, address challenge) external view returns (bool) {
        return attackerChallengeParticipation[attacker][challenge];
    }
}
