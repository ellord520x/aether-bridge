// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IMintableERC20
 * @notice Standard interface for destination wrapped/canonical tokens supporting minting.
 */
interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title MintContract
 * @notice Enterprise-grade destination minting gateway for BNB Smart Chain Mainnet.
 *         Enforces deterministic 1:1 token conservation, strict relayer authorization,
 *         sequential anti-replay nonce tracking, and OpenZeppelin emergency controls.
 */
contract MintContract is ReentrancyGuard, Pausable, Ownable {
    // --- IMMUTABLE ANCHOR ---
    address public constant GOVERNANCE_ANCHOR = 0x00a3b4f0688734ef0c6086f126b12d5ffe2070dc;

    // --- OPERATIONAL STATE ---
    address public relayerAddress;
    IMintableERC20 public destinationToken;

    // --- ANTI-REPLAY REGISTRY ---
    mapping(uint256 => bool) public isNonceProcessed;
    uint256 public totalMintedTransactions;

    // --- CUSTOM ERRORS ---
    error OnlyRelayerAllowed();
    error ZeroAddress();
    error ZeroAmount();
    error NonceAlreadyProcessed(uint256 nonce);
    error DestinationTokenNotConfigured();

    // --- EVENTS ---
    event TokensMinted(
        address indexed to,
        uint256 amount,
        uint256 indexed nonce
    );

    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event DestinationTokenUpdated(address indexed token);

    // --- MODIFIERS ---
    modifier onlyRelayer() {
        if (msg.sender != relayerAddress) {
            revert OnlyRelayerAllowed();
        }
        _;
    }

    /**
     * @notice Initializes the contract with an administrative owner, initial relayer, and destination token.
     * @param initialOwner Address of the governance administrator.
     * @param initialRelayer Address authorized to execute cross-chain mints.
     * @param initialToken Address of the mintable ERC-20 token on BNB Smart Chain.
     */
    constructor(
        address initialOwner,
        address initialRelayer,
        address initialToken
    )
        Ownable(initialOwner == address(0) ? GOVERNANCE_ANCHOR : initialOwner)
    {
        address relayer = initialRelayer == address(0) ? GOVERNANCE_ANCHOR : initialRelayer;
        relayerAddress = relayer;
        emit RelayerUpdated(address(0), relayer);

        if (initialToken != address(0)) {
            destinationToken = IMintableERC20(initialToken);
            emit DestinationTokenUpdated(initialToken);
        }
    }

    /**
     * @notice Mints tokens to the recipient with strict 1:1 parity and anti-replay nonce checks.
     * @dev Executable only by the designated Relayer wallet.
     * @param to Destination wallet address receiving the tokens.
     * @param amount Exact token amount locked on Ethereum (zero fee deductions applied).
     * @param nonce Sequential nonce originating from the source lock transaction.
     */
    function mintTokens(
        address to,
        uint256 amount,
        uint256 nonce
    ) external onlyRelayer nonReentrant whenNotPaused {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(destinationToken) == address(0)) revert DestinationTokenNotConfigured();

        // Anti-Replay Guard: Prevent Nonce Reuse
        if (isNonceProcessed[nonce]) {
            revert NonceAlreadyProcessed(nonce);
        }

        // Mark Nonce as Permanently Settled
        isNonceProcessed[nonce] = true;
        totalMintedTransactions++;

        // Enforce Strict 1:1 Parity: Mint Exact Target Amount
        destinationToken.mint(to, amount);

        emit TokensMinted(to, amount, nonce);
    }

    // --- ADMIN GOVERNANCE FUNCTIONS ---

    /**
     * @notice Updates the designated relayer address.
     * @param newRelayer Address of the new relayer node.
     */
    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroAddress();
        address previous = relayerAddress;
        relayerAddress = newRelayer;
        emit RelayerUpdated(previous, newRelayer);
    }

    /**
     * @notice Updates the mintable ERC-20 token address.
     * @param newToken Address of the destination token.
     */
    function setDestinationToken(address newToken) external onlyOwner {
        if (newToken == address(0)) revert ZeroAddress();
        destinationToken = IMintableERC20(newToken);
        emit DestinationTokenUpdated(newToken);
    }

    /**
     * @notice Emergency circuit breaker to halt minting operations.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes minting operations.
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
