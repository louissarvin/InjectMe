// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IOracle.sol";

/// @title TeeOracle - On-chain TEE attestation verifier for ERC-7857 iNFT
contract TeeOracle is IOracle, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public signerCount;
    uint256 public constant MAX_SIGNERS = 50;
    address public backendOracle;

    mapping(address => bool) public teeSigner;
    mapping(bytes32 => bool) public usedProofHashes;

    event TeeSignerAdded(address indexed signer);
    event TeeSignerRemoved(address indexed signer);
    event BackendOracleUpdated(address indexed oldOracle, address indexed newOracle);
    event ProofVerified(address indexed signer, bytes32 metadataHash);

    constructor(address _backendOracle) Ownable(msg.sender) {
        require(_backendOracle != address(0), "Invalid backend oracle");
        backendOracle = _backendOracle;
    }

    function addTeeSigner(address signer) external {
        require(msg.sender == backendOracle || msg.sender == owner(), "Not authorized");
        require(signer != address(0), "Invalid signer");
        require(!teeSigner[signer], "Already registered");
        require(signerCount < MAX_SIGNERS, "Max signers reached"); 

        teeSigner[signer] = true;
        signerCount++;

        emit TeeSignerAdded(signer);
    }

    function removeTeeSigner(address signer) external onlyOwner {
        require(teeSigner[signer], "Not a signer");
        require(signerCount > 0, "No signers to remove");

        teeSigner[signer] = false;
        signerCount--;

        emit TeeSignerRemoved(signer);
    }

    function setBackendOracle(address _backendOracle) external onlyOwner {
        require(_backendOracle != address(0), "Invalid oracle");
        emit BackendOracleUpdated(backendOracle, _backendOracle);
        backendOracle = _backendOracle;
    }

    function verifyProof(bytes calldata proof) external view override returns (bool) {
        if (proof.length < 97) return false;

        bytes32 metadataHash = bytes32(proof[0:32]);
        bytes memory signature = proof[32:97];

        address signer = metadataHash.toEthSignedMessageHash().recover(signature);

        return teeSigner[signer];
    }

    function verifyAndConsumeProof(bytes calldata proof) external returns (bool) {
        require(proof.length >= 97, "Proof too short");

        bytes32 metadataHash = bytes32(proof[0:32]);
        bytes memory signature = proof[32:97];

        bytes32 proofHash = keccak256(proof);
        require(!usedProofHashes[proofHash], "Proof already used");
        usedProofHashes[proofHash] = true;

        address signer = metadataHash.toEthSignedMessageHash().recover(signature);
        require(teeSigner[signer], "Not a TEE signer");

        emit ProofVerified(signer, metadataHash);
        return true;
    }

    function isTeeSigner(address signer) external view returns (bool) {
        return teeSigner[signer];
    }

    function isProofUsed(bytes32 proofHash) external view returns (bool) {
        return usedProofHashes[proofHash];
    }
}
