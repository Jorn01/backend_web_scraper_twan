const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function extractUrls() {
    const startTime = Date.now();
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Set the viewport to a desktop resolution
    const viewportHeight = 800;
    await page.setViewport({ width: 1280, height: viewportHeight });

    // Listen for console messages from the page context
    page.on('console', msg => {
        if (msg.type() === 'log') {
            console.log(`PAGE LOG: ${msg.text()}`);
        }
    });

    await page.goto('https://www.sofascore.com/', { waitUntil: 'networkidle2' });

    // Remove the consent and age verification modals
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

    // Click the label to filter live events
    await page.waitForSelector('label[for="WideToggle-right"]', { timeout: 10000 });
    await page.click('label[for="WideToggle-right"]');

    await delay(5000); // wait for 5 seconds to ensure content is loaded

    let extractedData = [];

    for (let i = 0; i < 3; i++) {
        // Extract the content after it has loaded
        const data = await page.evaluate(() => {
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

        extractedData.push(...data);

        // Scroll down one viewport height
        await page.evaluate(`window.scrollBy(0, ${viewportHeight});`);
        await delay(3000); // wait for 3 seconds to allow content to load
    }

    fs.writeFileSync('extracted_hrefs.json', JSON.stringify(extractedData, null, 2));

    await browser.close();
    console.log("Scraping URLs completed in: " + (Date.now() - startTime) + " ms");

    // Start the data extraction after the URLs have been scraped
    extractMatchData();
}

function parseTimeToMinutes(timeString) {
    const parts = timeString.split("'");
    const minutes = parseInt(parts[0], 10);
    return minutes;
}

async function extractMatchData() {
    try {
        const startTime = Date.now();
        const urls = JSON.parse(fs.readFileSync('extracted_hrefs.json', 'utf8'));
        // Filter URLs where match time is more than 70 minutes
        const filteredUrls = urls.filter(item => parseTimeToMinutes(item.matchTime) > 70);
        console.log(`Filtered to ${filteredUrls.length} URLs with match time > 70 minutes`);

        const browser = await puppeteer.launch({ headless: true });
        const results = [];

        for (const item of filteredUrls) {
            const { href: url, matchTime } = item;
            const urlStartTime = Date.now();
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 2000 });
            await page.goto(url, { waitUntil: 'networkidle2' });

            await page.evaluate(() => {
                const ageVerificationModal = document.querySelector('div[data-testid="modal"]');
                if (ageVerificationModal) {
                    ageVerificationModal.parentNode.removeChild(ageVerificationModal);
                }
            });

            await delay(3000);
            await page.evaluate(() => {
                const div = document.querySelector('div.Box.cYKaoH');
                if (div) div.scrollIntoView();
            });

            await delay(2000);
            const data = await page.evaluate(() => {
                const data = {};
                const matchTimeElement = document.querySelector('div.Box.klGMtt.GoalAnimationTextWrapper span.Text.cslbHF');
                if (matchTimeElement) data['Match time'] = matchTimeElement.textContent.trim();
                const ballPossessionElements = document.querySelectorAll('div.Box.heNsMA.bnpRyo > bdi.Box > span.Text > span.Text.gxbNET');
                if (ballPossessionElements.length === 2) data['Ball possession'] = { team1: ballPossessionElements[0].textContent.trim(), team2: ballPossessionElements[1].textContent.trim() };
                const overviewDivs = document.querySelectorAll('div.Box.dsybxc > div.Box.heNsMA.bnpRyo');
                overviewDivs.forEach(div => {
                    const title = div.querySelector('bdi.Box.fUNIGw > div.Box > span.Text')?.textContent.trim();
                    const value1 = div.querySelector('bdi.Box.hKQtHc > span.Text.iZtpCa')?.textContent.trim();
                    const value2 = div.querySelector('bdi.Box.fIiFyn > span.Text.lfzhVF')?.textContent.trim();
                    if (title && value1 && value2) data[title] = { team1: value1, team2: value2 };
                });
                return data;
            });

            if (data) {
                const result = { url, matchTime, data };
                // Read existing data
                let existingData = [];
                const filePath = path.resolve('match_data.json');
                if (fs.existsSync(filePath)) {
                    existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                }

                // Filter out duplicates and keep the one with the highest duration
                const urlMatch = result.url.match(/match\/([^/]+)\//);
                const urlKey = urlMatch ? urlMatch[1] : result.url;
                const existingIndex = existingData.findIndex(item => {
                    const existingUrlMatch = item.url.match(/match\/([^/]+)\//);
                    const existingUrlKey = existingUrlMatch ? existingUrlMatch[1] : item.url;
                    return existingUrlKey === urlKey;
                });

                if (existingIndex !== -1) {
                    const existingTime = parseTimeToMinutes(existingData[existingIndex].matchTime);
                    const newTime = parseTimeToMinutes(result.matchTime);
                    if (newTime > existingTime) {
                        existingData[existingIndex] = result;
                    }
                } else {
                    existingData.push(result);
                }

                // Write updated data to file
                fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
            } else {
                console.log(`No data found for URL: ${url}`);
            }

            await page.close();
            console.log(`Scraping time for ${url} completed in: ${(Date.now() - urlStartTime)} ms`);
        }

        await browser.close();
        console.log("Scraping match data completed in: " + (Date.now() - startTime) + " ms");

    } catch (error) {
        console.error('Error during match data extraction:', error);
    }
    extractUrls();
}

extractUrls();

module.exports = { extractUrls };
