/**
 * Cloudflare Worker - Trading Signal Bot
 * Edge runtime version
 */

// ==================== TECHNICAL INDICATORS ====================
class TechnicalIndicators {
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

  static EMA(data, period) {
    const result = [];
    const multiplier = 2 / (period + 1);
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

  static RSI(closes, period = 14) {
    const result = [];
    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    result.push(null);

    for (let i = 0; i < gains.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }

      const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;

      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(100 - (100 / (1 + rs)));
      }
    }
    return result;
  }

  static MACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const fastEMA = this.EMA(closes, fastPeriod);
    const slowEMA = this.EMA(closes, slowPeriod);

    const macdLine = fastEMA.map((fast, i) => {
      if (fast === null || slowEMA[i] === null) return null;
      return fast - slowEMA[i];
    });

    const validMacd = macdLine.filter(v => v !== null);
    const signalEMA = this.EMA(validMacd, signalPeriod);

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

    const histogram = macdLine.map((macd, i) => {
      if (macd === null || signal[i] === null) return null;
      return macd - signal[i];
    });

    return { macd: macdLine, signal, histogram };
  }

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

    return { upper, middle, lower };
  }

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

    return this.EMA(trueRanges, period);
  }

  static VolumeMA(volumes, period = 20) {
    return this.SMA(volumes, period);
  }
}

// ==================== SIGNAL ENGINE ====================
class SignalEngine {
  constructor(config = {}) {
    this.config = {
      rsiPeriod: config.rsiPeriod || 14,
      rsiOversold: config.rsiOversold || 30,
      rsiOverbought: config.rsiOverbought || 70,
      macdFast: config.macdFast || 12,
      macdSlow: config.macdSlow || 26,
      macdSignal: config.macdSignal || 9,
      emaFast: config.emaFast || 9,
      emaSlow: config.emaSlow || 21,
      emaTrend: config.emaTrend || 50,
      bbPeriod: config.bbPeriod || 20,
      bbStdDev: config.bbStdDev || 2,
      atrPeriod: config.atrPeriod || 14,
      atrMultiplierLong: config.atrMultiplierLong || 1.5,
      atrMultiplierShort: config.atrMultiplierShort || 2.0,
      riskRewardRatio: config.riskRewardRatio || 2,
    };
  }

  analyze(candles) {
    if (candles.length < 50) {
      return { error: 'Need at least 50 candles' };
    }

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    const indicators = {
      rsi: TechnicalIndicators.RSI(closes, this.config.rsiPeriod),
      macd: TechnicalIndicators.MACD(closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal),
      emaFast: TechnicalIndicators.EMA(closes, this.config.emaFast),
      emaSlow: TechnicalIndicators.EMA(closes, this.config.emaSlow),
      emaTrend: TechnicalIndicators.EMA(closes, this.config.emaTrend),
      bb: TechnicalIndicators.BollingerBands(closes, this.config.bbPeriod, this.config.bbStdDev),
      atr: TechnicalIndicators.ATR(candles, this.config.atrPeriod),
      volumeMA: TechnicalIndicators.VolumeMA(volumes, 20)
    };

    const currentPrice = closes[closes.length - 1];
    const latestIndicators = this.getLatestIndicators(indicators);
    const analysis = this.analyzeIndicators(latestIndicators, currentPrice);
    const signal = this.generateSignal(analysis, currentPrice, indicators);

    return {
      timestamp: new Date().toISOString(),
      symbol: candles[0]?.symbol || 'UNKNOWN',
      currentPrice,
      indicators: latestIndicators,
      analysis,
      signal
    };
  }

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
      rsi: { current: getLatest(indicators.rsi), previous: getPrevious(indicators.rsi) },
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

  analyzeIndicators(indicators, currentPrice) {
    let totalScore = 0;

    // RSI Analysis
    const rsi = indicators.rsi.current;
    if (rsi < this.config.rsiOversold) totalScore += 2;
    else if (rsi > this.config.rsiOverbought) totalScore -= 2;
    else if (rsi > 50) totalScore += 1;
    else totalScore -= 1;

    // MACD Analysis
    const histogram = indicators.macd.histogram;
    const prevHistogram = indicators.macd.prevHistogram;
    if (histogram > 0 && prevHistogram <= 0) totalScore += 3;
    else if (histogram < 0 && prevHistogram >= 0) totalScore -= 3;
    else if (histogram > 0) totalScore += 1;
    else totalScore -= 1;

    // EMA Analysis
    const { fast, slow, trend } = indicators.ema;
    if (fast > slow) {
      totalScore += 1;
      if (currentPrice > trend) totalScore += 1;
    } else {
      totalScore -= 1;
      if (currentPrice < trend) totalScore -= 1;
    }

    // BB Analysis
    const { upper, lower } = indicators.bb;
    if (currentPrice <= lower) totalScore += 2;
    else if (currentPrice >= upper) totalScore -= 2;

    // Trend Analysis
    if (currentPrice > fast && fast > slow && slow > trend) totalScore += 2;
    else if (currentPrice < fast && fast < slow && slow < trend) totalScore -= 2;

    return { totalScore, strength: Math.abs(totalScore) >= 5 ? 'STRONG' : Math.abs(totalScore) >= 3 ? 'MODERATE' : 'WEAK' };
  }

  generateSignal(analysis, currentPrice, indicators) {
    const { totalScore, strength } = analysis;
    const atr = this.getLatestIndicators(indicators).atr;

    let action = 'WAIT';
    let stopLoss = null;
    let takeProfit = null;
    let confidence = 0;

    if (totalScore > 0) {
      action = 'LONG';
      confidence = Math.min((totalScore / 8) * 100 + 30, 95);
      if (atr) {
        stopLoss = currentPrice - (atr * this.config.atrMultiplierLong);
        takeProfit = currentPrice + (atr * this.config.atrMultiplierLong * this.config.riskRewardRatio);
      }
    } else if (totalScore < 0) {
      action = 'SHORT';
      confidence = Math.min((Math.abs(totalScore) / 8) * 100 + 30, 95);
      if (atr) {
        stopLoss = currentPrice + (atr * this.config.atrMultiplierShort);
        takeProfit = currentPrice - (atr * this.config.atrMultiplierShort * this.config.riskRewardRatio);
      }
    }

    const riskPercent = stopLoss ? Math.abs((currentPrice - stopLoss) / currentPrice * 100) : null;
    const rewardPercent = takeProfit ? Math.abs((takeProfit - currentPrice) / currentPrice * 100) : null;

    let suggestedLeverage = 5;
    if (action !== 'WAIT' && riskPercent) {
      const targetRisk = Math.abs(totalScore) >= 5 ? 40 : Math.abs(totalScore) >= 3 ? 30 : 20;
      suggestedLeverage = Math.min(Math.max(Math.floor(targetRisk / riskPercent), 5), 50);
    }

    return {
      action,
      confidence: confidence.toFixed(1) + '%',
      strength,
      entry: currentPrice,
      stopLoss: stopLoss?.toFixed(2),
      takeProfit: takeProfit?.toFixed(2),
      riskPercent: riskPercent?.toFixed(2) + '%',
      rewardPercent: rewardPercent?.toFixed(2) + '%',
      leverage: suggestedLeverage,
      totalScore
    };
  }
}

// ==================== BINANCE API ====================
async function fetchBinanceKlines(symbol, interval = '1h', limit = 100) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);
  const data = await response.json();

  return data.map(candle => ({
    symbol,
    time: candle[0],
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5])
  }));
}

async function fetchBinancePrice(symbol) {
  const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;
  const response = await fetch(url);
  return response.json();
}

// ==================== POPULAR SYMBOLS ====================
const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'SOLUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
  'AVAXUSDT', 'ATOMUSDT', 'LTCUSDT', 'UNIUSDT', 'APTUSDT'
];

const INTERVALS = [
  { value: '1m', label: '1 Phut' },
  { value: '5m', label: '5 Phut' },
  { value: '15m', label: '15 Phut' },
  { value: '30m', label: '30 Phut' },
  { value: '1h', label: '1 Gio' },
  { value: '4h', label: '4 Gio' },
  { value: '1d', label: '1 Ngay' }
];

// ==================== ROUTER ====================
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only handle /api/* routes, let assets handle everything else
  if (!path.startsWith('/api/')) {
    // Return null to let Cloudflare Assets serve static files
    return null;
  }

  const signalEngine = new SignalEngine();

  try {
    // GET /api/signal/:symbol
    if (path.match(/^\/api\/signal\/([^/]+)$/)) {
      const symbol = path.split('/').pop();
      const interval = url.searchParams.get('interval') || '1h';

      const candles = await fetchBinanceKlines(symbol, interval, 100);
      const result = signalEngine.analyze(candles);
      result.symbol = symbol.toUpperCase();
      result.interval = interval;

      return new Response(JSON.stringify({ success: true, data: result }), { headers: corsHeaders });
    }

    // GET /api/signals
    if (path === '/api/signals') {
      const symbolsParam = url.searchParams.get('symbols');
      const interval = url.searchParams.get('interval') || '1h';
      const symbolList = symbolsParam ? symbolsParam.split(',') : POPULAR_SYMBOLS.slice(0, 5);

      const results = [];
      for (const symbol of symbolList) {
        try {
          const candles = await fetchBinanceKlines(symbol, interval, 100);
          const result = signalEngine.analyze(candles);
          result.symbol = symbol.toUpperCase();
          result.interval = interval;
          results.push(result);
        } catch (err) {
          results.push({ symbol, error: err.message });
        }
      }

      return new Response(JSON.stringify({ success: true, count: results.length, data: results }), { headers: corsHeaders });
    }

    // GET /api/price/:symbol
    if (path.match(/^\/api\/price\/([^/]+)$/)) {
      const symbol = path.split('/').pop();
      const price = await fetchBinancePrice(symbol);
      return new Response(JSON.stringify({ success: true, data: price }), { headers: corsHeaders });
    }

    // GET /api/config
    if (path === '/api/config') {
      return new Response(JSON.stringify({
        success: true,
        data: { symbols: POPULAR_SYMBOLS, intervals: INTERVALS }
      }), { headers: corsHeaders });
    }

    // GET /api/health
    if (path === '/api/health') {
      return new Response(JSON.stringify({
        success: true,
        status: 'running',
        runtime: 'cloudflare-workers',
        timestamp: new Date().toISOString()
      }), { headers: corsHeaders });
    }

    // 404 for unknown API routes
    return new Response(JSON.stringify({ success: false, error: 'API endpoint not found' }), {
      status: 404,
      headers: corsHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};
