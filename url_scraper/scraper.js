const { webkit } = require('playwright'); // Change to 'chromium' or 'firefox' if needed
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();

app.use(require('cors')());

app.get('/api', (req, res) => {
    try {
        const data = readJsonFile('extracted_hrefs.json');
        res.json(data);
    } catch (error) {
        res.status(500).send('Error reading data');
    }
});

const PORT = process.env.PORT || 3031;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

function readJsonFile(filePath) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function launchBrowser() {
    return await webkit.launch({ headless: true });
}

async function createNewPage(browser) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    return page;
}

async function handleConsoleMessages(page) {
    page.on('console', msg => {
        if (msg.type() === 'log') {
            console.log(`PAGE LOG: ${msg.text()}`);
        }
    });
}

async function navigateToPage(page, url) {
    await page.goto(url, { waitUntil: 'networkidle' });
}

async function removeModals(page) {
    await page.evaluate(() => {
        const consentModal = document.querySelector('div.fc-consent-root');
        if (consentModal) {
            consentModal.parentNode.removeChild(consentModal);
        }

        const ageVerificationModal = document.querySelector('div[data-testid="modal"]');
        if (ageVerificationModal) {
            ageVerificationModal.parentNode.removeChild(ageVerificationModal);
        }
    });
}

async function clickLiveEventsFilter(page) {
    await page.waitForSelector('label[for="WideToggle-right"]', { state: 'visible' });
    await page.click('label[for="WideToggle-right"]', { force: true });
}

async function extractContent(page) {
    return await page.evaluate(() => {
        const parentElements = Array.from(document.querySelectorAll('div.Box.dTbAOG')).filter(el => el.classList.length === 2);

        const data = parentElements.flatMap(parent => {
            const elements = Array.from(parent.querySelectorAll('div.klGMtt.Box')).filter(el => {
                return el.classList.length === 2 && el.querySelector('a[href]');
            });

            return elements.map(element => {
                const link = element.querySelector('a[href]');
                const matchTimeElement = element.querySelector('bdi.Text.ipsxwz');
                const matchTime = matchTimeElement ? matchTimeElement.textContent.trim() : null;
                return { href: link.href, matchTime };
            }).filter(item => item.href && item.matchTime);  // Filter out invalid entries
        });

        return data;
    });
}

async function scrollPage(page, viewportHeight) {
    await page.evaluate(`window.scrollBy(0, ${viewportHeight});`);
}

async function extractUrls() {
    try {
        const startTime = Date.now();

        const browser = await launchBrowser();
        const page = await createNewPage(browser);

        await handleConsoleMessages(page);
        await navigateToPage(page, 'https://www.sofascore.com/');
        await removeModals(page);
        await clickLiveEventsFilter(page);
        await delay(4000); // wait for 4 seconds to ensure content is loaded

        let extractedData = [];

        for (let i = 0; i < 6; i++) {
            const data = await extractContent(page);
            extractedData.push(...data);

            // Scroll down one viewport height
            await scrollPage(page, 800);
            await delay(3000); // wait for 3 seconds to allow content to load
        }

        writeJsonFile('extracted_hrefs.json', extractedData);

        await browser.close();
        console.log("Scraping URLs completed in: " + (Date.now() - startTime) + " ms");

        // Start the data extraction after the URLs have been scraped
        extractUrls();
    } catch (error) {
        console.error('Error during URL extraction:', error);
        console.log('Restarting the scraping process...');
        await delay(5000); // wait for 5 seconds before restarting
        extractUrls(); // Restart the scraping process
    }
}

extractUrls();
