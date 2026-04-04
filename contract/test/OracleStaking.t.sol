// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/OracleStaking.sol";
import "../src/ChallengeFactory.sol";
import "../src/Challenge.sol";
import "../src/interfaces/IChallenge.sol";

contract OracleStakingTest is Test {
    OracleStaking public staking;
    ChallengeFactory public factory;

    address public owner = address(this);
    address public feeCollector = makeAddr("feeCollector");
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");

    address public oracle1 = makeAddr("oracle1");
    address public oracle2 = makeAddr("oracle2");
    address public oracle3 = makeAddr("oracle3");
    address public oracle4 = makeAddr("oracle4");
    address public oracle5 = makeAddr("oracle5");
    address public nobody = makeAddr("nobody");

    uint256 constant MIN_STAKE = 1000 ether;
    uint256 constant CONFIRMATIONS_REQUIRED = 3;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("oracle-secret");
    string constant MODEL = "deepseek-chat-v3-0324";

    // Allow the test contract to receive slashed ETH
    receive() external payable {}

    function setUp() public {
        staking = new OracleStaking(MIN_STAKE, CONFIRMATIONS_REQUIRED);

        // Fund oracles
        vm.deal(oracle1, 10_000 ether);
        vm.deal(oracle2, 10_000 ether);
        vm.deal(oracle3, 10_000 ether);
        vm.deal(oracle4, 10_000 ether);
        vm.deal(oracle5, 10_000 ether);
        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(nobody, 100 ether);
    }

    // ============================================================
    //                    STAKING
    // ============================================================

    function test_stake_belowMinimum() public {
        vm.prank(oracle1);
        staking.stake{value: 100 ether}();

        (uint256 staked,,,,bool isActive,,) = staking.getOperator(oracle1);
        assertEq(staked, 100 ether);
        assertFalse(isActive); // Below minimum, not active
    }

    function test_stake_meetsMinimum() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        (uint256 staked,,,,bool isActive,,) = staking.getOperator(oracle1);
        assertEq(staked, MIN_STAKE);
        assertTrue(isActive);
        assertEq(staking.getActiveOracleCount(), 1);
    }

    function test_stake_incrementalToMinimum() public {
        vm.startPrank(oracle1);
        staking.stake{value: 500 ether}();
        assertFalse(staking.isActiveOracle(oracle1));

        staking.stake{value: 500 ether}();
        assertTrue(staking.isActiveOracle(oracle1));
        vm.stopPrank();
    }

    function test_stake_revert_zeroValue() public {
        vm.prank(oracle1);
        vm.expectRevert("Must stake > 0");
        staking.stake();
    }

    // ============================================================
    //                    UNSTAKING WITH TIMELOCK
    // ============================================================

    function test_unstake_requestAndComplete() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE + 500 ether}();

        // Unstake portion (stays above minimum)
        vm.prank(oracle1);
        staking.unstake(500 ether);

        (uint256 staked, uint256 pending, uint256 requestedAt,,,,) = staking.getOperator(oracle1);
        assertEq(staked, MIN_STAKE);
        assertEq(pending, 500 ether);
        assertGt(requestedAt, 0);

        // Cannot complete before timelock
        vm.prank(oracle1);
        vm.expectRevert("Timelock not expired");
        staking.completeUnstake();

        // Warp past timelock
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balBefore = oracle1.balance;
        vm.prank(oracle1);
        staking.completeUnstake();
        assertEq(oracle1.balance - balBefore, 500 ether);
    }

    function test_unstake_revert_belowMinimumWhileActive() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(oracle1);
        vm.expectRevert("Cannot unstake below minimum while active");
        staking.unstake(1 ether);
    }

    function test_unstake_revert_insufficientStake() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(oracle1);
        vm.expectRevert("Insufficient stake");
        staking.unstake(MIN_STAKE + 1 ether);
    }

    function test_unstake_revert_zeroAmount() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(oracle1);
        vm.expectRevert("Amount must be > 0");
        staking.unstake(0);
    }

    function test_unstake_afterDeactivation() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(oracle1);
        staking.deactivate();

        // Should now be able to unstake fully
        vm.prank(oracle1);
        staking.unstake(MIN_STAKE);

        (uint256 staked,,,,bool isActive,,) = staking.getOperator(oracle1);
        assertEq(staked, 0);
        assertFalse(isActive);
    }

    function test_completeUnstake_revert_noPending() public {
        vm.prank(oracle1);
        vm.expectRevert("No pending unstake");
        staking.completeUnstake();
    }

    // ============================================================
    //            ACTIVE ORACLE SET MANAGEMENT
    // ============================================================

    function test_activeOracleSet() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle2);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle3);
        staking.stake{value: MIN_STAKE}();

        assertEq(staking.getActiveOracleCount(), 3);

        address[] memory active = staking.getActiveOracles();
        assertEq(active.length, 3);

        assertTrue(staking.isActiveOracle(oracle1));
        assertTrue(staking.isActiveOracle(oracle2));
        assertTrue(staking.isActiveOracle(oracle3));
        assertFalse(staking.isActiveOracle(nobody));
    }

    function test_deactivate() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(oracle1);
        staking.deactivate();

        assertFalse(staking.isActiveOracle(oracle1));
        assertEq(staking.getActiveOracleCount(), 0);
    }

    function test_deactivate_revert_notActive() public {
        vm.prank(nobody);
        vm.expectRevert("Not active");
        staking.deactivate();
    }

    // ============================================================
    //        JUDGMENT SUBMISSION AND CONFIRMATION (M-of-N)
    // ============================================================

    function _setupOracles() internal {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle2);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle3);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle4);
        staking.stake{value: MIN_STAKE}();
        vm.prank(oracle5);
        staking.stake{value: MIN_STAKE}();
    }

    function test_submitJudgment() public {
        _setupOracles();

        address challengeAddr = makeAddr("challenge");

        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(challengeAddr, attacker1, "chat-123");

        (address challenge, address proposedWinner, string memory chatID,
         uint256 confirmations, bool executed,, address submitter) = staking.getJudgment(judgmentId);

        assertEq(challenge, challengeAddr);
        assertEq(proposedWinner, attacker1);
        assertEq(chatID, "chat-123");
        assertEq(confirmations, 1);
        assertFalse(executed);
        assertEq(submitter, oracle1);
        assertTrue(staking.hasConfirmed(judgmentId, oracle1));
    }

    function test_submitJudgment_revert_notActive() public {
        vm.prank(nobody);
        vm.expectRevert("Not active oracle");
        staking.submitJudgment(makeAddr("c"), attacker1, "chat");
    }

    function test_confirmJudgment() public {
        _setupOracles();

        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(makeAddr("c"), attacker1, "chat");

        vm.prank(oracle2);
        staking.confirmJudgment(judgmentId);

        (,,, uint256 confirmations,,,) = staking.getJudgment(judgmentId);
        assertEq(confirmations, 2);
        assertTrue(staking.hasConfirmed(judgmentId, oracle2));
    }

    function test_confirmJudgment_revert_alreadyConfirmed() public {
        _setupOracles();

        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(makeAddr("c"), attacker1, "chat");

        vm.prank(oracle1);
        vm.expectRevert("Already confirmed");
        staking.confirmJudgment(judgmentId);
    }

    function test_confirmJudgment_revert_notActive() public {
        _setupOracles();

        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(makeAddr("c"), attacker1, "chat");

        vm.prank(nobody);
        vm.expectRevert("Not active oracle");
        staking.confirmJudgment(judgmentId);
    }

    function test_confirmJudgment_revert_notFound() public {
        _setupOracles();

        vm.prank(oracle1);
        vm.expectRevert("Judgment not found");
        staking.confirmJudgment(999);
    }

    // ============================================================
    //        JUDGMENT EXECUTION AFTER THRESHOLD
    // ============================================================

    function test_executeJudgment_afterThreshold() public {
        _setupOracles();

        // Create a real challenge with the staking contract as oracle
        factory = new ChallengeFactory(feeCollector, address(staking));

        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: 1 ether}(
            "Oracle Test", 0.01 ether, DURATION, SECRET_HASH, MODEL
        );

        // Submit judgment
        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(challengeAddr, attacker1, "chat-exec");

        // Confirm by oracle2 and oracle3
        vm.prank(oracle2);
        staking.confirmJudgment(judgmentId);

        // Not enough confirmations yet (need 3)
        vm.prank(oracle1);
        vm.expectRevert("Insufficient confirmations");
        staking.executeJudgment(judgmentId);

        vm.prank(oracle3);
        staking.confirmJudgment(judgmentId);

        // Now execute
        vm.prank(oracle1);
        staking.executeJudgment(judgmentId);

        (,,,, bool executed,,) = staking.getJudgment(judgmentId);
        assertTrue(executed);

        // Challenge should be won
        Challenge c = Challenge(payable(challengeAddr));
        assertFalse(c.active());
        assertEq(c.winner(), attacker1);
    }

    function test_executeJudgment_revert_alreadyExecuted() public {
        _setupOracles();

        factory = new ChallengeFactory(feeCollector, address(staking));

        vm.prank(defender);
        address challengeAddr = factory.createTournament{value: 1 ether}(
            "Double Exec", 0.01 ether, DURATION, SECRET_HASH, MODEL
        );

        vm.prank(oracle1);
        uint256 judgmentId = staking.submitJudgment(challengeAddr, attacker1, "chat");
        vm.prank(oracle2);
        staking.confirmJudgment(judgmentId);
        vm.prank(oracle3);
        staking.confirmJudgment(judgmentId);

        vm.prank(oracle1);
        staking.executeJudgment(judgmentId);

        vm.prank(oracle1);
        vm.expectRevert("Already executed");
        staking.executeJudgment(judgmentId);
    }

    function test_executeJudgment_revert_notFound() public {
        vm.expectRevert("Judgment not found");
        staking.executeJudgment(999);
    }

    // ============================================================
    //                    SLASHING
    // ============================================================

    function test_slash() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        bytes32 evidence = keccak256("malicious-behavior");

        uint256 ownerBefore = owner.balance;
        staking.slash(oracle1, evidence);

        uint256 slashAmount = MIN_STAKE / 2;
        (uint256 staked,,,,bool isActive,,uint256 slashed) = staking.getOperator(oracle1);
        assertEq(staked, MIN_STAKE - slashAmount);
        assertEq(slashed, 1);

        // Below minimum, should be deactivated
        assertFalse(isActive);

        // Slashed funds go to owner
        assertEq(owner.balance - ownerBefore, slashAmount);
    }

    function test_slash_revert_notOwner() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nobody));
        staking.slash(oracle1, keccak256("evidence"));
    }

    function test_slash_revert_nothingToSlash() public {
        vm.expectRevert("Nothing to slash");
        staking.slash(nobody, keccak256("evidence"));
    }

    function test_slash_revert_noEvidence() public {
        vm.prank(oracle1);
        staking.stake{value: MIN_STAKE}();

        vm.expectRevert("Evidence required");
        staking.slash(oracle1, bytes32(0));
    }

    // ============================================================
    //                    REWARDS
    // ============================================================

    function test_distributeRewards() public {
        _setupOracles();

        uint256 rewardTotal = 10 ether;
        staking.distributeRewards{value: rewardTotal}();

        uint256 rewardPerOracle = rewardTotal / 5;

        (,,, uint256 rewards1,,,) = staking.getOperator(oracle1);
        assertEq(rewards1, rewardPerOracle);

        (,,, uint256 rewards2,,,) = staking.getOperator(oracle2);
        assertEq(rewards2, rewardPerOracle);
    }

    function test_claimRewards() public {
        _setupOracles();

        staking.distributeRewards{value: 10 ether}();

        uint256 rewardPerOracle = 10 ether / 5;
        uint256 balBefore = oracle1.balance;

        vm.prank(oracle1);
        staking.claimRewards();

        assertEq(oracle1.balance - balBefore, rewardPerOracle);

        (,,, uint256 rewards,,,) = staking.getOperator(oracle1);
        assertEq(rewards, 0);
    }

    function test_claimRewards_revert_noRewards() public {
        vm.prank(nobody);
        vm.expectRevert("No rewards");
        staking.claimRewards();
    }

    function test_distributeRewards_revert_noActive() public {
        vm.expectRevert("No active oracles");
        staking.distributeRewards{value: 1 ether}();
    }

    function test_distributeRewards_revert_zeroValue() public {
        _setupOracles();

        vm.expectRevert("No rewards to distribute");
        staking.distributeRewards();
    }

    // ============================================================
    //                    ADMIN
    // ============================================================

    function test_setMinStake() public {
        uint256 newMin = 2000 ether;
        staking.setMinStake(newMin);
        assertEq(staking.minStake(), newMin);
    }

    function test_setMinStake_revert_zero() public {
        vm.expectRevert("Min stake must be > 0");
        staking.setMinStake(0);
    }

    function test_setMinStake_revert_notOwner() public {
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nobody));
        staking.setMinStake(1 ether);
    }

    function test_setConfirmationsRequired() public {
        staking.setConfirmationsRequired(5);
        assertEq(staking.confirmationsRequired(), 5);
    }

    function test_setConfirmationsRequired_revert_zero() public {
        vm.expectRevert("Must be > 0");
        staking.setConfirmationsRequired(0);
    }

    // ============================================================
    //        INTEGRATION WITH CHALLENGEFACTORY
    // ============================================================

    function test_factoryOracleStakingIntegration() public {
        factory = new ChallengeFactory(feeCollector, address(staking));
        factory.setOracleStaking(address(staking));

        assertEq(factory.oracleStaking(), address(staking));
    }

    function test_factoryOracleStaking_revert_alreadySet() public {
        factory = new ChallengeFactory(feeCollector, address(staking));
        factory.setOracleStaking(address(staking));

        vm.expectRevert("OracleStaking already set");
        factory.setOracleStaking(makeAddr("newStaking"));
    }

    function test_factoryOracleStaking_revert_zeroAddress() public {
        factory = new ChallengeFactory(feeCollector, address(staking));

        vm.expectRevert("Invalid OracleStaking");
        factory.setOracleStaking(address(0));
    }

    // ============================================================
    //                    CONSTRUCTOR
    // ============================================================

    function test_constructor() public view {
        assertEq(staking.minStake(), MIN_STAKE);
        assertEq(staking.confirmationsRequired(), CONFIRMATIONS_REQUIRED);
        assertEq(staking.owner(), owner);
        assertEq(staking.getActiveOracleCount(), 0);
    }

    function test_constructor_revert_zeroMinStake() public {
        vm.expectRevert("Min stake must be > 0");
        new OracleStaking(0, 3);
    }

    function test_constructor_revert_zeroConfirmations() public {
        vm.expectRevert("Confirmations must be > 0");
        new OracleStaking(MIN_STAKE, 0);
    }

    // ============================================================
    //              DIRECT ETH REJECTED
    // ============================================================

    function test_directETH_rejected() public {
        vm.deal(nobody, 5 ether);
        vm.prank(nobody);
        (bool sent,) = address(staking).call{value: 1 ether}("");
        assertFalse(sent);
    }

    // ============================================================
    //                    FUZZ TESTS
    // ============================================================

    function testFuzz_stakeAmount(uint256 amount) public {
        amount = bound(amount, 1 wei, 100_000 ether);

        vm.deal(oracle1, amount);
        vm.prank(oracle1);
        staking.stake{value: amount}();

        (uint256 staked,,,,bool isActive,,) = staking.getOperator(oracle1);
        assertEq(staked, amount);
        assertEq(isActive, amount >= MIN_STAKE);
    }

    function testFuzz_unstakePartial(uint256 stakeAmount, uint256 unstakeAmount) public {
        stakeAmount = bound(stakeAmount, MIN_STAKE, 50_000 ether);
        // Can only unstake down to minStake while active
        uint256 maxUnstake = stakeAmount - MIN_STAKE;
        vm.assume(maxUnstake > 0);
        unstakeAmount = bound(unstakeAmount, 1, maxUnstake);

        vm.deal(oracle1, stakeAmount);
        vm.prank(oracle1);
        staking.stake{value: stakeAmount}();

        vm.prank(oracle1);
        staking.unstake(unstakeAmount);

        (uint256 staked, uint256 pending,,,,,) = staking.getOperator(oracle1);
        assertEq(staked, stakeAmount - unstakeAmount);
        assertEq(pending, unstakeAmount);
    }
}
