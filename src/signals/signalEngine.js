/**
 * Signal Engine - Phân tích và tạo tín hiệu Long/Short
 * Sử dụng nhiều chỉ báo kỹ thuật để xác định điểm vào lệnh
 */

const TechnicalIndicators = require('../indicators/technicalIndicators');

class SignalEngine {
  constructor(config = {}) {
    this.config = {
      // RSI Settings - Siết chặt hơn
      rsiPeriod: config.rsiPeriod || 14,
      rsiOversold: config.rsiOversold || 25,      // Giảm từ 30 -> 25 (oversold thực sự)
      rsiOverbought: config.rsiOverbought || 75,  // Tăng từ 70 -> 75 (overbought thực sự)

      // MACD Settings
      macdFast: config.macdFast || 12,
      macdSlow: config.macdSlow || 26,
      macdSignal: config.macdSignal || 9,

      // EMA Settings
      emaFast: config.emaFast || 9,
      emaSlow: config.emaSlow || 21,
      emaTrend: config.emaTrend || 50,
      ema200: config.ema200 || 200, // Thêm EMA200 cho long-term trend

      // Bollinger Bands Settings
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,

      // ATR Settings for Stop Loss
      atrPeriod: config.atrPeriod || 14,
      atrMultiplierLong: config.atrMultiplierLong || 2.5,
      atrMultiplierShort: config.atrMultiplierShort || 2.5,

      // ADX Settings - Đo độ mạnh trend
      adxPeriod: config.adxPeriod || 14,
      adxTrendThreshold: config.adxTrendThreshold || 25, // ADX > 25 = có trend

      // Signal Quality Settings - QUAN TRỌNG
      minScoreForSignal: config.minScoreForSignal || 4,        // Tối thiểu 4 điểm để tạo signal (tăng từ 0)
      minConfluence: config.minConfluence || 3,                 // Tối thiểu 3 indicators đồng thuận
      sidewaysADXThreshold: config.sidewaysADXThreshold || 20,  // ADX < 20 = sideway

      // Risk Management
      riskRewardRatio: config.riskRewardRatio || 1.5,
      maxRiskPercent: config.maxRiskPercent || 2,
    };
  }

  /**
   * Phân tích dữ liệu và tạo tín hiệu trading
   * @param {Object[]} candles - Mảng candle { open, high, low, close, volume, time }
   * @returns {Object} - Kết quả phân tích với tín hiệu
   */
  analyze(candles) {
    if (candles.length < 50) {
      return {
        error: 'Không đủ dữ liệu để phân tích (cần ít nhất 50 candles)'
      };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // Tính các chỉ báo
    const indicators = this.calculateIndicators(candles, closes, volumes);

    // Lấy giá trị mới nhất
    const currentPrice = closes[closes.length - 1];
    const latestIndicators = this.getLatestIndicators(indicators);

    // Phân tích từng chỉ báo
    const analysis = this.analyzeIndicators(latestIndicators, currentPrice);

    // Smart Money Analysis
    const smartMoney = this.analyzeSmartMoney(candles, volumes, currentPrice);

    // Tính điểm tổng hợp và tạo tín hiệu
    const signal = this.generateSignal(analysis, currentPrice, candles, indicators);

    return {
      timestamp: new Date().toISOString(),
      symbol: candles[0]?.symbol || 'UNKNOWN',
      currentPrice: currentPrice,
      indicators: latestIndicators,
      analysis: analysis,
      signal: signal,
      marketStructure: smartMoney.marketStructure,
      volumeConfirmation: smartMoney.volumeConfirmation,
      orderBlock: smartMoney.orderBlock,
      pullback: smartMoney.pullback
    };
  }

  /**
   * Smart Money Analysis - Phân tích theo phương pháp SMC
   */
  analyzeSmartMoney(candles, volumes, currentPrice) {
    const result = {
      marketStructure: this.analyzeMarketStructure(candles),
      volumeConfirmation: this.analyzeVolumeConfirmation(candles, volumes),
      orderBlock: this.findOrderBlocks(candles, currentPrice),
      pullback: this.analyzePullback(candles, currentPrice)
    };
    return result;
  }

  /**
   * Phân tích Market Structure (HH, HL, LH, LL)
   */
  analyzeMarketStructure(candles) {
    if (candles.length < 20) {
      return { trend: 'UNKNOWN', pattern: 'N/A', score: 0 };
    }

    const recentCandles = candles.slice(-20);
    const swingPoints = [];

    // Tìm swing highs và swing lows
    for (let i = 2; i < recentCandles.length - 2; i++) {
      const curr = recentCandles[i];
      const prev1 = recentCandles[i - 1];
      const prev2 = recentCandles[i - 2];
      const next1 = recentCandles[i + 1];
      const next2 = recentCandles[i + 2];

      // Swing High
      if (curr.high > prev1.high && curr.high > prev2.high &&
          curr.high > next1.high && curr.high > next2.high) {
        swingPoints.push({ type: 'HIGH', price: curr.high, index: i });
      }
      // Swing Low
      if (curr.low < prev1.low && curr.low < prev2.low &&
          curr.low < next1.low && curr.low < next2.low) {
        swingPoints.push({ type: 'LOW', price: curr.low, index: i });
      }
    }

    if (swingPoints.length < 4) {
      return { trend: 'SIDEWAYS', pattern: 'Không đủ swing points', score: 0 };
    }

    // Phân tích pattern
    const lastPoints = swingPoints.slice(-4);
    const highs = lastPoints.filter(p => p.type === 'HIGH').map(p => p.price);
    const lows = lastPoints.filter(p => p.type === 'LOW').map(p => p.price);

    let trend = 'SIDEWAYS';
    let pattern = '';
    let score = 0;

    if (highs.length >= 2 && lows.length >= 2) {
      const isHH = highs[highs.length - 1] > highs[highs.length - 2];
      const isHL = lows[lows.length - 1] > lows[lows.length - 2];
      const isLH = highs[highs.length - 1] < highs[highs.length - 2];
      const isLL = lows[lows.length - 1] < lows[lows.length - 2];

      if (isHH && isHL) {
        trend = 'UPTREND';
        pattern = 'HH+HL';
        score = 2;
      } else if (isLH && isLL) {
        trend = 'DOWNTREND';
        pattern = 'LH+LL';
        score = -2;
      } else if (isHH && isLL) {
        trend = 'SIDEWAYS';
        pattern = 'HH+LL (Expanding)';
        score = 0;
      } else if (isLH && isHL) {
        trend = 'SIDEWAYS';
        pattern = 'LH+HL (Contracting)';
        score = 0;
      }
    }

    return { trend, pattern, score, swingPoints: swingPoints.slice(-4) };
  }

  /**
   * Phân tích Volume Confirmation
   */
  analyzeVolumeConfirmation(candles, volumes) {
    if (volumes.length < 20) {
      return { ratio: 0, signal: 'N/A', score: 0 };
    }

    const recentVolumes = volumes.slice(-20);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const currentVolume = volumes[volumes.length - 1];
    const ratio = currentVolume / avgVolume;

    let signal = 'NORMAL';
    let score = 0;
    let description = '';

    if (ratio >= 2) {
      signal = 'VERY_HIGH';
      score = 2;
      description = 'Volume rất cao - Xác nhận mạnh';
    } else if (ratio >= 1.5) {
      signal = 'HIGH';
      score = 1;
      description = 'Volume cao - Có xác nhận';
    } else if (ratio < 0.5) {
      signal = 'LOW';
      score = -1;
      description = 'Volume thấp - Thiếu xác nhận';
    } else {
      description = 'Volume bình thường';
    }

    return { ratio: ratio.toFixed(2), signal, score, description, avgVolume, currentVolume };
  }

  /**
   * Tìm Order Blocks
   */
  findOrderBlocks(candles, currentPrice) {
    if (candles.length < 30) {
      return { type: 'NONE', zone: null, score: 0 };
    }

    const recentCandles = candles.slice(-30);
    let bullishOB = null;
    let bearishOB = null;

    // Tìm Bullish Order Block (nến giảm mạnh trước khi tăng mạnh)
    for (let i = 5; i < recentCandles.length - 3; i++) {
      const candle = recentCandles[i];
      const nextCandles = recentCandles.slice(i + 1, i + 4);

      // Bearish candle followed by strong bullish move
      if (candle.close < candle.open) {
        const moveUp = nextCandles.some(c => c.close > candle.high * 1.01);
        if (moveUp && currentPrice > candle.low && currentPrice < candle.high * 1.05) {
          bullishOB = { high: candle.high, low: candle.low, index: i };
        }
      }
    }

    // Tìm Bearish Order Block (nến tăng mạnh trước khi giảm mạnh)
    for (let i = 5; i < recentCandles.length - 3; i++) {
      const candle = recentCandles[i];
      const nextCandles = recentCandles.slice(i + 1, i + 4);

      // Bullish candle followed by strong bearish move
      if (candle.close > candle.open) {
        const moveDown = nextCandles.some(c => c.close < candle.low * 0.99);
        if (moveDown && currentPrice < candle.high && currentPrice > candle.low * 0.95) {
          bearishOB = { high: candle.high, low: candle.low, index: i };
        }
      }
    }

    if (bullishOB && (!bearishOB || bullishOB.index > bearishOB.index)) {
      return {
        type: 'BULLISH',
        zone: bullishOB,
        score: 2,
        description: 'Giá trong vùng Bullish OB - Hỗ trợ LONG'
      };
    } else if (bearishOB) {
      return {
        type: 'BEARISH',
        zone: bearishOB,
        score: -2,
        description: 'Giá trong vùng Bearish OB - Hỗ trợ SHORT'
      };
    }

    return { type: 'NONE', zone: null, score: 0, description: 'Không có Order Block gần' };
  }

  /**
   * Phân tích Pullback
   */
  analyzePullback(candles, currentPrice) {
    if (candles.length < 20) {
      return { type: 'NONE', depth: 0, score: 0 };
    }

    const recentCandles = candles.slice(-20);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    const recentHigh = Math.max(...highs);
    const recentLow = Math.min(...lows);
    const range = recentHigh - recentLow;

    if (range === 0) {
      return { type: 'NONE', depth: 0, score: 0 };
    }

    // Tính độ sâu pullback từ high/low gần nhất
    const distanceFromHigh = recentHigh - currentPrice;
    const distanceFromLow = currentPrice - recentLow;

    let type = 'NONE';
    let depth = 0;
    let score = 0;
    let description = '';

    // Pullback trong uptrend (giá giảm từ high)
    if (distanceFromHigh > distanceFromLow) {
      depth = (distanceFromHigh / range) * 100;
      if (depth >= 38.2 && depth <= 61.8) {
        type = 'BULLISH_PULLBACK';
        score = 2;
        description = `Pullback ${depth.toFixed(1)}% - Vùng Fibonacci hỗ trợ LONG`;
      } else if (depth >= 23.6 && depth < 38.2) {
        type = 'SHALLOW_PULLBACK';
        score = 1;
        description = `Pullback nông ${depth.toFixed(1)}%`;
      } else if (depth > 61.8) {
        type = 'DEEP_PULLBACK';
        score = -1;
        description = `Pullback sâu ${depth.toFixed(1)}% - Cẩn thận đảo chiều`;
      }
    }
    // Pullback trong downtrend (giá tăng từ low)
    else {
      depth = (distanceFromLow / range) * 100;
      if (depth >= 38.2 && depth <= 61.8) {
        type = 'BEARISH_PULLBACK';
        score = -2;
        description = `Pullback ${depth.toFixed(1)}% - Vùng Fibonacci hỗ trợ SHORT`;
      } else if (depth >= 23.6 && depth < 38.2) {
        type = 'SHALLOW_PULLBACK';
        score = -1;
        description = `Pullback nông ${depth.toFixed(1)}%`;
      } else if (depth > 61.8) {
        type = 'DEEP_PULLBACK';
        score = 1;
        description = `Pullback sâu ${depth.toFixed(1)}% - Có thể đảo chiều`;
      }
    }

    return { type, depth: depth.toFixed(1), score, description };
  }

  /**
   * Tìm Support và Resistance dựa trên Swing Points
   * Phương pháp: Tìm các đỉnh/đáy gần nhất làm S/R
   */
  findSupportResistance(candles, currentPrice) {
    if (candles.length < 50) {
      return { supports: [], resistances: [], nearestSupport: null, nearestResistance: null };
    }

    const recentCandles = candles.slice(-50);
    const supports = [];
    const resistances = [];

    // Tìm swing lows (support) và swing highs (resistance)
    for (let i = 3; i < recentCandles.length - 3; i++) {
      const curr = recentCandles[i];
      const window = 3; // Xét 3 nến trước và sau

      let isSwingLow = true;
      let isSwingHigh = true;

      for (let j = 1; j <= window; j++) {
        const prev = recentCandles[i - j];
        const next = recentCandles[i + j];

        if (curr.low >= prev.low || curr.low >= next.low) {
          isSwingLow = false;
        }
        if (curr.high <= prev.high || curr.high <= next.high) {
          isSwingHigh = false;
        }
      }

      if (isSwingLow) {
        supports.push(curr.low);
      }
      if (isSwingHigh) {
        resistances.push(curr.high);
      }
    }

    // Thêm các mức quan trọng khác: Low và High gần nhất
    const last20 = candles.slice(-20);
    const recentLow = Math.min(...last20.map(c => c.low));
    const recentHigh = Math.max(...last20.map(c => c.high));

    if (!supports.includes(recentLow)) supports.push(recentLow);
    if (!resistances.includes(recentHigh)) resistances.push(recentHigh);

    // Tìm support/resistance gần giá hiện tại nhất
    let nearestSupport = null;
    let nearestResistance = null;
    let minSupportDist = Infinity;
    let minResistanceDist = Infinity;

    // Support: phải DƯỚI giá hiện tại
    for (const s of supports) {
      if (s < currentPrice) {
        const dist = currentPrice - s;
        if (dist < minSupportDist) {
          minSupportDist = dist;
          nearestSupport = s;
        }
      }
    }

    // Resistance: phải TRÊN giá hiện tại
    for (const r of resistances) {
      if (r > currentPrice) {
        const dist = r - currentPrice;
        if (dist < minResistanceDist) {
          minResistanceDist = dist;
          nearestResistance = r;
        }
      }
    }

    // Nếu không tìm thấy, dùng % cố định
    if (!nearestSupport) {
      nearestSupport = currentPrice * 0.97; // 3% dưới giá
    }
    if (!nearestResistance) {
      nearestResistance = currentPrice * 1.03; // 3% trên giá
    }

    return {
      supports: supports.sort((a, b) => b - a),
      resistances: resistances.sort((a, b) => a - b),
      nearestSupport,
      nearestResistance,
      supportDistance: ((currentPrice - nearestSupport) / currentPrice * 100).toFixed(2) + '%',
      resistanceDistance: ((nearestResistance - currentPrice) / currentPrice * 100).toFixed(2) + '%'
    };
  }

  /**
   * Tính toán tất cả các chỉ báo
   */
  calculateIndicators(candles, closes, volumes) {
    return {
      rsi: TechnicalIndicators.RSI(closes, this.config.rsiPeriod),
      macd: TechnicalIndicators.MACD(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal),
      emaFast: TechnicalIndicators.EMA(closes, this.config.emaFast),
      emaSlow: TechnicalIndicators.EMA(closes, this.config.emaSlow),
      emaTrend: TechnicalIndicators.EMA(closes, this.config.emaTrend),
      ema200: TechnicalIndicators.EMA(closes, this.config.ema200),
      bb: TechnicalIndicators.BollingerBands(closes, this.config.bbPeriod, this.config.bbStdDev),
      atr: TechnicalIndicators.ATR(candles, this.config.atrPeriod),
      adx: TechnicalIndicators.ADX ? TechnicalIndicators.ADX(candles, this.config.adxPeriod) : null,
      volumeMA: TechnicalIndicators.VolumeMA(volumes, 20)
    };
  }

  /**
   * Lấy giá trị mới nhất của các chỉ báo
   */
  getLatestIndicators(indicators) {
    const getLatest = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null) return arr[i];
      }
      return null;
    };

    const getPrevious = (arr) => {
      let count = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null) {
          count++;
          if (count === 2) return arr[i];
        }
      }
      return null;
    };

    return {
      rsi: {
        current: getLatest(indicators.rsi),
        previous: getPrevious(indicators.rsi)
      },
      macd: {
        macd: getLatest(indicators.macd.macd),
        signal: getLatest(indicators.macd.signal),
        histogram: getLatest(indicators.macd.histogram),
        prevHistogram: getPrevious(indicators.macd.histogram)
      },
      ema: {
        fast: getLatest(indicators.emaFast),
        slow: getLatest(indicators.emaSlow),
        trend: getLatest(indicators.emaTrend),
        ema200: getLatest(indicators.ema200)
      },
      bb: {
        upper: getLatest(indicators.bb.upper),
        middle: getLatest(indicators.bb.middle),
        lower: getLatest(indicators.bb.lower)
      },
      atr: getLatest(indicators.atr),
      adx: indicators.adx ? getLatest(indicators.adx) : null,
      volumeMA: getLatest(indicators.volumeMA)
    };
  }

  /**
   * Phân tích từng chỉ báo và cho điểm
   */
  analyzeIndicators(indicators, currentPrice) {
    const analysis = {
      rsi: this.analyzeRSI(indicators.rsi),
      macd: this.analyzeMACD(indicators.macd),
      ema: this.analyzeEMA(indicators.ema, currentPrice),
      bb: this.analyzeBB(indicators.bb, currentPrice),
      trend: this.analyzeTrend(indicators.ema, currentPrice),
      adx: this.analyzeADX(indicators.adx)
    };

    // Tính tổng điểm
    let totalScore = 0;
    let signalCount = 0;
    let bullishCount = 0;  // Đếm số indicator bullish
    let bearishCount = 0;  // Đếm số indicator bearish

    // Các indicator chính để tính confluence
    const mainIndicators = ['rsi', 'macd', 'ema', 'bb', 'trend'];

    mainIndicators.forEach(key => {
      const a = analysis[key];
      if (a && a.score !== undefined) {
        totalScore += a.score;
        signalCount++;

        if (a.score > 0) bullishCount++;
        else if (a.score < 0) bearishCount++;
      }
    });

    // ADX không tính vào totalScore nhưng dùng để filter
    analysis.totalScore = totalScore;
    analysis.averageScore = signalCount > 0 ? totalScore / signalCount : 0;
    analysis.strength = this.getSignalStrength(analysis.averageScore);

    // Confluence: số lượng indicator đồng thuận
    analysis.bullishConfluence = bullishCount;
    analysis.bearishConfluence = bearishCount;
    analysis.confluence = Math.max(bullishCount, bearishCount);

    // Check sideway market (ADX < threshold)
    analysis.isSideway = indicators.adx !== null && indicators.adx < this.config.sidewaysADXThreshold;

    // Check có đủ trend strength không (ADX > trend threshold)
    analysis.hasTrend = indicators.adx !== null && indicators.adx >= this.config.adxTrendThreshold;

    return analysis;
  }

  /**
   * Phân tích ADX (Average Directional Index) - Đo độ mạnh trend
   */
  analyzeADX(adx) {
    if (adx === null) {
      return { signal: 'N/A', score: 0, value: null, description: 'Không có dữ liệu ADX' };
    }

    let signal = 'NEUTRAL';
    let description = '';

    if (adx >= 50) {
      signal = 'VERY_STRONG_TREND';
      description = `ADX ${adx.toFixed(1)} - Trend RẤT MẠNH (thuận lợi cho trend following)`;
    } else if (adx >= 25) {
      signal = 'STRONG_TREND';
      description = `ADX ${adx.toFixed(1)} - Trend đủ mạnh để giao dịch`;
    } else if (adx >= 20) {
      signal = 'WEAK_TREND';
      description = `ADX ${adx.toFixed(1)} - Trend yếu, cẩn thận`;
    } else {
      signal = 'SIDEWAY';
      description = `ADX ${adx.toFixed(1)} - THỊ TRƯỜNG SIDEWAY, TRÁNH GIAO DỊCH`;
    }

    // ADX không cho điểm trực tiếp, chỉ dùng để filter
    return { signal, score: 0, value: adx, description };
  }

  /**
   * Phân tích RSI - Siết chặt hơn để tránh false signals
   */
  analyzeRSI(rsi) {
    const { current, previous } = rsi;
    let score = 0;
    let signal = 'NEUTRAL';
    let description = '';

    if (current === null) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu RSI' };
    }

    // CHỈ cho điểm khi RSI thực sự oversold/overbought
    // RSI 40-60 = NEUTRAL, không cho điểm
    if (current < this.config.rsiOversold) {
      // RSI < 25: Thực sự oversold
      signal = 'LONG';
      score = 2;
      description = `RSI quá bán (${current.toFixed(1)}) - Cơ hội LONG`;

      // RSI đang tăng từ vùng oversold = signal mạnh hơn
      if (previous && current > previous) {
        score = 3;
        description += ' + RSI đang phục hồi';
      }
    } else if (current > this.config.rsiOverbought) {
      // RSI > 75: Thực sự overbought
      signal = 'SHORT';
      score = -2;
      description = `RSI quá mua (${current.toFixed(1)}) - Cơ hội SHORT`;

      // RSI đang giảm từ vùng overbought = signal mạnh hơn
      if (previous && current < previous) {
        score = -3;
        description += ' + RSI đang suy yếu';
      }
    } else if (current < 35) {
      // RSI 25-35: Gần oversold
      signal = 'SLIGHTLY_BULLISH';
      score = 1;
      description = `RSI ${current.toFixed(1)} - Gần oversold`;
    } else if (current > 65) {
      // RSI 65-75: Gần overbought
      signal = 'SLIGHTLY_BEARISH';
      score = -1;
      description = `RSI ${current.toFixed(1)} - Gần overbought`;
    } else {
      // RSI 35-65: NEUTRAL - KHÔNG cho điểm
      signal = 'NEUTRAL';
      score = 0;
      description = `RSI ${current.toFixed(1)} - Trung tính (không có tín hiệu)`;
    }

    return { signal, score, value: current, description };
  }

  /**
   * Phân tích MACD
   */
  analyzeMACD(macd) {
    const { macd: macdLine, signal: signalLine, histogram, prevHistogram } = macd;
    let score = 0;
    let signal = 'NEUTRAL';
    let description = '';

    if (macdLine === null || signalLine === null) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu MACD' };
    }

    // MACD cắt lên Signal Line (Golden Cross)
    if (histogram > 0 && prevHistogram !== null && prevHistogram <= 0) {
      signal = 'LONG';
      score = 3;
      description = 'MACD Golden Cross - Tín hiệu LONG mạnh';
    }
    // MACD cắt xuống Signal Line (Death Cross)
    else if (histogram < 0 && prevHistogram !== null && prevHistogram >= 0) {
      signal = 'SHORT';
      score = -3;
      description = 'MACD Death Cross - Tín hiệu SHORT mạnh';
    }
    // MACD trên Signal Line
    else if (histogram > 0) {
      signal = 'BULLISH';
      score = histogram > prevHistogram ? 2 : 1;
      description = 'MACD bullish' + (histogram > prevHistogram ? ' và tăng' : '');
    }
    // MACD dưới Signal Line
    else {
      signal = 'BEARISH';
      score = histogram < prevHistogram ? -2 : -1;
      description = 'MACD bearish' + (histogram < prevHistogram ? ' và giảm' : '');
    }

    return {
      signal,
      score,
      macd: macdLine,
      signalLine: signalLine,
      histogram: histogram,
      description
    };
  }

  /**
   * Phân tích EMA
   */
  analyzeEMA(ema, currentPrice) {
    const { fast, slow, trend } = ema;
    let score = 0;
    let signal = 'NEUTRAL';
    let description = '';

    if (fast === null || slow === null) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu EMA' };
    }

    // EMA nhanh trên EMA chậm
    if (fast > slow) {
      score += 1;
      description = 'EMA9 > EMA21 (Bullish)';

      // Giá trên EMA trend
      if (trend && currentPrice > trend) {
        score += 1;
        description += ', Giá > EMA50';
      }

      signal = 'BULLISH';
    } else {
      score -= 1;
      description = 'EMA9 < EMA21 (Bearish)';

      // Giá dưới EMA trend
      if (trend && currentPrice < trend) {
        score -= 1;
        description += ', Giá < EMA50';
      }

      signal = 'BEARISH';
    }

    return { signal, score, fast, slow, trend, description };
  }

  /**
   * Phân tích Bollinger Bands
   */
  analyzeBB(bb, currentPrice) {
    const { upper, middle, lower } = bb;
    let score = 0;
    let signal = 'NEUTRAL';
    let description = '';

    if (upper === null || lower === null) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu BB' };
    }

    const bbWidth = ((upper - lower) / middle) * 100;
    const pricePosition = ((currentPrice - lower) / (upper - lower)) * 100;

    // Giá chạm band dưới
    if (currentPrice <= lower) {
      signal = 'LONG';
      score = 2;
      description = 'Giá chạm BB Lower - Cơ hội LONG (Oversold)';
    }
    // Giá chạm band trên
    else if (currentPrice >= upper) {
      signal = 'SHORT';
      score = -2;
      description = 'Giá chạm BB Upper - Cơ hội SHORT (Overbought)';
    }
    // Giá gần band dưới (20% dưới)
    else if (pricePosition < 20) {
      signal = 'BULLISH';
      score = 1;
      description = 'Giá gần BB Lower - Tiềm năng tăng';
    }
    // Giá gần band trên (80% trên)
    else if (pricePosition > 80) {
      signal = 'BEARISH';
      score = -1;
      description = 'Giá gần BB Upper - Tiềm năng giảm';
    } else {
      description = 'Giá trong vùng trung tính BB';
    }

    return {
      signal,
      score,
      upper,
      middle,
      lower,
      width: bbWidth.toFixed(2),
      pricePosition: pricePosition.toFixed(2),
      description
    };
  }

  /**
   * Phân tích xu hướng tổng thể
   */
  analyzeTrend(ema, currentPrice) {
    const { fast, slow, trend } = ema;
    let signal = 'NEUTRAL';
    let description = '';
    let score = 0;

    if (!trend) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu trend' };
    }

    // Uptrend mạnh: Giá > EMA9 > EMA21 > EMA50
    if (currentPrice > fast && fast > slow && slow > trend) {
      signal = 'STRONG_UPTREND';
      score = 2;
      description = 'Uptrend mạnh - Thuận lợi cho LONG';
    }
    // Downtrend mạnh: Giá < EMA9 < EMA21 < EMA50
    else if (currentPrice < fast && fast < slow && slow < trend) {
      signal = 'STRONG_DOWNTREND';
      score = -2;
      description = 'Downtrend mạnh - Thuận lợi cho SHORT';
    }
    // Uptrend: Giá trên EMA50
    else if (currentPrice > trend) {
      signal = 'UPTREND';
      score = 1;
      description = 'Uptrend - Xu hướng tăng';
    }
    // Downtrend: Giá dưới EMA50
    else {
      signal = 'DOWNTREND';
      score = -1;
      description = 'Downtrend - Xu hướng giảm';
    }

    return { signal, score, description };
  }

  /**
   * Đánh giá sức mạnh tín hiệu
   */
  getSignalStrength(avgScore) {
    const absScore = Math.abs(avgScore);
    if (absScore >= 2) return 'STRONG';
    if (absScore >= 1) return 'MODERATE';
    return 'WEAK';
  }

  /**
   * Tạo tín hiệu trading cuối cùng với SL/TP
   * ĐÃ CẢI THIỆN: Thêm filter sideway, confluence, score threshold
   */
  generateSignal(analysis, currentPrice, candles, indicators) {
    const { totalScore, averageScore, strength, bullishConfluence, bearishConfluence, isSideway, hasTrend } = analysis;
    const atr = this.getLatestIndicators(indicators).atr;

    let action = 'WAIT';
    let confidence = 0;
    let stopLoss = null;
    let takeProfit = null;
    let entry = currentPrice;
    let reason = [];
    let rejectionReasons = []; // Lý do bị từ chối signal

    // ============ FILTER 1: Sideway Market ============
    // ADX < 20 = thị trường sideway, KHÔNG giao dịch
    if (isSideway) {
      rejectionReasons.push(`⛔ THỊ TRƯỜNG SIDEWAY (ADX < ${this.config.sidewaysADXThreshold}) - KHÔNG NÊN GIAO DỊCH`);
    }

    // ============ FILTER 2: Minimum Score ============
    // Cần ít nhất 4 điểm để tạo signal (thay vì > 0)
    const absScore = Math.abs(totalScore);
    if (absScore < this.config.minScoreForSignal) {
      rejectionReasons.push(`⚠️ Score (${totalScore}) chưa đủ mạnh (cần ≥${this.config.minScoreForSignal} hoặc ≤-${this.config.minScoreForSignal})`);
    }

    // ============ FILTER 3: Confluence ============
    // Cần ít nhất 3 indicators đồng thuận
    const confluence = totalScore > 0 ? bullishConfluence : bearishConfluence;
    if (confluence < this.config.minConfluence) {
      rejectionReasons.push(`⚠️ Chỉ có ${confluence} indicators đồng thuận (cần ≥${this.config.minConfluence})`);
    }

    // ============ QUYẾT ĐỊNH SIGNAL ============
    const passAllFilters = rejectionReasons.length === 0;

    // ============ TÌM SUPPORT/RESISTANCE ============
    const srLevels = this.findSupportResistance(candles, currentPrice);

    // LONG: Score dương VÀ pass tất cả filters VÀ gần support
    const nearSupport = srLevels.nearestSupport &&
                        (currentPrice - srLevels.nearestSupport) / currentPrice < 0.015; // Giá cách support < 1.5%

    // SHORT: Score âm VÀ pass tất cả filters VÀ gần resistance
    const nearResistance = srLevels.nearestResistance &&
                           (srLevels.nearestResistance - currentPrice) / currentPrice < 0.015; // Giá cách resistance < 1.5%

    if (totalScore >= this.config.minScoreForSignal && passAllFilters && bullishConfluence >= this.config.minConfluence) {
      // Kiểm tra thêm: có support rõ ràng không?
      if (!srLevels.nearestSupport) {
        rejectionReasons.push('⚠️ Không tìm thấy support rõ ràng để đặt SL');
      }

      if (rejectionReasons.length === 0) {
        action = 'LONG';
        confidence = Math.min((totalScore / 10) * 100 + 30 + (bullishConfluence * 5), 95);

        // Bonus confidence nếu gần support
        if (nearSupport) {
          confidence = Math.min(confidence + 10, 95);
        }

        // SL đặt dưới support gần nhất (có buffer 0.3%)
        stopLoss = srLevels.nearestSupport * 0.997;

        // QUAN TRỌNG: SL tối thiểu phải cách Entry ít nhất 1.5% để tránh bị quét
        const minSLDistance = currentPrice * 0.015; // 1.5%
        if (currentPrice - stopLoss < minSLDistance) {
          stopLoss = currentPrice - minSLDistance;
        }

        // TP dựa trên resistance hoặc R:R ratio
        // QUAN TRỌNG: TP cho LONG phải CAO HƠN giá hiện tại
        const slDistance = currentPrice - stopLoss;
        if (srLevels.nearestResistance && srLevels.nearestResistance > currentPrice * 1.005) {
          // TP = resistance gần nhất (trừ 0.2% buffer) - chỉ khi resistance cao hơn giá
          takeProfit = srLevels.nearestResistance * 0.998;
        } else {
          // Nếu không có resistance phù hợp, dùng R:R 1.5
          takeProfit = currentPrice + (slDistance * 1.5);
        }

        // Double check: TP phải cao hơn Entry ít nhất 0.5%
        if (takeProfit <= currentPrice * 1.005) {
          takeProfit = currentPrice + (slDistance * 1.5);
        }

        reason = this.getLongReasons(analysis);

        if (nearSupport) {
          reason.unshift('🎯 LONG tại SUPPORT - Win rate cao');
        } else if (totalScore >= 7 && bullishConfluence >= 4) {
          reason.unshift('🔥 Tín hiệu LONG RẤT MẠNH');
        } else {
          reason.unshift('✅ Tín hiệu LONG tốt');
        }

        reason.push(`📊 Confluence: ${bullishConfluence}/5 indicators bullish`);
        reason.push(`🛡️ Support: $${srLevels.nearestSupport?.toFixed(4) || 'N/A'}`);
        reason.push(`🎯 Resistance: $${srLevels.nearestResistance?.toFixed(4) || 'N/A'}`);
      }
    }
    // SHORT: Score âm VÀ pass tất cả filters
    else if (totalScore <= -this.config.minScoreForSignal && passAllFilters && bearishConfluence >= this.config.minConfluence) {
      // Kiểm tra thêm: có resistance rõ ràng không?
      if (!srLevels.nearestResistance) {
        rejectionReasons.push('⚠️ Không tìm thấy resistance rõ ràng để đặt SL');
      }

      if (rejectionReasons.length === 0) {
        action = 'SHORT';
        confidence = Math.min((Math.abs(totalScore) / 10) * 100 + 30 + (bearishConfluence * 5), 95);

        // Bonus confidence nếu gần resistance
        if (nearResistance) {
          confidence = Math.min(confidence + 10, 95);
        }

        // SL đặt trên resistance gần nhất (có buffer 0.3%)
        stopLoss = srLevels.nearestResistance * 1.003;

        // QUAN TRỌNG: SL tối thiểu phải cách Entry ít nhất 1.5% để tránh bị quét
        const minSLDistanceShort = currentPrice * 0.015; // 1.5%
        if (stopLoss - currentPrice < minSLDistanceShort) {
          stopLoss = currentPrice + minSLDistanceShort;
        }

        // TP dựa trên support hoặc R:R ratio
        // QUAN TRỌNG: TP cho SHORT phải THẤP HƠN giá hiện tại
        const slDistanceShort = stopLoss - currentPrice;
        if (srLevels.nearestSupport && srLevels.nearestSupport < currentPrice * 0.995) {
          // TP = support gần nhất (cộng 0.2% buffer) - chỉ khi support thấp hơn giá
          takeProfit = srLevels.nearestSupport * 1.002;
        } else {
          // Nếu không có support phù hợp, dùng R:R 1.5
          takeProfit = currentPrice - (slDistanceShort * 1.5);
        }

        // Double check: TP phải thấp hơn Entry ít nhất 0.5%
        if (takeProfit >= currentPrice * 0.995) {
          takeProfit = currentPrice - (slDistanceShort * 1.5);
        }

        reason = this.getShortReasons(analysis);

        if (nearResistance) {
          reason.unshift('🎯 SHORT tại RESISTANCE - Win rate cao');
        } else if (totalScore <= -7 && bearishConfluence >= 4) {
          reason.unshift('🔥 Tín hiệu SHORT RẤT MẠNH');
        } else {
          reason.unshift('✅ Tín hiệu SHORT tốt');
        }

        reason.push(`📊 Confluence: ${bearishConfluence}/5 indicators bearish`);
        reason.push(`🛡️ Support: $${srLevels.nearestSupport?.toFixed(4) || 'N/A'}`);
        reason.push(`🎯 Resistance: $${srLevels.nearestResistance?.toFixed(4) || 'N/A'}`);
      }
    }
    // WAIT: Không đủ điều kiện
    else {
      action = 'WAIT';
      reason = ['🛑 KHÔNG CÓ TÍN HIỆU - Đứng ngoài thị trường'];

      // Thêm lý do bị từ chối
      if (rejectionReasons.length > 0) {
        reason = reason.concat(rejectionReasons);
      } else {
        reason.push('Các chỉ báo chưa hội tụ đủ mạnh');
      }

      // Thông tin hiện tại
      reason.push(`📊 Score: ${totalScore} | Bullish: ${bullishConfluence} | Bearish: ${bearishConfluence}`);

      if (!hasTrend && !isSideway) {
        reason.push('💡 Trend yếu - chờ ADX tăng trên 25');
      }
    }

    // Tính Risk/Reward
    const riskPercent = stopLoss ? Math.abs((currentPrice - stopLoss) / currentPrice * 100) : null;
    const rewardPercent = takeProfit ? Math.abs((takeProfit - currentPrice) / currentPrice * 100) : null;

    // ============ TÍNH LEVERAGE AN TOÀN ============
    // Mục tiêu: Lỗ max 20-30% tài khoản, không quá cao
    let suggestedLeverage = 1;
    let leverageRisk = 'LOW';

    if (action !== 'WAIT' && riskPercent) {
      const absScore = Math.abs(totalScore);
      const confluenceScore = totalScore > 0 ? bullishConfluence : bearishConfluence;

      // Tính leverage dựa trên SL%
      // Mục tiêu: SL% x Leverage = 20-30% tài khoản
      // Ví dụ: SL 2% x 10x = 20% (an toàn)
      //        SL 3% x 10x = 30% (vừa phải)
      const targetRisk = 25; // Mục tiêu lỗ 25% tài khoản
      const calculatedLeverage = Math.floor(targetRisk / riskPercent);

      // Leverage cố định theo độ mạnh tín hiệu
      let desiredLeverage = 8;
      if (absScore >= 7 && confluenceScore >= 4) {
        desiredLeverage = 15;  // Tín hiệu rất mạnh: max 15x
      } else if (absScore >= 5 && confluenceScore >= 3) {
        desiredLeverage = 12;  // Tín hiệu mạnh: 12x
      } else if (absScore >= 4 && confluenceScore >= 3) {
        desiredLeverage = 10;  // Tín hiệu khá: 10x
      }

      // Lấy min để đảm bảo an toàn
      suggestedLeverage = Math.min(desiredLeverage, calculatedLeverage);
      suggestedLeverage = Math.max(suggestedLeverage, 5);  // Tối thiểu 5x
      suggestedLeverage = Math.min(suggestedLeverage, 15); // Max 15x

      // Tính lỗ thực tế với leverage này
      const accountRiskPercent = riskPercent * suggestedLeverage;

      // Đánh giá rủi ro
      if (accountRiskPercent >= 35) {
        leverageRisk = 'HIGH';
      } else if (accountRiskPercent >= 25) {
        leverageRisk = 'MODERATE';
      } else {
        leverageRisk = 'LOW';
      }

      // Thêm gợi ý leverage vào reasons
      reason.push(`💡 Đòn bẩy: ${suggestedLeverage}x (${leverageRisk} risk)`);
      reason.push(`📊 SL ${riskPercent.toFixed(2)}% x ${suggestedLeverage}x = lỗ ~${accountRiskPercent.toFixed(0)}% nếu thua`);
    }

    return {
      action: action,
      confidence: confidence.toFixed(1) + '%',
      strength: strength,
      entry: entry,
      stopLoss: stopLoss ? stopLoss.toFixed(2) : null,
      takeProfit: takeProfit ? takeProfit.toFixed(2) : null,
      riskPercent: riskPercent ? riskPercent.toFixed(2) + '%' : null,
      rewardPercent: rewardPercent ? rewardPercent.toFixed(2) + '%' : null,
      riskReward: riskPercent && rewardPercent ? (rewardPercent / riskPercent).toFixed(2) : null,
      leverage: suggestedLeverage,
      leverageRisk: leverageRisk,
      atr: atr ? atr.toFixed(2) : null,
      atrPercent: atr ? ((atr / currentPrice) * 100).toFixed(2) + '%' : null,
      totalScore: totalScore,
      averageScore: averageScore.toFixed(2),
      reasons: reason
    };
  }

  /**
   * Lấy lý do LONG
   */
  getLongReasons(analysis) {
    const reasons = [];

    if (analysis.rsi.score > 0) {
      reasons.push(analysis.rsi.description);
    }
    if (analysis.macd.score > 0) {
      reasons.push(analysis.macd.description);
    }
    if (analysis.ema.score > 0) {
      reasons.push(analysis.ema.description);
    }
    if (analysis.bb.score > 0) {
      reasons.push(analysis.bb.description);
    }
    if (analysis.trend.score > 0) {
      reasons.push(analysis.trend.description);
    }

    return reasons;
  }

  /**
   * Lấy lý do SHORT
   */
  getShortReasons(analysis) {
    const reasons = [];

    if (analysis.rsi.score < 0) {
      reasons.push(analysis.rsi.description);
    }
    if (analysis.macd.score < 0) {
      reasons.push(analysis.macd.description);
    }
    if (analysis.ema.score < 0) {
      reasons.push(analysis.ema.description);
    }
    if (analysis.bb.score < 0) {
      reasons.push(analysis.bb.description);
    }
    if (analysis.trend.score < 0) {
      reasons.push(analysis.trend.description);
    }

    return reasons;
  }
}

module.exports = SignalEngine;
