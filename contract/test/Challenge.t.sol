// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChallengeFactory.sol";
import "../src/Challenge.sol";
import "../src/interfaces/IChallenge.sol";

contract ChallengeTest is Test {
    ChallengeFactory public factory;

    address public owner = address(this);
    address public feeCollector = makeAddr("feeCollector");
    address public oracle = makeAddr("oracle");
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");
    address public attacker2 = makeAddr("attacker2");

    uint256 constant INITIAL_PRIZE = 1 ether;
    uint256 constant MSG_PRICE = 0.01 ether;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("secret123");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        factory = new ChallengeFactory(feeCollector, oracle);

        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(attacker2, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ============================================================
    //               FACTORY: TOURNAMENT CREATION
    // ============================================================

    function test_createTournament() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        assertTrue(factory.isChallenge(challengeAddr));
        assertEq(factory.getChallengeCount(), 1);
        assertEq(factory.getTournamentCount(), 1);
        assertEq(factory.getBountyCount(), 0);

        Challenge c = Challenge(payable(challengeAddr));
        assertEq(c.defender(), defender);
        assertEq(c.messagePrice(), MSG_PRICE);
        assertEq(c.prizePool(), INITIAL_PRIZE);
        assertTrue(c.active());
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.TOURNAMENT));
    }

    function test_createTournament_revert_prizeTooSmall() public {
        vm.prank(defender);
        vm.expectRevert("Prize pool too small");
        factory.createTournament{value: 0.01 ether}(
            "Tiny", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createTournament_revert_msgPriceTooLow() public {
        vm.prank(defender);
        vm.expectRevert("Message price too low");
        factory.createTournament{value: INITIAL_PRIZE}(
            "Cheap", 0.0001 ether, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createTournament_revert_emptyName() public {
        vm.prank(defender);
        vm.expectRevert("Name required");
        factory.createTournament{value: INITIAL_PRIZE}(
            "", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
    }

    // ============================================================
    //                FACTORY: BOUNTY CREATION
    // ============================================================

    function test_createBounty() public {
        uint256 listingFee = factory.bountyListingFee();
        uint256 totalValue = INITIAL_PRIZE + listingFee;
        uint256 feeCollectorBefore = feeCollector.balance;

        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: totalValue}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );

        assertTrue(factory.isChallenge(challengeAddr));
        assertEq(factory.getBountyCount(), 1);

        Challenge c = Challenge(payable(challengeAddr));
        assertEq(c.prizePool(), INITIAL_PRIZE);
        assertEq(c.messagePrice(), 0);
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.BOUNTY));

        // Listing fee should have gone to feeCollector
        assertEq(feeCollector.balance - feeCollectorBefore, listingFee);
    }

    function test_createBounty_revert_insufficientValue() public {
        vm.prank(defender);
        vm.expectRevert("Must cover bounty + listing fee");
        factory.createBounty{value: 0.1 ether}(
            "Bad Bounty", DURATION, SECRET_HASH, MODEL
        );
    }

    // ============================================================
    //             TOURNAMENT: ATTEMPT + FEE SPLIT
    // ============================================================

    function test_tournament_recordAttempt_feeSplit() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        bytes32 storageRoot = keccak256("attempt1");

        vm.prank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, storageRoot);

        assertEq(c.totalAttempts(), 1);
        assertEq(c.attackerAttempts(attacker1), 1);
        assertEq(c.attemptStorageRoots(1), storageRoot);

        // Fee split: 80% pool, 10% defender, 10% protocol (via pendingWithdrawals)
        uint256 expectedPool = INITIAL_PRIZE + (MSG_PRICE * 8000) / 10000;
        uint256 expectedDefenderEarnings = (MSG_PRICE * 1000) / 10000;
        uint256 expectedProtocolFee = (MSG_PRICE * 1000) / 10000;

        assertEq(c.prizePool(), expectedPool);
        assertEq(c.defenderEarnings(), expectedDefenderEarnings);
        // Protocol fee now in pendingWithdrawals instead of direct send
        assertEq(c.pendingWithdrawals(feeCollector), expectedProtocolFee);
    }

    function test_tournament_recordAttempt_revert_notOracle() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("Only oracle");
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("attempt"));
    }

    function test_tournament_recordAttempt_revert_incorrectFee() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Too little
        vm.prank(oracle);
        vm.expectRevert("Incorrect fee");
        c.recordAttempt{value: 0.001 ether}(attacker1, keccak256("attempt"));

        // Too much (overpayment no longer accepted)
        vm.prank(oracle);
        vm.expectRevert("Incorrect fee");
        c.recordAttempt{value: MSG_PRICE * 2}(attacker1, keccak256("attempt2"));
    }

    // ============================================================
    //              BOUNTY: NO FEE GUARD (C-3 fix)
    // ============================================================

    function test_bounty_revert_withValue() public {
        uint256 listingFee = factory.bountyListingFee();
        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: INITIAL_PRIZE + listingFee}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        vm.expectRevert("No fee required");
        c.recordAttempt{value: 0.5 ether}(attacker1, keccak256("b1"));
    }

    // ============================================================
    //                  CLAIM VICTORY + WITHDRAW
    // ============================================================

    function test_tournament_claimVictory_and_withdraw() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Record a few attempts to grow the pool
        vm.startPrank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a1"));
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a2"));
        c.recordAttempt{value: MSG_PRICE}(attacker2, keccak256("a3"));
        vm.stopPrank();

        uint256 prize = c.prizePool();
        uint256 defEarnings = c.defenderEarnings();

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-123");

        assertFalse(c.active());
        assertEq(c.winner(), attacker1);
        assertEq(c.prizePool(), 0);
        assertEq(c.defenderEarnings(), 0);

        // Funds are in pendingWithdrawals, not sent yet
        assertEq(c.pendingWithdrawals(attacker1), prize);
        assertEq(c.pendingWithdrawals(defender), defEarnings);

        // Winner withdraws
        uint256 attackerBefore = attacker1.balance;
        vm.prank(attacker1);
        c.withdraw();
        assertEq(attacker1.balance - attackerBefore, prize);
        assertEq(c.pendingWithdrawals(attacker1), 0);

        // Defender withdraws
        uint256 defenderBefore = defender.balance;
        vm.prank(defender);
        c.withdraw();
        assertEq(defender.balance - defenderBefore, defEarnings);

        // Fee collector withdraws protocol fees
        uint256 feeCollBefore = feeCollector.balance;
        vm.prank(feeCollector);
        c.withdraw();
        assertGt(feeCollector.balance - feeCollBefore, 0);
    }

    function test_bounty_claimVictory_and_withdraw() public {
        uint256 listingFee = factory.bountyListingFee();
        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: INITIAL_PRIZE + listingFee}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.recordAttempt(attacker1, keccak256("b1"));
        c.recordAttempt(attacker1, keccak256("b2"));
        vm.stopPrank();

        uint256 prize = c.prizePool();

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-bounty-456");

        assertFalse(c.active());

        // Winner withdraws
        uint256 attackerBefore = attacker1.balance;
        vm.prank(attacker1);
        c.withdraw();
        assertEq(attacker1.balance - attackerBefore, prize);
    }

    function test_claimVictory_revert_notOracle() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("Only oracle");
        c.claimVictory(attacker1, "fake-chat");
    }

    function test_claimVictory_revert_alreadyEnded() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-123");

        vm.prank(oracle);
        vm.expectRevert("Challenge ended");
        c.claimVictory(attacker2, "chat-456");
    }

    // ============================================================
    //         H-1 FIX: Victory grace period + expiry check
    // ============================================================

    function test_claimVictory_withinGracePeriod() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "Grace", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Warp to 30 minutes after expiry (within 1h grace)
        vm.warp(block.timestamp + DURATION + 30 minutes);

        vm.prank(oracle);
        c.claimVictory(attacker1, "grace-period");
        assertFalse(c.active());
    }

    function test_claimVictory_revert_afterGracePeriod() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "Late", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        // Warp past expiry + grace period
        vm.warp(block.timestamp + DURATION + 2 hours);

        vm.prank(oracle);
        vm.expectRevert("Victory window closed");
        c.claimVictory(attacker1, "too-late");
    }

    // ============================================================
    //                   CLAIM EXPIRY + WITHDRAW
    // ============================================================

    function test_claimExpiry_tournament_and_withdraw() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("a1"));
        c.recordAttempt{value: MSG_PRICE}(attacker2, keccak256("a2"));
        vm.stopPrank();

        uint256 returnAmount = c.prizePool() + c.defenderEarnings();

        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        assertFalse(c.active());
        assertEq(c.pendingWithdrawals(defender), returnAmount);

        // Defender withdraws
        uint256 defenderBefore = defender.balance;
        vm.prank(defender);
        c.withdraw();
        assertEq(defender.balance - defenderBefore, returnAmount);
    }

    function test_claimExpiry_bounty_and_withdraw() public {
        uint256 listingFee = factory.bountyListingFee();
        vm.prank(defender);
        address challengeAddr = factory.createBounty{value: INITIAL_PRIZE + listingFee}(
            "Test Agent", DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        assertFalse(c.active());

        uint256 defenderBefore = defender.balance;
        vm.prank(defender);
        c.withdraw();
        assertEq(defender.balance - defenderBefore, INITIAL_PRIZE);
    }

    function test_claimExpiry_revert_notExpired() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.expectRevert("Not expired");
        c.claimExpiry();
    }

    function test_claimExpiry_revert_alreadyEnded() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat");

        vm.warp(block.timestamp + DURATION + 1);
        vm.expectRevert("Already ended");
        c.claimExpiry();
    }

    // ============================================================
    //              WITHDRAW EDGE CASES
    // ============================================================

    function test_withdraw_revert_nothingToWithdraw() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "Empty", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("Nothing to withdraw");
        c.withdraw();
    }

    function test_withdraw_doubleWithdraw_reverts() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "Double", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat");

        vm.startPrank(attacker1);
        c.withdraw();
        vm.expectRevert("Nothing to withdraw");
        c.withdraw();
        vm.stopPrank();
    }

    // ============================================================
    //           C-1 FIX: Direct ETH rejected
    // ============================================================

    function test_directETH_reverts() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "NoDirectETH", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        vm.deal(address(0xdead), 5 ether);
        vm.prank(address(0xdead));
        (bool sent,) = challengeAddr.call{value: 1 ether}("");
        assertFalse(sent, "Direct ETH should be rejected");
    }

    // ============================================================
    //              ATTEMPT AFTER EXPIRY / ENDED
    // ============================================================

    function test_recordAttempt_revert_afterExpiry() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(oracle);
        vm.expectRevert("Challenge expired");
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("late"));
    }

    function test_recordAttempt_revert_afterVictory() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.startPrank(oracle);
        c.claimVictory(attacker1, "chat");
        vm.expectRevert("Challenge ended");
        c.recordAttempt{value: MSG_PRICE}(attacker2, keccak256("too-late"));
        vm.stopPrank();
    }

    // ============================================================
    //                 DURATION BOUNDS
    // ============================================================

    function test_duration_tooShort() public {
        vm.prank(defender);
        vm.expectRevert("Duration too short");
        factory.createTournament{value: INITIAL_PRIZE}(
            "Short", MSG_PRICE, 30 minutes, SECRET_HASH, MODEL
        );
    }

    function test_duration_tooLong() public {
        vm.prank(defender);
        vm.expectRevert("Duration too long");
        factory.createTournament{value: INITIAL_PRIZE}(
            "Forever", MSG_PRICE, 365 days, SECRET_HASH, MODEL
        );
    }

    // ============================================================
    //                    PAUSE
    // ============================================================

    function test_pause_blocksAttempts() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        factory.pauseChallenge(challengeAddr);

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("paused"));

        factory.unpauseChallenge(challengeAddr);

        vm.prank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("unpaused"));
        assertEq(c.totalAttempts(), 1);
    }

    // ============================================================
    //               FACTORY ADMIN FUNCTIONS
    // ============================================================

    function test_factory_setOracle() public {
        address newOracle = makeAddr("newOracle");
        factory.setOracle(newOracle);
        assertEq(factory.oracle(), newOracle);
    }

    function test_factory_setOracle_revert_notOwner() public {
        vm.prank(attacker1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker1));
        factory.setOracle(makeAddr("hack"));
    }

    function test_factory_setProtocolFeeBps_revert_tooHigh() public {
        vm.expectRevert("Fee too high");
        factory.setProtocolFeeBps(5000);
    }

    function test_factory_pagination() public {
        vm.startPrank(defender);
        for (uint256 i = 0; i < 5; i++) {
            factory.createTournament{value: INITIAL_PRIZE}(
                "Challenge", MSG_PRICE, DURATION, SECRET_HASH, MODEL
            );
        }
        vm.stopPrank();

        assertEq(factory.getChallengeCount(), 5);

        address[] memory page1 = factory.getChallengesPaginated(0, 3);
        assertEq(page1.length, 3);

        address[] memory page2 = factory.getChallengesPaginated(3, 3);
        assertEq(page2.length, 2);

        address[] memory empty = factory.getChallengesPaginated(10, 3);
        assertEq(empty.length, 0);
    }

    // ============================================================
    //              SECURITY: REENTRANCY
    // ============================================================

    function test_noReentrancyOnWithdraw() public {
        ReentrantWithdrawer malicious = new ReentrantWithdrawer();
        vm.deal(address(malicious), 10 ether);

        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );

        malicious.setTarget(payable(challengeAddr));

        // Oracle claims victory for the malicious contract
        vm.prank(oracle);
        Challenge(payable(challengeAddr)).claimVictory(address(malicious), "chat");

        // Malicious contract tries to withdraw with reentrancy
        malicious.tryWithdraw();

        // Should succeed once but reentrancy blocked
        assertEq(Challenge(payable(challengeAddr)).pendingWithdrawals(address(malicious)), 0);
    }

    // ============================================================
    //              SECURITY: CEI PATTERN
    // ============================================================

    function test_prizePoolZeroedBeforeCredit() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat");

        assertEq(c.prizePool(), 0);
        assertEq(c.defenderEarnings(), 0);
    }

    // ============================================================
    //              VIEW FUNCTIONS
    // ============================================================

    function test_timeRemaining() public {
        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: INITIAL_PRIZE}(
            "The Vault", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        assertGt(c.timeRemaining(), 0);

        vm.warp(block.timestamp + DURATION + 1);
        assertEq(c.timeRemaining(), 0);
    }

    // ============================================================
    //              MULTIPLE CHALLENGES
    // ============================================================

    function test_multipleActiveChallenges() public {
        vm.startPrank(defender);
        factory.createTournament{value: INITIAL_PRIZE}("A", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: INITIAL_PRIZE}("B", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        factory.createTournament{value: INITIAL_PRIZE}("C", MSG_PRICE, DURATION, SECRET_HASH, MODEL);
        vm.stopPrank();

        address[] memory active = factory.getActiveChallenges(10);
        assertEq(active.length, 3);

        vm.prank(oracle);
        Challenge(payable(active[0])).claimVictory(attacker1, "chat");

        active = factory.getActiveChallenges(10);
        assertEq(active.length, 2);
    }

    // ============================================================
    //                  FUZZ TESTS
    // ============================================================

    function testFuzz_feeSplitIntegrity(uint256 initialPrize) public {
        initialPrize = bound(initialPrize, 0.1 ether, 50 ether);

        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: initialPrize}(
            "Fuzz", MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        Challenge c = Challenge(payable(challengeAddr));

        vm.prank(oracle);
        c.recordAttempt{value: MSG_PRICE}(attacker1, keccak256("fuzz"));

        uint256 toPool = (MSG_PRICE * 8000) / 10000;
        uint256 toDefender = (MSG_PRICE * 1000) / 10000;
        uint256 toProtocol = (MSG_PRICE * 1000) / 10000;

        assertEq(c.prizePool(), initialPrize + toPool);
        assertEq(c.defenderEarnings(), toDefender);
        assertEq(c.pendingWithdrawals(feeCollector), toProtocol);

        // All fee accounted for (no rounding dust with exact fee)
        assertEq(toPool + toDefender + toProtocol, MSG_PRICE);
    }
}

/// @dev Malicious contract that attempts reentrancy on withdraw
contract ReentrantWithdrawer {
    address payable public target;
    bool public attacked;

    function setTarget(address payable _target) external {
        target = _target;
    }

    function tryWithdraw() external {
        Challenge(target).withdraw();
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            try Challenge(target).withdraw() {} catch {}
        }
    }
}
