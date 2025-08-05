// popup.js

document.addEventListener('DOMContentLoaded', () => {
    function updateLists() {
        chrome.storage.sync.get(['blockedSites', 'timeLimitedSites'], (data) => {
            const blockedSites = data.blockedSites || [];
            const timeLimitedSites = data.timeLimitedSites || {};

            // Update Blocked Sites List with block time.
            const blockedList = document.getElementById('blockedSiteList');
            blockedList.innerHTML = '';
            blockedSites.forEach((site) => {
                const li = document.createElement('li');
                li.textContent = `${site.domain} (Blocked at: ${site.blockedAt})`;
                const unblockBtn = document.createElement('button');
                unblockBtn.textContent = 'Unblock';
                unblockBtn.className = 'removeBtn';
                unblockBtn.addEventListener('click', () => {
                    chrome.storage.sync.get('blockedSites', (data) => {
                        const currentBlocked = data.blockedSites || [];
                        const updatedBlocked = currentBlocked.filter(s => s.domain !== site.domain);
                        chrome.storage.sync.set({ blockedSites: updatedBlocked }, () => {
                            chrome.runtime.sendMessage({ action: 'updateBlockingRules' });
                            chrome.runtime.sendMessage({ action: 'unblockSite', domain: site.domain });
                            updateLists();
                        });
                    });
                });
                li.appendChild(unblockBtn);
                blockedList.appendChild(li);
            });

            // Update Time-Limited Sites List.
            const timeLimitedList = document.getElementById('timeLimitedSiteList');
            timeLimitedList.innerHTML = '';
            Object.entries(timeLimitedSites).forEach(([domain, timeLimit]) => {
                const li = document.createElement('li');
                li.textContent = `${domain}: ${timeLimit} min`;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.className = 'removeBtn';
                removeBtn.addEventListener('click', () => {
                    delete timeLimitedSites[domain];
                    chrome.storage.sync.set({ timeLimitedSites }, updateLists);
                });
                li.appendChild(removeBtn);
                timeLimitedList.appendChild(li);
            });
        });
    }

    // Set Time Limit event.
    document.getElementById('setTimeLimitBtn').addEventListener('click', () => {
        const siteInput = document.getElementById('timeLimitSiteInput').value.trim();
        const timeLimit = parseInt(document.getElementById('timeLimitInput').value.trim(), 10);
        if (!siteInput || isNaN(timeLimit) || timeLimit < 0) {
            alert('Please enter a valid site and time limit (0 or more).');
            return;
        }
        let domain;
        try {
            const url = new URL(siteInput.startsWith('http') ? siteInput : 'https://' + siteInput);
            domain = url.hostname.replace(/^www\./, '');
        } catch (e) {
            alert('Invalid URL');
            return;
        }
        // If timeLimit is 0, directly block the site.
        if (timeLimit === 0) {
            chrome.storage.sync.get('blockedSites', (data) => {
                const blockedSites = data.blockedSites || [];
                const blockedAt = new Date().toLocaleTimeString();
                if (!blockedSites.some(s => s.domain === domain)) {
                    blockedSites.push({ domain, blockedAt });
                    chrome.storage.sync.set({ blockedSites }, () => {
                        chrome.runtime.sendMessage({ action: 'updateBlockingRules' });
                        updateLists();
                        document.getElementById('timeLimitSiteInput').value = '';
                        document.getElementById('timeLimitInput').value = '';
                    });
                }
            });
        } else {
            // Otherwise, set the time limit for the site.
            chrome.storage.sync.get('timeLimitedSites', (data) => {
                const timeLimitedSites = data.timeLimitedSites || {};
                timeLimitedSites[domain] = timeLimit;
                chrome.storage.sync.set({ timeLimitedSites }, () => {
                    updateLists();
                    document.getElementById('timeLimitSiteInput').value = '';
                    document.getElementById('timeLimitInput').value = '';
                });
            });
        }
    });

    updateLists();

    // Listen for storage changes to update the popup dynamically.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            updateLists();
        }
    });
});
