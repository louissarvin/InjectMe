// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IERC7857.sol";
import "./interfaces/IOracle.sol";

/// @title AgentNFT - ERC-7857 iNFT for AI Agents on InjectMe
contract AgentNFT is ERC721, ERC721Enumerable, Ownable, ReentrancyGuard, IERC7857 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct AgentMetadata {
        address challengeAddress; 
        string model;
        uint256 totalAttempts;
        uint256 attemptsSurvived;
        bool breached;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    uint256 private _nextTokenId;
    address public factory;
    address public oracle;          // TeeOracle contract for ERC-7857 proof verification
    address public backendOracle;   // Backend wallet for stats updates

    mapping(uint256 => bytes32) private _metadataHashes;
    mapping(uint256 => string) private _encryptedURIs;
    mapping(uint256 => bytes) private _sealedKeys;
    mapping(uint256 => mapping(uint256 => mapping(address => bytes))) private _authorizations;
    mapping(uint256 => uint256) private _authGenerations;
    mapping(bytes32 => bool) public usedProofs;
    mapping(uint256 => AgentMetadata) public agents;
    mapping(address => uint256) public challengeToToken;
    mapping(uint256 => bytes32[]) public attestationHashes;

    event AgentMinted(uint256 indexed tokenId, address indexed defender, address indexed challenge, string model);
    event AgentStatsUpdated(uint256 indexed tokenId, uint256 totalAttempts, uint256 attemptsSurvived);
    event AgentBreached(uint256 indexed tokenId, address indexed challenge, uint256 attemptsBeforeBreach);
    event AgentSurvived(uint256 indexed tokenId, address indexed challenge, uint256 totalAttemptsSurvived);
    event MetadataUpdated(uint256 indexed tokenId, bytes32 newHash);
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor);
    event UsageRevoked(uint256 indexed tokenId, address indexed executor);
    event AttestationAnchored(uint256 indexed tokenId, bytes32 attestationHash);
    event AgentCloned(uint256 indexed originalTokenId, uint256 indexed newTokenId, address indexed to);
    event OracleUpdated(address oldOracle, address newOracle);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    modifier onlyBackendOracle() {
        require(msg.sender == backendOracle, "Only backend oracle");
        _;
    }

    /// @notice ERC-7857: validate TEE proof via on-chain TeeOracle contract
    /// @dev Proof format: [0:32] metadataHash + [32:97] TEE signature (65 bytes)
    ///      The TeeOracle contract verifies the signature came from a registered TEE signer.
    ///      This ensures metadata re-encryption was performed inside a hardware enclave.
    modifier validProof(bytes calldata proof) {
        require(oracle != address(0), "Oracle not set");
        require(proof.length >= 97, "Proof too short");

        // Replay protection
        bytes32 proofHash = keccak256(proof);
        require(!usedProofs[proofHash], "Proof already used");
        usedProofs[proofHash] = true;

        // Verify proof via TeeOracle (checks TEE signer registration + signature)
        require(IOracle(oracle).verifyProof(proof), "TEE proof invalid");
        _;
    }

    constructor(address _teeOracle) ERC721("InjectMe Agent", "AGENT") Ownable(msg.sender) {
        require(_teeOracle != address(0), "Invalid TEE oracle");
        oracle = _teeOracle;       // TeeOracle contract for proof verification
        backendOracle = msg.sender; // Deployer is initial backend oracle
        _nextTokenId = 1;
    }

    /// @notice Set the factory address (called once after deployment)
    function setFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Invalid factory");
        require(factory == address(0), "Factory already set");
        factory = _factory;
    }

    /// @notice Mint an iNFT for a new AI agent when a challenge is created
    function mintAgent(
        address defender,
        address challengeAddress,
        bytes32 metadataHash,
        string calldata encryptedURI,
        string calldata model
    ) external onlyFactory returns (uint256) {
        uint256 tokenId = _nextTokenId++;

        _metadataHashes[tokenId] = metadataHash;
        _encryptedURIs[tokenId] = encryptedURI;

        agents[tokenId] = AgentMetadata({
            challengeAddress: challengeAddress,
            model: model,
            totalAttempts: 0,
            attemptsSurvived: 0,
            breached: false,
            createdAt: block.timestamp,
            resolvedAt: 0
        });

        challengeToToken[challengeAddress] = tokenId;

        _safeMint(defender, tokenId);

        emit AgentMinted(tokenId, defender, challengeAddress, model);
        return tokenId;
    }

    /// @notice Transfer with TEE re-encryption of encrypted metadata
    function transfer(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external override nonReentrant validProof(proof) {
        require(ownerOf(tokenId) == from, "Not owner");
        require(to != address(0), "Invalid recipient");
        require(
            from == msg.sender || isApprovedForAll(from, msg.sender) || getApproved(tokenId) == msg.sender,
            "Not authorized"
        );

        bytes32 newHash = bytes32(proof[0:32]);
        _metadataHashes[tokenId] = newHash;
        _sealedKeys[tokenId] = sealedKey;

        _transfer(from, to, tokenId);

        emit MetadataUpdated(tokenId, newHash);
    }

    /// @notice Clone an agent (create copy with re-encrypted metadata)
    function clone(
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external override nonReentrant validProof(proof) returns (uint256 newTokenId) {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(to != address(0), "Invalid recipient");

        newTokenId = _nextTokenId++;

        bytes32 newHash = bytes32(proof[0:32]);
        _metadataHashes[newTokenId] = newHash;
        _sealedKeys[newTokenId] = sealedKey;

        AgentMetadata memory original = agents[tokenId];
        agents[newTokenId] = AgentMetadata({
            challengeAddress: address(0), 
            model: original.model,
            totalAttempts: 0,
            attemptsSurvived: 0,
            breached: false,
            createdAt: block.timestamp,
            resolvedAt: 0
        });

        _safeMint(to, newTokenId);

        emit AgentCloned(tokenId, newTokenId, to);
        return newTokenId;
    }

    /// @notice Link an existing agent (e.g. clone) to a new challenge contract
    /// @dev Only callable by the backend oracle. Sets both the agent's challengeAddress
    ///      and the reverse mapping challengeToToken. This allows cloned agents to be
    ///      deployed into challenges and have their stats tracked.
    /// @param tokenId The agent token to link
    /// @param challengeAddress The challenge contract address to link to
    function linkAgentToChallenge(uint256 tokenId, address challengeAddress) external onlyBackendOracle {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token");
        require(challengeAddress != address(0), "Invalid challenge");
        require(agents[tokenId].challengeAddress == address(0), "Already linked");

        agents[tokenId].challengeAddress = challengeAddress;
        challengeToToken[challengeAddress] = tokenId;

        emit AgentStatsUpdated(tokenId, agents[tokenId].totalAttempts, agents[tokenId].attemptsSurvived);
    }

    /// @notice Grant execution rights to another address
    function authorizeUsage(
        uint256 tokenId,
        address executor,
        bytes calldata permissions
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(executor != address(0), "Invalid executor");

        uint256 gen = _authGenerations[tokenId];
        _authorizations[tokenId][gen][executor] = permissions;
        emit UsageAuthorized(tokenId, executor);
    }

    /// @notice Revoke usage authorization
    function revokeUsage(uint256 tokenId, address executor) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        uint256 gen = _authGenerations[tokenId];
        delete _authorizations[tokenId][gen][executor];
        emit UsageRevoked(tokenId, executor);
    }

    /// @notice Check if an address has usage authorization (current generation only)
    function isAuthorized(uint256 tokenId, address executor) external view returns (bool) {
        uint256 gen = _authGenerations[tokenId];
        return _authorizations[tokenId][gen][executor].length > 0;
    }

    /// @notice Get authorization permissions for an executor
    function getAuthorization(uint256 tokenId, address executor) external view returns (bytes memory) {
        uint256 gen = _authGenerations[tokenId];
        return _authorizations[tokenId][gen][executor];
    }

    /// @notice Update agent stats after an attack attempt
    function updateStats(address challengeAddress, uint256 newTotalAttempts, uint256 newSurvived) external onlyBackendOracle {
        uint256 tokenId = challengeToToken[challengeAddress];
        require(tokenId != 0, "No agent for challenge");

        agents[tokenId].totalAttempts = newTotalAttempts;
        agents[tokenId].attemptsSurvived = newSurvived;

        emit AgentStatsUpdated(tokenId, newTotalAttempts, newSurvived);
    }

    /// @notice Mark agent as breached (challenge was won by attacker)
    function markBreached(address challengeAddress, uint256 attemptsBeforeBreach) external onlyBackendOracle {
        uint256 tokenId = challengeToToken[challengeAddress];
        require(tokenId != 0, "No agent for challenge");
        require(!agents[tokenId].breached, "Already breached");

        agents[tokenId].breached = true;
        if (agents[tokenId].totalAttempts < attemptsBeforeBreach) {
            agents[tokenId].totalAttempts = attemptsBeforeBreach;
        }
        agents[tokenId].resolvedAt = block.timestamp;

        emit AgentBreached(tokenId, challengeAddress, attemptsBeforeBreach);
    }

    /// @notice Mark agent as survived (challenge expired without breach)
    function markSurvived(address challengeAddress, uint256 totalSurvived) external onlyBackendOracle {
        uint256 tokenId = challengeToToken[challengeAddress];
        require(tokenId != 0, "No agent for challenge");

        agents[tokenId].attemptsSurvived = totalSurvived;
        agents[tokenId].resolvedAt = block.timestamp;

        emit AgentSurvived(tokenId, challengeAddress, totalSurvived);
    }

    /// @notice Anchor a TEE attestation hash to the agent
    function anchorAttestation(address challengeAddress, bytes32 attestationHash) external onlyBackendOracle {
        uint256 tokenId = challengeToToken[challengeAddress];
        require(tokenId != 0, "No agent for challenge");

        attestationHashes[tokenId].push(attestationHash);
        emit AttestationAnchored(tokenId, attestationHash);
    }

    /// @notice Update encrypted metadata hash and URI (oracle only, M-2 fix)
    function updateMetadata(uint256 tokenId, bytes32 newHash, string calldata newURI) external onlyBackendOracle {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token");
        _metadataHashes[tokenId] = newHash;
        _encryptedURIs[tokenId] = newURI;
        emit MetadataUpdated(tokenId, newHash);
    }

    /// @notice Get the encrypted metadata hash
    function getMetadataHash(uint256 tokenId) external view returns (bytes32) {
        return _metadataHashes[tokenId];
    }

    /// @notice Get the encrypted URI (0G Storage location)
    function getEncryptedURI(uint256 tokenId) external view returns (string memory) {
        return _encryptedURIs[tokenId];
    }

    /// @notice Get the sealed key for current owner
    function getSealedKey(uint256 tokenId) external view returns (bytes memory) {
        return _sealedKeys[tokenId];
    }

    /// @notice Update the TeeOracle contract address
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    /// @notice Update the backend oracle address (for stats updates)
    function setBackendOracle(address _backendOracle) external onlyOwner {
        require(_backendOracle != address(0), "Invalid backend oracle");
        backendOracle = _backendOracle;
    }

    /// @notice Get full agent metadata
    function getAgent(uint256 tokenId) external view returns (AgentMetadata memory) {
        require(tokenId > 0 && tokenId < _nextTokenId, "Invalid token");
        return agents[tokenId];
    }

    /// @notice Get agent's security score (basis points, 10000 = 100% survival)
    function getSecurityScore(uint256 tokenId) external view returns (uint256) {
        AgentMetadata memory agent = agents[tokenId];
        if (agent.totalAttempts == 0) return 10000;
        return (agent.attemptsSurvived * 10000) / agent.totalAttempts;
    }

    function getAttestationCount(uint256 tokenId) external view returns (uint256) {
        return attestationHashes[tokenId].length;
    }

    function getTokenForChallenge(address challengeAddress) external view returns (uint256) {
        return challengeToToken[challengeAddress];
    }

    function isActive(uint256 tokenId) external view returns (bool) {
        return agents[tokenId].challengeAddress != address(0)
            && agents[tokenId].resolvedAt == 0
            && agents[tokenId].createdAt > 0;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            _authGenerations[tokenId]++;
        }
        return from;
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721Enumerable, IERC165) returns (bool) {
        return interfaceId == type(IERC7857).interfaceId || super.supportsInterface(interfaceId);
    }
}
