/**
 * Binance Service - Lấy dữ liệu giá từ Binance API
 */

const axios = require('axios');

class BinanceService {
  constructor() {
    this.baseUrl = 'https://api.binance.com';
    this.futuresUrl = 'https://fapi.binance.com';
  }

  /**
   * Lấy dữ liệu klines (candlestick) từ Binance Spot
   * @param {string} symbol - Ví dụ: BTCUSDT
   * @param {string} interval - Ví dụ: 1m, 5m, 15m, 1h, 4h, 1d
   * @param {number} limit - Số lượng candles (tối đa 1000)
   * @returns {Promise<Object[]>} - Mảng candle data
   */
  async getKlines(symbol, interval = '1h', limit = 100) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval: interval,
          limit: limit
        }
      });

      return this.formatKlines(response.data, symbol);
    } catch (error) {
      console.error('Lỗi lấy dữ liệu Binance:', error.message);
      throw error;
    }
  }

  /**
   * Lấy dữ liệu klines từ Binance Futures
   * @param {string} symbol - Ví dụ: BTCUSDT
   * @param {string} interval - Ví dụ: 1m, 5m, 15m, 1h, 4h, 1d
   * @param {number} limit - Số lượng candles
   * @returns {Promise<Object[]>} - Mảng candle data
   */
  async getFuturesKlines(symbol, interval = '1h', limit = 100) {
    try {
      const response = await axios.get(`${this.futuresUrl}/fapi/v1/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval: interval,
          limit: limit
        }
      });

      return this.formatKlines(response.data, symbol);
    } catch (error) {
      console.error('Lỗi lấy dữ liệu Futures:', error.message);
      throw error;
    }
  }

  /**
   * Format dữ liệu klines
   */
  formatKlines(data, symbol) {
    return data.map(candle => ({
      symbol: symbol,
      time: candle[0],
      timeFormatted: new Date(candle[0]).toISOString(),
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
      closeTime: candle[6],
      quoteVolume: parseFloat(candle[7]),
      trades: candle[8]
    }));
  }

  /**
   * Lấy giá hiện tại
   * @param {string} symbol - Ví dụ: BTCUSDT
   * @returns {Promise<Object>} - Thông tin giá
   */
  async getCurrentPrice(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/ticker/price`, {
        params: { symbol: symbol.toUpperCase() }
      });

      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.price)
      };
    } catch (error) {
      console.error('Lỗi lấy giá:', error.message);
      throw error;
    }
  }

  /**
   * Lấy giá Futures hiện tại
   * @param {string} symbol - Ví dụ: BTCUSDT
   * @returns {Promise<Object>} - Thông tin giá
   */
  async getFuturesPrice(symbol) {
    try {
      const response = await axios.get(`${this.futuresUrl}/fapi/v1/ticker/price`, {
        params: { symbol: symbol.toUpperCase() }
      });

      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.price)
      };
    } catch (error) {
      console.error('Lỗi lấy giá Futures:', error.message);
      throw error;
    }
  }

  /**
   * Lấy thông tin 24h của symbol (Futures)
   * @param {string} symbol - Ví dụ: BTCUSDT
   * @returns {Promise<Object>} - Thông tin 24h
   */
  async get24hStats(symbol) {
    try {
      // Dùng Futures API thay vì Spot
      const response = await axios.get(`${this.futuresUrl}/fapi/v1/ticker/24hr`, {
        params: { symbol: symbol.toUpperCase() }
      });

      return {
        symbol: response.data.symbol,
        priceChange: parseFloat(response.data.priceChange),
        priceChangePercent: parseFloat(response.data.priceChangePercent),
        highPrice: parseFloat(response.data.highPrice),
        lowPrice: parseFloat(response.data.lowPrice),
        volume: parseFloat(response.data.volume),
        quoteVolume: parseFloat(response.data.quoteVolume)
      };
    } catch (error) {
      console.error('Lỗi lấy thống kê 24h:', error.message);
      // Trả về object rỗng thay vì throw để không crash
      return {
        symbol: symbol,
        priceChange: 0,
        priceChangePercent: 0,
        highPrice: 0,
        lowPrice: 0,
        volume: 0,
        quoteVolume: 0
      };
    }
  }

  /**
   * Lấy danh sách các symbol phổ biến (fallback)
   * @returns {string[]} - Danh sách symbol
   */
  getPopularSymbols() {
    return [
      // Top 10
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
      'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
      // 11-20
      'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'UNIUSDT', 'APTUSDT',
      'ARBUSDT', 'OPUSDT', 'NEARUSDT', 'FILUSDT', 'INJUSDT',
      // 21-30
      'SUIUSDT', 'SEIUSDT', 'TIAUSDT', 'FETUSDT', 'WIFUSDT',
      '1000PEPEUSDT', 'ORDIUSDT', 'STXUSDT', 'RUNEUSDT', 'AAVEUSDT'
    ];
  }

  /**
   * Lấy TẤT CẢ Futures USDT symbols từ Binance
   * Lọc theo volume và loại bỏ các symbol không phù hợp
   * @param {number} minVolume - Volume tối thiểu 24h (USDT)
   * @returns {Promise<Object[]>} - Danh sách symbol với thông tin volume
   */
  async getAllFuturesSymbols(minVolume = 10000000) {
    try {
      // Lấy thông tin exchange
      const exchangeInfo = await axios.get(`${this.futuresUrl}/fapi/v1/exchangeInfo`);

      // Lấy ticker 24h để có volume
      const ticker24h = await axios.get(`${this.futuresUrl}/fapi/v1/ticker/24hr`);

      // Tạo map volume
      const volumeMap = {};
      ticker24h.data.forEach(t => {
        volumeMap[t.symbol] = {
          volume: parseFloat(t.quoteVolume), // Volume tính bằng USDT
          priceChange: parseFloat(t.priceChangePercent),
          lastPrice: parseFloat(t.lastPrice)
        };
      });

      // Lọc symbols
      const validSymbols = exchangeInfo.data.symbols
        .filter(s => {
          // Chỉ lấy USDT perpetual
          if (!s.symbol.endsWith('USDT')) return false;
          if (s.contractType !== 'PERPETUAL') return false;
          if (s.status !== 'TRADING') return false;

          // Loại bỏ các symbol đặc biệt
          if (s.symbol.includes('_')) return false;

          // Kiểm tra volume
          const vol = volumeMap[s.symbol];
          if (!vol || vol.volume < minVolume) return false;

          return true;
        })
        .map(s => ({
          symbol: s.symbol,
          ...volumeMap[s.symbol]
        }))
        .sort((a, b) => b.volume - a.volume); // Sắp xếp theo volume giảm dần

      console.log(`[Binance] Tìm thấy ${validSymbols.length} futures symbols có volume > $${(minVolume/1000000).toFixed(0)}M`);

      return validSymbols;
    } catch (error) {
      console.error('Lỗi lấy danh sách futures symbols:', error.message);
      // Fallback về danh sách cố định
      return this.getPopularSymbols().map(s => ({ symbol: s, volume: 0 }));
    }
  }

  /**
   * Lấy các interval hỗ trợ
   * @returns {Object[]} - Danh sách interval
   */
  getSupportedIntervals() {
    return [
      { value: '1m', label: '1 Phút' },
      { value: '5m', label: '5 Phút' },
      { value: '15m', label: '15 Phút' },
      { value: '30m', label: '30 Phút' },
      { value: '1h', label: '1 Giờ' },
      { value: '4h', label: '4 Giờ' },
      { value: '1d', label: '1 Ngày' },
      { value: '1w', label: '1 Tuần' }
    ];
  }
}

module.exports = BinanceService;
