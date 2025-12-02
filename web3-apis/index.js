import express from 'express';
import { executePayment } from './payment.js';
import { 
  getNonce, 
  getBalance, 
  isSessionSettled, 
  getDomainSeparator, 
  getContractInfo, 
  healthCheck, 
  rootEndpoint 
} from './utility.js';

const router = express.Router();

// Payment endpoint
router.post('/execute-payment', executePayment);

// Utility endpoints
router.get('/nonce/:address', getNonce);
router.get('/balance/:address', getBalance);
router.get('/is-settled/:sessionId', isSessionSettled);
router.get('/domain-separator', getDomainSeparator);
router.get('/contract-info', getContractInfo);

// Health and root endpoints
router.get('/health', healthCheck);
router.get('/', rootEndpoint);

export default router;
