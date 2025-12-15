/**
 * Trading Service - Đặt lệnh trực tiếp trên Binance Futures
 * Sử dụng API Key của người dùng (lưu local, không gửi server)
 */

const crypto = require('crypto');
const axios = require('axios');

class TradingService {
  constructor(apiKey, secretKey, testnet = false) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
  }

  /**
   * Tạo signature cho request
   */
  createSignature(queryString) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Gửi request có signature
   */
  async signedRequest(method, endpoint, params = {}) {
    const timestamp = Date.now();
    const queryParams = { ...params, timestamp };

    const queryString = Object.keys(queryParams)
      .map(key => `${key}=${queryParams[key]}`)
      .join('&');

    const signature = this.createSignature(queryString);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    try {
      const response = await axios({
        method,
        url,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });
      return response.data;
    } catch (error) {
      const errMsg = error.response?.data?.msg || error.message;
      throw new Error(errMsg);
    }
  }

  /**
   * Lấy thông tin tài khoản Futures
   */
  async getAccountInfo() {
    return this.signedRequest('GET', '/fapi/v2/account');
  }

  /**
   * Lấy số dư USDT
   */
  async getBalance() {
    const account = await this.getAccountInfo();
    const usdtAsset = account.assets.find(a => a.asset === 'USDT');
    return {
      totalBalance: parseFloat(usdtAsset?.walletBalance || 0),
      availableBalance: parseFloat(usdtAsset?.availableBalance || 0),
      unrealizedPnl: parseFloat(usdtAsset?.unrealizedProfit || 0)
    };
  }

  /**
   * Lấy thông tin symbol (precision, filters)
   */
  async getSymbolInfo(symbol) {
    const response = await axios.get(`${this.baseUrl}/fapi/v1/exchangeInfo`);
    const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);

    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} không tồn tại`);
    }

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
    const minNotionalFilter = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');

    return {
      symbol: symbolInfo.symbol,
      pricePrecision: symbolInfo.pricePrecision,
      quantityPrecision: symbolInfo.quantityPrecision,
      minQty: parseFloat(lotSizeFilter?.minQty || 0),
      maxQty: parseFloat(lotSizeFilter?.maxQty || 0),
      stepSize: parseFloat(lotSizeFilter?.stepSize || 0),
      tickSize: parseFloat(priceFilter?.tickSize || 0),
      minNotional: parseFloat(minNotionalFilter?.notional || 0)
    };
  }

  /**
   * Set leverage cho symbol
   */
  async setLeverage(symbol, leverage) {
    return this.signedRequest('POST', '/fapi/v1/leverage', {
      symbol,
      leverage
    });
  }

  /**
   * Set margin type (ISOLATED hoặc CROSSED)
   */
  async setMarginType(symbol, marginType = 'ISOLATED') {
    try {
      return await this.signedRequest('POST', '/fapi/v1/marginType', {
        symbol,
        marginType
      });
    } catch (error) {
      // Bỏ qua lỗi nếu đã set margin type này rồi
      if (!error.message.includes('No need to change margin type')) {
        throw error;
      }
    }
  }

  /**
   * Làm tròn số lượng theo precision của symbol
   */
  roundQuantity(quantity, stepSize) {
    const precision = Math.round(-Math.log10(stepSize));
    return Math.floor(quantity * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  /**
   * Làm tròn giá theo tickSize
   */
  roundPrice(price, tickSize) {
    const precision = Math.round(-Math.log10(tickSize));
    return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  /**
   * Tính position size dựa trên risk %
   */
  calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss, leverage = 1) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const stopLossPercent = Math.abs((entryPrice - stopLoss) / entryPrice);
    const positionSize = riskAmount / stopLossPercent;
    const quantity = positionSize / entryPrice;
    const marginRequired = positionSize / leverage;

    return {
      riskAmount,
      positionSize,
      quantity,
      marginRequired
    };
  }

  /**
   * Đặt lệnh Market
   */
  async placeMarketOrder(symbol, side, quantity) {
    return this.signedRequest('POST', '/fapi/v1/order', {
      symbol,
      side, // BUY hoặc SELL
      type: 'MARKET',
      quantity
    });
  }

  /**
   * Đặt lệnh Limit
   */
  async placeLimitOrder(symbol, side, quantity, price, timeInForce = 'GTC') {
    return this.signedRequest('POST', '/fapi/v1/order', {
      symbol,
      side,
      type: 'LIMIT',
      quantity,
      price,
      timeInForce
    });
  }

  /**
   * Đặt Stop Loss
   */
  async placeStopLoss(symbol, side, quantity, stopPrice) {
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    return this.signedRequest('POST', '/fapi/v1/order', {
      symbol,
      side: closeSide,
      type: 'STOP_MARKET',
      stopPrice,
      quantity,
      closePosition: 'false'
    });
  }

  /**
   * Đặt Take Profit
   */
  async placeTakeProfit(symbol, side, quantity, stopPrice) {
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    return this.signedRequest('POST', '/fapi/v1/order', {
      symbol,
      side: closeSide,
      type: 'TAKE_PROFIT_MARKET',
      stopPrice,
      quantity,
      closePosition: 'false'
    });
  }

  /**
   * Đặt lệnh đầy đủ với SL/TP
   * @param {Object} params - Tham số đặt lệnh
   * @param {string} params.symbol - Symbol (VD: BTCUSDT)
   * @param {string} params.side - BUY (Long) hoặc SELL (Short)
   * @param {string} params.orderType - MARKET hoặc LIMIT
   * @param {number} params.quantity - Số lượng
   * @param {number} params.entryPrice - Giá vào (cho LIMIT order)
   * @param {number} params.stopLoss - Giá Stop Loss
   * @param {number} params.takeProfit - Giá Take Profit
   * @param {number} params.leverage - Đòn bẩy
   */
  async placeOrderWithSLTP(params) {
    const {
      symbol,
      side,
      orderType,
      quantity,
      entryPrice,
      stopLoss,
      takeProfit,
      leverage = 10
    } = params;

    const results = {
      leverage: null,
      mainOrder: null,
      stopLossOrder: null,
      takeProfitOrder: null,
      errors: []
    };

    try {
      // 1. Set leverage
      results.leverage = await this.setLeverage(symbol, leverage);

      // 2. Set margin type
      await this.setMarginType(symbol, 'ISOLATED');

      // 3. Lấy thông tin symbol để làm tròn
      const symbolInfo = await this.getSymbolInfo(symbol);
      const roundedQty = this.roundQuantity(quantity, symbolInfo.stepSize);

      // 4. Đặt lệnh chính
      if (orderType === 'MARKET') {
        results.mainOrder = await this.placeMarketOrder(symbol, side, roundedQty);
      } else {
        const roundedPrice = this.roundPrice(entryPrice, symbolInfo.tickSize);
        results.mainOrder = await this.placeLimitOrder(symbol, side, roundedQty, roundedPrice);
      }

      // 5. Đặt Stop Loss
      if (stopLoss) {
        try {
          const roundedSL = this.roundPrice(stopLoss, symbolInfo.tickSize);
          results.stopLossOrder = await this.placeStopLoss(symbol, side, roundedQty, roundedSL);
        } catch (err) {
          results.errors.push(`SL Error: ${err.message}`);
        }
      }

      // 6. Đặt Take Profit
      if (takeProfit) {
        try {
          const roundedTP = this.roundPrice(takeProfit, symbolInfo.tickSize);
          results.takeProfitOrder = await this.placeTakeProfit(symbol, side, roundedQty, roundedTP);
        } catch (err) {
          results.errors.push(`TP Error: ${err.message}`);
        }
      }

      return results;
    } catch (error) {
      results.errors.push(error.message);
      throw results;
    }
  }

  /**
   * Lấy danh sách positions đang mở
   */
  async getOpenPositions() {
    const account = await this.getAccountInfo();
    return account.positions.filter(p => parseFloat(p.positionAmt) !== 0);
  }

  /**
   * Lấy danh sách orders đang mở
   */
  async getOpenOrders(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this.signedRequest('GET', '/fapi/v1/openOrders', params);
  }

  /**
   * Hủy order
   */
  async cancelOrder(symbol, orderId) {
    return this.signedRequest('DELETE', '/fapi/v1/order', {
      symbol,
      orderId
    });
  }

  /**
   * Hủy tất cả orders của symbol
   */
  async cancelAllOrders(symbol) {
    return this.signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
  }

  /**
   * Đóng position
   */
  async closePosition(symbol, positionAmt) {
    const side = positionAmt > 0 ? 'SELL' : 'BUY';
    const quantity = Math.abs(positionAmt);
    return this.placeMarketOrder(symbol, side, quantity);
  }
}

module.exports = TradingService;
