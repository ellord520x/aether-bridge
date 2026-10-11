// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

contract MintContract {
    address public immutable admin;
    address public relayer;
    address public immutable token;
    mapping(uint256 => bool) public processedNonces;

    event MintEvent(address indexed receiver, uint256 amount, uint256 nonce);

    constructor(address _admin, address _relayer, address _token) {
        admin = _admin;
        relayer = _relayer;
        token = _token;
    }

    function setRelayer(address _relayer) external {
        require(msg.sender == admin, "Only sovereign admin");
        relayer = _relayer;
    }

    function mintTokens(address receiver, uint256 amount, uint256 nonce) external {
        require(msg.sender == relayer, "Only authorized relayer can mint");
        require(!processedNonces[nonce], "Nonce already processed - Replay attack prevented");

        processedNonces[nonce] = true;
        IMintableToken(token).mint(receiver, amount);

        emit MintEvent(receiver, amount, nonce);
    }
}
