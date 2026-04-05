// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ChallengeERC20.sol";
import "./ChallengeFactory.sol";
import "./interfaces/IChallenge.sol";
import "./interfaces/IWrapped0GBase.sol";

/// @title ChallengeFactoryERC20 - Creates ERC-20 token challenges for InjectMe
/// @notice Companion factory to ChallengeFactory. Deploys ChallengeERC20 contracts
///         and registers them in the main ChallengeFactory.
contract ChallengeFactoryERC20 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Wrapped 0G Base precompile address on 0G Chain
    address public constant WRAPPED_0G_ADDRESS = 0x0000000000000000000000000000000000001002;

    ChallengeFactory public immutable mainFactory;

    constructor(address _mainFactory) Ownable(msg.sender) {
        require(_mainFactory != address(0), "Invalid main factory");
        mainFactory = ChallengeFactory(_mainFactory);
    }

    // ============================================================
    //              ERC-20 CHALLENGE CREATION
    // ============================================================

    /// @notice Create a Tournament with ERC-20 prize pool
    /// @param name Human-readable challenge name
    /// @param tokenAddr ERC-20 token address for prize pool
    /// @param amount Amount of tokens for the prize pool
    /// @param msgPrice Cost per attack message in token units
    /// @param duration Challenge duration in seconds
    /// @param secretHash Keccak256 hash of the secret
    /// @param model The 0G Compute model identifier
    function createTournamentERC20(
        string calldata name,
        address tokenAddr,
        uint256 amount,
        uint256 msgPrice,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(tokenAddr != address(0), "Invalid token");
        require(amount >= mainFactory.minPrizePool(), "Prize pool too small");
        require(msgPrice > 0, "Message price required");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        uint256 tokenAmount = _resolveERC20Funding(tokenAddr, amount);

        address addr = _deployERC20Challenge(
            tokenAddr, tokenAmount, msgPrice, duration, secretHash,
            mainFactory.protocolFeeBps(), IChallenge.ChallengeType.TOURNAMENT, 0
        );

        _registerInMainFactory(addr, IChallenge.ChallengeType.TOURNAMENT, secretHash, model, tokenAddr, tokenAmount);

        return addr;
    }

    /// @notice Create a Bounty with ERC-20 prize pool
    function createBountyERC20(
        string calldata name,
        address tokenAddr,
        uint256 amount,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(tokenAddr != address(0), "Invalid token");
        require(amount >= mainFactory.minPrizePool(), "Prize pool too small");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        uint256 tokenAmount = _resolveERC20Funding(tokenAddr, amount);

        address addr = _deployERC20Challenge(
            tokenAddr, tokenAmount, 0, duration, secretHash,
            0, IChallenge.ChallengeType.BOUNTY, 0
        );

        _registerInMainFactory(addr, IChallenge.ChallengeType.BOUNTY, secretHash, model, tokenAddr, tokenAmount);

        return addr;
    }

    /// @notice Create an Alignment challenge with ERC-20 prize pool
    function createAlignmentERC20(
        string calldata name,
        address tokenAddr,
        uint256 amount,
        uint256 rewardPerAttempt,
        uint256 duration,
        bytes32 secretHash,
        string calldata model
    ) external payable nonReentrant returns (address) {
        require(tokenAddr != address(0), "Invalid token");
        require(amount >= mainFactory.minPrizePool(), "Prize pool too small");
        require(rewardPerAttempt > 0, "Reward must be > 0");
        require(rewardPerAttempt <= amount, "Reward exceeds prize pool");
        require(bytes(name).length > 0, "Name required");
        require(bytes(model).length > 0, "Model required");

        uint256 tokenAmount = _resolveERC20Funding(tokenAddr, amount);

        address addr = _deployERC20Challenge(
            tokenAddr, tokenAmount, 0, duration, secretHash,
            0, IChallenge.ChallengeType.ALIGNMENT, rewardPerAttempt
        );

        _registerInMainFactory(addr, IChallenge.ChallengeType.ALIGNMENT, secretHash, model, tokenAddr, tokenAmount);

        return addr;
    }

    // ============================================================
    //                    INTERNAL
    // ============================================================

    /// @dev Deploy a ChallengeERC20 and transfer tokens to it
    function _deployERC20Challenge(
        address tokenAddr,
        uint256 tokenAmount,
        uint256 msgPrice,
        uint256 duration,
        bytes32 secretHash,
        uint256 feeBps,
        IChallenge.ChallengeType cType,
        uint256 reward
    ) internal returns (address) {
        ChallengeERC20 challenge = new ChallengeERC20(
            ChallengeERC20.ConstructorParams({
                token: tokenAddr,
                prizeAmount: tokenAmount,
                defender: msg.sender,
                feeCollector: mainFactory.feeCollector(),
                oracle: mainFactory.oracle(),
                messagePrice: msgPrice,
                duration: duration,
                secretHash: secretHash,
                protocolFeeBps: feeBps,
                challengeType: cType,
                rewardPerAttempt: reward,
                factory: address(mainFactory)
            })
        );

        IERC20(tokenAddr).safeTransfer(address(challenge), tokenAmount);
        return address(challenge);
    }

    /// @dev Register the deployed challenge in the main factory
    function _registerInMainFactory(
        address addr,
        IChallenge.ChallengeType cType,
        bytes32 secretHash,
        string calldata model,
        address tokenAddr,
        uint256 tokenAmount
    ) internal {
        mainFactory.registerExternalChallenge(
            ChallengeFactory.ExternalChallengeParams({
                challenge: addr,
                challengeType: cType,
                defender: msg.sender,
                secretHash: secretHash,
                model: model,
                tokenAddr: tokenAddr,
                prizeAmount: tokenAmount
            })
        );
    }

    /// @dev Resolve ERC-20 funding: if token is Wrapped0G and msg.value sent, auto-wrap.
    ///      Otherwise, transfer tokens from msg.sender.
    function _resolveERC20Funding(address tokenAddr, uint256 amount) internal returns (uint256) {
        if (tokenAddr == WRAPPED_0G_ADDRESS && msg.value > 0) {
            require(msg.value >= amount, "Insufficient native 0G");
            IWrapped0GBase(WRAPPED_0G_ADDRESS).deposit{value: amount}();
            if (msg.value > amount) {
                (bool refunded,) = msg.sender.call{value: msg.value - amount}("");
                require(refunded, "Refund failed");
            }
            return amount;
        } else {
            require(msg.value == 0, "Native ETH not accepted for ERC20 challenge");
            IERC20(tokenAddr).safeTransferFrom(msg.sender, address(this), amount);
            return amount;
        }
    }
}
