import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
const pages = await b.pages();
let page = pages.find(p => p.url().includes('localhost:3000'));

await page.click('#demo-btn');
await new Promise(r => setTimeout(r, 4000));
await page.screenshot({ path: './screenshot_demo.png' });

const title = await page.$eval('#week-title', el => el.textContent).catch(() => 'N/A');
const bbch = await page.$eval('#week-bbch', el => el.textContent).catch(() => 'N/A');
const badge = await page.$eval('#genome-badge', el => el.textContent).catch(() => 'N/A');
const slider = await page.$eval('#week-slider', el => el.disabled).catch(() => true);

console.log('week-title:', title);
console.log('week-bbch:', bbch);
console.log('genome-badge:', badge);
console.log('slider-disabled:', slider);
await b.disconnect();
