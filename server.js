public const express = require('express');
const cors = require('cors');
const { TatumSDK, Network } = require('@tatumio/sdk');
const admin = require('firebase-admin');
const logger = require('winston');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize logger
const logger = require('winston');
logger.configure({
  transports: [
    new logger.transports.Console(),
    new logger.transports.File({ filename: 'combined.log' })
  ]
});

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Initialize Tatum SDK
const tatum = await TatumSDK.init({
  network: Network.MAINNET, // Default to mainnet; switch to testnet for testing
  apiKey: process.env.TATUM_API_KEY,
});

// Map symbols to Tatum networks
const networkMap = {
  'BTC': Network.BITCOIN,
  'BNB': Network.BINANCE_SMART_CHAIN,
  'ETH': Network.ETHEREUM,
  'LTC': Network.LITECOIN,
  'TRX': Network.TRON,
  'USDT TRC-20': Network.TRON,
};

// Endpoint to generate wallet address
app.post('/wallet', async (req, res) => {
  const { userId, symbol } = req.body;

  if (!userId || !symbol || !networkMap[symbol]) {
    logger.error(`Invalid request: userId=${userId}, symbol=${symbol}`);
    return res.status(400).json({ error: 'Invalid userId or symbol' });
  }

  try {
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();
    let userData = userDoc.exists ? userDoc.data() : { wallets: {} };

    // Check if wallet address already exists
    if (userData.wallets?.[symbol]) {
      logger.info(`Wallet address for ${symbol} already exists for user ${userId}`);
      return res.json({ address: userData.wallets[symbol] });
    }

    // Generate wallet using Tatum
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

    // Generate address from wallet
    const addressData = await tatum.api[symbol === 'BTC' ? 'btcGenerateAddress' : 
                                       symbol === 'BNB' ? 'bscGenerateAddress' :
                                       symbol === 'ETH' ? 'ethGenerateAddress' :
                                       symbol === 'LTC' ? 'ltcGenerateAddress' :
                                       'tronGenerateAddress'](
      wallet.xpub || wallet.address, // Use xpub for BTC, LTC; address for TRX
      0 // Derivation index
    );

    const address = addressData.address;
    logger.info(`Generated ${symbol} address for user ${userId}: ${address}`);

    // Store address in Firestore
    userData.wallets = userData.wallets || {};
    userData.wallets[symbol] = address;
    await userDocRef.set(userData, { merge: true });

    res.json({ address });
  } catch (error) {
    logger.error(`Error generating wallet for ${symbol}: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate wallet address' });
  }
});

// Endpoint to get wallet balance (optional)
app.get('/balance/:userId/:symbol', async (req, res) => {
  const { userId, symbol } = req.params;

  if (!userId || !symbol || !networkMap[symbol]) {
    logger.error(`Invalid balance request: userId=${userId}, symbol=${symbol}`);
    return res.status(400).json({ error: 'Invalid userId or symbol' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const address = userDoc.data()?.wallets?.[symbol];
    if (!address) {
      logger.warn(`No address found for ${symbol} for user ${userId}`);
      return res.status(404).json({ error: 'Address not found' });
    }

    let balance;
    switch (symbol) {
      case 'BTC':
        balance = await tatum.api.btcGetBalance(address);
        break;
      case 'BNB':
        balance = await tatum.api.bscGetBalance(address);
        break;
      case 'ETH':
        balance = await tatum.api.ethGetBalance(address);
        break;
      case 'LTC':
        balance = await tatum.api.ltcGetBalance(address);
        break;
      case 'TRX':
        balance = await tatum.api.tronGetAccount(address);
        break;
      case 'USDT TRC-20':
        balance = await tatum.api.tronTrc20GetBalance(address, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'); // USDT contract address
        break;
      default:
        throw new Error('Unsupported symbol');
    }

    res.json({ balance });
  } catch (error) {
    logger.error(`Error fetching balance for ${symbol}: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
}); Main {
    
}
