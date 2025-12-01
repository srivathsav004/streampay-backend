// scripts/deploy.js
import { ethers } from "ethers";
import fs from 'fs';
import { config } from 'dotenv';

// Load environment variables
config();

async function main() {
  console.log("\n🚀 Deploying StreamPayEscrow...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Configuration
  const USDC_ADDRESS = "0x5425890298aed601595a70AB815c96711a31Bc65"; // Fuji USDC
  const SERVICE_WALLET = "0x6021e09E8Cd947701E2368D60239C04486118f18"; // Your business wallet
  
  // Get environment variables
  const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL;
  
  if (!PRIVATE_KEY || !RPC_URL) {
    console.error("❌ Missing environment variables:");
    console.error("   RELAYER_PRIVATE_KEY:", PRIVATE_KEY ? "✅" : "❌");
    console.error("   RPC_URL:", RPC_URL ? "✅" : "❌");
    console.error("\nPlease set these in your .env file");
    return;
  }

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployerAddress = wallet.address;
  
  // Check balance
  console.log("📋 Configuration:");
  console.log("   USDC Token:", USDC_ADDRESS);
  console.log("   Service Wallet (receives payments):", SERVICE_WALLET);
  console.log("   RPC URL:", RPC_URL);
  console.log("");
  console.log("👤 Deployer (server wallet):");
  console.log("   Address:", deployerAddress);
  
  const balance = await provider.getBalance(deployerAddress);
  console.log("   Balance:", ethers.formatEther(balance), "AVAX");
  console.log("");

  // Check balance
  if (balance < ethers.parseEther("0.1")) {
    console.log("⚠️  WARNING: Low AVAX balance. You need at least 0.1 AVAX for deployment.");
    console.log("   Please fund your deployer wallet:", deployerAddress);
    console.log("");
    return;
  }

  // Deploy
  console.log("📤 Deploying contract...");
  
  // Read contract ABI and bytecode
  const contractArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/StreamPayEscrow.sol/StreamPayEscrow.json', 'utf8'));
  const contractFactory = new ethers.ContractFactory(
    contractArtifact.abi,
    contractArtifact.bytecode,
    wallet
  );
  
  const contract = await contractFactory.deploy(USDC_ADDRESS, SERVICE_WALLET);

  console.log("⏳ Waiting for deployment...");
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();

  console.log("✅ Contract deployed!");
  console.log("");

  // Verify deployment
  console.log("📊 Contract Info:");
  const info = await contract.getInfo();
  console.log("   Contract Address:", contractAddress);
  console.log("   Name:", info.name);
  console.log("   Version:", info.version);
  console.log("   USDC Token:", info.usdc);
  console.log("   Service Wallet:", info.service);
  console.log("");

  // Get deployment transaction
  const deployTx = contract.deploymentTransaction();
  console.log("📝 Deployment Transaction:");
  console.log("   Tx Hash:", deployTx.hash);
  console.log("   Block:", deployTx.blockNumber);
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    network: "fuji",
    chainId: 43113,
    contractAddress: contractAddress,
    usdcAddress: USDC_ADDRESS,
    serviceWallet: SERVICE_WALLET,
    deployerWallet: deployerAddress,
    deployedAt: new Date().toISOString(),
    txHash: deployTx.hash,
    blockNumber: deployTx.blockNumber
  };

  fs.writeFileSync(
    'deployment.json',
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("💾 Deployment info saved to deployment.json");
  console.log("");
} 

main().catch((error) => {
  console.error("\n❌ Deployment failed:");
  console.error(error);
  process.exitCode = 1;
});