// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ReputationRegistry.sol";
import "../src/ChallengeFactory.sol";
import "../src/Challenge.sol";
import "../src/interfaces/IChallenge.sol";

contract ReputationRegistryTest is Test {
    ReputationRegistry public registry;
    ChallengeFactory public factory;

    address public owner = address(this);
    address public feeCollector = makeAddr("feeCollector");
    address public oracle = makeAddr("oracle");
    address public defender = makeAddr("defender");
    address public defender2 = makeAddr("defender2");
    address public attacker1 = makeAddr("attacker1");
    address public attacker2 = makeAddr("attacker2");
    address public attacker3 = makeAddr("attacker3");
    address public nobody = makeAddr("nobody");

    address public challenge1 = makeAddr("challenge1");
    address public challenge2 = makeAddr("challenge2");
    address public challenge3 = makeAddr("challenge3");

    uint256 constant INITIAL_PRIZE = 1 ether;
    uint256 constant MSG_PRICE = 0.01 ether;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("secret123");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        registry = new ReputationRegistry(oracle);
        factory = new ChallengeFactory(feeCollector, oracle);

        // Wire registry to factory
        factory.setReputationRegistry(address(registry));
        registry.setFactory(address(factory));

        vm.deal(defender, 100 ether);
        vm.deal(defender2, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(attacker2, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ============================================================
    //          ATTACKER REPUTATION: RECORDING ATTEMPTS
    // ============================================================

    function test_recordAttackerAttempt() public {
        vm.prank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalAttempts, 1);
        assertEq(rep.successfulBreaches, 0);
        assertEq(rep.challengesParticipated, 1);
        assertEq(rep.totalEarnings, 0);
        assertEq(rep.lastActiveAt, block.timestamp);
    }

    function test_recordAttackerAttempt_multipleOnSameChallenge() public {
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge1);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalAttempts, 3);
        // challengesParticipated should still be 1 (same challenge)
        assertEq(rep.challengesParticipated, 1);
    }

    function test_recordAttackerAttempt_multipleChallenges() public {
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge2);
        registry.recordAttackerAttempt(attacker1, challenge3);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalAttempts, 3);
        assertEq(rep.challengesParticipated, 3);
    }

    function test_recordAttackerAttempt_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.AttackerAttemptRecorded(attacker1, challenge1);

        vm.prank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
    }

    function test_recordAttackerAttempt_revert_zeroAttacker() public {
        vm.prank(oracle);
        vm.expectRevert("Invalid attacker");
        registry.recordAttackerAttempt(address(0), challenge1);
    }

    function test_recordAttackerAttempt_revert_zeroChallenge() public {
        vm.prank(oracle);
        vm.expectRevert("Invalid challenge");
        registry.recordAttackerAttempt(attacker1, address(0));
    }

    // ============================================================
    //          ATTACKER REPUTATION: RECORDING VICTORIES
    // ============================================================

    function test_recordAttackerVictory() public {
        // First some attempts
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalAttempts, 2);
        assertEq(rep.successfulBreaches, 1);
        assertEq(rep.challengesParticipated, 1);
        assertEq(rep.totalEarnings, 1 ether);
    }

    function test_recordAttackerVictory_newChallengeCountsParticipation() public {
        // Victory on a challenge without prior attempt should still count participation
        vm.prank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 0.5 ether);

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.challengesParticipated, 1);
        assertEq(rep.successfulBreaches, 1);
        assertTrue(registry.hasParticipated(attacker1, challenge1));
    }

    function test_recordAttackerVictory_multipleVictories() public {
        vm.startPrank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
        registry.recordAttackerVictory(attacker1, challenge2, 2 ether);
        registry.recordAttackerVictory(attacker1, challenge3, 0.5 ether);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.successfulBreaches, 3);
        assertEq(rep.totalEarnings, 3.5 ether);
        assertEq(rep.challengesParticipated, 3);
    }

    function test_recordAttackerVictory_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.AttackerVictoryRecorded(attacker1, challenge1, 1 ether);

        vm.prank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
    }

    // ============================================================
    //          DEFENDER REPUTATION: RECORDING CREATION
    // ============================================================

    function test_recordDefenderCreated_byOracle() public {
        vm.prank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 1);
        assertEq(rep.totalPrizeDefended, 1 ether);
        assertEq(rep.lastActiveAt, block.timestamp);
    }

    function test_recordDefenderCreated_byFactory() public {
        vm.prank(address(factory));
        registry.recordDefenderCreated(defender, challenge1, 1 ether);

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 1);
    }

    function test_recordDefenderCreated_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.DefenderCreatedRecorded(defender, challenge1, 1 ether);

        vm.prank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
    }

    function test_recordDefenderCreated_revert_zeroDefender() public {
        vm.prank(oracle);
        vm.expectRevert("Invalid defender");
        registry.recordDefenderCreated(address(0), challenge1, 1 ether);
    }

    // ============================================================
    //         DEFENDER REPUTATION: SURVIVED / BREACHED
    // ============================================================

    function test_recordDefenderSurvived() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderSurvived(defender, challenge1, 1.5 ether);
        vm.stopPrank();

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.challengesSurvived, 1);
        assertEq(rep.challengesBreached, 0);
        // totalPrizeDefended = 1 ether (created) + 1.5 ether (survived with growth)
        assertEq(rep.totalPrizeDefended, 2.5 ether);
    }

    function test_recordDefenderBreached() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderBreached(defender, challenge1, 1 ether);
        vm.stopPrank();

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.challengesSurvived, 0);
        assertEq(rep.challengesBreached, 1);
        assertEq(rep.totalPrizeLost, 1 ether);
    }

    function test_recordDefenderSurvived_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.DefenderSurvivedRecorded(defender, challenge1, 1 ether);

        vm.prank(oracle);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);
    }

    function test_recordDefenderBreached_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.DefenderBreachedRecorded(defender, challenge1, 0.5 ether);

        vm.prank(oracle);
        registry.recordDefenderBreached(defender, challenge1, 0.5 ether);
    }

    // ============================================================
    //              SCORE CALCULATIONS
    // ============================================================

    function test_attackerScore_zeroAttempts() public view {
        // No activity should return 0 (no track record)
        uint256 score = registry.getAttackerScore(attacker1);
        assertEq(score, 0);
    }

    function test_attackerScore_100percent() public {
        // Win every challenge participated in
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
        registry.recordAttackerAttempt(attacker1, challenge2);
        registry.recordAttackerVictory(attacker1, challenge2, 2 ether);
        vm.stopPrank();

        uint256 score = registry.getAttackerScore(attacker1);
        assertEq(score, 10000); // 100%
    }

    function test_attackerScore_50percent() public {
        // Win 1 out of 2 challenges
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
        registry.recordAttackerAttempt(attacker1, challenge2);
        // No victory on challenge2
        vm.stopPrank();

        uint256 score = registry.getAttackerScore(attacker1);
        assertEq(score, 5000); // 50%
    }

    function test_attackerScore_33percent() public {
        // Win 1 out of 3 challenges
        vm.startPrank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
        registry.recordAttackerAttempt(attacker1, challenge2);
        registry.recordAttackerAttempt(attacker1, challenge3);
        vm.stopPrank();

        uint256 score = registry.getAttackerScore(attacker1);
        // 1 * 10000 / 3 = 3333 (floors)
        assertEq(score, 3333);
    }

    function test_defenderScore_noResolved() public view {
        // No resolved challenges should return 10000 (benefit of doubt)
        uint256 score = registry.getDefenderScore(defender);
        assertEq(score, 10000);
    }

    function test_defenderScore_100percentSurvival() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);
        registry.recordDefenderCreated(defender, challenge2, 2 ether);
        registry.recordDefenderSurvived(defender, challenge2, 2 ether);
        vm.stopPrank();

        uint256 score = registry.getDefenderScore(defender);
        assertEq(score, 10000); // 100%
    }

    function test_defenderScore_0percentSurvival() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderBreached(defender, challenge1, 1 ether);
        vm.stopPrank();

        uint256 score = registry.getDefenderScore(defender);
        assertEq(score, 0); // 0%
    }

    function test_defenderScore_50percentSurvival() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);
        registry.recordDefenderCreated(defender, challenge2, 2 ether);
        registry.recordDefenderBreached(defender, challenge2, 2 ether);
        vm.stopPrank();

        uint256 score = registry.getDefenderScore(defender);
        assertEq(score, 5000); // 50%
    }

    function test_defenderScore_66percent() public {
        vm.startPrank(oracle);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);
        registry.recordDefenderSurvived(defender, challenge2, 1 ether);
        registry.recordDefenderBreached(defender, challenge3, 1 ether);
        vm.stopPrank();

        uint256 score = registry.getDefenderScore(defender);
        // 2 * 10000 / 3 = 6666 (floors)
        assertEq(score, 6666);
    }

    // ============================================================
    //              ACCESS CONTROL
    // ============================================================

    function test_recordAttackerAttempt_revert_notOracle() public {
        vm.prank(nobody);
        vm.expectRevert("Only oracle");
        registry.recordAttackerAttempt(attacker1, challenge1);
    }

    function test_recordAttackerVictory_revert_notOracle() public {
        vm.prank(nobody);
        vm.expectRevert("Only oracle");
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);
    }

    function test_recordDefenderCreated_revert_notOracleOrFactory() public {
        vm.prank(nobody);
        vm.expectRevert("Only oracle or factory");
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
    }

    function test_recordDefenderSurvived_revert_notOracle() public {
        vm.prank(nobody);
        vm.expectRevert("Only oracle");
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);
    }

    function test_recordDefenderBreached_revert_notOracle() public {
        vm.prank(nobody);
        vm.expectRevert("Only oracle");
        registry.recordDefenderBreached(defender, challenge1, 1 ether);
    }

    function test_recordAttackerAttempt_revert_factory() public {
        // Factory should NOT be able to record attacker attempts (only oracle)
        vm.prank(address(factory));
        vm.expectRevert("Only oracle");
        registry.recordAttackerAttempt(attacker1, challenge1);
    }

    // ============================================================
    //              ADMIN ACCESS CONTROL
    // ============================================================

    function test_setFactory_revert_notOwner() public {
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nobody));
        registry.setFactory(makeAddr("fake"));
    }

    function test_setFactory_revert_alreadySet() public {
        // factory is already set in setUp
        vm.expectRevert("Factory already set");
        registry.setFactory(makeAddr("newFactory"));
    }

    function test_setFactory_revert_zero() public {
        // Deploy fresh registry without factory set
        ReputationRegistry fresh = new ReputationRegistry(oracle);
        vm.expectRevert("Invalid factory");
        fresh.setFactory(address(0));
    }

    function test_setOracle() public {
        address newOracle = makeAddr("newOracle");
        registry.setOracle(newOracle);

        // Old oracle should no longer work
        vm.prank(oracle);
        vm.expectRevert("Only oracle");
        registry.recordAttackerAttempt(attacker1, challenge1);

        // New oracle should work
        vm.prank(newOracle);
        registry.recordAttackerAttempt(attacker1, challenge1);
    }

    function test_setOracle_revert_notOwner() public {
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nobody));
        registry.setOracle(makeAddr("hack"));
    }

    function test_setOracle_revert_zero() public {
        vm.expectRevert("Invalid oracle");
        registry.setOracle(address(0));
    }

    function test_setOracle_emitsEvent() public {
        address newOracle = makeAddr("newOracle");
        vm.expectEmit(true, true, false, true);
        emit ReputationRegistry.OracleUpdated(oracle, newOracle);
        registry.setOracle(newOracle);
    }

    // ============================================================
    //          MULTIPLE CHALLENGES / MULTIPLE USERS
    // ============================================================

    function test_multipleAttackers_independentReputation() public {
        vm.startPrank(oracle);
        // Attacker1: 3 attempts, 1 victory
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerAttempt(attacker1, challenge1);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);

        // Attacker2: 1 attempt on different challenge, no victory
        registry.recordAttackerAttempt(attacker2, challenge2);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep1 = registry.getAttackerReputation(attacker1);
        ReputationRegistry.AttackerReputation memory rep2 = registry.getAttackerReputation(attacker2);

        assertEq(rep1.totalAttempts, 3);
        assertEq(rep1.successfulBreaches, 1);
        assertEq(rep1.challengesParticipated, 1);

        assertEq(rep2.totalAttempts, 1);
        assertEq(rep2.successfulBreaches, 0);
        assertEq(rep2.challengesParticipated, 1);
    }

    function test_multipleDefenders_independentReputation() public {
        vm.startPrank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);

        registry.recordDefenderCreated(defender2, challenge2, 2 ether);
        registry.recordDefenderBreached(defender2, challenge2, 2 ether);
        vm.stopPrank();

        assertEq(registry.getDefenderScore(defender), 10000);
        assertEq(registry.getDefenderScore(defender2), 0);
    }

    function test_sameAddressAsAttackerAndDefender() public {
        // An address can be both attacker and defender
        vm.startPrank(oracle);
        registry.recordAttackerAttempt(defender, challenge1);
        registry.recordAttackerVictory(defender, challenge1, 0.5 ether);

        registry.recordDefenderCreated(defender, challenge2, 1 ether);
        registry.recordDefenderSurvived(defender, challenge2, 1 ether);
        vm.stopPrank();

        assertEq(registry.getAttackerScore(defender), 10000);
        assertEq(registry.getDefenderScore(defender), 10000);
    }

    // ============================================================
    //              BATCH OPERATIONS
    // ============================================================

    function test_batchRecordAttackerAttempts() public {
        address[] memory attackers = new address[](3);
        address[] memory challenges = new address[](3);

        attackers[0] = attacker1;
        attackers[1] = attacker2;
        attackers[2] = attacker1;

        challenges[0] = challenge1;
        challenges[1] = challenge1;
        challenges[2] = challenge2;

        vm.prank(oracle);
        registry.batchRecordAttackerAttempts(attackers, challenges);

        ReputationRegistry.AttackerReputation memory rep1 = registry.getAttackerReputation(attacker1);
        assertEq(rep1.totalAttempts, 2);
        assertEq(rep1.challengesParticipated, 2);

        ReputationRegistry.AttackerReputation memory rep2 = registry.getAttackerReputation(attacker2);
        assertEq(rep2.totalAttempts, 1);
        assertEq(rep2.challengesParticipated, 1);
    }

    function test_batchRecordAttackerAttempts_revert_lengthMismatch() public {
        address[] memory attackers = new address[](2);
        address[] memory challenges = new address[](3);

        attackers[0] = attacker1;
        attackers[1] = attacker2;
        challenges[0] = challenge1;
        challenges[1] = challenge2;
        challenges[2] = challenge3;

        vm.prank(oracle);
        vm.expectRevert("Array length mismatch");
        registry.batchRecordAttackerAttempts(attackers, challenges);
    }

    function test_batchRecordAttackerAttempts_revert_emptyBatch() public {
        address[] memory attackers = new address[](0);
        address[] memory challenges = new address[](0);

        vm.prank(oracle);
        vm.expectRevert("Empty batch");
        registry.batchRecordAttackerAttempts(attackers, challenges);
    }

    function test_batchRecordAttackerAttempts_revert_tooLarge() public {
        address[] memory attackers = new address[](51);
        address[] memory challenges = new address[](51);

        for (uint256 i = 0; i < 51; i++) {
            attackers[i] = attacker1;
            challenges[i] = challenge1;
        }

        vm.prank(oracle);
        vm.expectRevert("Batch too large");
        registry.batchRecordAttackerAttempts(attackers, challenges);
    }

    function test_batchRecordAttackerAttempts_revert_notOracle() public {
        address[] memory attackers = new address[](1);
        address[] memory challenges = new address[](1);
        attackers[0] = attacker1;
        challenges[0] = challenge1;

        vm.prank(nobody);
        vm.expectRevert("Only oracle");
        registry.batchRecordAttackerAttempts(attackers, challenges);
    }

    function test_batchRecordAttackerAttempts_revert_zeroAddress() public {
        address[] memory attackers = new address[](1);
        address[] memory challenges = new address[](1);
        attackers[0] = address(0);
        challenges[0] = challenge1;

        vm.prank(oracle);
        vm.expectRevert("Invalid attacker");
        registry.batchRecordAttackerAttempts(attackers, challenges);
    }

    // ============================================================
    //        PARTICIPATION TRACKING (DEDUP)
    // ============================================================

    function test_hasParticipated() public {
        assertFalse(registry.hasParticipated(attacker1, challenge1));

        vm.prank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);

        assertTrue(registry.hasParticipated(attacker1, challenge1));
        assertFalse(registry.hasParticipated(attacker1, challenge2));
    }

    function test_victoryAlsoTracksParticipation() public {
        assertFalse(registry.hasParticipated(attacker1, challenge1));

        vm.prank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 1 ether);

        assertTrue(registry.hasParticipated(attacker1, challenge1));
    }

    // ============================================================
    //         INTEGRATION WITH CHALLENGEFACTORY
    // ============================================================

    function test_factoryCreation_recordsDefenderReputation() public {
        vm.prank(defender);
        factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 1);
        assertEq(rep.totalPrizeDefended, INITIAL_PRIZE);
    }

    function test_factoryBountyCreation_recordsDefenderReputation() public {
        uint256 listingFee = factory.bountyListingFee();
        uint256 bountyAmount = INITIAL_PRIZE;

        vm.prank(defender);
        factory.createBounty{value: bountyAmount + listingFee}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 1);
        // Should record bountyAmount (excluding listing fee)
        assertEq(rep.totalPrizeDefended, bountyAmount);
    }

    function test_factoryMultipleChallenges_cumulativeReputation() public {
        vm.startPrank(defender);
        factory.createTournament{value: 1 ether}("A", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: 2 ether}("B", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: 0.5 ether}("C", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        vm.stopPrank();

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.totalChallengesCreated, 3);
        assertEq(rep.totalPrizeDefended, 3.5 ether);
    }

    function test_factoryWithoutRegistry_noRevert() public {
        // Deploy factory without registry to verify graceful skip
        ChallengeFactory bareFactory = new ChallengeFactory(feeCollector, oracle);
        vm.deal(defender, 100 ether);

        vm.prank(defender);
        address challengeAddr = bareFactory.createTournament{value: INITIAL_PRIZE}(
            "NoReg", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        assertTrue(bareFactory.isChallenge(challengeAddr));
    }

    // ============================================================
    //              CONSTRUCTOR VALIDATION
    // ============================================================

    function test_constructor_revert_zeroOracle() public {
        vm.expectRevert("Invalid oracle");
        new ReputationRegistry(address(0));
    }

    function test_constructor_setsOwner() public view {
        assertEq(registry.owner(), address(this));
    }

    // ============================================================
    //              VIEW FUNCTIONS: DEFAULT VALUES
    // ============================================================

    function test_emptyAttackerReputation() public view {
        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(nobody);
        assertEq(rep.totalAttempts, 0);
        assertEq(rep.successfulBreaches, 0);
        assertEq(rep.challengesParticipated, 0);
        assertEq(rep.totalEarnings, 0);
        assertEq(rep.lastActiveAt, 0);
    }

    function test_emptyDefenderReputation() public view {
        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(nobody);
        assertEq(rep.totalChallengesCreated, 0);
        assertEq(rep.challengesSurvived, 0);
        assertEq(rep.challengesBreached, 0);
        assertEq(rep.totalPrizeDefended, 0);
        assertEq(rep.totalPrizeLost, 0);
        assertEq(rep.lastActiveAt, 0);
    }

    // ============================================================
    //              TIMESTAMP TRACKING
    // ============================================================

    function test_lastActiveAt_updates() public {
        vm.warp(1000);
        vm.prank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge1);

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.lastActiveAt, 1000);

        vm.warp(2000);
        vm.prank(oracle);
        registry.recordAttackerAttempt(attacker1, challenge2);

        rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.lastActiveAt, 2000);
    }

    function test_defender_lastActiveAt_updates() public {
        vm.warp(1000);
        vm.prank(oracle);
        registry.recordDefenderCreated(defender, challenge1, 1 ether);

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.lastActiveAt, 1000);

        vm.warp(5000);
        vm.prank(oracle);
        registry.recordDefenderSurvived(defender, challenge1, 1 ether);

        rep = registry.getDefenderReputation(defender);
        assertEq(rep.lastActiveAt, 5000);
    }

    // ============================================================
    //              FUZZ TESTS
    // ============================================================

    function testFuzz_attackerScore_bounded(uint256 victories, uint256 participations) public {
        // Victories cannot exceed participations
        participations = bound(participations, 1, 100);
        victories = bound(victories, 0, participations);

        vm.startPrank(oracle);
        for (uint256 i = 0; i < participations; i++) {
            address fakeChallenge = address(uint160(0xC0FFEE + i));
            registry.recordAttackerAttempt(attacker1, fakeChallenge);
        }
        for (uint256 i = 0; i < victories; i++) {
            address fakeChallenge = address(uint160(0xC0FFEE + i));
            registry.recordAttackerVictory(attacker1, fakeChallenge, 1 ether);
        }
        vm.stopPrank();

        uint256 score = registry.getAttackerScore(attacker1);
        assertLe(score, 10000, "Score should never exceed 10000 BPS");
    }

    function testFuzz_defenderScore_bounded(uint256 survived, uint256 breached) public {
        survived = bound(survived, 0, 50);
        breached = bound(breached, 0, 50);
        vm.assume(survived + breached > 0);

        vm.startPrank(oracle);
        for (uint256 i = 0; i < survived; i++) {
            address fakeChallenge = address(uint160(0xDEAD + i));
            registry.recordDefenderSurvived(defender, fakeChallenge, 1 ether);
        }
        for (uint256 i = 0; i < breached; i++) {
            address fakeChallenge = address(uint160(0xBEEF + i));
            registry.recordDefenderBreached(defender, fakeChallenge, 1 ether);
        }
        vm.stopPrank();

        uint256 score = registry.getDefenderScore(defender);
        assertLe(score, 10000, "Score should never exceed 10000 BPS");
    }

    function testFuzz_earningsAccumulate(uint256 prize1, uint256 prize2) public {
        prize1 = bound(prize1, 0, 100 ether);
        prize2 = bound(prize2, 0, 100 ether);

        vm.startPrank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, prize1);
        registry.recordAttackerVictory(attacker1, challenge2, prize2);
        vm.stopPrank();

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalEarnings, prize1 + prize2);
    }

    // ============================================================
    //        EDGE CASE: ZERO PRIZE VICTORY
    // ============================================================

    function test_attackerVictory_zeroPrize() public {
        vm.prank(oracle);
        registry.recordAttackerVictory(attacker1, challenge1, 0);

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.successfulBreaches, 1);
        assertEq(rep.totalEarnings, 0);
    }

    function test_defenderBreached_zeroPrize() public {
        vm.prank(oracle);
        registry.recordDefenderBreached(defender, challenge1, 0);

        ReputationRegistry.DefenderReputation memory rep = registry.getDefenderReputation(defender);
        assertEq(rep.challengesBreached, 1);
        assertEq(rep.totalPrizeLost, 0);
    }

    // ============================================================
    //        EDGE CASE: MAX BATCH SIZE (50)
    // ============================================================

    function test_batchRecordAttackerAttempts_maxSize() public {
        address[] memory attackers = new address[](50);
        address[] memory challenges = new address[](50);

        for (uint256 i = 0; i < 50; i++) {
            attackers[i] = attacker1;
            challenges[i] = address(uint160(0xABCD + i));
        }

        vm.prank(oracle);
        registry.batchRecordAttackerAttempts(attackers, challenges);

        ReputationRegistry.AttackerReputation memory rep = registry.getAttackerReputation(attacker1);
        assertEq(rep.totalAttempts, 50);
        assertEq(rep.challengesParticipated, 50);
    }
}
