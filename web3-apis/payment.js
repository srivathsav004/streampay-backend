import { ethers } from 'ethers';

/**
 * Universal payment endpoint for all services
 */
async function executePayment(req, res) {
  const startTime = Date.now();
  const { contract, relayerWallet, provider, SERVICE_WALLET } = req.app.locals.web3;
  
  try {
    const { paymentIntent, serviceType, metadata } = req.body;

    // Validate input
    if (!paymentIntent || !serviceType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log("\n" + "═".repeat(60));
    console.log("📥 NEW PAYMENT REQUEST");
    console.log("═".repeat(60));
    console.log("🏷️  Service Type:", serviceType);
    console.log("🆔 Session ID:", paymentIntent.sessionId);
    console.log("👤 Payer:", paymentIntent.payer);
    // Normalize incoming amount for logging
    const normalizedAmount = typeof paymentIntent.amount === 'string' || typeof paymentIntent.amount === 'number'
      ? BigInt(paymentIntent.amount)
      : BigInt(paymentIntent.amount?.toString?.() ?? 0);
    console.log("💵 Amount:", ethers.formatUnits(normalizedAmount, 6), "USDC");
    console.log("📊 Metadata:", JSON.stringify(metadata || {}, null, 2));

    // Check user balance
    const balance = await contract.getBalance(paymentIntent.payer);
    const balanceUSDC = ethers.formatUnits(balance, 6);
    const amountUSDC = ethers.formatUnits(normalizedAmount, 6);
    
    console.log("\n💰 Balance Check:");
    console.log("   User Balance:", balanceUSDC, "USDC");
    console.log("   Required:", amountUSDC, "USDC");

    if (BigInt(balance) < normalizedAmount) {
      console.log("   ❌ INSUFFICIENT BALANCE");
      return res.status(400).json({
        error: 'Insufficient escrow balance',
        balance: balanceUSDC,
        required: amountUSDC
      });
    }
    console.log("   ✅ Sufficient balance");

    // Check if already settled
    const isSettled = await contract.isSessionSettled(paymentIntent.sessionId);
    if (isSettled) {
      console.log("\n❌ Session already settled");
      return res.status(400).json({ error: 'Session already settled' });
    }

    // Submit transaction (SERVER WALLET PAYS GAS)
    console.log("\n📤 Submitting Transaction:");
    console.log("   Gas payer:", relayerWallet.address);
    
    // Normalize the struct for v6 (ensure numeric fields are BigInt)
    const normalizedIntent = {
      payer: paymentIntent.payer,
      sessionId: paymentIntent.sessionId,
      amount: normalizedAmount,
      deadline: typeof paymentIntent.deadline === 'string' || typeof paymentIntent.deadline === 'number'
        ? BigInt(paymentIntent.deadline)
        : BigInt(paymentIntent.deadline?.toString?.() ?? 0),
      nonce: typeof paymentIntent.nonce === 'string' || typeof paymentIntent.nonce === 'number'
        ? BigInt(paymentIntent.nonce)
        : BigInt(paymentIntent.nonce?.toString?.() ?? 0),
      signature: paymentIntent.signature
    };

    const tx = await contract.executePaymentIntent(
      normalizedIntent,
      serviceType
    );

    console.log("   ⏳ Tx Hash:", tx.hash);
    // tx.gasPrice may be null in v6 with EIP-1559; log if available
    const pendingGasPrice = tx.gasPrice != null ? ethers.formatUnits(tx.gasPrice, 'gwei') : 'N/A';
    console.log("   ⛽ Gas Price:", pendingGasPrice, "gwei");

    // Wait for confirmation
    console.log("\n⏳ Waiting for confirmation...");
    const receipt = await tx.wait();

    // Calculate costs
    const gasUsed = receipt.gasUsed; // bigint in v6
    // Prefer effectiveGasPrice on receipt; fallback to tx.gasPrice
    const rxGasPrice = receipt.effectiveGasPrice ?? receipt.gasPrice ?? tx.gasPrice;
    const gasPrice = rxGasPrice ?? 0n;
    const gasCostAVAX = gasUsed * gasPrice; // bigint
    const gasCostUSD = parseFloat(ethers.formatEther(gasCostAVAX)) * 40; // Assume $40/AVAX
    const processingTime = Date.now() - startTime;

    console.log("\n✅ TRANSACTION CONFIRMED");
    console.log("   Block:", receipt.blockNumber);
    console.log("   Gas Used:", gasUsed.toString());
    console.log("   Gas Cost:", ethers.formatEther(gasCostAVAX), "AVAX (~$" + gasCostUSD.toFixed(2) + ")");
    console.log("   Processing Time:", processingTime, "ms");
    console.log("\n💸 Payment Flow:");
    console.log("   From:", paymentIntent.payer, "(escrow)");
    console.log("   To:", SERVICE_WALLET, "(service wallet)");
    console.log("   Amount:", amountUSDC, "USDC");
    console.log("   Gas Paid By:", relayerWallet.address, "(server wallet)");
    console.log("═".repeat(60) + "\n");

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: gasUsed.toString(),
      gasCostAVAX: ethers.formatEther(gasCostAVAX),
      gasCostUSD: gasCostUSD.toFixed(2),
      amountUSDC: amountUSDC,
      serviceType,
      metadata,
      processingTime: processingTime + "ms"
    });

  } catch (error) {
    console.error("\n❌ TRANSACTION FAILED");
    console.error("   Error:", error.message);
    if (error.reason) console.error("   Reason:", error.reason);
    if (error.data?.message) console.error("   Details:", error.data.message);
    console.log("═".repeat(60) + "\n");

    res.status(500).json({
      error: error.message,
      reason: error.reason,
      details: error.data?.message
    });
  }
}

export {
  executePayment
};

