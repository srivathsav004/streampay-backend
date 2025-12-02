// backend/server.js
import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';
import 'dotenv/config';
import web3Apis from './web3-apis/index.js';

// timestamped logger
function ts(...args) {
  const t = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  // eslint-disable-next-line no-console
  console.log(`[${t}]`, ...args);
}

const app = express();
app.use(cors());
app.use(express.json());

// ============ CONFIGURATION ============

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const USDC_ADDRESS = "0x5425890298aed601595a70AB815c96711a31Bc65";
const SERVICE_WALLET = "0x6021e09E8Cd947701E2368D60239C04486118f18";
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY; // Server wallet
const RPC_URL = process.env.RPC_URL;

// Validate environment variables
if (!CONTRACT_ADDRESS) {
  ts("CONTRACT_ADDRESS not set in .env");
  process.exit(1);
}

if (!RELAYER_PRIVATE_KEY) {
  ts("RELAYER_PRIVATE_KEY not set in .env");
  process.exit(1);
}

// Contract ABI
const CONTRACT_ABI = [
  "function executePaymentIntent((address payer, bytes32 sessionId, uint256 amount, uint256 deadline, uint256 nonce, bytes signature), string serviceType) external",
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function getNonce(address user) external view returns (uint256)",
  "function getBalance(address user) external view returns (uint256)",
  "function isSessionSettled(bytes32 sessionId) external view returns (bool)",
  "function getDomainSeparator() external view returns (bytes32)",
  "function getInfo() external view returns (address usdc, address service, string name, string version)"
];

// Setup provider and wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const relayerWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, relayerWallet);

// Check relayer balance on startup
(async () => {
  try {
    const balance = await provider.getBalance(relayerWallet.address);
    const balanceAVAX = ethers.formatEther(balance);
    ts("Relayer Balance:", balanceAVAX, "AVAX");
    
    if (parseFloat(balanceAVAX) < 0.1) {
      ts("WARNING: Low AVAX balance");
      ts("   Please fund relayer wallet:", relayerWallet.address);
    }
    ts("" + "-".repeat(60));
  } catch (error) {
    ts("Failed to check relayer balance:", error.message);
  }
})();

// Store web3 instances in app locals for access in routes
app.locals.web3 = {
  contract,
  relayerWallet,
  provider,
  SERVICE_WALLET,
  CONTRACT_ADDRESS,
  RPC_URL
};

// Mount API routes
app.use('/api', web3Apis);

// ============ ERROR HANDLING ============

app.use((err, req, res, next) => {
  ts("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message
  });
});

// ============ START SERVER ============

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  ts("Server started successfully");
  ts("Listening on port:", PORT);
});