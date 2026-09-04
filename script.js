// STATE MANAGEMENT
const db = {
    user: JSON.parse(localStorage.getItem('app_user')) || null,
    trip: JSON.parse(localStorage.getItem('app_trip')) || { category: 'Vacation/Trip', customName: '', startDate: '', endDate: '' },
    members: JSON.parse(localStorage.getItem('app_members')) || [],
    expenses: JSON.parse(localStorage.getItem('app_expenses')) || [],
    settlements: JSON.parse(localStorage.getItem('app_settlements')) || {},
    adjustments: JSON.parse(localStorage.getItem('app_adjustments')) || [],
    history: JSON.parse(localStorage.getItem('app_history')) || [],
    chatMessages: JSON.parse(localStorage.getItem('app_chat_messages')) || [],
    groups: JSON.parse(localStorage.getItem('app_groups')) || [],
    activeGroupId: localStorage.getItem('app_active_group_id') || '',
    deletedHistoryKeys: JSON.parse(localStorage.getItem('app_deleted_history_keys')) || []
};

let expenseChartInstance = null;
let balanceChartInstance = null;
let cameraStream = null;
let editingHistoryKey = null;
let pendingTripShare = null;
let qrScannerStream = null;
let qrScannerFrameId = null;

const currencySymbols = { INR: '₹', USD: '$', EUR: '€' };
const USER_STORE_KEY = 'app_users';

function normalizeUserEmail(email = '') {
    return String(email || '').trim().toLowerCase();
}

function getUserStore() {
    try {
        const raw = JSON.parse(localStorage.getItem(USER_STORE_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function saveUserStore(users) {
    localStorage.setItem(USER_STORE_KEY, JSON.stringify(users));
}

function createGroupRecord({ id, title, category = 'Vacation/Trip', customName = '', startDate = '', endDate = '', members = [], expenses = [], settlements = {}, adjustments = [], chatMessages = [] } = {}) {
    return {
        id: id || `group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: title || 'New Group',
        category,
        customName,
        startDate,
        endDate,
        members,
        expenses,
        settlements,
        adjustments,
        chatMessages
    };
}

function getDefaultGroup() {
    if (db.groups.length) return db.groups.find(group => group.id === db.activeGroupId) || db.groups[0];

    const defaultGroup = createGroupRecord({
        title: db.trip.title || db.trip.category || 'Trip Group',
        category: db.trip.category || 'Vacation/Trip',
        customName: db.trip.customName || '',
        startDate: db.trip.startDate || '',
        endDate: db.trip.endDate || '',
        members: [...db.members],
        expenses: [...db.expenses],
        settlements: { ...db.settlements },
        adjustments: [...db.adjustments],
        chatMessages: [...db.chatMessages]
    });
    db.groups = [defaultGroup];
    db.activeGroupId = defaultGroup.id;
    return defaultGroup;
}

function syncCurrentGroupState() {
    const activeGroup = getDefaultGroup();
    if (!activeGroup) return;

    activeGroup.title = db.trip.title || db.trip.category || activeGroup.title || 'Trip Group';
    activeGroup.category = db.trip.category || activeGroup.category || 'Vacation/Trip';
    activeGroup.customName = db.trip.customName || '';
    activeGroup.startDate = db.trip.startDate || '';
    activeGroup.endDate = db.trip.endDate || '';
    activeGroup.members = JSON.parse(JSON.stringify(db.members));
    activeGroup.expenses = JSON.parse(JSON.stringify(db.expenses));
    activeGroup.settlements = JSON.parse(JSON.stringify(db.settlements));
    activeGroup.adjustments = JSON.parse(JSON.stringify(db.adjustments));
    activeGroup.chatMessages = JSON.parse(JSON.stringify(db.chatMessages));
    db.groups = db.groups.map(group => group.id === activeGroup.id ? activeGroup : group);
    db.activeGroupId = activeGroup.id;
    localStorage.setItem('app_groups', JSON.stringify(db.groups));
    localStorage.setItem('app_active_group_id', db.activeGroupId);
}

function loadGroupIntoState(groupId) {
    const group = db.groups.find(item => item.id === groupId) || getDefaultGroup();
    if (!group) return;

    db.activeGroupId = group.id;
    db.trip = {
        category: group.category || 'Vacation/Trip',
        customName: group.customName || '',
        startDate: group.startDate || '',
        endDate: group.endDate || '',
        title: group.title || group.category || 'Trip Group'
    };
    db.members = JSON.parse(JSON.stringify(group.members || []));
    db.expenses = JSON.parse(JSON.stringify(group.expenses || []));
    db.settlements = JSON.parse(JSON.stringify(group.settlements || {}));
    db.adjustments = JSON.parse(JSON.stringify(group.adjustments || []));
    db.chatMessages = JSON.parse(JSON.stringify(group.chatMessages || []));
    saveDB();
    populateTripSetupFields();
    updateHeaderTripTitle(db.trip.title);
}

function populateTripSetupFields() {
    const categorySelect = document.getElementById('trip-category-select');
    const customNameInput = document.getElementById('trip-custom-name');
    const startDateInput = document.getElementById('trip-start-date');
    const endDateInput = document.getElementById('trip-end-date');

    if (!categorySelect) return;
    categorySelect.value = db.trip.category || 'Vacation/Trip';
    customNameInput.value = db.trip.customName || '';
    startDateInput.value = db.trip.startDate || '';
    endDateInput.value = db.trip.endDate || '';
    toggleOtherCategoryInput();
}

function renderGroupSelector() {
    const container = document.getElementById('group-selector');
    if (!container) return;

    if (!db.groups.length) {
        db.groups = [getDefaultGroup()];
        db.activeGroupId = db.groups[0].id;
    }

    container.innerHTML = db.groups.map(group => `
        <div class="group-tab ${group.id === db.activeGroupId ? 'active' : ''}" data-group-id="${group.id}" onclick="openGroup('${group.id}')">
            <div class="group-tab__title">${group.title || 'Group'}</div>
            <small>${group.members?.length || 0} members · ${group.expenses?.length || 0} expenses</small>
        </div>
    `).join('');
}

function selectGroup(groupId) {
    if (!groupId) return;
    switchGroup(groupId);
    renderGroupSelector();
}

function getGroupActionsMarkup(group) {
    return `
        <div class="selected-group-actions">
            <strong>Group options</strong>
            <div class="selected-group-actions__buttons">
            <button type="button" onclick="openGroup('${group.id}')"><i class="fa-solid fa-folder-open"></i> Open</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(2);"><i class="fa-solid fa-users"></i> Members</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(3);"><i class="fa-solid fa-receipt"></i> Expense</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(4);"><i class="fa-solid fa-chart-pie"></i> Balance</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(5);"><i class="fa-solid fa-file-invoice-dollar"></i> Receipts</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(7);"><i class="fa-solid fa-comments"></i> Chat</button>
            <button type="button" class="group-delete-button" onclick="deleteGroup('${group.id}')"><i class="fa-solid fa-trash"></i> Delete</button>
            </div>
        </div>
    `;
}

function switchGroup(groupId) {
    if (!groupId) return;
    const targetGroup = db.groups.find(group => group.id === groupId) || getDefaultGroup();
    if (!targetGroup) return;
    db.activeGroupId = targetGroup.id;
    loadGroupIntoState(targetGroup.id);
    renderGroupSelector();
    renderMembers();
    renderChat();
    renderAnalyticsAndBalances();
    renderReceipts();
    renderRecentHistory();
    window.dispatchEvent(new CustomEvent('splitit-group-changed', { detail: { groupId: targetGroup.id } }));
}

function openGroup(groupId) {
    switchGroup(groupId);
    setGroupDetailVisibility(true);
    renderGroupDetailActions();
    goToSlide(8);
}

function renderGroupDetailActions() {
    const container = document.getElementById('group-detail-actions');
    const group = db.groups.find(item => item.id === db.activeGroupId);
    if (!container || !group) return;
    container.innerHTML = `
        <div>
            <span>Open</span>
            <strong>${group.title || 'Group'}</strong>
        </div>
        <div class="group-detail-actions__buttons">
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(2);"><i class="fa-solid fa-users"></i> Members</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(3);"><i class="fa-solid fa-receipt"></i> Expense</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(4);"><i class="fa-solid fa-chart-pie"></i> Balance</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(5);"><i class="fa-solid fa-file-invoice-dollar"></i> Receipts</button>
            <button type="button" onclick="switchGroup('${group.id}'); goToSlide(7);"><i class="fa-solid fa-comments"></i> Chat</button>
        </div>
    `;
}

function createGroup() {
    const input = document.getElementById('group-name-input');
    const name = (input && input.value.trim()) || 'New Group';
    const group = createGroupRecord({
        title: name,
        category: 'Vacation/Trip',
        members: [],
        expenses: [],
        settlements: {},
        adjustments: [],
        chatMessages: [{ sender: 'System', text: `${name} created.`, time: new Date().toLocaleString() }]
    });

    db.groups.push(group);
    db.activeGroupId = group.id;
    db.trip = { category: 'Vacation/Trip', customName: '', startDate: '', endDate: '', title: group.title };
    db.members = [];
    db.expenses = [];
    db.settlements = {};
    db.adjustments = [];
    db.chatMessages = group.chatMessages;
    saveDB();
    window.dispatchEvent(new CustomEvent('splitit-group-changed', { detail: { groupId: group.id } }));
    renderGroupSelector();
    if (input) input.value = '';
    setGroupDetailVisibility(true);
    populateTripSetupFields();
    updateHeaderTripTitle(group.title);
    renderGroupDetailActions();
    goToSlide(8);
}

function deleteGroup(groupId) {
    if (!groupId || db.groups.length <= 1) return alert('At least one group must remain.');
    const target = db.groups.find(group => group.id === groupId);
    if (!target) return;
    if (!confirm(`Delete the group "${target.title}"?`)) return;

    db.groups = db.groups.filter(group => group.id !== groupId);
    db.activeGroupId = db.groups[0].id;
    loadGroupIntoState(db.activeGroupId);
    renderGroupSelector();
    renderMembers();
    renderChat();
    renderAnalyticsAndBalances();
    renderReceipts();
}

function getStoredUserByEmail(email) {
    const users = getUserStore();
    const emailKey = normalizeUserEmail(email);
    return users[emailKey] || null;
}

function saveUserAccount(user) {
    if (!user || !user.email) return;

    const users = getUserStore();
    const emailKey = normalizeUserEmail(user.email);

    users[emailKey] = {
        ...user,
        email: user.email.trim(),
        password: String(user.password || '')
    };

    saveUserStore(users);
    localStorage.setItem('app_credentials', JSON.stringify({
        email: emailKey,
        password: users[emailKey].password
    }));
}

function getCurrencyLabel(currency, customCurrency = '') {
    return currencySymbols[currency] || customCurrency.trim().toUpperCase() || '¤';
}

function formatMoney(amount, currency = 'INR', customCurrency = '') {
    const label = getCurrencyLabel(currency, customCurrency);
    return `${label}${amount.toFixed(2)}`;
}

function updateHeaderTripTitle(title) {
    const headerTitle = document.getElementById('header-trip-title');
    if (headerTitle) headerTitle.innerText = title || 'No group selected';
}

function setGroupDetailVisibility(isVisible) {
    const detail = document.getElementById('group-detail-content');
    if (detail) detail.hidden = !isVisible;
}

function setGroupDetailActionsVisibility(isVisible) {
    const actions = document.getElementById('group-detail-actions');
    if (actions) actions.hidden = !isVisible;
}

function hideSelectedGroupActions() {
    const actions = document.getElementById('selected-group-actions');
    if (actions) actions.hidden = true;
}

function saveDB() {
    const activeGroup = getDefaultGroup();
    if (activeGroup) {
        activeGroup.title = db.trip.title || db.trip.category || activeGroup.title || 'Trip Group';
        activeGroup.category = db.trip.category || activeGroup.category || 'Vacation/Trip';
        activeGroup.customName = db.trip.customName || '';
        activeGroup.startDate = db.trip.startDate || '';
        activeGroup.endDate = db.trip.endDate || '';
        activeGroup.members = JSON.parse(JSON.stringify(db.members));
        activeGroup.expenses = JSON.parse(JSON.stringify(db.expenses));
        activeGroup.settlements = JSON.parse(JSON.stringify(db.settlements));
        activeGroup.adjustments = JSON.parse(JSON.stringify(db.adjustments));
        activeGroup.chatMessages = JSON.parse(JSON.stringify(db.chatMessages));
    }

    localStorage.setItem('app_user', JSON.stringify(db.user));
    localStorage.setItem('app_trip', JSON.stringify(db.trip));
    localStorage.setItem('app_members', JSON.stringify(db.members));
    localStorage.setItem('app_expenses', JSON.stringify(db.expenses));
    localStorage.setItem('app_settlements', JSON.stringify(db.settlements));
    localStorage.setItem('app_adjustments', JSON.stringify(db.adjustments));
    localStorage.setItem('app_chat_messages', JSON.stringify(db.chatMessages));
    localStorage.setItem('app_groups', JSON.stringify(db.groups));
    localStorage.setItem('app_active_group_id', db.activeGroupId || (db.groups[0] && db.groups[0].id) || '');

    if (db.user && db.user.email) {
        saveUserAccount(db.user);
    }

    saveCurrentTripToHistory();
    localStorage.setItem('app_history', JSON.stringify(db.history));
}

function getTripHistoryKey() {
    return `${db.trip.title || db.trip.category}|${db.trip.startDate}|${db.trip.endDate}`;
}

function saveCurrentTripToHistory() {
    if (!db.trip.title && !db.trip.category) return;

    const key = getTripHistoryKey();
    if (db.deletedHistoryKeys.includes(key)) return;
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
document.getElementById('auth-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('user-name').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const password = document.getElementById('user-password').value;
    const phone = document.getElementById('user-phone').value.trim();
    const upi = document.getElementById('user-upi').value.trim();

    const emailKey = normalizeUserEmail(email);
    if (!emailKey) {
        alert('Please enter a valid email address.');
        return;
    }

    let firebaseUser = null;
    if (window.firebaseAuth) {
        try {
            firebaseUser = await window.firebaseAuth.signInWithEmailAndPassword(emailKey, password);
        } catch (error) {
            if (error.code !== 'auth/user-not-found' && error.code !== 'auth/invalid-credential') {
                alert(error.code === 'auth/wrong-password' ? 'Incorrect password for this account.' : 'Unable to sign in. Please try again.');
                return;
            }
            try {
                firebaseUser = await window.firebaseAuth.createUserWithEmailAndPassword(emailKey, password);
            } catch (createError) {
                alert(createError.code === 'auth/email-already-in-use'
                    ? 'Incorrect password for this account.'
                    : 'Unable to create your account. Passwords must be at least 6 characters.');
                return;
            }
        }
    }

    const existingUser = getStoredUserByEmail(emailKey);

    if (existingUser && String(existingUser.password || '') !== String(password)) {
        alert('Incorrect password for this email. Please enter the correct password.');
        document.getElementById('user-password').value = '';
        return;
    }

    if (existingUser) {
        db.user = {
            name: name || existingUser.name || '',
            email: existingUser.email || email,
            phone: phone || existingUser.phone || '',
            upi: upi || existingUser.upi || '',
            password: existingUser.password || password || '',
            uid: firebaseUser?.user?.uid || existingUser.uid || ''
        };
    } else {
        db.user = { name: name.trim(), email: email.trim(), phone, upi, password: password || '', uid: firebaseUser?.user?.uid || '' };
    }

    if (pendingTripShare) {
        db.trip = pendingTripShare.trip;
        db.members = pendingTripShare.members;
        db.expenses = pendingTripShare.expenses;
        db.settlements = pendingTripShare.settlements || {};
        const alreadyJoined = db.members.some(member => member.name.toLowerCase() === name.toLowerCase());
        if (!alreadyJoined) db.members.push({ name, email, upi, paymentMethod: upi ? 'UPI' : 'Cash' });
        if (!db.user) db.user = { name: name.trim(), email: email.trim(), phone, upi, password: password || '' };
        pendingTripShare = null;
        history.replaceState(null, '', window.location.pathname);
    }

    saveDB();
    if (typeof window.joinFirebaseGroup === 'function' && db.activeGroupId) {
        window.joinFirebaseGroup(db.activeGroupId, db.user);
    }
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
        document.getElementById('current-user-password').innerText = db.user.password ? '••••••••' : 'Password not set';
    } else {
        overlay.style.display = 'flex';
    }
}

function openProfileEditor() {
    const editor = document.getElementById('profile-editor');
    const profile = db.user || { name: '', email: '', phone: '', upi: '', password: '' };

    document.getElementById('profile-name-input').value = profile.name || '';
    document.getElementById('profile-email-input').value = profile.email || '';
    document.getElementById('profile-phone-input').value = profile.phone || '';
    document.getElementById('profile-upi-input').value = profile.upi || '';
    document.getElementById('profile-password-input').value = profile.password || '';

    document.getElementById('profile-menu').hidden = false;
    document.getElementById('profile-toggle').setAttribute('aria-expanded', 'true');
    editor.hidden = false;
}

function saveProfileEditor() {
    const name = document.getElementById('profile-name-input').value.trim();
    const email = document.getElementById('profile-email-input').value.trim();
    const phone = document.getElementById('profile-phone-input').value.trim();
    const upi = document.getElementById('profile-upi-input').value.trim();
    const password = document.getElementById('profile-password-input').value.trim();

    if (!name || !email || !password) {
        return alert('Name, email and password are required.');
    }

    db.user = { name, email, phone, upi, password };
    saveDB();
    checkAuth();
    document.getElementById('profile-editor').hidden = true;
}

function cancelProfileEditor() {
    document.getElementById('profile-editor').hidden = true;
}

function toggleProfileMenu() {
    const toggle = document.getElementById('profile-toggle');
    const menu = document.getElementById('profile-menu');
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    menu.hidden = isOpen;
}

function logoutUser() {
    if (window.firebaseAuth) window.firebaseAuth.signOut().catch(error => console.warn('Unable to sign out of Firebase.', error));
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
    const activeNavDot = document.querySelector(`.nav-dot[data-slide="${slideNum}"]`);
    if (activeNavDot) activeNavDot.classList.add('active');
    setGroupDetailActionsVisibility(slideNum !== 1 && slideNum !== 6);
    if (slideNum !== 1 && slideNum !== 6) renderGroupDetailActions();

    if (slideNum === 8) generateTripQr();
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
                    <button class="btn btn-danger" onclick="deleteHistoryEntry(${index})"><i class="fa-solid fa-trash"></i> Delete</button>
                </div>
            </article>
        `;
    });
}

function deleteHistoryEntry(index) {
    const entry = db.history[index];
    if (!entry) return;
    if (!confirm(`Delete the history entry "${entry.title}"?`)) return;

    db.history.splice(index, 1);
    if (entry.key && !db.deletedHistoryKeys.includes(entry.key)) {
        db.deletedHistoryKeys.push(entry.key);
    }
    localStorage.setItem('app_history', JSON.stringify(db.history));
    localStorage.setItem('app_deleted_history_keys', JSON.stringify(db.deletedHistoryKeys));
    renderRecentHistory();
}

function deleteAllHistory() {
    if (db.history.length === 0) {
        return alert('There is no history to delete.');
    }
    if (!confirm('Delete all saved history entries? This cannot be undone.')) return;

    db.history.forEach(entry => {
        if (entry.key && !db.deletedHistoryKeys.includes(entry.key)) {
            db.deletedHistoryKeys.push(entry.key);
        }
    });
    db.history = [];
    localStorage.setItem('app_history', JSON.stringify(db.history));
    localStorage.setItem('app_deleted_history_keys', JSON.stringify(db.deletedHistoryKeys));
    renderRecentHistory();
}

function escapeChatText(value) {
    return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderChat() {
    const senderSelect = document.getElementById('chat-sender');
    const messages = document.getElementById('chat-messages');
    const membersForChat = db.members.length
        ? [...db.members]
        : [];

    if (db.user?.name && !membersForChat.some(member => member.name.toLowerCase() === db.user.name.toLowerCase())) {
        membersForChat.push({ name: db.user.name, email: db.user.email || '', upi: db.user.upi || '', paymentMethod: db.user.upi ? 'UPI' : 'Cash' });
    }

    const accountName = db.user?.name || db.user?.email || 'Guest';
    senderSelect.value = db.user?.email ? `${accountName} (${db.user.email})` : accountName;

    if (!db.chatMessages.some(message => message.sender === 'System' && message.text.includes('joined the trip chat'))) {
        const systemName = db.user?.name || membersForChat[0]?.name || 'A member';
        db.chatMessages.push({ sender: 'System', text: `${systemName} joined the trip chat.`, time: new Date().toLocaleString() });
        saveDB();
    }

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

window.applyRemoteChatMessages = function(messages) {
    db.chatMessages = messages;
    localStorage.setItem('app_chat_messages', JSON.stringify(messages));
    renderChat();
};

window.addLocalChatMessage = function(text, sender) {
    db.chatMessages.push({ sender, text, time: new Date().toLocaleString() });
    saveDB();
    renderChat();
};

document.getElementById('chat-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const messageInput = document.getElementById('chat-message');
    const text = messageInput.value.trim();
    if (!text) return;
    const sender = db.user?.name || db.user?.email || 'Guest';
    if (typeof window.sendChatMessage === 'function') {
        window.sendChatMessage(text, sender);
        messageInput.value = '';
        return;
    }
    db.chatMessages.push({ sender, text, time: new Date().toLocaleString() });
    saveDB();
    messageInput.value = '';
    renderChat();
});

function getTripShareData() {
    return {
        groupId: db.activeGroupId,
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

function extractTripQrData(rawValue) {
    if (!rawValue) return null;

    if (rawValue.includes('#trip=')) {
        const tripData = new URLSearchParams(rawValue.split('#')[1]).get('trip');
        return tripData || null;
    }

    if (rawValue.includes('trip=')) {
        const params = new URLSearchParams(rawValue.split('?')[1] || rawValue);
        return params.get('trip') || null;
    }

    return rawValue;
}

function applyTripImportPayload(tripData) {
    if (!tripData) return false;

    const payload = extractTripQrData(tripData);
    if (!payload) return false;

    try {
        let imported;
        try {
            imported = JSON.parse(LZString.decompressFromEncodedURIComponent(payload));
        } catch (error) {
            imported = JSON.parse(payload);
        }

        if (!imported.trip || !Array.isArray(imported.members) || !Array.isArray(imported.expenses)) return false;
        if (imported.groupId && db.groups.length) {
            const localGroup = db.groups.find(group => group.id === db.activeGroupId) || db.groups[0];
            localGroup.id = imported.groupId;
            db.activeGroupId = imported.groupId;
            saveDB();
        }
        pendingTripShare = imported;
        document.getElementById('auth-title').innerHTML = '<i class="fa-solid fa-qrcode"></i> Join Shared Trip';
        document.getElementById('auth-description').innerText = `Enter your details to join ${imported.trip.title || imported.trip.category} and add expenses.`;
        checkAuth();
        return true;
    } catch (error) {
        console.warn('Unable to import trip QR data.', error);
        return false;
    }
}

function importTripFromQr() {
    const tripData = new URLSearchParams(window.location.hash.slice(1)).get('trip');
    if (!tripData) return;
    applyTripImportPayload(tripData);
}

function stopQrScanner() {
    if (qrScannerFrameId) {
        cancelAnimationFrame(qrScannerFrameId);
        qrScannerFrameId = null;
    }
    if (qrScannerStream) {
        qrScannerStream.getTracks().forEach(track => track.stop());
        qrScannerStream = null;
    }
    const video = document.getElementById('qr-scanner-video');
    if (video) video.srcObject = null;
}

function closeQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    stopQrScanner();
    if (modal) {
        modal.hidden = true;
        modal.style.display = 'none';
    }
}

function scanQrFrame() {
    const video = document.getElementById('qr-scanner-video');
    const canvas = document.getElementById('qr-scanner-canvas');
    const status = document.getElementById('qr-scanner-status');
    if (!video || !canvas || !status || !qrScannerStream) return;

    if (video.readyState === video.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });

        if (code) {
            const matched = applyTripImportPayload(code.data);
            if (matched) {
                status.innerText = 'Trip QR scanned successfully.';
                setTimeout(closeQrScanner, 700);
                return;
            }
            status.innerText = 'This QR code is not a valid trip invite.';
        }
    }

    qrScannerFrameId = requestAnimationFrame(scanQrFrame);
}

async function openQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    const status = document.getElementById('qr-scanner-status');
    const video = document.getElementById('qr-scanner-video');

    if (!modal || !video || typeof jsQR === 'undefined') {
        return alert('QR scanning is not available in this browser.');
    }

    modal.hidden = false;
    modal.style.display = 'flex';
    status.innerText = 'Requesting camera access...';

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera not supported');
        }

        stopQrScanner();
        qrScannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        video.srcObject = qrScannerStream;
        await video.play();
        status.innerText = 'Point your camera at a shared trip QR code.';
        qrScannerFrameId = requestAnimationFrame(scanQrFrame);
    } catch (error) {
        console.error('Unable to access camera for QR scan.', error);
        status.innerText = 'Camera access is blocked or unavailable. Please allow camera permission.';
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
    setGroupDetailVisibility(true);
    goToSlide(8);
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

    const activeGroup = db.groups.find(group => group.id === db.activeGroupId);
    const title = activeGroup?.title || ((category === 'Other' && customName) ? customName : category);
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

function clearAllMembers() {
    if (db.members.length === 0) {
        return alert('There are no members to clear.');
    }
    if (!confirm('Clear all current members from this trip? This does not delete the trip or its expenses.')) return;

    db.members = [];
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
    document.getElementById('upload-preview-button').hidden = true;
    document.getElementById('camera-preview-button').hidden = true;
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
        document.getElementById('camera-preview-button').hidden = false;
        closeCamera();
    });
}

function updateReceiptStatus(statusId, message) {
    document.getElementById(statusId).innerText = message;
}

function setupReceiptStatusListeners() {
    document.getElementById('expense-image-file').addEventListener('change', function() {
        if (this.files.length > 0) {
            updateReceiptStatus('upload-status', 'Uploaded');
            document.getElementById('upload-preview-button').hidden = false;
        }
    });
    document.getElementById('expense-image-camera').addEventListener('change', function() {
        if (this.files.length > 0) {
            updateReceiptStatus('camera-status', 'Clicked');
            document.getElementById('camera-preview-button').hidden = false;
        }
    });
}

function previewSelectedReceipt(source) {
    const inputId = source === 'camera' ? 'expense-image-camera' : 'expense-image-file';
    const input = document.getElementById(inputId);
    const file = input?.files?.[0];
    if (!file) return alert('Please select an image first.');

    const reader = new FileReader();
    reader.onload = event => openImageModal(event.target.result);
    reader.readAsDataURL(file);
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
function addManualAdjustment() {
    const fromMember = document.getElementById('adjustment-from-member').value;
    const toMember = document.getElementById('adjustment-to-member').value;
    const amountInput = document.getElementById('adjustment-amount');
    const rawAmount = Number.parseFloat(amountInput.value);

    if (!fromMember || !toMember) {
        return alert('Select both members for the extra adjustment.');
    }

    if (fromMember === toMember) {
        return alert('Choose two different members for the extra adjustment.');
    }

    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return alert('Enter a valid amount greater than zero.');
    }

    db.adjustments.push({
        id: Date.now(),
        from: fromMember,
        to: toMember,
        amount: rawAmount
    });

    saveDB();
    amountInput.value = '';
    renderAnalyticsAndBalances();
}

function removeManualAdjustment(adjustmentId) {
    db.adjustments = db.adjustments.filter(adjustment => adjustment.id !== adjustmentId);
    saveDB();
    renderAnalyticsAndBalances();
}

function renderAnalyticsAndBalances() {
    const balanceList = document.getElementById('net-balances-list');
    const adjustmentList = document.getElementById('extra-adjustments-list');
    const fromMemberSelect = document.getElementById('adjustment-from-member');
    const toMemberSelect = document.getElementById('adjustment-to-member');
    balanceList.innerHTML = '';

    const activeMembers = db.members.map(member => member.name);
    const activeMemberSet = new Set(activeMembers);
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
            if (!activeMemberSet.has(payer)) continue;
            netMap[payer] += e.paidByMap[payer];
            totalPaidMap[payer] += e.paidByMap[payer];
        }

        const validSplitAmong = (e.splitAmong || []).filter(name => activeMemberSet.has(name));
        const sharePerPerson = validSplitAmong.length ? e.totalPaid / validSplitAmong.length : 0;
        validSplitAmong.forEach(m => {
            netMap[m] -= sharePerPerson;
        });

    });

    (db.adjustments || []).forEach(adjustment => {
        if (!activeMemberSet.has(adjustment.from) || !activeMemberSet.has(adjustment.to)) return;
        netMap[adjustment.from] = (netMap[adjustment.from] || 0) - adjustment.amount;
        netMap[adjustment.to] = (netMap[adjustment.to] || 0) + adjustment.amount;
    });

    const adjustedNetMap = {};
    activeMembers.forEach(memberName => {
        adjustedNetMap[memberName] = netMap[memberName] || 0;
    });

    if (fromMemberSelect && toMemberSelect) {
        const currentFrom = fromMemberSelect.value;
        const currentTo = toMemberSelect.value;
        fromMemberSelect.innerHTML = activeMembers.map(member => `<option value="${member}">${member}</option>`).join('');
        toMemberSelect.innerHTML = activeMembers.map(member => `<option value="${member}">${member}</option>`).join('');
        fromMemberSelect.value = activeMembers.includes(currentFrom) ? currentFrom : (activeMembers[0] || '');
        toMemberSelect.value = activeMembers.includes(currentTo) ? currentTo : (activeMembers[1] || activeMembers[0] || '');
    }

    if (adjustmentList) {
        if ((db.adjustments || []).length === 0) {
            adjustmentList.innerHTML = '<p class="history-empty">No extra adjustments added yet.</p>';
        } else {
            adjustmentList.innerHTML = (db.adjustments || []).map(adjustment => `
                <div class="adjustment-item" style="display:flex; justify-content:space-between; gap:0.5rem; align-items:center; padding:0.45rem 0; border-bottom:1px solid var(--border-color);">
                    <div>
                        <strong>${adjustment.from}</strong> → <strong>${adjustment.to}</strong><br>
                        <small>${formatMoney(adjustment.amount, balanceCurrency, balanceCustomCurrency)}</small>
                    </div>
                    <button class="btn btn-secondary" type="button" onclick="removeManualAdjustment(${adjustment.id})">Remove</button>
                </div>
            `).join('');
        }
    }

    for (let member in adjustedNetMap) {
        const bal = adjustedNetMap[member];
        const contribution = totalPaidMap[member] || 0;
        const color = bal >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const balancePercent = getPercentage(Math.abs(bal), Object.values(adjustedNetMap).reduce((sum, value) => sum + Math.abs(value), 0));
        const balanceLabel = bal >= 0 ? 'gets back' : 'owes';
        balanceList.innerHTML += `
            <li>
                <div>
                    <strong>${member}</strong>
                    <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.15rem;">Contribution: ${formatMoney(contribution, balanceCurrency, balanceCustomCurrency)}</div>
                    <small class="balance-percent">${balancePercent}%</small>
                </div>
                <span style="color:${color}; font-weight:bold; text-align:right;">
                    ${balanceLabel}<br>${formatMoney(Math.abs(bal), balanceCurrency, balanceCustomCurrency)}
                </span>
            </li>
        `;
    }

    renderCircularChart('expenseChart', totalPaidMap, 'expense');
    renderCircularChart('balanceChart', adjustedNetMap, 'balance');
    renderSettlementBreakdown(adjustedNetMap, balanceCurrency, balanceCustomCurrency);
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

    const attachedReceipts = db.expenses.filter(expense => expense.image).map((expense, index) => `
        <article class="attached-receipt-card">
            <div>
                <strong>${expense.desc || `Receipt ${index + 1}`}</strong>
                <small>Attached receipt image</small>
            </div>
            <div class="receipt-image-actions">
                <button type="button" class="btn btn-secondary" data-image="${expense.image}" onclick="openImageModal(this.dataset.image)">
                    <i class="fa-solid fa-eye"></i> View Image
                </button>
                <button type="button" class="btn btn-primary" data-image="${expense.image}" data-name="${expense.desc || 'Receipt'}" onclick="shareReceiptImage(this.dataset.image, this.dataset.name)">
                    <i class="fa-solid fa-share-nodes"></i> Share Image
                </button>
            </div>
        </article>
    `).join('');

    const receiptsHeading = attachedReceipts ? `
        <div class="attached-receipts-section">
            <h3><i class="fa-solid fa-images"></i> Attached Receipt Images</h3>
            <div class="attached-receipts-grid">${attachedReceipts}</div>
        </div>
    ` : '';

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

    (db.adjustments || []).forEach(adjustment => {
        if (!netMap[adjustment.from]) netMap[adjustment.from] = 0;
        if (!netMap[adjustment.to]) netMap[adjustment.to] = 0;
        netMap[adjustment.from] -= adjustment.amount;
        netMap[adjustment.to] += adjustment.amount;
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
            amount: minAmt,
            kind: 'settlement'
        });

        debtors[i].amount -= minAmt;
        creditors[j].amount -= minAmt;
        if (debtors[i].amount < 0.01) i++;
        if (creditors[j].amount < 0.01) j++;
    }

    (db.adjustments || []).forEach(adjustment => {
        const fromMember = db.members.find(member => member.name === adjustment.from) || { name: adjustment.from, email: '', upi: '', paymentMethod: 'Cash' };
        const toMember = db.members.find(member => member.name === adjustment.to) || { name: adjustment.to, email: '', upi: '', paymentMethod: 'Cash' };

        transactions.push({
            id: `adjustment-${adjustment.id}`,
            from: adjustment.from,
            to: adjustment.to,
            toUpi: toMember.upi,
            toEmail: toMember.email || '',
            toPaymentMethod: toMember.paymentMethod || (toMember.upi ? 'UPI' : 'Cash'),
            fromEmail: fromMember.email || '',
            fromContribution: contributionMap[adjustment.from] || 0,
            toContribution: contributionMap[adjustment.to] || 0,
            amount: adjustment.amount,
            kind: 'adjustment'
        });
    });

    if (transactions.length === 0) {
        container.innerHTML = receiptsHeading + `<p style="color:var(--text-muted)">All balances are even! No settlements required.</p>`;
        return;
    }

    container.innerHTML = receiptsHeading;

    transactions.forEach(t => {
        const isSettled = db.settlements[t.id] || false;
        const upiLink = `upi://pay?pa=${encodeURIComponent(t.toUpi)}&pn=${encodeURIComponent(t.to)}&am=${t.amount.toFixed(2)}&cu=INR`;
        const formattedAmount = formatMoney(t.amount, receiptCurrency, receiptCustomCurrency);
        const toMember = db.members.find(member => member.name === t.to) || {};
        const extraText = t.kind === 'adjustment'
            ? `<div class="receipt-amount">Extra amount: <strong>${formattedAmount}</strong> to be paid by <strong>${t.from}</strong> to <strong>${t.to}</strong></div>`
            : `<div class="receipt-amount">${t.from} owes <strong>${formattedAmount}</strong> and ${t.to} receives it</div>`;
        const shareMsg = encodeURIComponent(`Hi ${t.from}, here is your bill receipt for ${db.trip.title || 'our event'}:\n${t.kind === 'adjustment' ? `Extra amount due: ${formattedAmount} to ${t.to}.` : `You owe ${formattedAmount} to ${t.to} (${t.toUpi}).`}`);
        const paymentAction = receiptCurrency === 'INR' && t.toPaymentMethod === 'UPI' && t.toUpi
            ? `<a href="${upiLink}" class="btn btn-primary" style="font-size: 0.8rem;" onclick="markAutoSettled('${t.id}')">📲 Pay via UPI</a>`
            : '<span class="currency-note">Pay by cash and mark as done.</span>';
        const receiptImageAction = db.expenses.find(e => e.id === Number(t.id))?.image
            ? `<button class="btn btn-secondary" style="font-size: 0.8rem;" onclick="shareReceiptImage('${db.expenses.find(e => e.id === Number(t.id)).image}', '${db.trip.title || 'Receipt'}')">📤 Share Receipt</button>`
            : '';

        container.innerHTML += `
            <div class="receipt-card bill-doodle ${isSettled ? 'settled' : ''}">
                ${isSettled ? '<div class="app-stamp">SMART SPLITTER<br><span>PAID</span></div>' : ''}
                <div class="receipt-header">
                    <span class="receipt-icon">🧾</span>
                    <div><h3>${t.kind === 'adjustment' ? 'Extra Amount Receipt' : 'Trip Bill Receipt'}</h3><small>${db.trip.title || 'Shared Expense'}</small></div>
                </div>
                <div class="receipt-member-row">
                    <div><strong>From: ${t.from}</strong><small>${t.fromEmail || 'Email not added'}</small></div>
                    <div class="receipt-contribution">Contribution<br><strong>${formatMoney(t.fromContribution, receiptCurrency, receiptCustomCurrency)}</strong></div>
                </div>
                <div class="receipt-member-row">
                    <div><strong>To: ${t.to}</strong><small>${t.toEmail || 'Email not added'}</small></div>
                    <div class="receipt-contribution">Contribution<br><strong>${formatMoney(t.toContribution, receiptCurrency, receiptCustomCurrency)}</strong></div>
                </div>
                ${extraText}
                <div class="payment-detail"><strong>Payment:</strong> ${toMember.paymentMethod === 'Cash' ? 'Cash' : `UPI: ${toMember.upi || 'Not added'}`}</div>
                <div class="receipt-status">${isSettled ? 'Payment completed' : 'Payment pending'}</div>
                <div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${paymentAction}
                    ${receiptImageAction}
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
function dataURLToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(data);
    const array = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }

    return new Blob([array], { type: mime });
}

function shareReceiptImage(imageData, title = 'Receipt image') {
    if (!imageData) {
        return alert('No receipt image available to share.');
    }

    const blob = dataURLToBlob(imageData);
    const file = new File([blob], `${(title || 'receipt').replace(/\s+/g, '-').toLowerCase()}.jpg`, { type: blob.type || 'image/jpeg' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
            title: 'Trip Receipt',
            text: `Here is the receipt for ${title}.`,
            files: [file]
        }).catch(err => {
            if (err && err.name !== 'AbortError') {
                openImageModal(imageData);
            }
        });
        return;
    }

    openImageModal(imageData);
}

function openImageModal(src) {
    document.getElementById('modal-image').src = src;
    document.getElementById('image-modal').style.display = 'flex';
}
function closeImageModal() {
    document.getElementById('image-modal').style.display = 'none';
}

// INIT
window.onload = function() {
    if (!db.groups.length) {
        const defaultGroup = createGroupRecord({
            title: db.trip.title || db.trip.category || 'Trip Group',
            category: db.trip.category || 'Vacation/Trip',
            customName: db.trip.customName || '',
            startDate: db.trip.startDate || '',
            endDate: db.trip.endDate || '',
            members: [...db.members],
            expenses: [...db.expenses],
            settlements: { ...db.settlements },
            adjustments: [...db.adjustments],
            chatMessages: [...db.chatMessages]
        });
        db.groups = [defaultGroup];
        db.activeGroupId = defaultGroup.id;
    }
    if (!db.activeGroupId && db.groups.length) {
        db.activeGroupId = db.groups[0].id;
    }
    if (db.activeGroupId) {
        loadGroupIntoState(db.activeGroupId);
    }
    importTripFromQr();
    checkAuth();
    if(db.trip.title) {
        updateHeaderTripTitle(db.trip.title);
    }
    renderGroupSelector();
    renderMembers();
    setupReceiptStatusListeners();
    saveDB();
    hideSelectedGroupActions();
    setGroupDetailActionsVisibility(false);
    window.dispatchEvent(new CustomEvent('splitit-group-changed', { detail: { groupId: db.activeGroupId } }));
};