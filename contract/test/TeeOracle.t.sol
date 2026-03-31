// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TeeOracle.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TeeOracleTest is Test {
    using MessageHashUtils for bytes32;

    TeeOracle public teeOracle;

    uint256 public teeKey1 = 0xAA01;
    address public teeSigner1;
    uint256 public teeKey2 = 0xAA02;
    address public teeSigner2;
    uint256 public fakeKey = 0xBB01;
    address public fakeSigner;

    address public backendOracle = makeAddr("backend");

    function setUp() public {
        teeSigner1 = vm.addr(teeKey1);
        teeSigner2 = vm.addr(teeKey2);
        fakeSigner = vm.addr(fakeKey);

        teeOracle = new TeeOracle(backendOracle);
    }

    function _buildProof(bytes32 metadataHash, uint256 signerKey) internal pure returns (bytes memory) {
        bytes32 ethHash = metadataHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethHash);
        return abi.encodePacked(metadataHash, r, s, v);
    }

    // ============================================================
    //               SIGNER MANAGEMENT
    // ============================================================

    function test_addTeeSigner() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        assertTrue(teeOracle.isTeeSigner(teeSigner1));
        assertEq(teeOracle.signerCount(), 1);
    }

    function test_addMultipleSigners() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner2);

        assertTrue(teeOracle.isTeeSigner(teeSigner1));
        assertTrue(teeOracle.isTeeSigner(teeSigner2));
        assertEq(teeOracle.signerCount(), 2);
    }

    function test_removeTeeSigner() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        teeOracle.removeTeeSigner(teeSigner1);
        assertFalse(teeOracle.isTeeSigner(teeSigner1));
        assertEq(teeOracle.signerCount(), 0);
    }

    function test_addTeeSigner_revert_notAuthorized() public {
        vm.prank(fakeSigner);
        vm.expectRevert("Not authorized");
        teeOracle.addTeeSigner(teeSigner1);
    }

    function test_addTeeSigner_revert_duplicate() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        vm.prank(backendOracle);
        vm.expectRevert("Already registered");
        teeOracle.addTeeSigner(teeSigner1);
    }

    // ============================================================
    //               PROOF VERIFICATION
    // ============================================================

    function test_verifyProof_validTeeSigner() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        bytes32 metadataHash = keccak256("encrypted-agent-data");
        bytes memory proof = _buildProof(metadataHash, teeKey1);

        assertTrue(teeOracle.verifyProof(proof));
    }

    function test_verifyProof_invalidSigner() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        // Proof signed by unregistered key
        bytes32 metadataHash = keccak256("data");
        bytes memory proof = _buildProof(metadataHash, fakeKey);

        assertFalse(teeOracle.verifyProof(proof));
    }

    function test_verifyProof_noSignersRegistered() public {
        bytes32 metadataHash = keccak256("data");
        bytes memory proof = _buildProof(metadataHash, teeKey1);

        assertFalse(teeOracle.verifyProof(proof));
    }

    function test_verifyProof_tooShort() public {
        assertFalse(teeOracle.verifyProof(hex"deadbeef"));
    }

    function test_verifyProof_afterSignerRemoved() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        bytes32 metadataHash = keccak256("data");
        bytes memory proof = _buildProof(metadataHash, teeKey1);

        // Valid before removal
        assertTrue(teeOracle.verifyProof(proof));

        // Remove signer
        teeOracle.removeTeeSigner(teeSigner1);

        // Invalid after removal (key rotation)
        assertFalse(teeOracle.verifyProof(proof));
    }

    // ============================================================
    //               VERIFY AND CONSUME (replay protection)
    // ============================================================

    function test_verifyAndConsumeProof() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        bytes32 metadataHash = keccak256("unique-data");
        bytes memory proof = _buildProof(metadataHash, teeKey1);

        assertTrue(teeOracle.verifyAndConsumeProof(proof));

        // Same proof rejected (replay)
        vm.expectRevert("Proof already used");
        teeOracle.verifyAndConsumeProof(proof);
    }

    function test_verifyAndConsumeProof_differentData() public {
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);

        bytes memory proof1 = _buildProof(keccak256("data1"), teeKey1);
        bytes memory proof2 = _buildProof(keccak256("data2"), teeKey1);

        assertTrue(teeOracle.verifyAndConsumeProof(proof1));
        assertTrue(teeOracle.verifyAndConsumeProof(proof2));
    }

    // ============================================================
    //               MULTI-SIGNER (key rotation scenario)
    // ============================================================

    function test_multiSigner_bothValid() public {
        vm.startPrank(backendOracle);
        teeOracle.addTeeSigner(teeSigner1);
        teeOracle.addTeeSigner(teeSigner2);
        vm.stopPrank();

        bytes32 metadataHash = keccak256("data");

        // Both signers produce valid proofs
        assertTrue(teeOracle.verifyProof(_buildProof(metadataHash, teeKey1)));
        assertTrue(teeOracle.verifyProof(_buildProof(metadataHash, teeKey2)));

        // Unregistered signer still invalid
        assertFalse(teeOracle.verifyProof(_buildProof(metadataHash, fakeKey)));
    }

    // ============================================================
    //               FUZZ
    // ============================================================

    function testFuzz_verifyProof_onlyRegisteredSigners(uint256 key) public {
        key = bound(key, 1, type(uint128).max); // Valid private key range
        address signer = vm.addr(key);

        // Not registered
        bytes32 metadataHash = keccak256("fuzz");
        bytes memory proof = _buildProof(metadataHash, key);
        assertFalse(teeOracle.verifyProof(proof));

        // Register
        vm.prank(backendOracle);
        teeOracle.addTeeSigner(signer);

        // Now valid
        assertTrue(teeOracle.verifyProof(proof));
    }
}
