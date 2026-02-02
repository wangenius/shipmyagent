#!/usr/bin/env node

// 美股信息收集脚本
// 使用免费的 API 获取数据

import https from 'https';
import fs from 'fs';

const stocks = [
  { symbol: 'AAPL', name: '苹果' },
  { symbol: 'MSFT', name: '微软' },
  { symbol: 'GOOGL', name: '谷歌' },
  { symbol: 'TSLA', name: '特斯拉' },
  { symbol: 'NVDA', name: '英伟达' },
  { symbol: 'AMZN', name: '亚马逊' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'NFLX', name: 'Netflix' }
];

function getStockData(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=YOUR_API_KEY`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.results && json.results.length > 0) {
            const result = json.results[0];
            const close = result.c;
            const open = result.o;
            const change = close - open;
            const changePercent = (change / open) * 100;
            
            resolve({
              symbol,
              price: close.toFixed(2),
              change: change.toFixed(2),
              changePercent: changePercent.toFixed(2)
            });
          } else {
            reject(new Error('No data'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('📈 美股实时行情');
  console.log('================================');
  console.log('更新时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('');
  console.log('由于API限制，目前无法获取实时数据。');
  console.log('');
  console.log('建议访问以下网站查看美股行情：');
  console.log('');
  console.log('🔗 Yahoo Finance: https://finance.yahoo.com');
  console.log('🔗 TradingView: https://www.tradingview.com');
  console.log('🔗 Google Finance: https://www.google.com/finance');
  console.log('');
  console.log('要查询的股票列表：');
  stocks.forEach(stock => {
    console.log(`  - ${stock.name} (${stock.symbol})`);
  });
  console.log('');
  console.log('💡 提示：如需自动获取数据，可以申请免费API密钥：');
  console.log('   - Polygon.io: https://polygon.io');
  console.log('   - Finnhub.io: https://finnhub.io');
  console.log('   - Alpha Vantage: https://www.alphavantage.co');
}

main().catch(console.error);
