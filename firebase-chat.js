(function() {
    const firebaseConfig = {
        apiKey: 'AIzaSyAxTIXCfRGP8GY6-FqGc9ijSneT10swto0',
        authDomain: 'split-it-fc44f.firebaseapp.com',
        projectId: 'split-it-fc44f',
        storageBucket: 'split-it-fc44f.firebasestorage.app',
        messagingSenderId: '250983697151',
        appId: '1:250983697151:web:49102dd02b01b901249aca'
    };

    if (!window.firebase) return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const firestore = firebase.firestore();
    let unsubscribeChat = null;
    let activeGroupId = '';
    let currentUser = null;

    function getUserName() {
        try {
            const user = JSON.parse(localStorage.getItem('app_user') || 'null');
            return user?.name || 'Guest';
        } catch {
            return 'Guest';
        }
    }

    function getUserProfile() {
        try {
            return JSON.parse(localStorage.getItem('app_user') || 'null') || {};
        } catch {
            return {};
        }
    }

    async function joinFirebaseGroup(groupId, profile = getUserProfile()) {
        if (!currentUser || !groupId) return;

        const groupRef = firestore.collection('groups').doc(groupId);
        const memberRef = groupRef.collection('members').doc(currentUser.uid);
        try {
            await groupRef.set({
                ownerUid: currentUser.uid,
                title: profile.groupTitle || groupId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch {
        }
        await memberRef.set({
            uid: currentUser.uid,
            name: profile.name || currentUser.email || 'Member',
            email: currentUser.email || profile.email || '',
            role: 'member',
            joinedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    window.joinFirebaseGroup = joinFirebaseGroup;

    function formatMessageTime(timestamp) {
        return timestamp?.toDate ? timestamp.toDate().toLocaleString() : new Date().toLocaleString();
    }

    function subscribeToGroupChat(groupId) {
        if (unsubscribeChat) unsubscribeChat();
        unsubscribeChat = null;
        activeGroupId = groupId || '';
        if (!activeGroupId || !currentUser) return;

        joinFirebaseGroup(activeGroupId).then(() => {
            unsubscribeChat = firestore.collection('groups').doc(activeGroupId).collection('messages')
            .orderBy('createdAt', 'asc')
            .onSnapshot(snapshot => {
                const messages = snapshot.docs.map(message => {
                    const data = message.data();
                    return {
                        id: message.id,
                        sender: data.sender || 'Guest',
                        senderUid: data.senderUid || '',
                        text: data.text || '',
                        time: formatMessageTime(data.createdAt)
                    };
                });
                if (window.applyRemoteChatMessages) window.applyRemoteChatMessages(messages);
            }, error => console.warn('Shared chat is unavailable.', error));
        }).catch(error => console.warn('Unable to register group membership.', error));
    }

    window.sendChatMessage = function(text, sender) {
        if (!activeGroupId || !currentUser) {
            alert('Sign in before sending chat messages.');
            return Promise.resolve();
        }
        return firestore.collection('groups').doc(activeGroupId).collection('messages').add({
            sender: getUserName(),
            senderUid: currentUser.uid,
            text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(error => {
            console.warn('Unable to send shared chat message.', error);
            if (window.addLocalChatMessage) window.addLocalChatMessage(text, sender || getUserName());
            alert('Message could not be sent. Please check your internet connection.');
        });
    };

    window.addEventListener('splitit-group-changed', event => {
        subscribeToGroupChat(event.detail?.groupId);
    });

    auth.onAuthStateChanged(user => {
        currentUser = user;
        subscribeToGroupChat(localStorage.getItem('app_active_group_id') || '');
    });
    window.firebaseAuth = auth;
})();
