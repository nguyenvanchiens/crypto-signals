/**
 * Trading Signal Bot Server
 * API Server để lấy tín hiệu trading
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const BinanceService = require('./services/binanceService');
const SignalEngine = require('./signals/signalEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Khởi tạo services
const binanceService = new BinanceService();
const signalEngine = new SignalEngine({
  // RSI Settings - Nới lỏng để có tín hiệu
  rsiPeriod: 14,
  rsiOversold: 35,      // RSI < 35 = oversold
  rsiOverbought: 65,    // RSI > 65 = overbought

  // Risk/Reward - SL/TP dựa trên Support/Resistance
  atrMultiplierLong: 2.0,
  atrMultiplierShort: 2.0,
  riskRewardRatio: 1.5,

  // Signal Quality - Cân bằng giữa chất lượng và số lượng
  minScoreForSignal: 3,     // Cần ít nhất 3 điểm
  minConfluence: 2,          // Cần 2 indicators đồng thuận
  sidewaysADXThreshold: 18,  // ADX < 18 = sideway
  adxTrendThreshold: 20      // ADX > 20 = có trend
});

// Cache để lưu tín hiệu
let signalCache = {};

/**
 * API: Lấy tín hiệu trading cho một symbol
 * GET /api/signal/:symbol
 */
app.get('/api/signal/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = '1h', market = 'futures' } = req.query;

    console.log(`[${new Date().toISOString()}] Phân tích ${symbol} - ${interval} - ${market}`);

    // Lấy dữ liệu candle
    let candles;
    if (market === 'futures') {
      candles = await binanceService.getFuturesKlines(symbol, interval, 100);
    } else {
      candles = await binanceService.getKlines(symbol, interval, 100);
    }

    // Phân tích và tạo tín hiệu
    const result = signalEngine.analyze(candles);
    result.symbol = symbol.toUpperCase();
    result.interval = interval;
    result.market = market;

    // Lưu vào cache
    signalCache[`${symbol}_${interval}`] = {
      ...result,
      cachedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Lỗi phân tích:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API: Phân tích nhiều symbol cùng lúc
 * GET /api/signals
 */
app.get('/api/signals', async (req, res) => {
  try {
    const { symbols, interval = '1h', market = 'futures' } = req.query;

    const symbolList = symbols
      ? symbols.split(',')
      : binanceService.getPopularSymbols().slice(0, 30);

    const results = [];

    for (const symbol of symbolList) {
      try {
        let candles;
        if (market === 'futures') {
          candles = await binanceService.getFuturesKlines(symbol, interval, 100);
        } else {
          candles = await binanceService.getKlines(symbol, interval, 100);
        }

        const result = signalEngine.analyze(candles);
        result.symbol = symbol.toUpperCase();
        result.interval = interval;

        results.push(result);

        // Delay nhỏ để tránh rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.error(`Lỗi phân tích ${symbol}:`, err.message);
        results.push({
          symbol: symbol,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API: Lấy giá hiện tại
 * GET /api/price/:symbol
 */
app.get('/api/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { market = 'futures' } = req.query;

    let price;
    if (market === 'futures') {
      price = await binanceService.getFuturesPrice(symbol);
    } else {
      price = await binanceService.getCurrentPrice(symbol);
    }

    const stats = await binanceService.get24hStats(symbol);

    res.json({
      success: true,
      data: {
        ...price,
        ...stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API: Lấy danh sách symbols và intervals
 * GET /api/config
 */
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    data: {
      symbols: binanceService.getPopularSymbols(),
      intervals: binanceService.getSupportedIntervals()
    }
  });
});

/**
 * API: Quét TOÀN BỘ thị trường và chọn TOP 3 đồng tốt nhất
 * GET /api/scan-all
 */
app.get('/api/scan-all', async (req, res) => {
  try {
    const { interval = '1h', minVolume = 10000000 } = req.query;

    console.log(`[${new Date().toISOString()}] Bắt đầu quét toàn bộ thị trường...`);

    // Lấy tất cả Futures symbols
    const allSymbols = await binanceService.getAllFuturesSymbols(parseInt(minVolume));
    console.log(`[Scan] Đang phân tích ${allSymbols.length} symbols...`);

    const allResults = [];
    let processed = 0;

    // Phân tích từng symbol
    for (const symbolInfo of allSymbols) {
      try {
        const candles = await binanceService.getFuturesKlines(symbolInfo.symbol, interval, 100);
        const result = signalEngine.analyze(candles);

        // Chỉ lưu nếu có tín hiệu (LONG hoặc SHORT)
        if (result.signal && result.signal.action !== 'WAIT') {
          allResults.push({
            symbol: symbolInfo.symbol,
            volume24h: symbolInfo.volume,
            priceChange24h: symbolInfo.priceChange,
            lastPrice: symbolInfo.lastPrice,
            action: result.signal.action,
            confidence: parseFloat(result.signal.confidence),
            totalScore: result.signal.totalScore,
            strength: result.signal.strength,
            entry: result.signal.entry,
            stopLoss: result.signal.stopLoss,
            takeProfit: result.signal.takeProfit,
            riskPercent: result.signal.riskPercent,
            rewardPercent: result.signal.rewardPercent,
            riskReward: result.signal.riskReward,
            leverage: result.signal.leverage,
            reason: result.signal.reason,
            indicators: result.indicators,
            interval: interval
          });
        }

        processed++;
        if (processed % 20 === 0) {
          console.log(`[Scan] Đã xử lý ${processed}/${allSymbols.length} symbols...`);
        }

        // Delay để tránh rate limit
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        // Bỏ qua lỗi, tiếp tục symbol khác
      }
    }

    console.log(`[Scan] Hoàn thành! Tìm thấy ${allResults.length} tín hiệu`);

    // Sắp xếp theo điểm và chọn TOP 3
    const sortedResults = allResults.sort((a, b) => {
      // Ưu tiên: Score cao + Confidence cao + Volume cao
      const scoreA = Math.abs(a.totalScore) * 10 + a.confidence + Math.log10(a.volume24h);
      const scoreB = Math.abs(b.totalScore) * 10 + b.confidence + Math.log10(b.volume24h);
      return scoreB - scoreA;
    });

    const top3 = sortedResults.slice(0, 3);

    res.json({
      success: true,
      totalScanned: allSymbols.length,
      totalSignals: allResults.length,
      top3: top3,
      allSignals: sortedResults // Trả về tất cả để xem thêm nếu cần
    });
  } catch (error) {
    console.error('Lỗi quét thị trường:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API: Tính toán vị thế
 * POST /api/calculate-position
 */
app.post('/api/calculate-position', (req, res) => {
  try {
    const {
      accountBalance,
      riskPercent = 2,
      entryPrice,
      stopLoss,
      leverage = 1
    } = req.body;

    if (!accountBalance || !entryPrice || !stopLoss) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin: accountBalance, entryPrice, stopLoss'
      });
    }

    // Tính risk amount
    const riskAmount = accountBalance * (riskPercent / 100);

    // Tính % stop loss
    const stopLossPercent = Math.abs((entryPrice - stopLoss) / entryPrice);

    // Tính position size
    const positionSize = riskAmount / stopLossPercent;

    // Tính số coin
    const quantity = positionSize / entryPrice;

    // Với leverage
    const marginRequired = positionSize / leverage;

    res.json({
      success: true,
      data: {
        accountBalance: accountBalance,
        riskPercent: riskPercent + '%',
        riskAmount: riskAmount.toFixed(2),
        entryPrice: entryPrice,
        stopLoss: stopLoss,
        stopLossPercent: (stopLossPercent * 100).toFixed(2) + '%',
        positionSize: positionSize.toFixed(2),
        quantity: quantity.toFixed(6),
        leverage: leverage + 'x',
        marginRequired: marginRequired.toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * API: Health check
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

/**
 * API: Lấy cache signals
 * GET /api/cache
 */
app.get('/api/cache', (req, res) => {
  res.json({
    success: true,
    data: signalCache
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Scheduled task: Quét tín hiệu mỗi giờ
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Đang quét tín hiệu...');

  const symbols = binanceService.getPopularSymbols();

  for (const symbol of symbols) {
    try {
      const candles = await binanceService.getFuturesKlines(symbol, '1h', 100);
      const result = signalEngine.analyze(candles);

      if (result.signal && result.signal.action !== 'WAIT') {
        console.log(`[SIGNAL] ${symbol}: ${result.signal.action} - Confidence: ${result.signal.confidence}`);
      }

      signalCache[`${symbol}_1h`] = {
        ...result,
        symbol: symbol,
        cachedAt: new Date().toISOString()
      };

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.error(`[CRON] Lỗi ${symbol}:`, err.message);
    }
  }

  console.log('[CRON] Hoàn thành quét tín hiệu');
});

// Lấy IP LAN của máy
function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Start server - bind to 0.0.0.0 để cho phép truy cập từ LAN
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         TRADING SIGNAL BOT - FUTURES LONG/SHORT           ║
╠═══════════════════════════════════════════════════════════╣
║  Server đang chạy tại:                                    ║
║  - Local:   http://localhost:${PORT}                         ║
║  - Network: http://${localIP}:${PORT}                       ║
║                                                           ║
║  API Endpoints:                                           ║
║  - GET  /api/signal/:symbol   - Lấy tín hiệu 1 symbol     ║
║  - GET  /api/signals          - Lấy tín hiệu nhiều symbol ║
║  - GET  /api/price/:symbol    - Lấy giá hiện tại          ║
║  - GET  /api/config           - Lấy cấu hình              ║
║  - POST /api/calculate-position - Tính position size      ║
║                                                           ║
║  Truy cập từ điện thoại/thiết bị khác trong mạng LAN:     ║
║  http://${localIP}:${PORT}                                  ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
