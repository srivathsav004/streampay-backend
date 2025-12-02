import { ethers } from 'ethers';

/**
 * Get user's nonce (for signing)
 */
async function getNonce(req, res) {
  try {
    const { contract } = req.app.locals.web3;
    const nonce = await contract.getNonce(req.params.address);
    res.json({ 
      address: req.params.address,
      nonce: nonce.toString() 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get user's escrow balance
 */
async function getBalance(req, res) {
  try {
    const { contract } = req.app.locals.web3;
    const balance = await contract.getBalance(req.params.address);
    res.json({
      address: req.params.address,
      balance: balance.toString(),
      balanceUSDC: ethers.formatUnits(balance, 6)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Check if session is settled
 */
async function isSessionSettled(req, res) {
  try {
    const { contract } = req.app.locals.web3;
    const sessionId = req.params.sessionId;
    const isSettled = await contract.isSessionSettled(sessionId);
    res.json({ 
      sessionId, 
      isSettled 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get domain separator (EIP-712)
 */
async function getDomainSeparator(req, res) {
  try {
    const { contract } = req.app.locals.web3;
    const domainSeparator = await contract.getDomainSeparator();
    res.json({ domainSeparator });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get contract info
 */
async function getContractInfo(req, res) {
  try {
    const { contract, CONTRACT_ADDRESS } = req.app.locals.web3;
    const info = await contract.getInfo();
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      usdc: info.usdc,
      serviceWallet: info.service,
      name: info.name,
      version: info.version,
      network: "Avalanche Fuji Testnet",
      chainId: 43113
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Health check
 */
async function healthCheck(req, res) {
  try {
    const { contract, relayerWallet, provider, CONTRACT_ADDRESS, RPC_URL } = req.app.locals.web3;
    const relayerBalance = await provider.getBalance(relayerWallet.address);
    const info = await contract.getInfo();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      relayer: {
        address: relayerWallet.address,
        balanceAVAX: ethers.formatEther(relayerBalance),
        role: "Pays gas for transactions"
      },
      service: {
        address: info.service,
        role: "Receives USDC payments"
      },
      contract: {
        address: CONTRACT_ADDRESS,
        usdc: info.usdc,
        name: info.name,
        version: info.version
      },
      network: {
        name: "Avalanche Fuji Testnet",
        chainId: 43113,
        rpcUrl: RPC_URL
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Root endpoint
 */
function rootEndpoint(req, res) {
  res.json({
    name: "StreamPay Backend Relayer",
    version: "1.0.0",
    endpoints: {
      payment: "POST /api/execute-payment",
      nonce: "GET /api/nonce/:address",
      balance: "GET /api/balance/:address",
      isSettled: "GET /api/is-settled/:sessionId",
      domainSeparator: "GET /api/domain-separator",
      contractInfo: "GET /api/contract-info",
      health: "GET /health"
    }
  });
}

export {
  getNonce,
  getBalance,
  isSessionSettled,
  getDomainSeparator,
  getContractInfo,
  healthCheck,
  rootEndpoint
};
