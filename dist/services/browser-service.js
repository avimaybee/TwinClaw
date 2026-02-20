import { chromium } from 'playwright-core';
export class BrowserService {
    browser = null;
    context = null;
    page = null;
    async init() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
            this.context = await this.browser.newContext();
            this.page = await this.context.newPage();
        }
    }
    async navigate(url) {
        if (!this.page)
            await this.init();
        await this.page.goto(url, { waitUntil: 'networkidle' });
    }
    async getAccessibilityTree() {
        if (!this.page)
            await this.init();
        const bodyLocator = this.page.locator('body');
        if (typeof bodyLocator.ariaSnapshot === 'function') {
            return await bodyLocator.ariaSnapshot();
        }
        return await this.page.content();
    }
    async takeScreenshot(path) {
        if (!this.page)
            await this.init();
        await this.page.screenshot({ path });
    }
    async takeScreenshotForVlm(filePath, fullPage = true) {
        if (!this.page)
            await this.init();
        await this.page.screenshot({ path: filePath, fullPage });
        const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
        return {
            path: filePath,
            viewport,
        };
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
    }
    async click(selector) {
        if (!this.page)
            await this.init();
        await this.page.click(selector);
    }
    async clickAt(point) {
        if (!this.page)
            await this.init();
        await this.page.mouse.click(point.x, point.y);
    }
    async clickFromViewportPercentage(xRatio, yRatio) {
        if (!this.page)
            await this.init();
        const viewport = this.page.viewportSize() ?? { width: 1280, height: 720 };
        const boundedX = Math.max(0, Math.min(1, xRatio));
        const boundedY = Math.max(0, Math.min(1, yRatio));
        const point = {
            x: Math.round(viewport.width * boundedX),
            y: Math.round(viewport.height * boundedY),
        };
        await this.clickAt(point);
        return point;
    }
    async getViewportInfo() {
        if (!this.page)
            await this.init();
        return this.page.viewportSize() ?? { width: 1280, height: 720 };
    }
    async type(selector, text) {
        if (!this.page)
            await this.init();
        await this.page.type(selector, text);
    }
}
