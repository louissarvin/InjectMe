// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChallengeFactory.sol";
import "../src/AgentNFT.sol";
import "../src/TeeOracle.sol";
import "../src/Challenge.sol";

contract AgentNFTTest is Test {
    ChallengeFactory public factory;
    AgentNFT public agentNFT;
    TeeOracle public teeOracle;

    address public feeCollector = makeAddr("feeCollector");
    uint256 public oracleKey = 0xA11CE; // Known private key for signing proofs in tests
    address public oracle;              // Backend oracle (EOA)
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");

    uint256 constant PRIZE = 1 ether;
    uint256 constant MSG_PRICE = 0.01 ether;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("secret");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        oracle = vm.addr(oracleKey);

        // Deploy TeeOracle and register test oracle key as TEE signer
        teeOracle = new TeeOracle(oracle);
        teeOracle.addTeeSigner(oracle); // Register the test key as a valid TEE signer

        // AgentNFT uses TeeOracle for proof verification
        agentNFT = new AgentNFT(address(teeOracle));
        // Set the backend oracle for stats updates
        agentNFT.setBackendOracle(oracle);

        factory = new ChallengeFactory(feeCollector, oracle);
        factory.setAgentNFT(address(agentNFT));
        agentNFT.setFactory(address(factory));

        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    /// @dev Build a valid oracle-signed proof for ERC-7857 operations
    function _buildProof(bytes32 metadataHash) internal view returns (bytes memory) {
        // Contract does: messageHash.toEthSignedMessageHash().recover(sig)
        // So we sign the EthSignedMessage of the raw metadataHash
        bytes32 ethHash = metadataHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, ethHash);
        return abi.encodePacked(metadataHash, r, s, v); // 32 + 32 + 32 + 1 = 97 bytes
    }

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    // ============================================================
    //               iNFT MINTED ON CHALLENGE CREATION
    // ============================================================

    function test_tournamentMintsAgentNFT() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        assertEq(agentNFT.balanceOf(defender), 1);
        assertEq(agentNFT.ownerOf(1), defender);
        assertEq(agentNFT.getTokenForChallenge(challengeAddr), 1);

        AgentNFT.AgentMetadata memory agent = agentNFT.getAgent(1);
        assertEq(agent.challengeAddress, challengeAddr);
        assertEq(agentNFT.getMetadataHash(1), SECRET_HASH);
        assertEq(keccak256(bytes(agent.model)), keccak256(bytes(MODEL)));
        assertEq(agent.totalAttempts, 0);
        assertFalse(agent.breached);
        assertTrue(agentNFT.isActive(1));
    }

    function test_bountyMintsAgentNFT() public {
        uint256 listingFee = factory.bountyListingFee();

        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: PRIZE + listingFee}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );

        assertEq(agentNFT.balanceOf(defender), 1);
        assertEq(agentNFT.getTokenForChallenge(challengeAddr), 1);
    }

    function test_multipleChallengesMultipleNFTs() public {
        vm.startPrank(defender);
        factory.createTournament{value: PRIZE}("A", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: PRIZE}("B", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: PRIZE}("C", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        vm.stopPrank();

        assertEq(agentNFT.balanceOf(defender), 3);
        assertEq(agentNFT.totalSupply(), 3);
    }

    // ============================================================
    //               STATS UPDATE BY ORACLE
    // ============================================================

    function test_updateStats() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "Stats", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(oracle);
        agentNFT.updateStats(challengeAddr, 10, 9);

        AgentNFT.AgentMetadata memory agent = agentNFT.getAgent(1);
        assertEq(agent.totalAttempts, 10);
        assertEq(agent.attemptsSurvived, 9);
        assertEq(agentNFT.getSecurityScore(1), 9000); // 90%
    }

    function test_markBreached() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "Breached", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(oracle);
        agentNFT.markBreached(challengeAddr, 42);

        AgentNFT.AgentMetadata memory agent = agentNFT.getAgent(1);
        assertTrue(agent.breached);
        assertEq(agent.totalAttempts, 42);
        assertGt(agent.resolvedAt, 0);
        assertFalse(agentNFT.isActive(1));
    }

    function test_markSurvived() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "Survived", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Set real stats first
        vm.prank(oracle);
        agentNFT.updateStats(challengeAddr, 100, 95);

        vm.prank(oracle);
        agentNFT.markSurvived(challengeAddr, 95);

        AgentNFT.AgentMetadata memory agent = agentNFT.getAgent(1);
        assertFalse(agent.breached);
        assertEq(agent.attemptsSurvived, 95);
        // H-3 fix: totalAttempts stays at 100 (not overwritten)
        assertEq(agent.totalAttempts, 100);
        assertEq(agentNFT.getSecurityScore(1), 9500); // 95%, not 100%
        assertGt(agent.resolvedAt, 0);
    }

    // ============================================================
    //               TEE ATTESTATION ANCHORING
    // ============================================================

    function test_anchorAttestation() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "TEE", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.startPrank(oracle);
        agentNFT.anchorAttestation(challengeAddr, keccak256("attestation-1"));
        agentNFT.anchorAttestation(challengeAddr, keccak256("attestation-2"));
        vm.stopPrank();

        assertEq(agentNFT.getAttestationCount(1), 2);
    }

    // ============================================================
    //         ERC-7857: TRANSFER WITH ORACLE-SIGNED PROOF
    // ============================================================

    function test_erc7857_transfer() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "ERC7857", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address buyer = makeAddr("buyer");
        bytes32 newHash = keccak256("re-encrypted-for-buyer");
        bytes memory proof = _buildProof(newHash);
        bytes memory sealedKey = abi.encodePacked(keccak256("sealed-key-for-buyer"));

        vm.prank(defender);
        agentNFT.transfer(defender, buyer, 1, sealedKey, proof);

        assertEq(agentNFT.ownerOf(1), buyer);
        assertEq(agentNFT.getMetadataHash(1), newHash);
    }

    function test_erc7857_transfer_revert_notOwner() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "NotOwner", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        bytes memory proof = _buildProof(keccak256("hash"));

        vm.prank(attacker1);
        vm.expectRevert("Not authorized");
        agentNFT.transfer(defender, attacker1, 1, "", proof);
    }

    function test_erc7857_transfer_revert_emptyProof() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "EmptyProof", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(defender);
        vm.expectRevert("Proof too short");
        agentNFT.transfer(defender, attacker1, 1, "", "");
    }

    function test_erc7857_transfer_revert_fakeProof() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "FakeProof", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Build proof signed by wrong key
        uint256 fakeKey = 0xDEAD;
        bytes32 metaHash = keccak256("fake-hash");
        bytes32 ethHash = metaHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeKey, ethHash);
        bytes memory fakeProof = abi.encodePacked(metaHash, r, s, v);

        vm.prank(defender);
        vm.expectRevert("TEE proof invalid");
        agentNFT.transfer(defender, attacker1, 1, "", fakeProof);
    }

    // ============================================================
    //              ERC-7857: CLONE WITH ORACLE-SIGNED PROOF
    // ============================================================

    function test_erc7857_clone() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Original", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address challengeAddr = factory.challenges(0);
        vm.prank(oracle);
        agentNFT.updateStats(challengeAddr, 50, 48);

        address cloneRecipient = makeAddr("cloneRecipient");
        bytes32 cloneHash = keccak256("clone-encrypted-metadata");
        bytes memory proof = _buildProof(cloneHash);

        vm.prank(defender);
        uint256 cloneId = agentNFT.clone(cloneRecipient, 1, "", proof);

        assertEq(cloneId, 2);
        assertEq(agentNFT.ownerOf(2), cloneRecipient);

        // Clone has fresh stats
        AgentNFT.AgentMetadata memory cloneAgent = agentNFT.getAgent(2);
        assertEq(cloneAgent.totalAttempts, 0);
        assertFalse(cloneAgent.breached);
        assertEq(cloneAgent.challengeAddress, address(0));

        // Clone has its own oracle-attested metadata hash
        assertEq(agentNFT.getMetadataHash(2), cloneHash);

        // L-2 fix: clone is NOT reported as active (no challenge)
        assertFalse(agentNFT.isActive(2));

        // Original unchanged
        assertEq(agentNFT.ownerOf(1), defender);
    }

    function test_erc7857_clone_revert_notOwner() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "CloneACL", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        bytes memory proof = _buildProof(keccak256("hash"));

        vm.prank(attacker1);
        vm.expectRevert("Not owner");
        agentNFT.clone(attacker1, 1, "", proof);
    }

    // ============================================================
    //        LINK CLONED AGENT TO CHALLENGE
    // ============================================================

    function test_linkAgentToChallenge() public {
        // Mint an agent via a challenge so we have a valid setup
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Original", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Clone the agent (clone starts with challengeAddress == address(0))
        bytes32 cloneHash = keccak256("clone-metadata");
        bytes memory proof = _buildProof(cloneHash);
        vm.prank(defender);
        uint256 cloneId = agentNFT.clone(defender, 1, "", proof);
        assertEq(cloneId, 2);

        // Verify clone has no challenge linked
        AgentNFT.AgentMetadata memory cloneBefore = agentNFT.getAgent(2);
        assertEq(cloneBefore.challengeAddress, address(0));
        assertEq(agentNFT.getTokenForChallenge(address(0x999)), 0);

        // Backend oracle links the clone to a new challenge address
        address newChallenge = makeAddr("newChallenge");
        vm.prank(oracle);
        agentNFT.linkAgentToChallenge(cloneId, newChallenge);

        // Verify both mappings are set correctly
        AgentNFT.AgentMetadata memory cloneAfter = agentNFT.getAgent(2);
        assertEq(cloneAfter.challengeAddress, newChallenge);
        assertEq(agentNFT.getTokenForChallenge(newChallenge), cloneId);

        // Verify the agent is now considered active
        assertTrue(agentNFT.isActive(cloneId));
    }

    function test_linkAgentToChallenge_revert_notBackendOracle() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "LinkACL", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Clone so we have an unlinked agent
        bytes memory proof = _buildProof(keccak256("clone-acl"));
        vm.prank(defender);
        uint256 cloneId = agentNFT.clone(defender, 1, "", proof);

        // Non-oracle caller should revert
        vm.prank(attacker1);
        vm.expectRevert("Only backend oracle");
        agentNFT.linkAgentToChallenge(cloneId, makeAddr("someChallenge"));
    }

    function test_linkAgentToChallenge_revert_alreadyLinked() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "AlreadyLinked", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Token 1 already has a challengeAddress set from minting
        AgentNFT.AgentMetadata memory agent = agentNFT.getAgent(1);
        assertEq(agent.challengeAddress, challengeAddr);

        vm.prank(oracle);
        vm.expectRevert("Already linked");
        agentNFT.linkAgentToChallenge(1, makeAddr("anotherChallenge"));
    }

    function test_linkAgentToChallenge_revert_zeroAddress() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "ZeroAddr", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        // Clone to get an unlinked agent
        bytes memory proof = _buildProof(keccak256("clone-zero"));
        vm.prank(defender);
        uint256 cloneId = agentNFT.clone(defender, 1, "", proof);

        vm.prank(oracle);
        vm.expectRevert("Invalid challenge");
        agentNFT.linkAgentToChallenge(cloneId, address(0));
    }

    function test_linkAgentToChallenge_revert_invalidToken() public {
        // Token 999 does not exist
        vm.prank(oracle);
        vm.expectRevert("Invalid token");
        agentNFT.linkAgentToChallenge(999, makeAddr("someChallenge"));

        // Token 0 is also invalid
        vm.prank(oracle);
        vm.expectRevert("Invalid token");
        agentNFT.linkAgentToChallenge(0, makeAddr("someChallenge"));
    }

    // ============================================================
    //        C-3 FIX: Authorizations invalidated on transfer
    // ============================================================

    function test_authorizationsInvalidatedOnTransfer() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "AuthInvalidate", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address executor = makeAddr("executor");

        // Authorize
        vm.prank(defender);
        agentNFT.authorizeUsage(1, executor, abi.encode("read"));
        assertTrue(agentNFT.isAuthorized(1, executor));

        // Transfer via standard ERC-721
        vm.prank(defender);
        agentNFT.transferFrom(defender, attacker1, 1);

        // Authorization invalidated (C-3 fix)
        assertFalse(agentNFT.isAuthorized(1, executor));
    }

    function test_authorizationsInvalidatedOnERC7857Transfer() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Auth7857", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address executor = makeAddr("executor");

        vm.prank(defender);
        agentNFT.authorizeUsage(1, executor, abi.encode("read"));
        assertTrue(agentNFT.isAuthorized(1, executor));

        // Transfer via ERC-7857
        bytes memory proof = _buildProof(keccak256("new-hash"));
        vm.prank(defender);
        agentNFT.transfer(defender, attacker1, 1, "", proof);

        // Authorization invalidated
        assertFalse(agentNFT.isAuthorized(1, executor));
    }

    // ============================================================
    //        H-2 FIX: markBreached doesn't overwrite higher totalAttempts
    // ============================================================

    function test_markBreached_preservesHigherTotalAttempts() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "PreserveStats", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.startPrank(oracle);
        agentNFT.updateStats(challengeAddr, 100, 95);
        agentNFT.markBreached(challengeAddr, 50); // lower than current 100
        vm.stopPrank();

        // totalAttempts stays at 100 (not overwritten to 50)
        assertEq(agentNFT.getAgent(1).totalAttempts, 100);
    }

    // ============================================================
    //        H-3 FIX: markSurvived doesn't inflate score
    // ============================================================

    function test_markSurvived_doesNotInflateScore() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "NoInflate", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.startPrank(oracle);
        agentNFT.updateStats(challengeAddr, 100, 60); // 60% survival
        agentNFT.markSurvived(challengeAddr, 60);
        vm.stopPrank();

        // Score stays at 60%, not 100%
        assertEq(agentNFT.getSecurityScore(1), 6000);
        assertEq(agentNFT.getAgent(1).totalAttempts, 100); // Preserved
    }

    // ============================================================
    //        H-5 FIX: Proof replay blocked
    // ============================================================

    function test_proofReplay_reverts() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Replay", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address buyer = makeAddr("buyer");
        bytes memory proof = _buildProof(keccak256("replay-hash"));

        // First clone succeeds
        vm.prank(defender);
        agentNFT.clone(buyer, 1, "", proof);

        // Replay same proof reverts
        vm.prank(defender);
        vm.expectRevert("Proof already used");
        agentNFT.clone(attacker1, 1, "", proof);
    }

    // ============================================================
    //        M-2 FIX: updateMetadata restricted to oracle
    // ============================================================

    function test_updateMetadata_revert_notOracle() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "MetaACL", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(defender);
        vm.expectRevert("Only backend oracle");
        agentNFT.updateMetadata(1, keccak256("new"), "https://new.uri");
    }

    function test_updateMetadata_oracle() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "MetaOracle", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(oracle);
        agentNFT.updateMetadata(1, keccak256("new"), "0g://new");
        assertEq(agentNFT.getMetadataHash(1), keccak256("new"));
    }

    // ============================================================
    //               ERC-7857: AUTHORIZE / REVOKE USAGE
    // ============================================================

    function test_authorizeUsage() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Auth", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address executor = makeAddr("executor");

        vm.prank(defender);
        agentNFT.authorizeUsage(1, executor, abi.encode("read"));
        assertTrue(agentNFT.isAuthorized(1, executor));
    }

    function test_authorizeUsage_revert_notOwner() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Auth", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(attacker1);
        vm.expectRevert("Not owner");
        agentNFT.authorizeUsage(1, attacker1, "");
    }

    function test_revokeUsage() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "Revoke", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        address executor = makeAddr("executor");
        vm.startPrank(defender);
        agentNFT.authorizeUsage(1, executor, abi.encode("read"));
        assertTrue(agentNFT.isAuthorized(1, executor));
        agentNFT.revokeUsage(1, executor);
        assertFalse(agentNFT.isAuthorized(1, executor));
        vm.stopPrank();
    }

    // ============================================================
    //               ACCESS CONTROL
    // ============================================================

    function test_updateStats_revert_notOracle() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "ACL", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(attacker1);
        vm.expectRevert("Only backend oracle");
        agentNFT.updateStats(challengeAddr, 5, 5);
    }

    function test_mintAgent_revert_notFactory() public {
        vm.prank(attacker1);
        vm.expectRevert("Only factory");
        agentNFT.mintAgent(attacker1, address(0x1), SECRET_HASH, "", MODEL);
    }

    function test_setFactory_revert_alreadySet() public {
        vm.expectRevert("Factory already set");
        agentNFT.setFactory(address(0x1));
    }

    // ============================================================
    //               L-3 FIX: supportsInterface
    // ============================================================

    function test_supportsERC7857Interface() public view {
        assertTrue(agentNFT.supportsInterface(type(IERC7857).interfaceId));
        assertTrue(agentNFT.supportsInterface(type(IERC721).interfaceId));
    }

    // ============================================================
    //               SECURITY SCORE EDGE CASES
    // ============================================================

    function test_securityScore_noAttempts() public {
        vm.prank(defender);
        factory.createTournament{value: PRIZE}(
            "NoAttempts", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        assertEq(agentNFT.getSecurityScore(1), 10000);
    }

    function test_securityScore_allBreached() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "AllFail", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.prank(oracle);
        agentNFT.updateStats(challengeAddr, 10, 0);
        assertEq(agentNFT.getSecurityScore(1), 0);
    }

    // ============================================================
    //               M-4 FIX: setAgentNFT one-time only
    // ============================================================

    function test_setAgentNFT_revert_alreadySet() public {
        vm.expectRevert("AgentNFT already set");
        factory.setAgentNFT(address(0x1));
    }
}

/// @dev Helper for ECDSA hash in tests
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

using MessageHashUtils for bytes32;
