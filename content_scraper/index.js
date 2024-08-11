const { webkit } = require('playwright'); // Change to 'chromium' or 'firefox' if needed
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();

let memorizedData = [];  // In-memory store for scraped data

app.use(require('cors')());

app.get('/api', async (req, res) => {
    const { L } = req.query;
    if (L) {
        console.log(`Setting match time to: ${L}`);
        matchTime = L;
    }
    console.log(matchTime);
    try {
        const data = JSON.parse(fs.readFileSync('match_data.json', 'utf8'));
        res.json(data);
    } catch (error) {
        res.status(500).send('Error reading data');
    }
});

const PORT = process.env.PORT || 3030;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

let matchTime = 70;

function parseTimeToMinutes(timeString) {
    const parts = timeString.split("'");
    const minutes = parseInt(parts[0], 10);
    return minutes;
}

async function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function fetchUrls() {
    try {
        const response = await fetch('http://localhost:3031/api');
        if (!response.ok) throw new Error('Failed to fetch URLs');
        const urls = await response.json();
        if (!urls) throw new Error('No URLs received');
        return urls;
    } catch (error) {
        console.error(`Error fetching URLs: ${error.message}`);
        await delay(5000);
        return fetchUrls();
    }
}

function filterUrls(urls) {
    return urls
        .filter(item => parseTimeToMinutes(item.matchTime) > matchTime)
        .filter(item => {
            const urlMatch = item.href.match(/match\/([^/]+)\//);
            const urlKey = urlMatch ? urlMatch[1] : item.href;
            return !memorizedData.some(existingItem => {
                const existingUrlMatch = existingItem.url.match(/match\/([^/]+)\//);
                const existingUrlKey = existingUrlMatch ? existingUrlMatch[1] : existingItem.url;
                return existingUrlKey === urlKey;
            });
        });
}

async function scrapeDataFromUrl(browser, item) {
    try {
        const startTime_Url = Date.now();
        const { href: url, matchTime } = item;
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 2000 });
        await page.goto(url, { waitUntil: 'networkidle' });

        await removeAgeVerificationModal(page);
        await delay(3000); // Wait for content to load
        await scrollIntoView(page);
        await delay(2000); // Wait for any additional content to load

        const data = await extractDataFromPage(page);
        if (data) {
            const result = { url, matchTime, data };
            updateMemorizedData(result);
            updateDataFile();
        } else {
            console.log(`No data found for URL: ${url}`);
        }

        await page.close();
        console.log(`Scraping match data for URL ${url} completed in: ${Date.now() - startTime_Url} ms`);
        fs.writeFileSync('scraping_times_url.csv', `${Date.now() - startTime_Url}\n`, { flag: 'a' });
    } catch (error) {
        console.error(`Error processing URL ${item.href}: ${error.message}`);
    }
}

async function removeAgeVerificationModal(page) {
    await page.evaluate(() => {
        const ageVerificationModal = document.querySelector('div[data-testid="modal"]');
        if (ageVerificationModal) {
            ageVerificationModal.parentNode.removeChild(ageVerificationModal);
        }
    });
}

async function scrollIntoView(page) {
    await page.evaluate(() => {
        const div = document.querySelector('div.Box.cYKaoH');
        if (div) div.scrollIntoView();
    });
}

async function extractDataFromPage(page) {
    return await page.evaluate(() => {
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
}

function updateMemorizedData(result) {
    memorizedData.push(result);
}

function updateDataFile() {
    fs.writeFileSync('match_data.json', JSON.stringify(memorizedData, null, 2));
}

async function extractMatchData() {
    const startTime = Date.now();
    const urls = await fetchUrls();
    const uniqueUrls = filterUrls(urls);

    console.log(`Filtered to ${uniqueUrls.length} new URLs with match time > ${matchTime} minutes`);

    if (uniqueUrls.length === 0) {
        console.log("No new URLs to scrape");
        await delay(5000);
        extractMatchData();
        return
    }
    const browser = await webkit.launch({ headless: true }); // Launch WebKit in headless mode

    for (const item of uniqueUrls) {
        await scrapeDataFromUrl(browser, item);
    }

    await browser.close();
    console.log("Scraping match data completed in: " + (Date.now() - startTime) + " ms");

    // Recursively call the function to continue scraping with updated match time
    extractMatchData();
}

extractMatchData();