// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChallengeFactory.sol";
import "../src/ChallengeFactoryERC20.sol";
import "../src/ChallengeERC20.sol";
import "../src/interfaces/IChallenge.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Standard ERC-20 mock for testing
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _decimals = dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/// @dev ERC-20 that does not return a bool on transfer (like USDT)
contract NonStandardERC20 {
    string public name = "NoReturn";
    string public symbol = "NR";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        // No return value (non-standard)
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not approved");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        // No return value
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract ChallengeERC20Test is Test {
    ChallengeFactory public factory;
    ChallengeFactoryERC20 public erc20Factory;
    MockERC20 public token;
    MockERC20 public usdc; // 6 decimal token

    address public owner = address(this);
    address public feeCollector = makeAddr("feeCollector");
    address public oracle = makeAddr("oracle");
    address public defender = makeAddr("defender");
    address public attacker1 = makeAddr("attacker1");
    address public attacker2 = makeAddr("attacker2");

    uint256 constant PRIZE_POOL = 1000e18;
    uint256 constant MSG_PRICE = 10e18;
    uint256 constant DURATION = 7 days;
    bytes32 constant SECRET_HASH = keccak256("erc20-secret");
    string constant MODEL = "deepseek-chat-v3-0324";

    function setUp() public {
        factory = new ChallengeFactory(feeCollector, oracle);
        erc20Factory = new ChallengeFactoryERC20(address(factory));
        factory.setERC20Factory(address(erc20Factory));

        token = new MockERC20("Test Token", "TT", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Fund accounts
        token.mint(defender, 100_000e18);
        token.mint(attacker1, 100_000e18);
        token.mint(oracle, 100_000e18);

        usdc.mint(defender, 100_000e6);

        vm.deal(defender, 100 ether);
        vm.deal(attacker1, 100 ether);
        vm.deal(oracle, 100 ether);
    }

    // ============================================================
    //              ERC-20 TOURNAMENT CREATION
    // ============================================================

    function test_createTournamentERC20() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "ERC20 Tournament", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        assertTrue(factory.isChallenge(challengeAddr));
        assertEq(factory.getTournamentCount(), 1);

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));
        assertEq(c.defender(), defender);
        assertEq(c.messagePrice(), MSG_PRICE);
        assertEq(c.prizePool(), PRIZE_POOL);
        assertTrue(c.active());
        assertEq(address(c.token()), address(token));
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.TOURNAMENT));

        // Token balance should be in the challenge
        assertEq(token.balanceOf(challengeAddr), PRIZE_POOL);
    }

    function test_createTournamentERC20_revert_noApproval() public {
        vm.prank(defender);
        vm.expectRevert(); // SafeERC20 will revert
        erc20Factory.createTournamentERC20(
            "No Approve", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
    }

    function test_createTournamentERC20_revert_nativeETH() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        vm.expectRevert("Native ETH not accepted for ERC20 challenge");
        erc20Factory.createTournamentERC20{value: 1 ether}(
            "ETH Reject", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();
    }

    function test_createTournamentERC20_revert_zeroToken() public {
        vm.prank(defender);
        vm.expectRevert("Invalid token");
        erc20Factory.createTournamentERC20(
            "Zero", address(0), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
    }

    // ============================================================
    //           ERC-20 FEE DISTRIBUTION
    // ============================================================

    function test_erc20_tournament_feeSplit() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Fee Split", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        // Oracle needs to approve the challenge for fee transfer
        vm.startPrank(oracle);
        token.approve(challengeAddr, MSG_PRICE);
        c.recordAttempt(attacker1, keccak256("a1"));
        vm.stopPrank();

        assertEq(c.totalAttempts(), 1);

        uint256 expectedPool = PRIZE_POOL + (MSG_PRICE * 8000) / 10000;
        uint256 expectedDefenderEarnings = (MSG_PRICE * 1000) / 10000;
        uint256 expectedProtocolFee = (MSG_PRICE * 1000) / 10000;

        assertEq(c.prizePool(), expectedPool);
        assertEq(c.defenderEarnings(), expectedDefenderEarnings);
        assertEq(c.pendingWithdrawals(feeCollector), expectedProtocolFee);
    }

    // ============================================================
    //          ERC-20 WITHDRAWAL
    // ============================================================

    function test_erc20_withdraw() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Withdraw", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-erc20");

        uint256 balBefore = token.balanceOf(attacker1);
        vm.prank(attacker1);
        c.withdraw();
        assertEq(token.balanceOf(attacker1) - balBefore, PRIZE_POOL);
    }

    // ============================================================
    //          ERC-20 VICTORY + EXPIRY
    // ============================================================

    function test_erc20_claimVictory() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Victory", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-v");

        assertFalse(c.active());
        assertEq(c.winner(), attacker1);
        assertEq(c.pendingWithdrawals(attacker1), PRIZE_POOL);
    }

    function test_erc20_claimExpiry() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Expiry", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.warp(block.timestamp + DURATION + 1);
        c.claimExpiry();

        assertFalse(c.active());
        assertEq(c.pendingWithdrawals(defender), PRIZE_POOL);

        // Defender withdraws
        uint256 balBefore = token.balanceOf(defender);
        vm.prank(defender);
        c.withdraw();
        assertEq(token.balanceOf(defender) - balBefore, PRIZE_POOL);
    }

    // ============================================================
    //          DIFFERENT DECIMALS
    // ============================================================

    function test_erc20_6decimals_usdc() public {
        // Lower the minPrizePool for USDC since it uses 6 decimals
        factory.setMinPrizePool(100e6); // 100 USDC minimum
        uint256 usdcPrize = 1000e6; // 1000 USDC
        uint256 usdcMsgPrice = 1e6; // 1 USDC

        vm.startPrank(defender);
        usdc.approve(address(erc20Factory), usdcPrize);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "USDC Tournament", address(usdc), usdcPrize, usdcMsgPrice, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));
        assertEq(c.prizePool(), usdcPrize);
        assertEq(usdc.balanceOf(challengeAddr), usdcPrize);
    }

    // ============================================================
    //          CANNOT SEND NATIVE ETH TO ERC-20 CHALLENGE
    // ============================================================

    function test_erc20_rejectsNativeETH() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "NoETH", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        vm.deal(attacker1, 5 ether);
        vm.prank(attacker1);
        (bool sent,) = challengeAddr.call{value: 1 ether}("");
        assertFalse(sent, "Native ETH should be rejected");
    }

    function test_erc20_commitRejectsNativeETH() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "NoETH", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.prank(attacker1);
        vm.expectRevert("Native ETH not accepted");
        c.commitAttempt{value: 0.1 ether}(keccak256("commit1"));
    }

    function test_erc20_recordAttemptRejectsNativeETH() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "NoETH", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.prank(oracle);
        vm.expectRevert("Native ETH not accepted");
        c.recordAttempt{value: 0.1 ether}(attacker1, keccak256("a1"));
    }

    // ============================================================
    //          NON-STANDARD TOKEN (NO RETURN VALUE)
    // ============================================================

    function test_erc20_nonStandardToken() public {
        NonStandardERC20 nsToken = new NonStandardERC20();
        nsToken.mint(defender, 100_000e18);

        vm.startPrank(defender);
        nsToken.approve(address(erc20Factory), PRIZE_POOL);
        // SafeERC20 should handle the non-standard return
        address challengeAddr = erc20Factory.createBountyERC20(
            "NonStandard", address(nsToken), PRIZE_POOL, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        assertEq(nsToken.balanceOf(challengeAddr), PRIZE_POOL);
    }

    // ============================================================
    //          ERC-20 BOUNTY
    // ============================================================

    function test_erc20_bounty() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createBountyERC20(
            "ERC20 Bounty", address(token), PRIZE_POOL, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));
        assertEq(c.prizePool(), PRIZE_POOL);
        assertEq(c.messagePrice(), 0);
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.BOUNTY));
    }

    // ============================================================
    //          ERC-20 ALIGNMENT
    // ============================================================

    function test_erc20_alignment() public {
        uint256 reward = 10e18;

        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createAlignmentERC20(
            "ERC20 Alignment", address(token), PRIZE_POOL, reward, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));
        assertEq(c.prizePool(), PRIZE_POOL);
        assertEq(c.rewardPerAttempt(), reward);
        assertEq(uint256(c.challengeType()), uint256(IChallenge.ChallengeType.ALIGNMENT));

        // Record an attempt and verify reward is paid
        vm.prank(oracle);
        c.recordAttempt(attacker1, keccak256("a1"));

        assertEq(c.pendingWithdrawals(attacker1), reward);
        assertEq(c.prizePool(), PRIZE_POOL - reward);
    }

    // ============================================================
    //          COMMIT-REVEAL WITH ERC-20
    // ============================================================

    function test_erc20_commitWithTokenApproval() public {
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "CommitReveal", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        // Attacker must approve the challenge contract for the fee
        vm.startPrank(attacker1);
        token.approve(challengeAddr, MSG_PRICE);
        c.commitAttempt(keccak256("commit1"));
        vm.stopPrank();

        // Verify the fee was transferred
        assertEq(token.balanceOf(challengeAddr), PRIZE_POOL + MSG_PRICE);
    }

    // ============================================================
    //          FULL LIFECYCLE
    // ============================================================

    function test_erc20_fullLifecycle() public {
        // Create tournament
        vm.startPrank(defender);
        token.approve(address(erc20Factory), PRIZE_POOL);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Full Lifecycle", address(token), PRIZE_POOL, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        // Record some attempts via oracle
        vm.startPrank(oracle);
        token.approve(challengeAddr, MSG_PRICE * 3);
        c.recordAttempt(attacker1, keccak256("a1"));
        c.recordAttempt(attacker1, keccak256("a2"));
        c.recordAttempt(attacker2, keccak256("a3"));
        vm.stopPrank();

        uint256 prize = c.prizePool();
        uint256 defEarnings = c.defenderEarnings();

        // Oracle declares victory
        vm.prank(oracle);
        c.claimVictory(attacker1, "chat-full");

        assertFalse(c.active());

        // Winner withdraws
        uint256 a1Before = token.balanceOf(attacker1);
        vm.prank(attacker1);
        c.withdraw();
        assertEq(token.balanceOf(attacker1) - a1Before, prize);

        // Defender withdraws earnings
        uint256 dBefore = token.balanceOf(defender);
        vm.prank(defender);
        c.withdraw();
        assertEq(token.balanceOf(defender) - dBefore, defEarnings);

        // Fee collector withdraws
        uint256 fcBefore = token.balanceOf(feeCollector);
        vm.prank(feeCollector);
        c.withdraw();
        assertGt(token.balanceOf(feeCollector) - fcBefore, 0);
    }

    // ============================================================
    //                   FUZZ TESTS
    // ============================================================

    function testFuzz_erc20_feeSplitIntegrity(uint256 prizeAmount) public {
        prizeAmount = bound(prizeAmount, 0.1 ether, 50 ether);

        token.mint(defender, prizeAmount);

        vm.startPrank(defender);
        token.approve(address(erc20Factory), prizeAmount);
        address challengeAddr = erc20Factory.createTournamentERC20(
            "Fuzz", address(token), prizeAmount, MSG_PRICE, DURATION, SECRET_HASH, MODEL
        );
        vm.stopPrank();

        ChallengeERC20 c = ChallengeERC20(payable(challengeAddr));

        vm.startPrank(oracle);
        token.approve(challengeAddr, MSG_PRICE);
        c.recordAttempt(attacker1, keccak256("fuzz"));
        vm.stopPrank();

        uint256 toPool = (MSG_PRICE * 8000) / 10000;
        uint256 toDefender = (MSG_PRICE * 1000) / 10000;
        uint256 toProtocol = (MSG_PRICE * 1000) / 10000;

        assertEq(c.prizePool(), prizeAmount + toPool);
        assertEq(c.defenderEarnings(), toDefender);
        assertEq(c.pendingWithdrawals(feeCollector), toProtocol);
        assertEq(toPool + toDefender + toProtocol, MSG_PRICE);
    }
}
