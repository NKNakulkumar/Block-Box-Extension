// background.js

// In-memory tracking
let blockedSites = [];
let timeLimitedSites = {};
let totalTimeSpent = {};
let activeTabSessions = {}; // { tabId: timestamp }

// Load data from storage
function loadBlockedSites(callback) {
    chrome.storage.sync.get('blockedSites', (data) => {
        blockedSites = data.blockedSites || [];
        if (callback) callback();
    });
}

function loadTimeLimitedSites() {
    chrome.storage.sync.get('timeLimitedSites', (data) => {
        timeLimitedSites = data.timeLimitedSites || {};
    });
}

function loadTotalTimeSpent() {
    chrome.storage.local.get('totalTimeSpent', (data) => {
        totalTimeSpent = data.totalTimeSpent || {};
    });
}

// Helper to construct a regex that matches the domain and its subdomains
function buildDomainRegex(domain) {
    const escapedDomain = domain.replace(/\./g, '\\.');
    return `^(http|https):\\/\\/(?:[^\\/]+\\.)?${escapedDomain}\\/?`;
}

// Update dynamic blocking rules using regexFilter so that all pages on a domain are blocked
function updateBlockingRules() {
    loadBlockedSites(() => {
        // Remove a broad range of rule IDs.
        const removeIds = Array.from({ length: 100 }, (_, i) => i + 1);
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeIds
        }, () => {
            // Create a rule for each blocked site using a regexFilter.
            const rules = blockedSites.map((site, index) => ({
                id: index + 1,
                priority: 1,
                action: {
                    redirect: { url: chrome.runtime.getURL('blocked.html?domain=' + site.domain) }
                },
                condition: {
                    regexFilter: buildDomainRegex(site.domain),
                    resourceTypes: ["main_frame"]
                }
            }));
            chrome.declarativeNetRequest.updateDynamicRules({
                addRules: rules
            }, () => {
                console.log('Dynamic blocking rules updated:', rules);
            });
        });
    });
}

// Monitor active tab time for time-limited sites
function checkTimeLimits() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs.length) return;
        const tab = tabs[0];
        try {
            const urlObj = new URL(tab.url);
            const domain = urlObj.hostname.replace(/^www\./, '');
            // Only process if the domain has a time limit defined.
            if (timeLimitedSites[domain]) {
                const now = Date.now();
                if (!activeTabSessions[tab.id]) {
                    activeTabSessions[tab.id] = now;
                } else {
                    const elapsed = (now - activeTabSessions[tab.id]) / 1000;
                    totalTimeSpent[domain] = (totalTimeSpent[domain] || 0) + elapsed;
                    activeTabSessions[tab.id] = now;
                    const allowedSeconds = timeLimitedSites[domain] * 60;
                    if (totalTimeSpent[domain] >= allowedSeconds) {
                        if (!blockedSites.some(s => s.domain === domain)) {
                            const blockedAt = new Date().toLocaleTimeString();
                            blockedSites.push({ domain, blockedAt });
                            chrome.storage.sync.set({ blockedSites }, () => {
                                updateBlockingRules();
                                console.log(`${domain} blocked at ${blockedAt} after exceeding limit.`);
                                chrome.tabs.query({}, (tabs) => {
                                    tabs.forEach((t) => {
                                        if (t.url && new URL(t.url).hostname.replace(/^www\./, '') === domain) {
                                            chrome.tabs.update(t.id, { url: chrome.runtime.getURL('blocked.html?domain=' + domain) });
                                        }
                                    });
                                });
                            });
                        }
                    }
                    chrome.storage.local.set({ totalTimeSpent });
                }
            }
        } catch (e) {
            // Ignore URL parsing errors.
        }
    });
}

// Clear active session when a tab is activated or closed.
chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabSessions[activeInfo.tabId] = Date.now();
});
chrome.tabs.onRemoved.addListener((tabId) => {
    delete activeTabSessions[tabId];
});

// Redirect any navigation to a blocked site immediately.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        try {
            const urlObj = new URL(tab.url);
            const domain = urlObj.hostname.replace(/^www\./, '');
            if (blockedSites.some(s => s.domain === domain)) {
                chrome.tabs.update(tabId, { url: chrome.runtime.getURL('blocked.html?domain=' + domain) });
            }
        } catch (e) {
            // Ignore errors.
        }
    }
});

// Listen for messages from the popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateBlockingRules') {
        updateBlockingRules();
        sendResponse({ status: 'updated' });
    }
    if (message.action === 'unblockSite') {
        const domain = message.domain;
        blockedSites = blockedSites.filter(s => s.domain !== domain);
        totalTimeSpent[domain] = 0;
        chrome.storage.sync.set({ blockedSites }, () => {
            updateBlockingRules();
            chrome.storage.local.set({ totalTimeSpent });
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    if (tab.url && tab.url.includes('blocked.html')) {
                        try {
                            const urlObj = new URL(tab.url);
                            const blockedDomain = urlObj.searchParams.get('domain');
                            if (blockedDomain === domain) {
                                chrome.tabs.update(tab.id, { url: 'https://' + domain });
                            }
                        } catch (e) {
                            // Ignore URL parsing errors.
                        }
                    }
                });
            });
            sendResponse({ status: 'unblocked' });
        });
    }
});

// Check time limits every second.
setInterval(checkTimeLimits, 1000);

// Initial load.
loadBlockedSites();
loadTimeLimitedSites();
loadTotalTimeSpent();
updateBlockingRules();
