// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChallengeFactory.sol";
import "../src/Challenge.sol";
import "../src/interfaces/IChallenge.sol";

/// @title ChallengePostFix - Jessica's post-fix re-audit tests
/// @notice Additional edge cases for pull pattern, grace period boundaries, and accounting
contract ChallengePostFixTest is Test {
    ChallengeFactory public factory;

    address public feeCollector = makeAddr("feeCollector");
    address public oracle = makeAddr("oracle");
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");
    address public attacker2 = makeAddr("attacker2");

    uint256 constant PRIZE = 1 ether;
    uint256 constant MSG_PRICE = 0.01 ether;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("secret");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        factory = new ChallengeFactory(feeCollector, oracle);
        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(attacker2, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ============================================================
    //  GRACE PERIOD: Exact boundary tests
    // ============================================================

    function test_gracePeriod_exactBoundary_lastSecond() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "Boundary", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Warp to exactly expiresAt + VICTORY_GRACE_PERIOD - 1 (last valid second)
        uint256 deadline = c.expiresAt() + c.VICTORY_GRACE_PERIOD();
        vm.warp(deadline - 1);

        vm.prank(oracle);
        c.claimVictory(attacker1, "boundary-pass");
        assertFalse(c.active());
    }

    function test_gracePeriod_exactBoundary_oneSecondLate() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "Boundary", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Warp to exactly expiresAt + VICTORY_GRACE_PERIOD (first invalid second)
        uint256 deadline = c.expiresAt() + c.VICTORY_GRACE_PERIOD();
        vm.warp(deadline);

        vm.prank(oracle);
        vm.expectRevert("Victory window closed");
        c.claimVictory(attacker1, "boundary-fail");
    }

    // ============================================================
    //  PULL PATTERN: Winner == Defender (same address)
    // ============================================================

    function test_pullPattern_winnerIsDefender() public {
        // Defender creates a challenge and also "wins" it
        // (unlikely but possible if defender tests their own challenge)
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "SelfWin", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record attempt to generate defender earnings
        vm.prank(oracle);
        c.recordAttempt{value: MSG_PRICE}(defender, keccak256("self"));

        uint256 prize = c.prizePool();
        uint256 defEarnings = c.defenderEarnings();

        // Oracle awards victory to defender
        vm.prank(oracle);
        c.claimVictory(defender, "self-win");

        // pendingWithdrawals should contain BOTH prize and defender earnings
        assertEq(c.pendingWithdrawals(defender), prize + defEarnings);

        // Single withdraw gets both
        uint256 defenderBefore = defender.balance;
        vm.prank(defender);
        c.withdraw();
        assertEq(defender.balance - defenderBefore, prize + defEarnings);
        assertEq(c.pendingWithdrawals(defender), 0);
    }

    // ============================================================
    //  PULL PATTERN: Multiple challenges accumulate for feeCollector
    // ============================================================

    function test_pullPattern_multiChallengeFeeAccumulation() public {
        // Create 3 tournaments, each with attempts
        address[3] memory challenges;
        vm.startPrank(defender);
        for (uint256 i = 0; i < 3; i++) {
            challenges[i] = factory.createTournament{value: PRIZE}(
                "Multi", MSG_PRICE, DURATION, SECRET_HASH, MODEL
            );
        }
        vm.stopPrank();

        // Oracle records 2 attempts on each challenge
        uint256 expectedProtocolFee = (MSG_PRICE * 1000) / 10000;
        vm.startPrank(oracle);
        for (uint256 i = 0; i < 3; i++) {
            Challenge c = Challenge(payable(challenges[i]));
            c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256(abi.encode(i, 0)));
            c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256(abi.encode(i, 1)));
        }
        vm.stopPrank();

        // Each challenge has its own pendingWithdrawals for feeCollector
        // feeCollector must withdraw from each challenge separately
        for (uint256 i = 0; i < 3; i++) {
            Challenge c = Challenge(payable(challenges[i]));
            assertEq(c.pendingWithdrawals(feeCollector), expectedProtocolFee * 2);

            uint256 before = feeCollector.balance;
            vm.prank(feeCollector);
            c.withdraw();
            assertEq(feeCollector.balance - before, expectedProtocolFee * 2);
        }
    }

    // ============================================================
    //  PULL PATTERN: Withdraw after expiry + claimExpiry
    // ============================================================

    function test_pullPattern_withdrawAfterExpiry() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "ExpiryWithdraw", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record attempts (generates feeCollector pending balance)
        vm.startPrank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a1"));
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a2"));
        vm.stopPrank();

        uint256 feeCollPending = c.pendingWithdrawals(feeCollector);
        assertGt(feeCollPending, 0);

        // Expire and claim
        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        // Defender can withdraw their returned funds
        uint256 defPending = c.pendingWithdrawals(defender);
        assertGt(defPending, 0);

        vm.prank(defender);
        c.withdraw();
        assertEq(c.pendingWithdrawals(defender), 0);

        // FeeCollector can ALSO still withdraw their accumulated fees
        vm.prank(feeCollector);
        c.withdraw();
        assertEq(c.pendingWithdrawals(feeCollector), 0);

        // Contract should be nearly empty (only dust if any)
        assertLe(address(c).balance, 10, "Should be empty or near-empty");
    }

    // ============================================================
    //  ACCOUNTING INVARIANT: Full lifecycle
    // ============================================================

    function test_invariant_fullLifecycleAccounting() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "FullLifecycle", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // 10 attempts from two attackers
        vm.startPrank(oracle);
        for (uint256 i = 0; i < 5; i++) {
            c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256(abi.encode("a1", i)));
            c.recordAttempt{value: MSG_PRICE}(attacker2, keccak256(abi.encode("a2", i)));
        }
        vm.stopPrank();

        // Check invariant: tracked obligations <= balance
        uint256 obligations = c.prizePool() + c.defenderEarnings() + c.pendingWithdrawals(feeCollector);
        assertLe(obligations, address(c).balance, "Obligations should not exceed balance");

        // Oracle claims victory for attacker1
        vm.prank(oracle);
        c.claimVictory(attacker1, "lifecycle");

        // Post-victory: all obligations moved to pendingWithdrawals
        uint256 postVictoryObligations = c.pendingWithdrawals(attacker1)
            + c.pendingWithdrawals(defender)
            + c.pendingWithdrawals(feeCollector);
        assertLe(postVictoryObligations, address(c).balance, "Post-victory obligations <= balance");

        // Everyone withdraws
        vm.prank(attacker1);
        c.withdraw();
        vm.prank(defender);
        c.withdraw();
        vm.prank(feeCollector);
        c.withdraw();

        // Nothing owed, only dust remains
        assertEq(c.pendingWithdrawals(attacker1), 0);
        assertEq(c.pendingWithdrawals(defender), 0);
        assertEq(c.pendingWithdrawals(feeCollector), 0);
        assertLe(address(c).balance, 10, "Only dust should remain");
    }

    // ============================================================
    //  FUZZ: Full cycle with arbitrary prize and multiple attempts
    // ============================================================

    function testFuzz_fullCycleAccounting(uint256 prize, uint8 numAttempts) public {
        prize = bound(prize, 0.1 ether, 10 ether);
        numAttempts = uint8(bound(numAttempts, 1, 20));

        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: prize}(
            "FuzzCycle", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record attempts
        vm.startPrank(oracle);
        for (uint256 i = 0; i < numAttempts; i++) {
            c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256(abi.encode(i)));
        }
        vm.stopPrank();

        // Invariant holds
        uint256 obligations = c.prizePool() + c.defenderEarnings() + c.pendingWithdrawals(feeCollector);
        assertLe(obligations, address(c).balance, "Pre-victory invariant");

        // Claim victory
        vm.prank(oracle);
        c.claimVictory(attacker1, "fuzz");

        // All withdraw
        vm.prank(attacker1);
        c.withdraw();
        if (c.pendingWithdrawals(defender) > 0) {
            vm.prank(defender);
            c.withdraw();
        }
        vm.prank(feeCollector);
        c.withdraw();

        // At most numAttempts * 3 wei of dust
        assertLe(address(c).balance, uint256(numAttempts) * 3, "Dust bounded");
    }

    // ============================================================
    //  EDGE: claimExpiry during grace period
    // ============================================================

    function test_claimExpiry_duringGracePeriod() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "GraceExpiry", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Warp into grace period (after expiry but within grace)
        vm.warp(block.timestamp + DURATION + 30 minutes);

        // Both claimExpiry and claimVictory are available during grace period
        // claimExpiry should work (block.timestamp >= expiresAt)
        c.claimExpiry();
        assertFalse(c.active());

        // Now claimVictory is blocked (already ended)
        vm.prank(oracle);
        vm.expectRevert("Challenge ended");
        c.claimVictory(attacker1, "too-late");
    }

    // ============================================================
    //  EDGE: Pause does not block withdraw
    // ============================================================

    function test_pauseDoesNotBlockWithdraw() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "PauseWithdraw", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Oracle records attempt and claims victory
        vm.startPrank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a1"));
        c.claimVictory(attacker1, "chat");
        vm.stopPrank();

        // Owner pauses the challenge
        factory.pauseChallenge(challengeAddr);

        // Winner should still be able to withdraw (pause only affects recordAttempt)
        vm.prank(attacker1);
        c.withdraw();
        assertEq(c.pendingWithdrawals(attacker1), 0);
    }

    // ============================================================
    //  EDGE: Withdraw emits event
    // ============================================================

    function test_withdrawEmitsEvent() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: PRIZE}(
            "EventTest", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat");

        uint256 amount = c.pendingWithdrawals(attacker1);

        vm.prank(attacker1);
        vm.expectEmit(true, false, false, true, address(c));
        emit Challenge.Withdrawal(attacker1, amount);
        c.withdraw();
    }

    // ============================================================
    //  EDGE: claimVictory with zero defender earnings (bounty)
    // ============================================================

    function test_bountyVictory_noDefenderPending() public {
        uint256 listingFee = factory.bountyListingFee();
        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: PRIZE + listingFee}(
            "BountyZeroDef", DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("b1"));
        c.claimVictory(attacker1, "bounty-win");
        vm.stopPrank();

        // Defender should have 0 pending (bounties have no defender earnings)
        assertEq(c.pendingWithdrawals(defender), 0);
        // FeeCollector should have 0 pending (bounties have no protocol fee per message)
        assertEq(c.pendingWithdrawals(feeCollector), 0);
        // Winner gets full prize
        assertEq(c.pendingWithdrawals(attacker1), PRIZE);
    }
}
