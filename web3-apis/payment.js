import { ethers } from 'ethers';

// simple timestamped logger
function ts(...args) {
  const t = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  // eslint-disable-next-line no-console
  console.log(`[${t}]`, ...args);
}

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

    ts("\n" + "=".repeat(60));
    ts("NEW PAYMENT REQUEST");
    ts("=".repeat(60));
    ts("Service Type:", serviceType);
    ts("Session ID:", paymentIntent.sessionId);
    ts("Payer:", paymentIntent.payer);
    // Normalize incoming amount for logging
    const normalizedAmount = typeof paymentIntent.amount === 'string' || typeof paymentIntent.amount === 'number'
      ? BigInt(paymentIntent.amount)
      : BigInt(paymentIntent.amount?.toString?.() ?? 0);
    ts("Amount:", ethers.formatUnits(normalizedAmount, 6), "USDC");
    ts("Metadata:", JSON.stringify(metadata || {}, null, 2));

    // Check user balance
    const balance = await contract.getBalance(paymentIntent.payer);
    const balanceUSDC = ethers.formatUnits(balance, 6);
    const amountUSDC = ethers.formatUnits(normalizedAmount, 6);
    
    ts("\nBalance Check:");
    ts("   User Balance:", balanceUSDC, "USDC");
    ts("   Required:", amountUSDC, "USDC");

    if (BigInt(balance) < normalizedAmount) {
      ts("   INSUFFICIENT BALANCE");
      return res.status(400).json({
        error: 'Insufficient escrow balance',
        balance: balanceUSDC,
        required: amountUSDC
      });
    }
    ts("   Sufficient balance");

    // Check if already settled
    const isSettled = await contract.isSessionSettled(paymentIntent.sessionId);
    if (isSettled) {
      ts("\nSession already settled");
      return res.status(400).json({ error: 'Session already settled' });
    }

    // Submit transaction (SERVER WALLET PAYS GAS)
    ts("\nSubmitting Transaction:");
    ts("   Gas payer:", relayerWallet.address);
    
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

    ts("   Tx Hash:", tx.hash);
    // tx.gasPrice may be null in v6 with EIP-1559; log if available
    const pendingGasPrice = tx.gasPrice != null ? ethers.formatUnits(tx.gasPrice, 'gwei') : 'N/A';
    ts("   Gas Price:", pendingGasPrice, "gwei");

    // Wait for confirmation
    ts("\nWaiting for confirmation...");
    const receipt = await tx.wait();

    // Calculate costs
    const gasUsed = receipt.gasUsed; // bigint in v6
    // Prefer effectiveGasPrice on receipt; fallback to tx.gasPrice
    const rxGasPrice = receipt.effectiveGasPrice ?? receipt.gasPrice ?? tx.gasPrice;
    const gasPrice = rxGasPrice ?? 0n;
    const gasCostAVAX = gasUsed * gasPrice; // bigint
    const gasCostUSD = parseFloat(ethers.formatEther(gasCostAVAX)) * 40; // Assume $40/AVAX
    const processingTime = Date.now() - startTime;

    ts("\nTRANSACTION CONFIRMED");
    ts("   Block:", receipt.blockNumber);
    ts("   Gas Used:", gasUsed.toString());
    ts("   Gas Cost:", ethers.formatEther(gasCostAVAX), "AVAX (~$" + gasCostUSD.toFixed(2) + ")");
    ts("   Processing Time:", processingTime, "ms");
    ts("\nPayment Flow:");
    ts("   From:", paymentIntent.payer, "(escrow)");
    ts("   To:", SERVICE_WALLET, "(service wallet)");
    ts("   Amount:", amountUSDC, "USDC");
    ts("   Gas Paid By:", relayerWallet.address, "(server wallet)");
    ts("=".repeat(60) + "\n");

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
    ts("\nTRANSACTION FAILED");
    ts("   Error:", error.message);
    if (error.reason) ts("   Reason:", error.reason);
    if (error.data?.message) ts("   Details:", error.data.message);
    ts("=".repeat(60) + "\n");

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

