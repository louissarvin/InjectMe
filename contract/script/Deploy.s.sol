// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ChallengeFactory.sol";
import "../src/ChallengeFactoryERC20.sol";
import "../src/AgentNFT.sol";
import "../src/TeeOracle.sol";
import "../src/ReputationRegistry.sol";
import "../src/OracleStaking.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address feeCollector = deployer;
        address oracle = deployer;

        // OracleStaking configuration
        uint256 minStake = 1000 ether;
        uint256 confirmationsRequired = 3;

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TeeOracle (on-chain TEE attestation verifier)
        TeeOracle teeOracle = new TeeOracle(oracle);
        console.log("TeeOracle deployed at:", address(teeOracle));

        // 2. Deploy AgentNFT (ERC-7857 iNFT, uses TeeOracle as oracle)
        AgentNFT agentNFT = new AgentNFT(address(teeOracle));
        console.log("AgentNFT deployed at:", address(agentNFT));

        // 3. Deploy ReputationRegistry
        ReputationRegistry reputationRegistry = new ReputationRegistry(oracle);
        console.log("ReputationRegistry deployed at:", address(reputationRegistry));

        // 4. Deploy OracleStaking (decentralized oracle network)
        OracleStaking oracleStaking = new OracleStaking(minStake, confirmationsRequired);
        console.log("OracleStaking deployed at:", address(oracleStaking));

        // 5. Deploy ChallengeFactory
        ChallengeFactory factory = new ChallengeFactory(feeCollector, oracle);
        console.log("ChallengeFactory deployed at:", address(factory));

        // 6. Deploy ChallengeFactoryERC20 (companion for ERC-20 challenges)
        ChallengeFactoryERC20 erc20Factory = new ChallengeFactoryERC20(address(factory));
        console.log("ChallengeFactoryERC20 deployed at:", address(erc20Factory));

        // 7. Wire them together
        factory.setAgentNFT(address(agentNFT));
        factory.setReputationRegistry(address(reputationRegistry));
        factory.setOracleStaking(address(oracleStaking));
        factory.setERC20Factory(address(erc20Factory));
        agentNFT.setFactory(address(factory));
        reputationRegistry.setFactory(address(factory));

        vm.stopBroadcast();

        console.log("\n--- Deployment Summary ---");
        console.log("Chain ID:", block.chainid);
        console.log("TeeOracle:", address(teeOracle));
        console.log("AgentNFT (ERC-7857 iNFT):", address(agentNFT));
        console.log("ReputationRegistry:", address(reputationRegistry));
        console.log("OracleStaking:", address(oracleStaking));
        console.log("ChallengeFactory:", address(factory));
        console.log("ChallengeFactoryERC20:", address(erc20Factory));
        console.log("Protocol Fee:", factory.protocolFeeBps(), "bps (10%)");
        console.log("Min Stake:", minStake / 1 ether, "0G");
        console.log("Confirmations Required:", confirmationsRequired);
        console.log("Wrapped0GBase:", erc20Factory.WRAPPED_0G_ADDRESS());
    }
}
