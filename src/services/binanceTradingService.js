/**
 * Binance Trading Service - Đặt lệnh thật trên Binance Futures
 * Sử dụng API Key và Secret để giao dịch
 */

const crypto = require('crypto');
const axios = require('axios');

class BinanceTradingService {
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
    params.timestamp = timestamp;

    const queryString = Object.entries(params)
      .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
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
      console.error('Binance API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Lấy thông tin tài khoản
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
      unrealizedPnL: parseFloat(account.totalUnrealizedProfit || 0)
    };
  }

  /**
   * Đặt leverage cho symbol
   */
  async setLeverage(symbol, leverage) {
    return this.signedRequest('POST', '/fapi/v1/leverage', {
      symbol: symbol.toUpperCase(),
      leverage: leverage
    });
  }

  /**
   * Đặt margin type (ISOLATED hoặc CROSSED)
   */
  async setMarginType(symbol, marginType = 'ISOLATED') {
    try {
      return await this.signedRequest('POST', '/fapi/v1/marginType', {
        symbol: symbol.toUpperCase(),
        marginType: marginType
      });
    } catch (error) {
      // Bỏ qua lỗi nếu margin type đã được set
      if (error.response?.data?.code === -4046) {
        return { msg: 'No need to change margin type' };
      }
      throw error;
    }
  }

  /**
   * Mở lệnh Market
   * @param {string} symbol - VD: BTCUSDT
   * @param {string} side - BUY (Long) hoặc SELL (Short)
   * @param {number} quantity - Số lượng coin
   * @param {number} leverage - Đòn bẩy
   */
  async openMarketOrder(symbol, side, quantity, leverage = 10) {
    // Set leverage trước
    await this.setLeverage(symbol, leverage);
    await this.setMarginType(symbol, 'ISOLATED');

    // Đặt lệnh market
    return this.signedRequest('POST', '/fapi/v1/order', {
      symbol: symbol.toUpperCase(),
      side: side, // BUY hoặc SELL
      type: 'MARKET',
      quantity: quantity
    });
  }

  /**
   * Mở lệnh với SL/TP
   * @param {Object} params - Thông số lệnh
   */
  async openPositionWithSLTP(params) {
    const {
      symbol,
      side, // 'LONG' hoặc 'SHORT'
      margin, // Số tiền USDT muốn dùng
      leverage = 10,
      stopLoss,
      takeProfit
    } = params;

    const upperSymbol = symbol.toUpperCase();

    // 1. Set leverage và margin type
    await this.setLeverage(upperSymbol, leverage);
    await this.setMarginType(upperSymbol, 'ISOLATED');

    // 2. Lấy giá hiện tại để tính quantity
    const ticker = await axios.get(`${this.baseUrl}/fapi/v1/ticker/price`, {
      params: { symbol: upperSymbol }
    });
    const currentPrice = parseFloat(ticker.data.price);

    // 3. Lấy thông tin symbol để biết precision
    const exchangeInfo = await axios.get(`${this.baseUrl}/fapi/v1/exchangeInfo`);
    const symbolInfo = exchangeInfo.data.symbols.find(s => s.symbol === upperSymbol);
    const quantityPrecision = symbolInfo?.quantityPrecision || 3;
    const pricePrecision = symbolInfo?.pricePrecision || 2;

    // 4. Tính quantity từ margin và leverage
    const positionSize = margin * leverage;
    const quantity = parseFloat((positionSize / currentPrice).toFixed(quantityPrecision));

    // 5. Xác định side cho lệnh
    const orderSide = side === 'LONG' ? 'BUY' : 'SELL';
    const closeSide = side === 'LONG' ? 'SELL' : 'BUY';

    console.log(`[Trade] Opening ${side} ${upperSymbol}: Margin=${margin}, Leverage=${leverage}x, Qty=${quantity}, Price=${currentPrice}`);

    // 6. Mở lệnh Market
    const mainOrder = await this.signedRequest('POST', '/fapi/v1/order', {
      symbol: upperSymbol,
      side: orderSide,
      type: 'MARKET',
      quantity: quantity
    });

    console.log('[Trade] Main order placed:', mainOrder.orderId);

    // 7. Đặt Stop Loss (STOP_MARKET)
    let slOrder = null;
    if (stopLoss) {
      try {
        slOrder = await this.signedRequest('POST', '/fapi/v1/order', {
          symbol: upperSymbol,
          side: closeSide,
          type: 'STOP_MARKET',
          stopPrice: parseFloat(stopLoss).toFixed(pricePrecision),
          closePosition: 'true'
        });
        console.log('[Trade] SL order placed:', slOrder.orderId);
      } catch (e) {
        console.error('[Trade] SL order failed:', e.response?.data || e.message);
      }
    }

    // 8. Đặt Take Profit (TAKE_PROFIT_MARKET)
    let tpOrder = null;
    if (takeProfit) {
      try {
        tpOrder = await this.signedRequest('POST', '/fapi/v1/order', {
          symbol: upperSymbol,
          side: closeSide,
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: parseFloat(takeProfit).toFixed(pricePrecision),
          closePosition: 'true'
        });
        console.log('[Trade] TP order placed:', tpOrder.orderId);
      } catch (e) {
        console.error('[Trade] TP order failed:', e.response?.data || e.message);
      }
    }

    return {
      success: true,
      mainOrder,
      slOrder,
      tpOrder,
      position: {
        symbol: upperSymbol,
        side,
        quantity,
        entryPrice: currentPrice,
        margin,
        leverage,
        stopLoss,
        takeProfit
      }
    };
  }

  /**
   * Đóng position
   */
  async closePosition(symbol, side) {
    const upperSymbol = symbol.toUpperCase();

    // Lấy position hiện tại
    const positions = await this.signedRequest('GET', '/fapi/v2/positionRisk', {
      symbol: upperSymbol
    });

    const position = positions.find(p => parseFloat(p.positionAmt) !== 0);
    if (!position) {
      throw new Error('Không có position nào để đóng');
    }

    const positionAmt = Math.abs(parseFloat(position.positionAmt));
    const closeSide = parseFloat(position.positionAmt) > 0 ? 'SELL' : 'BUY';

    // Đóng lệnh market
    const closeOrder = await this.signedRequest('POST', '/fapi/v1/order', {
      symbol: upperSymbol,
      side: closeSide,
      type: 'MARKET',
      quantity: positionAmt
    });

    // Hủy các lệnh SL/TP đang chờ
    await this.cancelAllOrders(upperSymbol);

    return closeOrder;
  }

  /**
   * Hủy tất cả lệnh đang chờ của symbol
   */
  async cancelAllOrders(symbol) {
    return this.signedRequest('DELETE', '/fapi/v1/allOpenOrders', {
      symbol: symbol.toUpperCase()
    });
  }

  /**
   * Lấy danh sách positions đang mở
   */
  async getOpenPositions() {
    const positions = await this.signedRequest('GET', '/fapi/v2/positionRisk');
    return positions.filter(p => parseFloat(p.positionAmt) !== 0);
  }

  /**
   * Lấy danh sách lệnh đang chờ
   */
  async getOpenOrders(symbol = null) {
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    return this.signedRequest('GET', '/fapi/v1/openOrders', params);
  }

  /**
   * Kiểm tra kết nối API
   */
  async testConnection() {
    try {
      const account = await this.getAccountInfo();
      return {
        connected: true,
        canTrade: account.canTrade,
        totalBalance: account.totalWalletBalance
      };
    } catch (error) {
      return {
        connected: false,
        error: error.response?.data?.msg || error.message
      };
    }
  }
}

module.exports = BinanceTradingService;
