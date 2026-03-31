// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IWrapped0GBase - Interface for the 0G Chain wrapped native token precompile
/// @notice Precompile at 0x0000000000000000000000000000000000001002 on 0G Chain
/// @dev ERC-20 compatible interface for wrapping/unwrapping native 0G tokens
interface IWrapped0GBase {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}
