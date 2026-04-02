// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Challenge.sol";
import "./AgentNFT.sol";
import "./ReputationRegistry.sol";
import "./interfaces/IChallenge.sol";

/// @title ChallengeFactory - Creates and registers InjectMe challenges (native 0G)
/// @notice Main registry for all challenges. ERC-20 challenges are created via ChallengeFactoryERC20
///         and registered back here through registerExternalChallenge().
contract ChallengeFactory is Ownable, ReentrancyGuard {

    address public feeCollector;
    address public oracle;
    AgentNFT public agentNFT;
    ReputationRegistry public reputationRegistry;
    address public oracleStaking;
    address public erc20Factory;

    uint256 public protocolFeeBps = 1000;
    uint256 public bountyListingFee = 0.5 ether;
    uint256 public minPrizePool = 0.1 ether;
    uint256 public minMessagePrice = 0.001 ether;

    address[] public challenges;
    mapping(address => bool) public isChallenge;
    mapping(address => address[]) public defenderChallenges;

    address[] public tournaments;
    address[] public bounties;
    address[] public alignmentChallenges;

    event ChallengeCreated(
        address indexed challenge,
        address indexed creator,
        uint256 prizePool,
        uint256 messagePrice,
        string name,
        string model,
        IChallenge.ChallengeType challengeType
    );
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event ConfigUpdated(string param, uint256 value);
    event AgentNFTMinted(address indexed challenge, address indexed defender, uint256 tokenId);
    event ERC20ChallengeCreated(
        address indexed challenge,
        address indexed creator,
        address indexed token,
        uint256 prizePool,
        IChallenge.ChallengeType challengeType
    );
    event OracleStakingUpdated(address indexed oracleStaking);
    event ERC20FactoryUpdated(address indexed erc20Factory);

    modifier onlyERC20Factory() {
        require(msg.sender == erc20Factory, "Only ERC20 factory");
        _;
    }

    constructor(address _feeCollector, address _oracle) Ownable(msg.sender) {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_oracle != address(0), "Invalid oracle");
        feeCollector = _feeCollector;
        oracle = _oracle;
    }

    // ============================================================
    //              NATIVE CHALLENGE CREATION
    // ============================================================

    /// @notice Create a Platform Tournament (entertainment, fee-funded pool growth)
    /// @param name Human-readable challenge name
    /// @param messagePrice Cost per attack message in wei
    /// @param duration Challenge duration in seconds
    /// @param secretHash Keccak256 hash of the secret the AI guards
    /// @param model The 0G Compute model identifier
    function createTournament(
        string calldata name,
        uint256 messagePrice,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(msg.value >= minPrizePool, "Prize pool too small");
        require(messagePrice >= minMessagePrice, "Message price too low");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        Challenge challenge = new Challenge{value: msg.value}(
            msg.sender,
            feeCollector,
            oracle,
            messagePrice,
            duration,
            secretHash,
            protocolFeeBps,
            IChallenge.ChallengeType.TOURNAMENT,
            0
        );

        address addr = address(challenge);
        _register(addr, msg.sender);
        tournaments.push(addr);

        _mintAgentNFT(msg.sender, addr, secretHash, "", model);
        _recordDefenderCreated(msg.sender, addr, msg.value);

        emit ChallengeCreated(addr, msg.sender, msg.value, messagePrice, name, model, IChallenge.ChallengeType.TOURNAMENT);
        return addr;
    }

    /// @notice Create an Agent Bounty (security testing, developer-funded)
    /// @param name Human-readable bounty name
    /// @param duration Bounty duration in seconds
    /// @param secretHash Keccak256 hash of the system prompt
    /// @param model The 0G Compute model identifier
    function createBounty(
        string calldata name,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(msg.value > bountyListingFee, "Must cover bounty + listing fee");
        uint256 bountyAmount = msg.value - bountyListingFee;
        require(bountyAmount >= minPrizePool, "Bounty too small");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        (bool sent,) = feeCollector.call{value: bountyListingFee}("");
        require(sent, "Listing fee transfer failed");

        Challenge challenge = new Challenge{value: bountyAmount}(
            msg.sender,
            feeCollector,
            oracle,
            0,
            duration,
            secretHash,
            0,
            IChallenge.ChallengeType.BOUNTY,
            0
        );

        address addr = address(challenge);
        _register(addr, msg.sender);
        bounties.push(addr);

        _mintAgentNFT(msg.sender, addr, secretHash, "", model);
        _recordDefenderCreated(msg.sender, addr, bountyAmount);

        emit ChallengeCreated(addr, msg.sender, bountyAmount, 0, name, model, IChallenge.ChallengeType.BOUNTY);
        return addr;
    }

    /// @notice Create an Alignment Bounty (AI alignment data collection, reward per attempt)
    /// @param name Human-readable alignment challenge name
    /// @param rewardPerAttempt Amount paid from prize pool to each attacker per attempt
    /// @param duration Challenge duration in seconds
    /// @param secretHash Keccak256 hash of the system prompt
    /// @param model The 0G Compute model identifier
    function createAlignment(
        string calldata name,
        uint256 rewardPerAttempt,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(msg.value >= minPrizePool, "Prize pool too small");
        require(rewardPerAttempt > 0, "Reward must be > 0");
        require(rewardPerAttempt <= msg.value, "Reward exceeds prize pool");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        Challenge challenge = new Challenge{value: msg.value}(
            msg.sender,
            feeCollector,
            oracle,
            0,
            duration,
            secretHash,
            0,
            IChallenge.ChallengeType.ALIGNMENT,
            rewardPerAttempt
        );

        address addr = address(challenge);
        _register(addr, msg.sender);
        alignmentChallenges.push(addr);

        _mintAgentNFT(msg.sender, addr, secretHash, "", model);
        _recordDefenderCreated(msg.sender, addr, msg.value);

        emit ChallengeCreated(addr, msg.sender, msg.value, 0, name, model, IChallenge.ChallengeType.ALIGNMENT);
        return addr;
    }

    // ============================================================
    //        EXTERNAL CHALLENGE REGISTRATION (ERC-20 factory)
    // ============================================================

    /// @dev Parameters for registering an external (ERC-20) challenge
    struct ExternalChallengeParams {
        address challenge;
        IChallenge.ChallengeType challengeType;
        address defender;
        bytes32 secretHash;
        string model;
        address tokenAddr;
        uint256 prizeAmount;
    }

    /// @notice Register an ERC-20 challenge created by the authorized ERC20 factory
    /// @dev Called by ChallengeFactoryERC20 after deploying a ChallengeERC20 contract
    /// @param p Struct containing all registration parameters
    function registerExternalChallenge(ExternalChallengeParams calldata p) external onlyERC20Factory {
        require(p.challenge != address(0), "Invalid challenge");
        require(!isChallenge[p.challenge], "Already registered");

        _register(p.challenge, p.defender);

        if (p.challengeType == IChallenge.ChallengeType.TOURNAMENT) {
            tournaments.push(p.challenge);
        } else if (p.challengeType == IChallenge.ChallengeType.BOUNTY) {
            bounties.push(p.challenge);
        } else {
            alignmentChallenges.push(p.challenge);
        }

        _mintAgentNFT(p.defender, p.challenge, p.secretHash, "", p.model);
        _recordDefenderCreated(p.defender, p.challenge, p.prizeAmount);

        emit ERC20ChallengeCreated(p.challenge, p.defender, p.tokenAddr, p.prizeAmount, p.challengeType);
    }

    // ============================================================
    //                    INTERNAL
    // ============================================================

    function _register(address challenge, address creator) internal {
        challenges.push(challenge);
        isChallenge[challenge] = true;
        defenderChallenges[creator].push(challenge);
    }

    /// @dev Record defender reputation if ReputationRegistry is configured
    function _recordDefenderCreated(address defender, address challenge, uint256 prize) internal {
        if (address(reputationRegistry) != address(0)) {
            reputationRegistry.recordDefenderCreated(defender, challenge, prize);
        }
    }

    /// @dev Mint iNFT if AgentNFT contract is configured
    function _mintAgentNFT(
        address defender,
        address challengeAddress,
        bytes32 metadataHash,
        string memory encryptedURI,
        string calldata model
    ) internal {
        if (address(agentNFT) != address(0)) {
            uint256 tokenId = agentNFT.mintAgent(defender, challengeAddress, metadataHash, encryptedURI, model);
            emit AgentNFTMinted(challengeAddress, defender, tokenId);
        }
    }

    // ============================================================
    //                    ADMIN FUNCTIONS
    // ============================================================

    /// @notice Update oracle for factory AND all existing challenges (H-3 fix)
    /// @dev Rotates oracle key across all live challenges to prevent compromised key exploit
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;

        for (uint256 i = 0; i < challenges.length; i++) {
            Challenge(payable(challenges[i])).updateOracle(_oracle);
        }
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid fee collector");
        emit FeeCollectorUpdated(feeCollector, _feeCollector);
        feeCollector = _feeCollector;
    }

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 3000, "Fee too high");
        protocolFeeBps = _bps;
        emit ConfigUpdated("protocolFeeBps", _bps);
    }

    function setBountyListingFee(uint256 _fee) external onlyOwner {
        bountyListingFee = _fee;
        emit ConfigUpdated("bountyListingFee", _fee);
    }

    function setMinPrizePool(uint256 _min) external onlyOwner {
        minPrizePool = _min;
        emit ConfigUpdated("minPrizePool", _min);
    }

    function setMinMessagePrice(uint256 _min) external onlyOwner {
        minMessagePrice = _min;
        emit ConfigUpdated("minMessagePrice", _min);
    }

    function setAgentNFT(address _agentNFT) external onlyOwner {
        require(_agentNFT != address(0), "Invalid AgentNFT");
        require(address(agentNFT) == address(0), "AgentNFT already set");
        agentNFT = AgentNFT(_agentNFT);
    }

    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        require(_reputationRegistry != address(0), "Invalid ReputationRegistry");
        require(address(reputationRegistry) == address(0), "ReputationRegistry already set");
        reputationRegistry = ReputationRegistry(_reputationRegistry);
    }

    /// @notice Set the OracleStaking contract (one-time set)
    function setOracleStaking(address _oracleStaking) external onlyOwner {
        require(_oracleStaking != address(0), "Invalid OracleStaking");
        require(oracleStaking == address(0), "OracleStaking already set");
        oracleStaking = _oracleStaking;
        emit OracleStakingUpdated(_oracleStaking);
    }

    /// @notice Set the ERC20 companion factory (one-time set)
    /// @param _erc20Factory The ChallengeFactoryERC20 contract address
    function setERC20Factory(address _erc20Factory) external onlyOwner {
        require(_erc20Factory != address(0), "Invalid ERC20 factory");
        require(erc20Factory == address(0), "ERC20 factory already set");
        erc20Factory = _erc20Factory;
        emit ERC20FactoryUpdated(_erc20Factory);
    }

    /// @notice Get the active oracle address
    function getOracle() external view returns (address) {
        return oracle;
    }

    /// @notice Emergency pause a specific challenge
    function pauseChallenge(address challenge) external onlyOwner {
        require(isChallenge[challenge], "Not a challenge");
        Challenge(payable(challenge)).pause();
    }

    function unpauseChallenge(address challenge) external onlyOwner {
        require(isChallenge[challenge], "Not a challenge");
        Challenge(payable(challenge)).unpause();
    }

    // ============================================================
    //                    VIEW FUNCTIONS
    // ============================================================

    function getChallengeCount() external view returns (uint256) {
        return challenges.length;
    }

    function getTournamentCount() external view returns (uint256) {
        return tournaments.length;
    }

    function getBountyCount() external view returns (uint256) {
        return bounties.length;
    }

    function getAlignmentCount() external view returns (uint256) {
        return alignmentChallenges.length;
    }

    function getDefenderChallenges(address defender) external view returns (address[] memory) {
        return defenderChallenges[defender];
    }

    /// @notice Get paginated challenges to avoid gas issues with large arrays
    /// @param offset Start index
    /// @param limit Max number of results
    function getChallengesPaginated(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = challenges.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = challenges[offset + i];
        }
        return result;
    }

    /// @notice Get active challenges (limited to avoid gas issues)
    /// @param maxResults Maximum number of active challenges to return
    function getActiveChallenges(uint256 maxResults) external view returns (address[] memory) {
        uint256 total = challenges.length;
        address[] memory temp = new address[](total);
        uint256 count = 0;

        for (uint256 i = 0; i < total && count < maxResults; i++) {
            if (Challenge(payable(challenges[i])).active()) {
                temp[count++] = challenges[i];
            }
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }
        return result;
    }
}
