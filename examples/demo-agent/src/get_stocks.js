#!/usr/bin/env node

// 中概股信息收集脚本
// 由于API限制，这里提供几个备选方案

const stocks = [
  { symbol: 'BABA', name: '阿里巴巴' },
  { symbol: '0700.HK', name: '腾讯' },
  { symbol: 'PDD', name: '拼多多' },
  { symbol: 'JD', name: '京东' },
  { symbol: '3690.HK', name: '美团' },
  { symbol: 'NTES', name: '网易' },
  { symbol: 'BIDU', name: '百度' }
];

console.log('📈 中概股信息收集脚本');
console.log('================================');
console.log('由于公开API限制，建议使用以下方案：');
console.log('');
console.log('方案1: 使用Yahoo Finance网页版');
console.log('  访问: https://finance.yahoo.com/quote/BABA');
console.log('');
console.log('方案2: 使用TradingView');
console.log('  访问: https://www.tradingview.com/symbols/NYSE-BABA/');
console.log('');
console.log('方案3: 使用Google Finance');
console.log('  访问: https://www.google.com/search?q=BABA+stock');
console.log('');
console.log('要查询的股票列表：');
stocks.forEach(stock => {
  console.log(`  - ${stock.name} (${stock.symbol})`);
});
console.log('');
console.log('建议：我可以帮你设置定时任务，每日自动收集这些股票的行情信息。');
