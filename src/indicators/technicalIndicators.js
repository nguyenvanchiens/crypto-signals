/**
 * Module tính toán các chỉ báo kỹ thuật
 * Bao gồm: RSI, MACD, EMA, SMA, Bollinger Bands, ATR
 */

class TechnicalIndicators {
  /**
   * Tính Simple Moving Average (SMA)
   * @param {number[]} data - Mảng giá đóng cửa
   * @param {number} period - Số kỳ
   * @returns {number[]} - Mảng giá trị SMA
   */
  static SMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return result;
  }

  /**
   * Tính Exponential Moving Average (EMA)
   * @param {number[]} data - Mảng giá đóng cửa
   * @param {number} period - Số kỳ
   * @returns {number[]} - Mảng giá trị EMA
   */
  static EMA(data, period) {
    const result = [];
    const multiplier = 2 / (period + 1);

    // Tính SMA đầu tiên làm giá trị EMA ban đầu
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }
      if (i === period - 1) {
        result.push(ema);
        continue;
      }
      ema = (data[i] - ema) * multiplier + ema;
      result.push(ema);
    }
    return result;
  }

  /**
   * Tính Relative Strength Index (RSI)
   * @param {number[]} closes - Mảng giá đóng cửa
   * @param {number} period - Số kỳ (mặc định 14)
   * @returns {number[]} - Mảng giá trị RSI (0-100)
   */
  static RSI(closes, period = 14) {
    const result = [];
    const gains = [];
    const losses = [];

    // Tính thay đổi giá
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Thêm null cho index đầu tiên
    result.push(null);

    for (let i = 0; i < gains.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }

      let avgGain, avgLoss;

      if (i === period - 1) {
        // Tính trung bình đầu tiên
        avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
      } else {
        // Sử dụng smoothed average
        const prevRSI = result[result.length - 1];
        if (prevRSI === null) {
          avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
          avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        } else {
          // Smoothed calculation
          avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
          avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        }
      }

      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        result.push(rsi);
      }
    }

    return result;
  }

  /**
   * Tính MACD (Moving Average Convergence Divergence)
   * @param {number[]} closes - Mảng giá đóng cửa
   * @param {number} fastPeriod - EMA nhanh (mặc định 12)
   * @param {number} slowPeriod - EMA chậm (mặc định 26)
   * @param {number} signalPeriod - Signal line (mặc định 9)
   * @returns {Object} - { macd, signal, histogram }
   */
  static MACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = this.EMA(closes, fastPeriod);
    const slowEMA = this.EMA(closes, slowPeriod);

    // Tính MACD Line
    const macdLine = fastEMA.map((fast, i) => {
      if (fast === null || slowEMA[i] === null) return null;
      return fast - slowEMA[i];
    });

    // Tính Signal Line (EMA của MACD)
    const validMacd = macdLine.filter(v => v !== null);
    const signalEMA = this.EMA(validMacd, signalPeriod);

    // Map signal về đúng index
    const signal = [];
    let signalIndex = 0;
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] === null) {
        signal.push(null);
      } else {
        signal.push(signalEMA[signalIndex] || null);
        signalIndex++;
      }
    }

    // Tính Histogram
    const histogram = macdLine.map((macd, i) => {
      if (macd === null || signal[i] === null) return null;
      return macd - signal[i];
    });

    return {
      macd: macdLine,
      signal: signal,
      histogram: histogram
    };
  }

  /**
   * Tính Bollinger Bands
   * @param {number[]} closes - Mảng giá đóng cửa
   * @param {number} period - Số kỳ (mặc định 20)
   * @param {number} stdDev - Số độ lệch chuẩn (mặc định 2)
   * @returns {Object} - { upper, middle, lower }
   */
  static BollingerBands(closes, period = 20, stdDev = 2) {
    const middle = this.SMA(closes, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        upper.push(null);
        lower.push(null);
        continue;
      }

      const slice = closes.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const squaredDiffs = slice.map(val => Math.pow(val - mean, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(variance);

      upper.push(mean + stdDev * std);
      lower.push(mean - stdDev * std);
    }

    return {
      upper: upper,
      middle: middle,
      lower: lower
    };
  }

  /**
   * Tính Average True Range (ATR) - Dùng để tính Stop Loss
   * @param {Object[]} candles - Mảng candle { high, low, close }
   * @param {number} period - Số kỳ (mặc định 14)
   * @returns {number[]} - Mảng giá trị ATR
   */
  static ATR(candles, period = 14) {
    const trueRanges = [];

    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        trueRanges.push(candles[i].high - candles[i].low);
        continue;
      }

      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // Tính ATR bằng EMA của True Range
    return this.EMA(trueRanges, period);
  }

  /**
   * Tính Volume Moving Average
   * @param {number[]} volumes - Mảng volume
   * @param {number} period - Số kỳ (mặc định 20)
   * @returns {number[]} - Mảng giá trị Volume MA
   */
  static VolumeMA(volumes, period = 20) {
    return this.SMA(volumes, period);
  }

  /**
   * Tính Stochastic RSI
   * @param {number[]} closes - Mảng giá đóng cửa
   * @param {number} rsiPeriod - RSI period
   * @param {number} stochPeriod - Stochastic period
   * @param {number} kPeriod - %K smoothing
   * @param {number} dPeriod - %D smoothing
   * @returns {Object} - { k, d }
   */
  static StochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
    const rsi = this.RSI(closes, rsiPeriod);
    const stochRSI = [];

    for (let i = 0; i < rsi.length; i++) {
      if (i < stochPeriod - 1 || rsi[i] === null) {
        stochRSI.push(null);
        continue;
      }

      const rsiSlice = rsi.slice(i - stochPeriod + 1, i + 1).filter(v => v !== null);
      if (rsiSlice.length < stochPeriod) {
        stochRSI.push(null);
        continue;
      }

      const minRSI = Math.min(...rsiSlice);
      const maxRSI = Math.max(...rsiSlice);

      if (maxRSI === minRSI) {
        stochRSI.push(50);
      } else {
        stochRSI.push(((rsi[i] - minRSI) / (maxRSI - minRSI)) * 100);
      }
    }

    // Tính %K và %D
    const validStoch = stochRSI.filter(v => v !== null);
    const kLine = this.SMA(validStoch, kPeriod);
    const dLine = this.SMA(kLine.filter(v => v !== null), dPeriod);

    return {
      k: kLine,
      d: dLine,
      raw: stochRSI
    };
  }
}

module.exports = TechnicalIndicators;
