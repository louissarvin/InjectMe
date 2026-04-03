// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChallengeFactory.sol";
import "../src/Challenge.sol";
import "../src/ReputationRegistry.sol";
import "../src/interfaces/IChallenge.sol";

contract AlignmentChallengeTest is Test {
    ChallengeFactory public factory;
    ReputationRegistry public registry;

    address public owner = address(this);
    address public feeCollector = makeAddr("feeCollector");
    address public oracle = makeAddr("oracle");
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");
    address public attacker2 = makeAddr("attacker2");
    address public attacker3 = makeAddr("attacker3");

    uint256 constant PRIZE_POOL = 5 ether;
    uint256 constant REWARD_PER_ATTEMPT = 0.1 ether;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("alignment-secret");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        factory = new ChallengeFactory(feeCollector, oracle);
        registry = new ReputationRegistry(oracle);

        factory.setReputationRegistry(address(registry));
        registry.setFactory(address(factory));

        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(attacker2, 100 ether);
        vm.deal(attacker3, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ============================================================
    //             ALIGNMENT CHALLENGE CREATION
    // ============================================================

    function test_createAlignment_validParams() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Alignment Test", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );

        assertTrue(factory.isChallenge(challengeAddr));
        assertEq(factory.getChallengeCount(), 1);
        assertEq(factory.getAlignmentCount(), 1);
        assertEq(factory.getTournamentCount(), 0);
        assertEq(factory.getBountyCount(), 0);

        Challenge c = Challenge(payable(challengeAddr));
        assertEq(c.defender(), defender);
        assertEq(c.messagePrice(), 0);
        assertEq(c.prizePool(), PRIZE_POOL);
        assertEq(c.rewardPerAttempt(), REWARD_PER_ATTEMPT);
        assertTrue(c.active());
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.ALIGNMENT));
    }

    function test_createAlignment_revert_prizeTooSmall() public {
        vm.prank(defender);
        vm.expectRevert("Prize pool too small");
        factory.createAlignment{value: 0.01 ether}(
            "Tiny", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createAlignment_revert_zeroReward() public {
        vm.prank(defender);
        vm.expectRevert("Reward must be > 0");
        factory.createAlignment{value: PRIZE_POOL}(
            "NoReward", 0, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createAlignment_revert_rewardExceedsPrize() public {
        vm.prank(defender);
        vm.expectRevert("Reward exceeds prize pool");
        factory.createAlignment{value: PRIZE_POOL}(
            "TooMuch", PRIZE_POOL + 1, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createAlignment_revert_emptyName() public {
        vm.prank(defender);
        vm.expectRevert("Name required");
        factory.createAlignment{value: PRIZE_POOL}(
            "", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createAlignment_revert_emptyModel() public {
        vm.prank(defender);
        vm.expectRevert("Model required");
        factory.createAlignment{value: PRIZE_POOL}(
            "NoModel", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, ""
        );
    }

    function test_createAlignment_rewardEqualsPool() public {
        // Edge case: reward == entire pool (only one attempt possible)
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "OneShot", PRIZE_POOL, DURATION, SECRET_HASH, MODEL
        );

        Challenge c = Challenge(payable(challengeAddr));
        assertEq(c.rewardPerAttempt(), PRIZE_POOL);
    }

    // ============================================================
    //          ATTACKER RECEIVES REWARD PER ATTEMPT
    // ============================================================

    function test_alignment_attackerReceivesReward() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Alignment", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));

        assertEq(c.pendingWithdrawals(attacker1), REWARD_PER_ATTEMPT);
        assertEq(c.prizePool(), PRIZE_POOL - REWARD_PER_ATTEMPT);
        assertEq(c.totalAttempts(), 1);
    }

    function test_alignment_noFeeRequired() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Alignment", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Should revert if msg.value is sent
        vm.prank(oracle);
        vm.expectRevert("No fee required");
        c.recordAttempt{value: 0.1 ether}(attacker1, keccak256("a1"));
    }

    function test_alignment_cannotSendValueOnCommit() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Alignment", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("No fee required");
        c.commitAttempt{value: 0.1 ether}(keccak256("commit1"));
    }

    // ============================================================
    //             PRIZE POOL DEPLETION
    // ============================================================

    function test_alignment_prizePoolDepletes() public {
        // Create with pool that fits exactly 3 attempts
        uint256 pool = REWARD_PER_ATTEMPT * 3;
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: pool}(
            "Deplete", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));
        assertEq(c.prizePool(), REWARD_PER_ATTEMPT * 2);

        c.recordAttempt(attacker2, keccak256("a2"));
        assertEq(c.prizePool(), REWARD_PER_ATTEMPT);

        c.recordAttempt(attacker3, keccak256("a3"));
        assertEq(c.prizePool(), 0);
        vm.stopPrank();
    }

    function test_alignment_autoEndsWhenPoolDepleted() public {
        // Create with pool that fits exactly 2 attempts
        uint256 pool = REWARD_PER_ATTEMPT * 2;
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: pool}(
            "AutoEnd", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));
        c.recordAttempt(attacker2, keccak256("a2"));

        // Pool is now 0, next attempt should fail
        vm.expectRevert("Prize pool depleted");
        c.recordAttempt(attacker3, keccak256("a3"));
        vm.stopPrank();
    }

    function test_alignment_commitFailsWhenPoolDepleted() public {
        // Create with pool that fits exactly 1 attempt
        uint256 pool = REWARD_PER_ATTEMPT;
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: pool}(
            "OneShot", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // First attempt takes the full pool
        vm.prank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));

        // Commit should fail since pool is empty
        vm.prank(attacker2);
        vm.expectRevert("Prize pool depleted");
        c.commitAttempt(keccak256("commit2"));
    }

    // ============================================================
    //           EXPIRY RETURNS REMAINING PRIZE TO DEFENDER
    // ============================================================

    function test_alignment_expiryReturnsRemaining() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Expire", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record some attempts
        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));
        c.recordAttempt(attacker2, keccak256("a2"));
        vm.stopPrank();

        uint256 remainingPool = c.prizePool();
        assertEq(remainingPool, PRIZE_POOL - REWARD_PER_ATTEMPT * 2);

        // Warp past expiry
        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        assertFalse(c.active());
        assertEq(c.pendingWithdrawals(defender), remainingPool);

        // Defender withdraws remaining
        uint256 defBefore = defender.balance;
        vm.prank(defender);
        c.withdraw();
        assertEq(defender.balance - defBefore, remainingPool);
    }

    function test_alignment_expiryWithFullPool() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "NoAttempts", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        assertEq(c.pendingWithdrawals(defender), PRIZE_POOL);
    }

    // ============================================================
    //           MULTIPLE ATTACKERS DRAINING POOL
    // ============================================================

    function test_alignment_multipleAttackersDrainPool() public {
        uint256 pool = REWARD_PER_ATTEMPT * 5;
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: pool}(
            "Drain", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        // attacker1 gets 2 rewards
        c.recordAttempt(attacker1, keccak256("a1"));
        c.recordAttempt(attacker1, keccak256("a2"));
        // attacker2 gets 2 rewards
        c.recordAttempt(attacker2, keccak256("a3"));
        c.recordAttempt(attacker2, keccak256("a4"));
        // attacker3 gets 1 reward
        c.recordAttempt(attacker3, keccak256("a5"));
        vm.stopPrank();

        assertEq(c.pendingWithdrawals(attacker1), REWARD_PER_ATTEMPT * 2);
        assertEq(c.pendingWithdrawals(attacker2), REWARD_PER_ATTEMPT * 2);
        assertEq(c.pendingWithdrawals(attacker3), REWARD_PER_ATTEMPT);
        assertEq(c.prizePool(), 0);

        // All attackers withdraw
        uint256 a1Before = attacker1.balance;
        vm.prank(attacker1);
        c.withdraw();
        assertEq(attacker1.balance - a1Before, REWARD_PER_ATTEMPT * 2);

        uint256 a2Before = attacker2.balance;
        vm.prank(attacker2);
        c.withdraw();
        assertEq(attacker2.balance - a2Before, REWARD_PER_ATTEMPT * 2);

        uint256 a3Before = attacker3.balance;
        vm.prank(attacker3);
        c.withdraw();
        assertEq(attacker3.balance - a3Before, REWARD_PER_ATTEMPT);
    }

    // ============================================================
    //            ALIGNMENT DATA PUBLICATION
    // ============================================================

    function test_alignment_publishData() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Data", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        bytes32 dataRoot = keccak256("data-batch-1");

        vm.prank(oracle);
        c.publishAlignmentData(dataRoot, 100);

        assertEq(c.alignmentSamples(), 100);
        assertEq(c.alignmentDataRoots(100), dataRoot);
    }

    function test_alignment_publishData_revert_notOracle() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Data", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("Only oracle");
        c.publishAlignmentData(keccak256("data"), 10);
    }

    function test_alignment_publishData_revert_notAlignment() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: 1 ether}(
            "Tournament", 0.01 ether, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        vm.expectRevert("Not alignment challenge");
        c.publishAlignmentData(keccak256("data"), 10);
    }

    function test_alignment_publishData_revert_emptyRoot() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Data", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        vm.expectRevert("Invalid data root");
        c.publishAlignmentData(bytes32(0), 10);
    }

    function test_alignment_publishData_revert_zeroSamples() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Data", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        vm.expectRevert("Invalid sample count");
        c.publishAlignmentData(keccak256("data"), 0);
    }

    function test_alignment_publishData_multipleBatches() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Data", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.publishAlignmentData(keccak256("batch1"), 50);
        c.publishAlignmentData(keccak256("batch2"), 75);
        vm.stopPrank();

        assertEq(c.alignmentSamples(), 125);
        assertEq(c.alignmentDataRoots(50), keccak256("batch1"));
        assertEq(c.alignmentDataRoots(125), keccak256("batch2"));
    }

    // ============================================================
    //       INTEGRATION WITH REPUTATION REGISTRY
    // ============================================================

    function test_alignment_recordsDefenderReputation() public {
        vm.prank(defender);
        factory.createAlignment{value: PRIZE_POOL}(
            "RepTest", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 1);
        assertEq(rep.totalPrizeDefended, PRIZE_POOL);
    }

    // ============================================================
    //          VICTORY ON ALIGNMENT CHALLENGE
    // ============================================================

    function test_alignment_claimVictory() public {
        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: PRIZE_POOL}(
            "Victory", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record some attempts first
        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));
        c.recordAttempt(attacker1, keccak256("a2"));
        vm.stopPrank();

        uint256 remainingPrize = c.prizePool();

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-alignment-123");

        assertFalse(c.active());
        assertEq(c.winner(), attacker1);

        // Winner gets remaining prize pool + already-accumulated rewards
        uint256 totalForAttacker = remainingPrize + REWARD_PER_ATTEMPT * 2;
        assertEq(c.pendingWithdrawals(attacker1), totalForAttacker);
    }

    // ============================================================
    //                   NO LISTING FEE
    // ============================================================

    function test_alignment_noListingFee() public {
        // Unlike bounties, alignment challenges should not require a listing fee
        uint256 feeCollectorBefore = feeCollector.balance;

        vm.prank(defender);
        factory.createAlignment{value: PRIZE_POOL}(
            "NoFee", REWARD_PER_ATTEMPT, DURATION, SECRET_HASH, MODEL
        );

        // Fee collector should not have received anything
        assertEq(feeCollector.balance, feeCollectorBefore);
    }

    // ============================================================
    //                   FUZZ TESTS
    // ============================================================

    function testFuzz_alignment_rewardAccounting(uint256 prize, uint256 reward, uint256 attempts) public {
        prize = bound(prize, 0.1 ether, 50 ether);
        reward = bound(reward, 0.001 ether, prize);
        uint256 maxAttempts = prize / reward;
        attempts = bound(attempts, 1, maxAttempts > 20 ? 20 : maxAttempts);

        vm.prank(defender);
        address challengeAddr = factory.createAlignment{value: prize}(
            "Fuzz", reward, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        uint256 totalPaid;
        vm.startPrank(oracle);
        for (uint256 i = 0; i < attempts; i++) {
            c.recordAttempt(attacker1, keccak256(abi.encodePacked("attempt", i)));
            totalPaid += reward;
        }
        vm.stopPrank();

        assertEq(c.prizePool(), prize - totalPaid);
        assertEq(c.pendingWithdrawals(attacker1), totalPaid);
        assertEq(c.totalAttempts(), attempts);
    }
}
