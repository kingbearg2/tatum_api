const express = require('express');
const cors = require('cors');
const { TatumSDK, Network } = require('@tatumio/sdk');
const admin = require('firebase-admin');
const logger = require('winston');
const rateLimit = require('express-rate-limit');
const DailyRotateFile = require('winston-daily-rotate-file');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize logger
logger.configure({
  transports: [
    new logger.transports.Console(),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
  ],
});

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Initialize Tatum SDK with specific networks
const tatum = await TatumSDK.init({
  network: process.env.NODE_ENV === 'production' ? Network.MAINNET : Network.TESTNET,
  apiKey: process.env.TATUM_API_KEY,
  configure: {
    enabledNetworks: [
      Network.BITCOIN,
      Network.BINANCE_SMART_CHAIN,
      Network.ETHEREUM,
      Network.LITECOIN,
      Network.TRON,
    ],
  },
});

// Map symbols to Tatum networks
const networkMap = {
  'BTC': process.env.NODE_ENV === 'production' ? Network.BITCOIN : Network.BITCOIN_TESTNET,
  'BNB': process.env.NODE_ENV === 'production' ? Network.BINANCE_SMART_CHAIN : Network.BINANCE_SMART_CHAIN_TESTNET,
  'ETH': process.env.NODE_ENV === 'production' ? Network.ETHEREUM : Network.ETHEREUM_SEPOLIA,
  'LTC': process.env.NODE_ENV === 'production' ? Network.LITECOIN : Network.LITECOIN_TESTNET,
  'TRX': process.env.NODE_ENV === 'production' ? Network.TRON : Network.TRON_TESTNET,
  'USDT TRC-20': process.env.NODE_ENV === 'production' ? Network.TRON : Network.TRON_TESTNET,
};

// Rate limiting
app.use('/wallet', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later.',
}));

// Authentication middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.error('Missing or invalid authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    logger.error(`Token verification failed: ${error.message}`);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Endpoint to generate wallet address
app.post('/wallet', verifyToken, async (req, res) => {
  const { symbol } = req.body;
  const userId = req.userId;

  if (!symbol || !networkMap[symbol]) {
    logger.error(`Invalid request: userId=${userId}, symbol=${symbol}`);
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  try {
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    let userData = userDoc.exists ? userDoc.data() : { wallets: {} };

    if (userData.wallets?.[symbol]) {
      logger.info(`Wallet address for ${symbol} already exists for user ${userId}`);
      return res.json({ address: userData.wallets[symbol] });
    }

    let wallet;
    switch (symbol) {
      case 'BTC':
        wallet = await tatum.api.btcGenerateWallet();
        break;
      case 'BNB':
        wallet = await tatum.api.bscGenerateWallet();
        break;
      case 'ETH':
        wallet = await tatum.api.ethGenerateWallet();
        break;
      case 'LTC':
        wallet = await tatum.api.ltcGenerateWallet();
        break;
      case 'TRX':
        wallet = await tatum.api.tronGenerateWallet();
        break;
      case 'USDT TRC-20':
        wallet = await tatum.api.tronGenerateWallet();
        break;
      default:
        throw new Error('Unsupported symbol');
    }

    logger.warn('Private keys not stored. Implement Tatum KMS for production.');

    const addressData = await tatum.api[symbol === 'BTC' ? 'btcGenerateAddress' : 
                                       symbol === 'BNB' ? 'bscGenerateAddress' :
                                       symbol === 'ETH' ? 'ethGenerateAddress' :
                                       symbol === 'LTC' ? 'ltcGenerateAddress' :
                                       'tronGenerateAddress'](
      wallet.xpub || wallet.address,
      0
    );

    const address = addressData.address;
    logger.info(`Generated ${symbol} address for user ${userId}: ${address}`);

    userData.wallets = userData.wallets || {};
    userData.wallets[symbol] = address;
    await userDocRef.set(userData, { merge: true });

    res.json({ address });
  } catch (error) {
    logger.error(`Error generating wallet for ${symbol}: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate wallet address' });
  }
});

// Endpoint to get wallet balance
app.get('/balance/:userId/:symbol', verifyToken, async (req, res) => {
  const { symbol } = req.params;
  const userId = req.userId;

  if (!symbol || !networkMap[symbol]) {
    logger.error(`Invalid balance request: userId=${userId}, symbol=${symbol}`);
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const address = userDoc.data()?.wallets?.[symbol];
    if (!address) {
      logger.warn(`No address found for ${symbol} for user ${userId}`);
      return res.status(404).json({ error: 'Address not found' });
    }

    let balance;
    const usdtContractAddress = process.env.NODE_ENV === 'production'
      ? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
      : 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj'; // Testnet USDT TRC-20 address
    switch (symbol) {
      case 'BTC':
        balance = (await tatum.api.btcGetBalance(address)).balance / 1e8;
        break;
      case 'BNB':
        balance = (await tatum.api.bscGetBalance(address)).balance / 1e18;
        break;
      case 'ETH':
        balance = (await tatum.api.ethGetBalance(address)).balance / 1e18;
        break;
      case 'LTC':
        balance = (await tatum.api.ltcGetBalance(address)).balance / 1e8;
        break;
      case 'TRX':
        balance = (await tatum.api.tronGetAccount(address)).balance / 1e6;
        break;
      case 'USDT TRC-20':
        balance = (await tatum.api.tronTrc20GetBalance(address, usdtContractAddress)).balance / 1e6;
        break;
      default:
        throw new Error('Unsupported symbol');
    }

    res.json({ balance: balance.toString() });
  } catch (error) {
    logger.error(`Error fetching balance for ${symbol}: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});