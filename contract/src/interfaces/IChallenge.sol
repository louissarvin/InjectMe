// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IChallenge {
    enum ChallengeType {
        TOURNAMENT,
        BOUNTY,
        ALIGNMENT
    }

    event AttemptMade(address indexed attacker, uint256 attemptNumber, uint256 fee, bytes32 storageRoot);
    event ChallengeWon(address indexed attacker, uint256 prize, uint256 attemptNumber, string chatID);
    event ChallengeExpired(address indexed defender, uint256 returnedAmount);

    function defender() external view returns (address);
    function messagePrice() external view returns (uint256);
    function expiresAt() external view returns (uint256);
    function challengeType() external view returns (ChallengeType);
    function prizePool() external view returns (uint256);
    function totalAttempts() external view returns (uint256);
    function active() external view returns (bool);
    function winner() external view returns (address);

    function recordAttempt(address attacker, bytes32 storageRoot) external payable;
    function claimVictory(address winner, string calldata chatID) external;
    function claimExpiry() external;
}
