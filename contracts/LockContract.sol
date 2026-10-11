// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract LockContract {
    address public immutable admin;
    address public immutable token;
    uint256 public nonce;

    event LockEvent(address indexed sender, address indexed receiver, uint256 amount, uint256 nonce);

    constructor(address _admin, address _token) {
        admin = _admin;
        token = _token;
    }

    function lock(uint256 amount, address receiver) external {
        require(amount > 0, "Amount must be greater than zero");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "Transfer failed");

        emit LockEvent(msg.sender, receiver, amount, nonce);
        nonce++;
    }

    function withdrawTokens(uint256 amount) external {
        require(msg.sender == admin, "Only sovereign admin");
        IERC20(token).transfer(admin, amount);
    }
}
