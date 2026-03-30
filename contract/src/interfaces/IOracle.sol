// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IOracle - Oracle interface for ERC-7857 proof verification
interface IOracle {
    function verifyProof(bytes calldata proof) external view returns (bool);
}
