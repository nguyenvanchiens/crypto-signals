/**
 * Auto Trader Bot - Tự động quét và vào lệnh
 * Chạy liên tục, quét tín hiệu và đặt lệnh khi có cơ hội tốt
 */

const BinanceService = require('../services/binanceService');
const BinanceTradingService = require('../services/binanceTradingService');
const SignalEngine = require('../signals/signalEngine');
const fs = require('fs');
const path = require('path');

// File lưu trữ data
const DATA_FILE = path.join(__dirname, '../../data/bot-data.json');

class AutoTrader {
  constructor(config = {}) {
    // API Services
    this.binanceService = new BinanceService();
    this.tradingService = null; // Sẽ init khi có API key

    // Signal Engine
    this.signalEngine = new SignalEngine({
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      minScoreForSignal: config.minScore || 4,
      minConfluence: config.minConfluence || 3,
      sidewaysADXThreshold: 18,
      adxTrendThreshold: 20
    });

    // Bot config
    this.config = {
      enabled: false,
      interval: config.interval || '1h',        // Khung thời gian phân tích
      scanInterval: config.scanInterval || 60,  // Quét mỗi 60 giây
      maxOpenPositions: config.maxOpenPositions || 3, // Tối đa 3 lệnh cùng lúc
      marginPerTrade: config.marginPerTrade || 5, // USDT mỗi lệnh
      minVolume: config.minVolume || 10000000,  // Volume tối thiểu 10M
      minScore: config.minScore || 4,           // Score tối thiểu để vào lệnh
      testMode: config.testMode !== false,      // Mặc định là test mode (không đặt lệnh thật)
      ...config
    };

    // State
    this.isRunning = false;
    this.scanTimer = null;
    this.openPositions = [];
    this.tradeHistory = [];
    this.lastScan = null;
    this.stats = {
      totalScans: 0,
      signalsFound: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      totalPnL: 0
    };

    // Callbacks
    this.onSignal = null;
    this.onTrade = null;
    this.onError = null;
    this.onLog = null;

    // Load saved data on startup
    this.loadData();
  }

  /**
   * Lưu data vào file
   */
  saveData() {
    try {
      // Tạo thư mục data nếu chưa có
      const dataDir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const data = {
        openPositions: this.openPositions,
        tradeHistory: this.tradeHistory,
        stats: this.stats,
        lastScan: this.lastScan,
        savedAt: new Date().toISOString()
      };

      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      console.log('[AutoTrader] Data saved to file');
    } catch (error) {
      console.error('[AutoTrader] Error saving data:', error.message);
    }
  }

  /**
   * Load data từ file
   */
  loadData() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

        this.openPositions = data.openPositions || [];
        this.tradeHistory = data.tradeHistory || [];
        this.stats = data.stats || this.stats;
        this.lastScan = data.lastScan;

        console.log(`[AutoTrader] Loaded ${this.openPositions.length} open positions, ${this.tradeHistory.length} history trades`);
      }
    } catch (error) {
      console.error('[AutoTrader] Error loading data:', error.message);
    }
  }

  /**
   * Khởi tạo với API keys
   */
  init(apiKey, secretKey, testnet = false) {
    if (apiKey && secretKey) {
      this.tradingService = new BinanceTradingService(apiKey, secretKey, testnet);
      this.log('Trading service initialized');
    }
  }

  /**
   * Log message
   */
  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] [AutoTrader] ${message}`;
    console.log(logMsg);
    if (this.onLog) this.onLog({ timestamp, message, type });
  }

  /**
   * Bắt đầu bot
   */
  async start() {
    if (this.isRunning) {
      this.log('Bot đang chạy rồi!', 'warn');
      return;
    }

    this.isRunning = true;
    this.config.enabled = true;
    this.log('Bot started! Scanning every ' + this.config.scanInterval + ' seconds');

    // Quét ngay lập tức
    await this.scan();

    // Set interval để quét định kỳ
    this.scanTimer = setInterval(() => {
      this.scan();
    }, this.config.scanInterval * 1000);
  }

  /**
   * Dừng bot
   */
  stop() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.isRunning = false;
    this.config.enabled = false;
    this.log('Bot stopped!');
  }

  /**
   * Quét thị trường và tìm tín hiệu
   */
  async scan() {
    if (!this.isRunning) return;

    this.stats.totalScans++;
    this.lastScan = new Date();
    this.log(`Scan #${this.stats.totalScans} started...`);

    try {
      // Lấy tất cả symbols
      const symbols = await this.binanceService.getAllFuturesSymbols(this.config.minVolume);
      this.log(`Found ${symbols.length} symbols to analyze`);

      const signals = [];

      // Phân tích từng symbol
      for (const symbolInfo of symbols) {
        try {
          const candles = await this.binanceService.getFuturesKlines(
            symbolInfo.symbol,
            this.config.interval,
            100
          );

          const result = this.signalEngine.analyze(candles);

          if (result.signal && result.signal.action !== 'WAIT') {
            const score = Math.abs(result.signal.totalScore);
            if (score >= this.config.minScore) {
              signals.push({
                symbol: symbolInfo.symbol,
                volume24h: symbolInfo.volume,
                action: result.signal.action,
                score: result.signal.totalScore,
                confidence: parseFloat(result.signal.confidence),
                entry: result.signal.entry,
                stopLoss: result.signal.stopLoss,
                takeProfit: result.signal.takeProfit,
                leverage: result.signal.leverage,
                reason: result.signal.reason
              });
            }
          }

          // Delay nhỏ để tránh rate limit
          await this.delay(30);
        } catch (err) {
          // Bỏ qua lỗi của từng symbol
        }
      }

      this.stats.signalsFound += signals.length;
      this.log(`Found ${signals.length} signals`);

      // Sắp xếp theo score
      signals.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

      // Callback
      if (this.onSignal && signals.length > 0) {
        this.onSignal(signals);
      }

      // Xử lý tín hiệu tốt nhất
      if (signals.length > 0) {
        await this.processSignals(signals);
      }

    } catch (error) {
      this.log(`Scan error: ${error.message}`, 'error');
      if (this.onError) this.onError(error);
    }
  }

  /**
   * Xử lý các tín hiệu
   */
  async processSignals(signals) {
    try {
      // Kiểm tra số lệnh đang mở
      const openCount = this.openPositions.length;
      if (openCount >= this.config.maxOpenPositions) {
        this.log(`Max positions reached (${openCount}/${this.config.maxOpenPositions}), skipping new signals`);
        return;
      }

      // Duyệt qua các tín hiệu để tìm cái phù hợp
      for (const signal of signals) {
        // Kiểm tra lại số lệnh (có thể đã mở thêm trong loop)
        if (this.openPositions.length >= this.config.maxOpenPositions) {
          this.log(`Max positions reached, stopping`);
          break;
        }

        // Kiểm tra xem đã có position cho symbol này chưa
        const existingPosition = this.openPositions.find(p => p.symbol === signal.symbol);
        if (existingPosition) {
          this.log(`Already have position for ${signal.symbol}, trying next signal`);
          continue;
        }

        // Validate signal data
        if (!signal.entry || !signal.stopLoss || !signal.takeProfit) {
          this.log(`Invalid signal data for ${signal.symbol}, skipping`, 'warn');
          continue;
        }

        // Vào lệnh
        await this.openTrade(signal);

        // Chỉ mở 1 lệnh mỗi lần scan để tránh spam
        break;
      }
    } catch (error) {
      this.log(`processSignals error: ${error.message}`, 'error');
      if (this.onError) this.onError(error);
    }
  }

  /**
   * Mở lệnh
   */
  async openTrade(signal) {
    try {
      this.log(`Opening ${signal.action} ${signal.symbol} @ ${signal.entry}`);

      const trade = {
        id: Date.now(),
        symbol: signal.symbol,
        side: signal.action,
        entryPrice: parseFloat(signal.entry) || 0,
        stopLoss: parseFloat(signal.stopLoss) || 0,
        takeProfit: parseFloat(signal.takeProfit) || 0,
        leverage: signal.leverage || 10,
        margin: this.config.marginPerTrade,
        score: signal.score,
        openTime: new Date().toISOString(),
        status: 'OPEN'
      };

      // Validate trade data
      if (trade.entryPrice <= 0) {
        this.log(`Invalid entry price for ${signal.symbol}, skipping`, 'error');
        return null;
      }

      // Nếu không phải test mode, đặt lệnh thật
      if (!this.config.testMode && this.tradingService) {
        try {
          const result = await this.tradingService.openPositionWithSLTP({
            symbol: signal.symbol,
            side: signal.action,
            margin: this.config.marginPerTrade,
            leverage: signal.leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit
          });

          trade.orderId = result.mainOrder?.orderId;
          trade.slOrderId = result.slOrder?.orderId;
          trade.tpOrderId = result.tpOrder?.orderId;
          trade.realTrade = true;

          this.log(`Real trade opened! Order ID: ${trade.orderId}`);
        } catch (error) {
          this.log(`Failed to open real trade: ${error.message}`, 'error');
          if (this.onError) this.onError(error);
          return null;
        }
      } else {
        trade.realTrade = false;
        this.log(`Test trade opened (no real order)`);
      }

      this.openPositions.push(trade);
      this.stats.tradesOpened++;

      // Lưu data
      this.saveData();

      // Callback
      if (this.onTrade) {
        this.onTrade({ type: 'OPEN', trade });
      }

      return trade;
    } catch (error) {
      this.log(`openTrade error: ${error.message}`, 'error');
      if (this.onError) this.onError(error);
      return null;
    }
  }

  /**
   * Đóng lệnh
   */
  async closeTrade(tradeId, closePrice, reason = 'MANUAL') {
    const index = this.openPositions.findIndex(p => p.id === tradeId);
    if (index === -1) {
      this.log(`Trade ${tradeId} not found`, 'error');
      return;
    }

    const trade = this.openPositions[index];

    // Đóng lệnh thật nếu có
    if (trade.realTrade && this.tradingService) {
      try {
        await this.tradingService.closePosition(trade.symbol, trade.side);
        this.log(`Real position closed for ${trade.symbol}`);
      } catch (error) {
        this.log(`Failed to close real position: ${error.message}`, 'error');
      }
    }

    // Tính PnL
    const pnlPercent = trade.side === 'LONG'
      ? ((closePrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - closePrice) / trade.entryPrice) * 100;

    const pnl = (pnlPercent / 100) * trade.margin * trade.leverage;

    trade.closePrice = closePrice;
    trade.closeTime = new Date().toISOString();
    trade.pnl = pnl;
    trade.pnlPercent = pnlPercent;
    trade.closeReason = reason;
    trade.status = 'CLOSED';

    // Cập nhật stats
    this.stats.tradesClosed++;
    this.stats.totalPnL += pnl;

    // Chuyển sang history
    this.tradeHistory.push(trade);
    this.openPositions.splice(index, 1);

    // Lưu data
    this.saveData();

    this.log(`Trade closed: ${trade.symbol} ${trade.side} | PnL: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)`);

    // Callback
    if (this.onTrade) {
      this.onTrade({ type: 'CLOSE', trade });
    }

    return trade;
  }

  /**
   * Đóng tất cả lệnh
   */
  async closeAllTrades(reason = 'CLOSE_ALL') {
    const closedTrades = [];
    let totalPnL = 0;

    // Copy array để tránh modify trong khi loop
    const tradesToClose = [...this.openPositions];

    for (const trade of tradesToClose) {
      try {
        // Lấy giá hiện tại
        const priceData = await this.binanceService.getFuturesPrice(trade.symbol);
        const currentPrice = priceData.price;

        const closedTrade = await this.closeTrade(trade.id, currentPrice, reason);
        if (closedTrade) {
          closedTrades.push(closedTrade);
          totalPnL += closedTrade.pnl;
        }
      } catch (error) {
        this.log(`Failed to close ${trade.symbol}: ${error.message}`, 'error');
      }
    }

    this.log(`Closed ${closedTrades.length} trades. Total PnL: ${totalPnL.toFixed(2)} USDT`);

    return {
      closedCount: closedTrades.length,
      totalPnL,
      trades: closedTrades
    };
  }

  /**
   * Lấy trạng thái bot
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      stats: this.stats,
      lastScan: this.lastScan,
      openPositions: this.openPositions,
      tradeHistory: this.tradeHistory.slice(-20) // 20 lệnh gần nhất
    };
  }

  /**
   * Cập nhật config
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.log(`Config updated: ${JSON.stringify(newConfig)}`);
  }

  /**
   * Utility: delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutoTrader;
