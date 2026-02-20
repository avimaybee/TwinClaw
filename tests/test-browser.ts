import { BrowserService } from '../src/services/browser-service.js';

async function test() {
  const browser = new BrowserService();
  try {
    console.log('Initializing browser...');
    await browser.init();
    console.log('Navigating to example.com...');
    await browser.navigate('https://example.com');
    const page = (browser as any).page;
    console.log('Available keys on page:', Object.keys(page).filter(k => !k.startsWith('_')));
    console.log('Taking accessibility snapshot...');
    const snapshot = await browser.getAccessibilityTree();
    console.log('Accessibility Tree Snapshot:', JSON.stringify(snapshot, null, 2));
    await browser.takeScreenshot('tests/screenshot.png');
    console.log('Screenshot saved to tests/screenshot.png');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

test();
