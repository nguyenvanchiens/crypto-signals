# \# Trading Signal Bot - Futures Long/Short

# 

# Bot phân tích tín hiệu giao dịch Futures với Stop Loss, Take Profit và đề xuất đòn bẩy.

# 

# \## Tính năng

# 

# \- Phân tích kỹ thuật: RSI, MACD, EMA, Bollinger Bands, ATR

# \- Tín hiệu LONG/SHORT với Entry, Stop Loss, Take Profit

# \- Đề xuất đòn bẩy dựa trên độ mạnh tín hiệu

# \- Hỗ trợ 150+ cặp coin Futures

# \- Theo dõi lệnh realtime với P/L

# \- Lịch sử giao dịch với Win Rate

# \- Truy cập từ LAN (điện thoại, máy khác)

# 

# \## Cài đặt

# 

# ```bash

# \# Clone repo

# git clone https://github.com/YOUR\_USERNAME/trading-signal-bot.git

# cd trading-signal-bot

# 

# \# Cài dependencies

# npm install

# 

# \# Chạy server

# npm start

# ```

# 

# Server sẽ chạy tại:

# \- Local: http://localhost:3001

# \- LAN: http://YOUR\_IP:3001

# 

# \## API Endpoints

# 

# | Method | Endpoint | Mô tả |

# |--------|----------|-------|

# | GET | `/api/signal/:symbol` | Lấy tín hiệu 1 symbol |

# | GET | `/api/signals?symbols=BTC,ETH` | Lấy tín hiệu nhiều symbol |

# | GET | `/api/price/:symbol` | Lấy giá hiện tại |

# | GET | `/api/config` | Lấy danh sách symbols và intervals |

# | POST | `/api/calculate-position` | Tính position size |

# | GET | `/api/health` | Health check |

# 

# \## Deploy

# 

# \### Option 1: VPS/Server (Khuyến nghị)

# 

# ```bash

# \# Trên VPS

# git clone https://github.com/YOUR\_USERNAME/trading-signal-bot.git

# cd trading-signal-bot

# npm install

# npm start

# 

# \# Hoặc dùng PM2

# npm install -g pm2

# pm2 start src/server.js --name trading-bot

# pm2 save

# ```

# 

# \### Option 2: Cloudflare Workers

# 

# ```bash

# \# Cài Wrangler CLI

# npm install -g wrangler

# 

# \# Login Cloudflare

# wrangler login

# 

# \# Deploy

# wrangler deploy

# ```

# 

# \### Option 3: Render.com (Free tier)

# 

# 1\. Push code lên GitHub

# 2\. Vào render.com > New Web Service

# 3\. Connect GitHub repo

# 4\. Build command: `npm install`

# 5\. Start command: `npm start`

# 

# \## Cấu trúc thư mục

# 

# ```

# trading-signal-bot/

# ├── public/

# │   └── index.html          # Giao diện web

# ├── src/

# │   ├── server.js           # Express server

# │   ├── services/

# │   │   └── binanceService.js   # Binance API

# │   ├── signals/

# │   │   └── signalEngine.js     # Logic tín hiệu

# │   └── indicators/

# │       └── technicalIndicators.js  # Các chỉ báo kỹ thuật

# ├── package.json

# ├── .env.example

# └── README.md

# ```

# 

# \## Screenshots

# 

# !\[Trading Signal Bot](https://via.placeholder.com/800x400?text=Trading+Signal+Bot)

# 

# \## License

# 

# MIT



