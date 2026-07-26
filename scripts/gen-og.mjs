/** 生成默认分享图 public/og-default.png（1200×630，奶油纸+黄铜时钟意象） */
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#f5efe0"/>
  <rect x="24" y="24" width="1152" height="582" fill="none" stroke="#d9ccae" stroke-width="2"/>
  <circle cx="920" cy="315" r="150" fill="#fbf6ea" stroke="#a8853c" stroke-width="10"/>
  <line x1="920" y1="315" x2="920" y2="215" stroke="#2b2117" stroke-width="10" stroke-linecap="round"/>
  <line x1="920" y1="315" x2="990" y2="350" stroke="#2b2117" stroke-width="10" stroke-linecap="round"/>
  <circle cx="920" cy="315" r="12" fill="#a8853c"/>
  <text x="120" y="300" font-family="serif" font-size="72" font-weight="bold" fill="#2b2117">三页的书桌</text>
  <text x="122" y="370" font-family="serif" font-size="30" fill="#5a4c3a">一个私人的数字书桌 · 写作 · 思考 · 记录</text>
  <text x="122" y="430" font-family="serif" font-size="24" fill="#a8853c">把时间调准，世界才会回应你。</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('public/og-default.png');
console.log('og-default.png generated');
