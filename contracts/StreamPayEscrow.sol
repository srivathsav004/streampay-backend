// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title StreamPayEscrow
 * @notice Minimal x402 escrow for StreamPay services
 * @dev USDC escrow with x402 payment intents
 */
contract StreamPayEscrow is EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ============ STATE VARIABLES ============

    IERC20 public immutable usdcToken;
    address public immutable serviceWallet;

    // Escrow balances (in USDC, 6 decimals)
    mapping(address => uint256) public escrowBalances;

    // Nonces for replay protection (x402)
    mapping(address => uint256) public nonces;

    // Settled sessions (prevent double-spending)
    mapping(bytes32 => bool) public settledSessions;

    // Reentrancy guard
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ============ STRUCTS ============

    struct PaymentIntent {
        address payer;
        bytes32 sessionId;
        uint256 amount; // USDC amount (6 decimals)
        uint256 deadline;
        uint256 nonce;
        bytes signature;
    }

    // ============ EVENTS ============

    event Deposited(
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    event Withdrawn(
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    event PaymentExecuted(
        address indexed payer,
        bytes32 indexed sessionId,
        uint256 amount,
        string serviceType,
        uint256 timestamp
    );

    // ============ MODIFIERS ============

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _usdcToken,
        address _serviceWallet
    ) EIP712("StreamPay", "1") {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_serviceWallet != address(0), "Invalid service wallet");
        
        usdcToken = IERC20(_usdcToken);
        serviceWallet = _serviceWallet;
        _status = _NOT_ENTERED;
    }

    // ============ ESCROW FUNCTIONS ============

    /**
     * @notice Deposit USDC into escrow
     * @param amount Amount of USDC (6 decimals)
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        // Transfer USDC from user to contract
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update balance
        escrowBalances[msg.sender] += amount;

        emit Deposited(msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Withdraw USDC from escrow
     * @param amount Amount of USDC (6 decimals)
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(escrowBalances[msg.sender] >= amount, "Insufficient balance");

        // Update balance
        escrowBalances[msg.sender] -= amount;

        // Transfer USDC to user
        usdcToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, block.timestamp);
    }

    // ============ x402 PAYMENT INTENT ============

    /**
     * @notice Execute x402 payment intent
     * @param intent Payment intent struct
     * @param serviceType Service identifier (for events)
     */
    function executePaymentIntent(
        PaymentIntent calldata intent,
        string calldata serviceType
    ) external nonReentrant {
        // Verify deadline
        require(block.timestamp <= intent.deadline, "Intent expired");

        // Verify not already settled
        require(!settledSessions[intent.sessionId], "Already settled");

        // Verify signature (x402)
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PaymentIntent(address payer,bytes32 sessionId,uint256 amount,uint256 deadline,uint256 nonce)"
                ),
                intent.payer,
                intent.sessionId,
                intent.amount,
                intent.deadline,
                intent.nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(intent.signature);

        require(signer == intent.payer, "Invalid signature");
        require(intent.nonce == nonces[intent.payer], "Invalid nonce");

        // Update state
        nonces[intent.payer]++;
        settledSessions[intent.sessionId] = true;

        // Verify balance
        require(escrowBalances[intent.payer] >= intent.amount, "Insufficient balance");

        // Deduct from escrow
        escrowBalances[intent.payer] -= intent.amount;

        // Transfer to service wallet
        usdcToken.safeTransfer(serviceWallet, intent.amount);

        emit PaymentExecuted(
            intent.payer,
            intent.sessionId,
            intent.amount,
            serviceType,
            block.timestamp
        );
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get user's escrow balance
     */
    function getBalance(address user) external view returns (uint256) {
        return escrowBalances[user];
    }

    /**
     * @notice Get user's current nonce
     */
    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    /**
     * @notice Check if session is settled
     */
    function isSessionSettled(bytes32 sessionId) external view returns (bool) {
        return settledSessions[sessionId];
    }

    /**
     * @notice Get domain separator (EIP-712)
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Get contract info
     */
    function getInfo() external view returns (
        address usdc,
        address service,
        string memory name,
        string memory version
    ) {
        return (
            address(usdcToken),
            serviceWallet,
            "StreamPay",
            "1"
        );
    }
}