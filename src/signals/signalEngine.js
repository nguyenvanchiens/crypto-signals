/**
 * Signal Engine - Phân tích và tạo tín hiệu Long/Short
 * Sử dụng nhiều chỉ báo kỹ thuật để xác định điểm vào lệnh
 */

const TechnicalIndicators = require('../indicators/technicalIndicators');

class SignalEngine {
  constructor(config = {}) {
    this.config = {
      // RSI Settings
      rsiPeriod: config.rsiPeriod || 14,
      rsiOversold: config.rsiOversold || 30,
      rsiOverbought: config.rsiOverbought || 70,

      // MACD Settings
      macdFast: config.macdFast || 12,
      macdSlow: config.macdSlow || 26,
      macdSignal: config.macdSignal || 9,

      // EMA Settings
      emaFast: config.emaFast || 9,
      emaSlow: config.emaSlow || 21,
      emaTrend: config.emaTrend || 50,

      // Bollinger Bands Settings
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,

      // ATR Settings for Stop Loss
      atrPeriod: config.atrPeriod || 14,
      atrMultiplierLong: config.atrMultiplierLong || 2.5,   // SL cho LONG (dưới entry) - tăng từ 1.5 để SL rộng hơn
      atrMultiplierShort: config.atrMultiplierShort || 2.5, // SL cho SHORT (trên entry) - tăng để SL rộng hơn

      // Risk Management
      riskRewardRatio: config.riskRewardRatio || 1.5,       // Giảm từ 2 xuống 1.5 để TP dễ đạt hơn
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
   * Tính toán tất cả các chỉ báo
   */
  calculateIndicators(candles, closes, volumes) {
    return {
      rsi: TechnicalIndicators.RSI(closes, this.config.rsiPeriod),
      macd: TechnicalIndicators.MACD(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal),
      emaFast: TechnicalIndicators.EMA(closes, this.config.emaFast),
      emaSlow: TechnicalIndicators.EMA(closes, this.config.emaSlow),
      emaTrend: TechnicalIndicators.EMA(closes, this.config.emaTrend),
      bb: TechnicalIndicators.BollingerBands(closes, this.config.bbPeriod, this.config.bbStdDev),
      atr: TechnicalIndicators.ATR(candles, this.config.atrPeriod),
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
        trend: getLatest(indicators.emaTrend)
      },
      bb: {
        upper: getLatest(indicators.bb.upper),
        middle: getLatest(indicators.bb.middle),
        lower: getLatest(indicators.bb.lower)
      },
      atr: getLatest(indicators.atr),
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
      trend: this.analyzeTrend(indicators.ema, currentPrice)
    };

    // Tính tổng điểm
    let totalScore = 0;
    let signalCount = 0;

    Object.values(analysis).forEach(a => {
      if (a.score !== undefined) {
        totalScore += a.score;
        signalCount++;
      }
    });

    analysis.totalScore = totalScore;
    analysis.averageScore = signalCount > 0 ? totalScore / signalCount : 0;
    analysis.strength = this.getSignalStrength(analysis.averageScore);

    return analysis;
  }

  /**
   * Phân tích RSI
   */
  analyzeRSI(rsi) {
    const { current, previous } = rsi;
    let score = 0;
    let signal = 'NEUTRAL';
    let description = '';

    if (current === null) {
      return { signal: 'N/A', score: 0, description: 'Không đủ dữ liệu RSI' };
    }

    if (current < this.config.rsiOversold) {
      signal = 'LONG';
      score = 2;
      description = `RSI quá bán (${current.toFixed(2)}) - Cơ hội LONG`;

      // RSI tăng từ vùng oversold
      if (previous && current > previous) {
        score = 3;
        description += ' - RSI đang phục hồi';
      }
    } else if (current > this.config.rsiOverbought) {
      signal = 'SHORT';
      score = -2;
      description = `RSI quá mua (${current.toFixed(2)}) - Cơ hội SHORT`;

      // RSI giảm từ vùng overbought
      if (previous && current < previous) {
        score = -3;
        description += ' - RSI đang suy yếu';
      }
    } else if (current > 50) {
      signal = 'BULLISH';
      score = 1;
      description = `RSI bullish (${current.toFixed(2)})`;
    } else {
      signal = 'BEARISH';
      score = -1;
      description = `RSI bearish (${current.toFixed(2)})`;
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
   */
  generateSignal(analysis, currentPrice, candles, indicators) {
    const { totalScore, averageScore, strength } = analysis;
    const atr = this.getLatestIndicators(indicators).atr;

    let action = 'WAIT';
    let confidence = 0;
    let stopLoss = null;
    let takeProfit = null;
    let entry = currentPrice;
    let reason = [];

    // LONG: Điểm dương (score > 0)
    if (totalScore > 0) {
      action = 'LONG';
      // Confidence dựa trên độ mạnh của tín hiệu (30-95%)
      confidence = Math.min((totalScore / 8) * 100 + 30, 95);

      // Tính Stop Loss dựa trên ATR (LONG: SL dưới entry)
      if (atr) {
        stopLoss = currentPrice - (atr * this.config.atrMultiplierLong);
        takeProfit = currentPrice + (atr * this.config.atrMultiplierLong * this.config.riskRewardRatio);
      } else {
        stopLoss = currentPrice * 0.98;
        takeProfit = currentPrice * 1.04;
      }

      reason = this.getLongReasons(analysis);

      // Đánh giá độ mạnh tín hiệu
      if (totalScore >= 5) {
        reason.unshift('🔥 Tín hiệu LONG RẤT MẠNH');
      } else if (totalScore >= 3) {
        reason.unshift('✅ Tín hiệu LONG khá tốt');
      } else {
        reason.push('⚠️ Tín hiệu yếu - cân nhắc size nhỏ hoặc đợi thêm');
      }
    }
    // SHORT: Điểm âm (score < 0)
    else if (totalScore < 0) {
      action = 'SHORT';
      confidence = Math.min((Math.abs(totalScore) / 8) * 100 + 30, 95);

      // SHORT: SL trên entry - cần xa hơn vì giá hay quét lên trước khi xuống
      if (atr) {
        stopLoss = currentPrice + (atr * this.config.atrMultiplierShort);
        takeProfit = currentPrice - (atr * this.config.atrMultiplierShort * this.config.riskRewardRatio);
      } else {
        stopLoss = currentPrice * 1.025; // 2.5% thay vì 2%
        takeProfit = currentPrice * 0.95;
      }

      reason = this.getShortReasons(analysis);

      // Đánh giá độ mạnh tín hiệu
      if (totalScore <= -5) {
        reason.unshift('🔥 Tín hiệu SHORT RẤT MẠNH');
      } else if (totalScore <= -3) {
        reason.unshift('✅ Tín hiệu SHORT khá tốt');
      } else {
        reason.push('⚠️ Tín hiệu yếu - cân nhắc size nhỏ hoặc đợi thêm');
      }
    }
    // WAIT: Score = 0 (hiếm khi xảy ra)
    else {
      reason = ['Thị trường sideway - các chỉ báo cân bằng', 'Nên đứng ngoài chờ đợi'];
    }

    // Tính Risk/Reward
    const riskPercent = stopLoss ? Math.abs((currentPrice - stopLoss) / currentPrice * 100) : null;
    const rewardPercent = takeProfit ? Math.abs((takeProfit - currentPrice) / currentPrice * 100) : null;

    // Tính đòn bẩy khuyến nghị dựa trên:
    // 1. Độ mạnh tín hiệu (totalScore)
    // 2. Volatility (ATR%)
    // 3. Khoảng cách SL (riskPercent) - SL càng gần thì leverage có thể cao hơn
    let suggestedLeverage = 1;
    let leverageRisk = 'LOW';

    if (action !== 'WAIT' && riskPercent) {
      const atrPercent = atr ? (atr / currentPrice) * 100 : 1;
      const absScore = Math.abs(totalScore);

      // Logic tính leverage mới:
      // Dựa trên % SL để tính leverage tối đa an toàn
      // Nếu SL = 2% và muốn rủi ro tối đa 50% tài khoản khi sai -> max leverage = 50/2 = 25x
      // Nếu SL = 3% -> max leverage = 50/3 = 16x

      // Tính leverage dựa trên khoảng cách SL
      // Công thức: leverage = targetRisk / riskPercent
      // targetRisk: % tài khoản sẵn sàng mất nếu SL (20-40% tùy tín hiệu)

      let targetRisk = 25; // Mặc định sẵn sàng rủi ro 25% tài khoản

      if (absScore >= 5) {
        targetRisk = 40; // Tín hiệu rất mạnh -> chấp nhận rủi ro 40%
      } else if (absScore >= 3) {
        targetRisk = 30; // Tín hiệu khá -> rủi ro 30%
      } else {
        targetRisk = 20; // Tín hiệu yếu -> rủi ro 20%
      }

      // Tính leverage từ SL%
      let calculatedLeverage = Math.floor(targetRisk / riskPercent);

      // Giới hạn leverage theo volatility
      let maxLeverage = 50;
      if (atrPercent >= 3) {
        maxLeverage = 30; // Volatility rất cao -> max 30x
      } else if (atrPercent >= 2) {
        maxLeverage = 40; // Volatility cao -> max 40x
      }

      suggestedLeverage = Math.min(calculatedLeverage, maxLeverage);
      suggestedLeverage = Math.max(suggestedLeverage, 5); // Tối thiểu 5x

      // Đánh giá mức độ rủi ro
      if (suggestedLeverage >= 40) {
        leverageRisk = 'HIGH';
      } else if (suggestedLeverage >= 25) {
        leverageRisk = 'MODERATE';
      } else {
        leverageRisk = 'LOW';
      }

      // Thêm gợi ý leverage vào reasons
      reason.push(`💡 Đòn bẩy khuyến nghị: ${suggestedLeverage}x (${leverageRisk} risk)`);
      reason.push(`📊 Với SL ${riskPercent.toFixed(2)}%, bẩy ${suggestedLeverage}x -> rủi ro ~${(riskPercent * suggestedLeverage).toFixed(0)}% tài khoản`);
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
