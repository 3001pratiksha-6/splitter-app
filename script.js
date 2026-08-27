// STATE MANAGEMENT
const db = {
    user: JSON.parse(localStorage.getItem('app_user')) || null,
    trip: JSON.parse(localStorage.getItem('app_trip')) || { category: 'Vacation/Trip', customName: '', startDate: '', endDate: '' },
    members: JSON.parse(localStorage.getItem('app_members')) || [],
    expenses: JSON.parse(localStorage.getItem('app_expenses')) || [],
    settlements: JSON.parse(localStorage.getItem('app_settlements')) || {},
    history: JSON.parse(localStorage.getItem('app_history')) || [],
    chatMessages: JSON.parse(localStorage.getItem('app_chat_messages')) || []
};

let expenseChartInstance = null;
let balanceChartInstance = null;
let cameraStream = null;
let editingHistoryKey = null;
let pendingTripShare = null;

const currencySymbols = { INR: '₹', USD: '$', EUR: '€' };

function getCurrencyLabel(currency, customCurrency = '') {
    return currencySymbols[currency] || customCurrency.trim().toUpperCase() || '¤';
}

function formatMoney(amount, currency = 'INR', customCurrency = '') {
    const label = getCurrencyLabel(currency, customCurrency);
    return `${label}${amount.toFixed(2)}`;
}

function updateHeaderTripTitle(title) {
    const headerTitle = document.getElementById('header-trip-title');
    if (headerTitle) headerTitle.innerText = title;
}

function saveDB() {
    localStorage.setItem('app_user', JSON.stringify(db.user));
    localStorage.setItem('app_trip', JSON.stringify(db.trip));
    localStorage.setItem('app_members', JSON.stringify(db.members));
    localStorage.setItem('app_expenses', JSON.stringify(db.expenses));
    localStorage.setItem('app_settlements', JSON.stringify(db.settlements));
    localStorage.setItem('app_chat_messages', JSON.stringify(db.chatMessages));
    saveCurrentTripToHistory();
    localStorage.setItem('app_history', JSON.stringify(db.history));
}

function getTripHistoryKey() {
    return `${db.trip.title || db.trip.category}|${db.trip.startDate}|${db.trip.endDate}`;
}

function saveCurrentTripToHistory() {
    if (!db.trip.title && !db.trip.category) return;

    const key = getTripHistoryKey();
    const existingIndex = db.history.findIndex(entry => entry.key === key || entry.key === editingHistoryKey);
    const snapshot = {
        key,
        title: db.trip.title || db.trip.category || 'Untitled Trip',
        category: db.trip.category || 'Vacation/Trip',
        customName: db.trip.customName || '',
        startDate: db.trip.startDate || '',
        endDate: db.trip.endDate || '',
        members: JSON.parse(JSON.stringify(db.members)),
        expenses: JSON.parse(JSON.stringify(db.expenses)),
        settlements: JSON.parse(JSON.stringify(db.settlements)),
        updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) db.history[existingIndex] = snapshot;
    else db.history.unshift(snapshot);
    db.history = db.history.slice(0, 20);
    editingHistoryKey = null;
}

// AUTH HANDLER
document.getElementById('auth-form').addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const password = document.getElementById('user-password').value;
    const phone = document.getElementById('user-phone').value.trim();
    const upi = document.getElementById('user-upi').value.trim();

    const savedCredentials = JSON.parse(localStorage.getItem('app_credentials'));
    if (!pendingTripShare && savedCredentials && (savedCredentials.email !== email.toLowerCase() || savedCredentials.password !== password)) {
        return alert('Incorrect email or password.');
    }
    if (!pendingTripShare && !savedCredentials) {
        localStorage.setItem('app_credentials', JSON.stringify({ email: email.toLowerCase(), password }));
    }

    db.user = { name: name.trim(), email: email.trim(), phone, upi };

    if (pendingTripShare) {
        db.trip = pendingTripShare.trip;
        db.members = pendingTripShare.members;
        db.expenses = pendingTripShare.expenses;
        db.settlements = pendingTripShare.settlements || {};
        const alreadyJoined = db.members.some(member => member.name.toLowerCase() === name.toLowerCase());
        if (!alreadyJoined) db.members.push({ name, email, upi, paymentMethod: upi ? 'UPI' : 'Cash' });
        pendingTripShare = null;
        history.replaceState(null, '', window.location.pathname);
    }

    saveDB();
    checkAuth();
    updateHeaderTripTitle(db.trip.title || db.trip.category);
    document.getElementById('user-password').value = '';
});

function checkAuth() {
    const overlay = document.getElementById('auth-overlay');
    if (db.user && !pendingTripShare) {
        overlay.style.display = 'none';
        document.getElementById('current-user-name').innerText = db.user.name;
        document.getElementById('profile-name').innerText = db.user.name;
        document.getElementById('current-user-email').innerText = db.user.email || 'Email not added';
        document.getElementById('current-user-phone').innerText = db.user.phone || 'Phone not added';
        document.getElementById('current-user-upi').innerText = db.user.upi ? `UPI: ${db.user.upi}` : 'UPI not added';
    } else {
        overlay.style.display = 'flex';
    }
}

function openProfileEditor() {
    const name = prompt('Full name:', db.user?.name || '');
    if (name === null) return;
    const email = prompt('Email address:', db.user?.email || '');
    if (email === null) return;
    const phone = prompt('Phone number:', db.user?.phone || '');
    if (phone === null) return;
    const upi = prompt('UPI ID:', db.user?.upi || '');
    if (upi === null) return;
    if (!name.trim() || !email.trim()) return alert('Name and email are required.');

    db.user = { name: name.trim(), email: email.trim(), phone: phone.trim(), upi: upi.trim() };
    saveDB();
    checkAuth();
    document.getElementById('profile-menu').hidden = false;
    document.getElementById('profile-toggle').setAttribute('aria-expanded', 'true');
}

function toggleProfileMenu() {
    const toggle = document.getElementById('profile-toggle');
    const menu = document.getElementById('profile-menu');
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    menu.hidden = isOpen;
}

function logoutUser() {
    db.user = null;
    localStorage.removeItem('app_user');
    document.getElementById('profile-menu').hidden = true;
    document.getElementById('profile-toggle').setAttribute('aria-expanded', 'false');
    checkAuth();
}

// SLIDE NAV
function goToSlide(slideNum) {
    if (slideNum === 2 && !validateTripSetup()) return;
    if (slideNum === 3 && db.members.length === 0) {
        return alert('Add at least one member before continuing to expenses.');
    }
    if (slideNum === 4 && db.expenses.length === 0) {
        return alert('Save at least one expense before viewing analytics.');
    }

    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-dot').forEach(d => d.classList.remove('active'));
    
    document.getElementById(`slide-${slideNum}`).classList.add('active');
    document.querySelectorAll('.nav-dot')[slideNum - 1].classList.add('active');

    if (slideNum === 1) generateTripQr();
    if (slideNum === 3) setupExpenseInputs();
    if (slideNum === 4) renderAnalyticsAndBalances();
    if (slideNum === 5) renderReceipts();
    if (slideNum === 6) renderRecentHistory();
    if (slideNum === 7) renderChat();
}

// SLIDE 1: TRIP SETUP
function toggleOtherCategoryInput() {
    const select = document.getElementById('trip-category-select');
    const container = document.getElementById('other-category-container');
    container.style.display = select.value === 'Other' ? 'flex' : 'none';
}

function renderRecentHistory() {
    const list = document.getElementById('recent-history-list');
    list.innerHTML = '';

    if (db.history.length === 0) {
        list.innerHTML = '<p class="history-empty">No saved trips yet. Your trip will appear here after you start adding details.</p>';
        return;
    }

    db.history.forEach((entry, index) => {
        const updated = new Date(entry.updatedAt).toLocaleString();
        list.innerHTML += `
            <article class="recent-history-item">
                <div>
                    <h3>${entry.title}</h3>
                    <p>${entry.category} · ${entry.members.length} members · ${entry.expenses.length} expenses</p>
                    <small>Last saved: ${updated}</small>
                </div>
                <div class="history-actions">
                    <button class="btn btn-secondary" onclick="editHistoryEntry(${index})"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-primary" onclick="openHistoryEntry(${index})"><i class="fa-solid fa-folder-open"></i> Open</button>
                </div>
            </article>
        `;
    });
}

function escapeChatText(value) {
    return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderChat() {
    const senderSelect = document.getElementById('chat-sender');
    const messages = document.getElementById('chat-messages');
    senderSelect.innerHTML = db.members.length
        ? db.members.map(member => `<option value="${escapeChatText(member.name)}">${escapeChatText(member.name)}</option>`).join('')
        : '<option value="Guest">Guest</option>';
    messages.innerHTML = db.chatMessages.length
        ? db.chatMessages.map(message => `
            <article class="chat-message">
                <div class="chat-message-meta"><strong>${escapeChatText(message.sender)}</strong><small>${escapeChatText(message.time)}</small></div>
                <p>${escapeChatText(message.text)}</p>
            </article>
        `).join('')
        : '<p class="history-empty">No messages yet. Start the conversation.</p>';
    messages.scrollTop = messages.scrollHeight;
}

document.getElementById('chat-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const messageInput = document.getElementById('chat-message');
    const text = messageInput.value.trim();
    if (!text) return;
    db.chatMessages.push({ sender: document.getElementById('chat-sender').value, text, time: new Date().toLocaleString() });
    saveDB();
    messageInput.value = '';
    renderChat();
});

function getTripShareData() {
    return {
        trip: db.trip,
        members: db.members,
        expenses: db.expenses.map(expense => ({ ...expense, image: null })),
        settlements: db.settlements
    };
}

function generateTripQr() {
    const qrContainer = document.getElementById('trip-qr-code');
    const status = document.getElementById('trip-qr-status');
    if (!qrContainer || typeof QRCode === 'undefined') return;

    const payload = LZString.compressToEncodedURIComponent(JSON.stringify(getTripShareData()));
    const shareUrl = `${window.location.href.split('#')[0]}#trip=${payload}`;
    qrContainer.innerHTML = '';
    try {
        new QRCode(qrContainer, { text: shareUrl, width: 220, height: 220, colorDark: '#0f172a', colorLight: '#ffffff' });
        const localFileWarning = window.location.protocol === 'file:'
            ? ' This local file cannot be opened on another device; host the app on a shared URL first.'
            : '';
        status.innerText = db.expenses.some(expense => expense.image)
            ? `Scan to open this trip. Receipt images are not included in the QR share.${localFileWarning}`
            : `Scan to open this trip on the same app.${localFileWarning}`;
    } catch (error) {
        status.innerText = 'QR is too large to generate. Remove receipt images and try again.';
    }
}

function importTripFromQr() {
    const tripData = new URLSearchParams(window.location.hash.slice(1)).get('trip');
    if (!tripData) return;

    try {
        const imported = JSON.parse(LZString.decompressFromEncodedURIComponent(tripData));
        if (!imported.trip || !Array.isArray(imported.members) || !Array.isArray(imported.expenses)) return;
        pendingTripShare = imported;
        document.getElementById('auth-title').innerHTML = '<i class="fa-solid fa-qrcode"></i> Join Shared Trip';
        document.getElementById('auth-description').innerText = `Enter your details to join ${imported.trip.title || imported.trip.category} and add expenses.`;
    } catch (error) {
        console.warn('Unable to import trip QR data.', error);
    }
}

function openHistoryEntry(index) {
    const entry = db.history[index];
    if (!entry) return;

    db.trip = { category: entry.category, customName: '', startDate: entry.startDate, endDate: entry.endDate, title: entry.title };
    db.members = JSON.parse(JSON.stringify(entry.members));
    db.expenses = JSON.parse(JSON.stringify(entry.expenses));
    db.settlements = JSON.parse(JSON.stringify(entry.settlements));
    saveDB();
    updateHeaderTripTitle(db.trip.title);
    goToSlide(4);
}

function editHistoryEntry(index) {
    const entry = db.history[index];
    if (!entry) return;

    editingHistoryKey = entry.key;

    db.trip = { category: entry.category, customName: entry.customName || '', startDate: entry.startDate, endDate: entry.endDate, title: entry.title };
    db.members = JSON.parse(JSON.stringify(entry.members));
    db.expenses = JSON.parse(JSON.stringify(entry.expenses));
    db.settlements = JSON.parse(JSON.stringify(entry.settlements));

    document.getElementById('trip-category-select').value = entry.category === 'Other' ? 'Other' : entry.category;
    document.getElementById('trip-custom-name').value = entry.customName || (entry.category === 'Other' ? entry.title : '');
    document.getElementById('trip-start-date').value = entry.startDate || '';
    document.getElementById('trip-end-date').value = entry.endDate || '';
    toggleOtherCategoryInput();
    updateHeaderTripTitle(entry.title);
    goToSlide(1);
}

function toggleOtherCurrencyInput() {
    const select = document.getElementById('expense-currency');
    const container = document.getElementById('other-currency-container');
    container.style.display = select.value === 'OTHER' ? 'flex' : 'none';
    updatePayerCurrencyPlaceholder();
}

function updatePayerCurrencyPlaceholder() {
    const currency = document.getElementById('expense-currency').value;
    const customCurrency = document.getElementById('other-currency').value;
    const label = getCurrencyLabel(currency, customCurrency);
    document.querySelectorAll('.payer-amount-input').forEach(input => {
        input.placeholder = `${label}0.00`;
    });
}

function saveTripDetails() {
    if (!validateTripSetup()) return;

    const category = document.getElementById('trip-category-select').value;
    const customName = document.getElementById('trip-custom-name').value.trim();
    const startDate = document.getElementById('trip-start-date').value;
    const endDate = document.getElementById('trip-end-date').value;

    const title = (category === 'Other' && customName) ? customName : category;
    db.trip = { category, customName, startDate, endDate, title };
    saveDB();
    updateHeaderTripTitle(title);
    goToSlide(2);
}

function validateTripSetup() {
    const category = document.getElementById('trip-category-select').value;
    const customName = document.getElementById('trip-custom-name').value.trim();
    const startDate = document.getElementById('trip-start-date').value;
    const endDate = document.getElementById('trip-end-date').value;

    if (category === 'Other' && !customName) return alert('Please write a custom event type.');
    if (!startDate || !endDate) return alert('Please enter both start and end dates.');
    if (endDate < startDate) return alert('End date cannot be before the start date.');
    return true;
}

// SLIDE 2: MEMBERS
function addMember() {
    const nameInput = document.getElementById('member-name-input');
    const upiInput = document.getElementById('member-upi-input');
    const emailInput = document.getElementById('member-email-input');
    const paymentMethodInput = document.getElementById('member-payment-method');

    if (!nameInput.value.trim()) return alert('Please enter the member name.');
    if (paymentMethodInput.value === 'UPI' && !upiInput.value.trim()) return alert('Enter a UPI ID or choose Cash.');

    db.members.push({
        name: nameInput.value.trim(),
        upi: upiInput.value.trim(),
        email: emailInput.value.trim(),
        paymentMethod: paymentMethodInput.value
    });
    saveDB();
    
    nameInput.value = '';
    upiInput.value = '';
    emailInput.value = '';
    paymentMethodInput.value = 'UPI';
    renderMembers();
}

function renderMembers() {
    const list = document.getElementById('members-list');
    list.innerHTML = '';
    db.members.forEach((m, idx) => {
        const paymentDetail = m.paymentMethod === 'Cash' ? 'Cash' : (m.upi || 'UPI not added');
        list.innerHTML += `<li><span><strong>${m.name}</strong> (${paymentDetail}${m.email ? ` · ${m.email}` : ''})</span> <button class="btn btn-danger" onclick="deleteMember(${idx})"><i class="fa-solid fa-trash"></i> Remove</button></li>`;
    });
}

function deleteMember(idx) {
    const member = db.members[idx];
    if (!member) return;
    if (!confirm(`Remove ${member.name} from this trip? Existing expenses will remain unchanged.`)) return;
    db.members.splice(idx, 1);
    saveDB();
    renderMembers();
}

// SLIDE 3: MULTI-PAYER EXPENSE & ATTACHMENTS
function setupExpenseInputs() {
    const payerBox = document.getElementById('multi-payer-container');
    const splitterBox = document.getElementById('multi-splitter-container');
    const sharedMemberCount = document.getElementById('shared-member-count');
    payerBox.innerHTML = '';
    splitterBox.innerHTML = '';

    if (db.members.length === 0) {
        payerBox.innerHTML = `<p style="color:var(--accent-red)">Add members in Slide 2 first!</p>`;
        sharedMemberCount.innerText = '(0 members)';
        return;
    }

    db.members.forEach(m => {
        payerBox.innerHTML += `
            <div class="payer-row">
                <span>${m.name}</span>
                <input type="number" class="payer-amount-input" data-name="${m.name}" placeholder="₹0.00" min="0">
            </div>
        `;
        splitterBox.innerHTML += `
            <div class="splitter-row">
                <label><input type="checkbox" class="splitter-checkbox" data-name="${m.name}" checked> ${m.name}</label>
                <div class="splitter-controls">
                    <span class="splitter-status splitter-status--shared" aria-label="Shared">✔</span>
                    <button type="button" class="share-toggle-button" onclick="toggleExpenseSharing('${m.name.replace(/'/g, "\\'")}')">Remove</button>
                </div>
            </div>
        `;
    });

    updatePayerCurrencyPlaceholder();

    const updateSharedMemberStatus = () => {
        const checkboxes = document.querySelectorAll('.splitter-checkbox');
        const sharedCount = document.querySelectorAll('.splitter-checkbox:checked').length;
        sharedMemberCount.innerText = `(${sharedCount} ${sharedCount === 1 ? 'member' : 'members'})`;
        checkboxes.forEach(checkbox => {
            const status = checkbox.closest('.splitter-row').querySelector('.splitter-status');
            const isShared = checkbox.checked;
            status.innerText = isShared ? '✔' : '✖';
            status.className = `splitter-status ${isShared ? 'splitter-status--shared' : 'splitter-status--not-shared'}`;
            status.setAttribute('aria-label', isShared ? 'Shared' : 'Not shared');
            const toggleButton = checkbox.closest('.splitter-row').querySelector('.share-toggle-button');
            toggleButton.innerText = isShared ? 'Remove' : 'Add';
            toggleButton.className = `share-toggle-button ${isShared ? '' : 'share-toggle-button--add'}`;
        });
    };

    document.querySelectorAll('.splitter-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateSharedMemberStatus);
    });
    updateSharedMemberStatus();
}

function toggleExpenseSharing(memberName) {
    const checkbox = [...document.querySelectorAll('.splitter-checkbox')].find(input => input.dataset.name === memberName);
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
}

function addExpense() {
    const desc = document.getElementById('expense-desc-text').value.trim() || 'Expense';
    const currency = document.getElementById('expense-currency').value;
    const customCurrency = document.getElementById('other-currency').value.trim();

    if (currency === 'OTHER' && !customCurrency) return alert('Please enter a custom currency label.');

    let paidByMap = {};
    let totalPaid = 0;

    document.querySelectorAll('.payer-amount-input').forEach(inp => {
        const amt = parseFloat(inp.value) || 0;
        if (amt > 0) {
            paidByMap[inp.dataset.name] = amt;
            totalPaid += amt;
        }
    });

    if (totalPaid <= 0) return alert('At least one person must pay an amount > 0.');

    let splitAmong = [];
    document.querySelectorAll('.splitter-checkbox:checked').forEach(chk => {
        splitAmong.push(chk.dataset.name);
    });

    if (splitAmong.length === 0) return alert('Select at least one member sharing this expense.');

    const fileInput = document.getElementById('expense-image-file');
    const cameraInput = document.getElementById('expense-image-camera');
    const activeFile = (fileInput.files && fileInput.files[0]) ? fileInput.files[0] : (cameraInput.files && cameraInput.files[0]);

    if (activeFile) {
        const reader = new FileReader();
        reader.onload = function(e) {
            saveExpenseRecord(desc, totalPaid, paidByMap, splitAmong, e.target.result, currency, customCurrency);
        };
        reader.readAsDataURL(activeFile);
    } else {
        saveExpenseRecord(desc, totalPaid, paidByMap, splitAmong, null, currency, customCurrency);
    }
}

function saveExpenseRecord(desc, totalPaid, paidByMap, splitAmong, imageBase64, currency = 'INR', customCurrency = '') {
    db.expenses.push({ id: Date.now(), desc, totalPaid, paidByMap, splitAmong, image: imageBase64, currency, customCurrency });
    saveDB();
    document.getElementById('expense-desc-text').value = '';
    document.getElementById('expense-image-file').value = '';
    document.getElementById('expense-image-camera').value = '';
    document.getElementById('expense-currency').value = 'INR';
    document.getElementById('other-currency').value = '';
    toggleOtherCurrencyInput();
    updateReceiptStatus('upload-status', '');
    updateReceiptStatus('camera-status', '');
    setupExpenseInputs();
    alert('Expense recorded successfully!');
}

async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return alert('Camera access is not supported in this browser. Please upload an image instead.');
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        document.getElementById('camera-preview').srcObject = cameraStream;
        document.getElementById('camera-modal').style.display = 'flex';
    } catch (error) {
        alert('Camera access was denied or is unavailable. Please allow camera permission or upload an image instead.');
    }
}

function captureCameraImage() {
    const video = document.getElementById('camera-preview');
    if (!video.videoWidth || !video.videoHeight) return alert('Camera is still starting. Please try again.');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    fetch(canvas.toDataURL('image/jpeg', 0.9)).then(response => response.blob()).then(blob => {
        const file = new File([blob], 'camera-receipt.jpg', { type: 'image/jpeg' });
        const cameraInput = document.getElementById('expense-image-camera');
        const transfer = new DataTransfer();
        transfer.items.add(file);
        cameraInput.files = transfer.files;
        updateReceiptStatus('camera-status', 'Clicked');
        closeCamera();
    });
}

function updateReceiptStatus(statusId, message) {
    document.getElementById(statusId).innerText = message;
}

function setupReceiptStatusListeners() {
    document.getElementById('expense-image-file').addEventListener('change', function() {
        if (this.files.length > 0) updateReceiptStatus('upload-status', 'Uploaded');
    });
    document.getElementById('expense-image-camera').addEventListener('change', function() {
        if (this.files.length > 0) updateReceiptStatus('camera-status', 'Clicked');
    });
}

function closeCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    document.getElementById('camera-preview').srcObject = null;
    document.getElementById('camera-modal').style.display = 'none';
}

// SLIDE 4: ANALYTICS CHART & BALANCES
function renderAnalyticsAndBalances() {
    const historyList = document.getElementById('expense-history-list');
    const balanceList = document.getElementById('net-balances-list');
    historyList.innerHTML = '';
    balanceList.innerHTML = '';

    let netMap = {};
    let totalPaidMap = {};
    const balanceCurrency = db.expenses[0]?.currency || 'INR';
    const balanceCustomCurrency = db.expenses[0]?.customCurrency || '';
    db.members.forEach(m => {
        netMap[m.name] = 0;
        totalPaidMap[m.name] = 0;
    });

    db.expenses.forEach(e => {
        for (let payer in e.paidByMap) {
            netMap[payer] += e.paidByMap[payer];
            totalPaidMap[payer] += e.paidByMap[payer];
        }

        const sharePerPerson = e.totalPaid / e.splitAmong.length;
        e.splitAmong.forEach(m => {
            netMap[m] -= sharePerPerson;
        });

        const imgTag = e.image ? `<button class="btn btn-secondary" onclick="openImageModal('${e.image}')">🖼️ View Receipt</button>` : '';
        historyList.innerHTML += `
            <div style="padding:0.6rem 0; border-bottom:1px solid var(--border-color)">
                <strong>${e.desc}</strong> - ${formatMoney(e.totalPaid, e.currency, e.customCurrency)}<br>
                <small style="color: var(--text-muted)">Shared by: ${e.splitAmong.join(', ')}</small> ${imgTag}
            </div>
        `;
    });

    for (let member in netMap) {
        const bal = netMap[member];
        const color = bal >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const balancePercent = getPercentage(Math.abs(bal), Object.values(netMap).reduce((sum, value) => sum + Math.abs(value), 0));
        const balanceLabel = bal >= 0 ? 'gets back' : 'owes';
        balanceList.innerHTML += `<li><span><strong>${member}</strong> <small class="balance-percent">${balancePercent}%</small></span> <span style="color:${color}; font-weight:bold;">${balanceLabel} ${formatMoney(Math.abs(bal), balanceCurrency, balanceCustomCurrency)}</span></li>`;
    }

    renderCircularChart('expenseChart', totalPaidMap, 'expense');
    renderCircularChart('balanceChart', netMap, 'balance');
    renderSettlementBreakdown(netMap, balanceCurrency, balanceCustomCurrency);
}

function getPercentage(value, total) {
    return total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
}

function renderSettlementBreakdown(netMap, currency, customCurrency) {
    const breakdown = document.getElementById('settlement-breakdown');
    const debtors = Object.entries(netMap).filter(([, amount]) => amount < -0.01).map(([name, amount]) => ({ name, amount: -amount }));
    const creditors = Object.entries(netMap).filter(([, amount]) => amount > 0.01).map(([name, amount]) => ({ name, amount }));
    const totalToSettle = creditors.reduce((sum, creditor) => sum + creditor.amount, 0);
    const transactions = [];
    let debtorIndex = 0;
    let creditorIndex = 0;

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const amount = Math.min(debtors[debtorIndex].amount, creditors[creditorIndex].amount);
        transactions.push({
            debtor: debtors[debtorIndex].name,
            creditor: creditors[creditorIndex].name,
            amount
        });
        debtors[debtorIndex].amount -= amount;
        creditors[creditorIndex].amount -= amount;
        if (debtors[debtorIndex].amount < 0.01) debtorIndex++;
        if (creditors[creditorIndex].amount < 0.01) creditorIndex++;
    }

    if (transactions.length === 0) {
        breakdown.innerHTML = '<p class="settlement-empty">No payments needed. Everyone is even.</p>';
        return;
    }

    breakdown.innerHTML = `<h4>Who Pays Whom?</h4>${transactions.map(transaction => `
        <p><strong>${transaction.debtor}</strong> pays <strong>${getPercentage(transaction.amount, totalToSettle)}%</strong>
        (${formatMoney(transaction.amount, currency, customCurrency)}) to <strong>${transaction.creditor}</strong></p>
    `).join('')}`;
}

function renderCircularChart(canvasId, valuesMap, chartKind) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const labels = Object.keys(valuesMap);
    const rawValues = Object.values(valuesMap);
    const data = chartKind === 'balance' ? rawValues.map(value => Math.abs(value)) : rawValues;
    const total = data.reduce((sum, value) => sum + value, 0);
    const colors = ['#38bdf8', '#22c55e', '#f59e0b', '#f97316', '#ec4899', '#14b8a6', '#a78bfa', '#f43f5e'];
    const displayLabels = chartKind === 'balance'
        ? labels.map((label, index) => `${label} ${rawValues[index] < 0 ? 'pays' : 'receives'}`)
        : labels;
    const chartData = { labels: displayLabels, data, colors };

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: displayLabels,
            datasets: [{
                data: data,
                backgroundColor: colors
            }]
        },
        options: {
            responsive: true,
            cutout: '58%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#ffffff',
                        generateLabels: chart => chart.data.labels.map((label, index) => ({
                            text: `${label} (${getPercentage(chartData.data[index], total)}%)`,
                            fillStyle: chartData.colors[index % chartData.colors.length],
                            strokeStyle: chartData.colors[index % chartData.colors.length],
                            index
                        }))
                    }
                },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${getPercentage(context.raw, total)}%`
                    }
                }
            }
        }
    });

    if (chartKind === 'balance') balanceChartInstance = chart;
    else expenseChartInstance = chart;
}

// SLIDE 5: RECEIPTS & INSTANT UPI SETTLEMENT
function renderReceipts() {
    const container = document.getElementById('receipts-container');
    container.innerHTML = '';

    let debtors = [], creditors = [];
    let netMap = {};
    let contributionMap = {};
    const receiptCurrency = db.expenses[0]?.currency || 'INR';
    const receiptCustomCurrency = db.expenses[0]?.customCurrency || '';
    db.members.forEach(m => {
        netMap[m.name] = 0;
        contributionMap[m.name] = 0;
    });

    db.expenses.forEach(e => {
        for (let payer in e.paidByMap) {
            netMap[payer] += e.paidByMap[payer];
            contributionMap[payer] += e.paidByMap[payer];
        }
        const share = e.totalPaid / (e.splitAmong.length || 1);
        e.splitAmong.forEach(m => netMap[m] -= share);
    });

    for (let m in netMap) {
        if (netMap[m] < -0.01) debtors.push({ name: m, amount: -netMap[m] });
        else if (netMap[m] > 0.01) creditors.push({ name: m, amount: netMap[m] });
    }

    let i = 0, j = 0;
    let transactions = [];

    while (i < debtors.length && j < creditors.length) {
        let minAmt = Math.min(debtors[i].amount, creditors[j].amount);
        let debtorObj = db.members.find(m => m.name === debtors[i].name);
        let creditorObj = db.members.find(m => m.name === creditors[j].name);

        transactions.push({
            id: `${debtorObj.name}-${creditorObj.name}`,
            from: debtorObj.name,
            to: creditorObj.name,
            toUpi: creditorObj.upi,
            toEmail: creditorObj.email || '',
            toPaymentMethod: creditorObj.paymentMethod || (creditorObj.upi ? 'UPI' : 'Cash'),
            fromEmail: debtorObj.email || '',
            fromContribution: contributionMap[debtorObj.name] || 0,
            toContribution: contributionMap[creditorObj.name] || 0,
            amount: minAmt
        });

        debtors[i].amount -= minAmt;
        creditors[j].amount -= minAmt;
        if (debtors[i].amount < 0.01) i++;
        if (creditors[j].amount < 0.01) j++;
    }

    if (transactions.length === 0) {
        container.innerHTML = `<p style="color:var(--text-muted)">All balances are even! No settlements required.</p>`;
        return;
    }

    transactions.forEach(t => {
        const isSettled = db.settlements[t.id] || false;
        const upiLink = `upi://pay?pa=${encodeURIComponent(t.toUpi)}&pn=${encodeURIComponent(t.to)}&am=${t.amount.toFixed(2)}&cu=INR`;
        const formattedAmount = formatMoney(t.amount, receiptCurrency, receiptCustomCurrency);
        const toMember = db.members.find(member => member.name === t.to) || {};
        const shareMsg = encodeURIComponent(`Hi ${t.from}, here is your bill receipt for ${db.trip.title || 'our event'}:\nYou owe ${formattedAmount} to ${t.to} (${t.toUpi}).`);
        const paymentAction = receiptCurrency === 'INR' && t.toPaymentMethod === 'UPI' && t.toUpi
            ? `<a href="${upiLink}" class="btn btn-primary" style="font-size: 0.8rem;" onclick="markAutoSettled('${t.id}')">📲 Pay via UPI</a>`
            : '<span class="currency-note">Pay by cash and mark as done.</span>';

        container.innerHTML += `
            <div class="receipt-card bill-doodle ${isSettled ? 'settled' : ''}">
                ${isSettled ? '<div class="app-stamp">SMART SPLITTER<br><span>PAID</span></div>' : ''}
                <div class="receipt-header">
                    <span class="receipt-icon">🧾</span>
                    <div><h3>Trip Bill Receipt</h3><small>${db.trip.title || 'Shared Expense'}</small></div>
                </div>
                <div class="receipt-member-row">
                    <div><strong>From: ${t.from}</strong><small>${t.fromEmail || 'Email not added'}</small></div>
                    <div class="receipt-contribution">Contribution<br><strong>${formatMoney(t.fromContribution, receiptCurrency, receiptCustomCurrency)}</strong></div>
                </div>
                <div class="receipt-member-row">
                    <div><strong>To: ${t.to}</strong><small>${t.toEmail || 'Email not added'}</small></div>
                    <div class="receipt-contribution">Contribution<br><strong>${formatMoney(t.toContribution, receiptCurrency, receiptCustomCurrency)}</strong></div>
                </div>
                <div class="receipt-amount">${t.from} owes <strong>${formattedAmount}</strong> and ${t.to} receives it</div>
                <div class="payment-detail"><strong>Payment:</strong> ${toMember.paymentMethod === 'Cash' ? 'Cash' : `UPI: ${toMember.upi || 'Not added'}`}</div>
                <div class="receipt-status">${isSettled ? 'Payment completed' : 'Payment pending'}</div>
                <div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${paymentAction}
                    <button class="btn btn-settle ${isSettled ? 'done' : ''}" onclick="toggleSettle('${t.id}')">
                        ${isSettled ? '✔ Settled' : 'Mark Done'}
                    </button>
                    <a href="https://wa.me/?text=${shareMsg}" target="_blank" class="btn btn-whatsapp"><i class="fa-brands fa-whatsapp"></i> Share</a>
                </div>
            </div>
        `;
    });
}

function markAutoSettled(transId) {
    db.settlements[transId] = true;
    saveDB();
    setTimeout(renderReceipts, 500);
}

function toggleSettle(transId) {
    db.settlements[transId] = !db.settlements[transId];
    saveDB();
    renderReceipts();
}

// IMAGE MODAL
function openImageModal(src) {
    document.getElementById('modal-image').src = src;
    document.getElementById('image-modal').style.display = 'flex';
}
function closeImageModal() {
    document.getElementById('image-modal').style.display = 'none';
}

// INIT
window.onload = function() {
    importTripFromQr();
    checkAuth();
    if(db.trip.title) {
        updateHeaderTripTitle(db.trip.title);
    }
    renderMembers();
    setupReceiptStatusListeners();
    saveDB();
};