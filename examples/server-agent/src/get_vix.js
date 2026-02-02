#!/usr/bin/env node

// VIX 恐慌指数分析脚本
// 获取VIX数据并进行分析

import https from 'https';

// VIX指数解读标准
const VIX_LEVELS = {
  EXTREME_FEAR: { min: 30, label: '极度恐慌', emoji: '😱', color: '🔴' },
  FEAR: { min: 25, label: '恐慌', emoji: '😰', color: '🟠' },
  GREED: { min: 20, label: '贪婪', emoji: '😋', color: '🟡' },
  EXTREME_GREED: { min: 0, label: '极度贪婪', emoji: '🤑', color: '🟢' }
};

function getVIXLevel(vixValue) {
  if (vixValue >= VIX_LEVELS.EXTREME_FEAR.min) {
    return VIX_LEVELS.EXTREME_FEAR;
  } else if (vixValue >= VIX_LEVELS.FEAR.min) {
    return VIX_LEVELS.FEAR;
  } else if (vixValue >= VIX_LEVELS.GREED.min) {
    return VIX_LEVELS.GREED;
  } else {
    return VIX_LEVELS.EXTREME_GREED;
  }
}

// 使用Yahoo Finance的简单API获取VIX数据
function getVIXData() {
  return new Promise((resolve, reject) => {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/^VIX';
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.chart && json.chart.result && json.chart.result.length > 0) {
            const result = json.chart.result[0];
            const meta = result.meta;
            const regularMarketPrice = meta.regularMarketPrice;
            const previousClose = meta.previousClose;
            const change = regularMarketPrice - previousClose;
            const changePercent = (change / previousClose) * 100;
            
            resolve({
              symbol: '^VIX',
              name: 'VIX恐慌指数',
              price: regularMarketPrice.toFixed(2),
              previousClose: previousClose.toFixed(2),
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

function analyzeVIX(vixData) {
  const vixValue = parseFloat(vixData.price);
  const level = getVIXLevel(vixValue);
  const isRising = parseFloat(vixData.change) > 0;
  
  let analysis = [];
  
  // 基础分析
  analysis.push(`当前VIX指数为 ${vixValue}，市场情绪处于${level.emoji} ${level.label}状态`);
  
  // 趋势分析
  if (isRising) {
    analysis.push(`VIX指数上涨 ${vixData.changePercent}%，市场不确定性增加，投资者情绪趋于谨慎`);
  } else {
    analysis.push(`VIX指数下跌 ${Math.abs(vixData.changePercent)}%，市场情绪相对稳定`);
  }
  
  // 历史对比
  if (vixValue < 15) {
    analysis.push('VIX低于15，市场处于历史低波动期，可能存在过度乐观的风险');
  } else if (vixValue > 25) {
    analysis.push('VIX高于25，市场波动性较高，建议保持谨慎，适当降低仓位');
  } else {
    analysis.push('VIX处于15-25的正常区间，市场波动性适中');
  }
  
  // 投资建议
  if (level.label === '极度恐慌' || level.label === '恐慌') {
    analysis.push('💡 投资建议：市场恐慌时往往是长期投资机会，但建议分批建仓，不要一次性抄底');
  } else if (level.label === '贪婪' || level.label === '极度贪婪') {
    analysis.push('💡 投资建议：市场情绪过于乐观时，建议适当获利了结，保持现金仓位');
  } else {
    analysis.push('💡 投资建议：市场情绪相对平衡，可按正常策略进行投资');
  }
  
  return analysis;
}

async function main() {
  console.log('📊 VIX恐慌指数分析');
  console.log('================================');
  console.log('更新时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('');
  
  try {
    const vixData = await getVIXData();
    
    console.log(`📈 ${vixData.name} (^VIX)`);
    console.log('--------------------------------');
    console.log(`当前价格: ${vixData.price}`);
    console.log(`昨收价格: ${vixData.previousClose}`);
    console.log(`涨跌: ${vixData.change} (${vixData.changePercent}%)`);
    console.log('');
    
    const analysis = analyzeVIX(vixData);
    console.log('📋 市场分析');
    console.log('--------------------------------');
    analysis.forEach((item, index) => {
      console.log(`${index + 1}. ${item}`);
    });
    
    console.log('');
    console.log('📚 VIX指数说明');
    console.log('--------------------------------');
    console.log('VIX（CBOE波动率指数）反映了标普500指数未来30天的预期波动率');
    console.log('');
    console.log('VIX指数等级划分：');
    console.log(`  ${VIX_LEVELS.EXTREME_FEAR.color} 30+   极度恐慌 ${VIX_LEVELS.EXTREME_FEAR.emoji}`);
    console.log(`  ${VIX_LEVELS.FEAR.color} 25-30  恐慌 ${VIX_LEVELS.FEAR.emoji}`);
    console.log(`  ${VIX_LEVELS.GREED.color} 20-25  贪婪 ${VIX_LEVELS.GREED.emoji}`);
    console.log(`  ${VIX_LEVELS.EXTREME_GREED.color} 0-20   极度贪婪 ${VIX_LEVELS.EXTREME_GREED.emoji}`);
    
  } catch (error) {
    console.log('❌ 无法获取VIX数据');
    console.log('');
    console.log('原因:', error.message);
    console.log('');
    console.log('🔗 建议访问以下网站查看VIX指数：');
    console.log('   - Yahoo Finance: https://finance.yahoo.com/quote/%5EVIX');
    console.log('   - CBOE官网: https://www.cboe.com/us/indices/dashboard/^VIX');
    console.log('   - TradingView: https://www.tradingview.com/symbols/CBOE/VIX/');
  }
}

main().catch(console.error);
