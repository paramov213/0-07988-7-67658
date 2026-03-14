// Database Configuration
const db = new Dexie("BrokeDB");
db.version(1).stores({
    messages: '++id, sender, text, timestamp'
});

const ADMIN_ID = "xeone";
let peer, conn, myPeerId;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// 1. Initialization & Ban Check
window.onload = () => {
    if (localStorage.getItem('broke_banned') === 'true') {
        document.getElementById('ban-screen').classList.remove('hidden');
        return;
    }
    document.getElementById('login-modal').style.display = 'flex';
};

// Start Connection
document.getElementById('start-btn').onclick = () => {
    const inputId = document.getElementById('admin-id-input').value.trim();
    initPeer(inputId);
};

function initPeer(id) {
    const peerConfig = id === ADMIN_ID ? id : null;
    peer = new Peer(peerConfig, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1
    });

    peer.on('open', (id) => {
        myPeerId = id;
        document.getElementById('my-peer-id').innerText = `ID: ${id}`;
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        
        if (id === ADMIN_ID) {
            enableAdminUI();
        } else if (isPremium) {
            enablePremiumUI();
        }
        
        startHeartbeat();
    });

    // Handle Connections
    peer.on('connection', (connection) => {
        conn = connection;
        setupDataListeners();
    });

    // Handle Calls
    peer.on('call', handleIncomingCall);
}

// 2. Admin Logic
function enableAdminUI() {
    const badge = document.getElementById('my-status-badge');
    badge.innerText = '[ADMIN]';
    badge.classList.add('admin-badge');
    document.getElementById('admin-panel').classList.remove('hidden');
}

function adminAction(type) {
    const targetId = document.getElementById('target-id').value;
    if (!targetId) return alert("Enter Target ID");

    const tempConn = peer.connect(targetId);
    tempConn.on('open', () => {
        tempConn.send({ type: 'SYSTEM_CMD', action: type });
        alert(`Command ${type} sent to ${targetId}`);
    });
}

// 3. Premium & Special Features
function enablePremiumUI() {
    isPremium = true;
    const badge = document.getElementById('my-status-badge');
    badge.innerText = '[GHOST]';
    badge.classList.add('ghost-badge');
}

// Panic Button (Esc)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.body.style.filter = document.body.style.filter ? '' : 'blur(50px)';
    }
});

// Anti-Spy (Visibility Change)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.title = "System Update...";
        document.getElementById('app').style.opacity = "0";
    } else {
        document.title = "BROKE";
        document.getElementById('app').style.opacity = "1";
    }
});

// 4. Messaging Logic
function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !conn) return;

    const msgData = {
        type: 'CHAT',
        sender: myPeerId,
        text: text,
        premium: isPremium,
        timestamp: Date.now()
    };

    conn.send(msgData);
    appendMessage(msgData);
    db.messages.add(msgData);
    input.value = '';
}

document.getElementById('send-btn').onclick = sendMessage;

function setupDataListeners() {
    conn.on('data', (data) => {
        if (data.type === 'CHAT') {
            appendMessage(data);
            db.messages.add(data);
            
            // Self-Destruct Logic (Premium)
            if (data.selfDestruct) {
                setTimeout(() => { /* logic to remove from DOM */ }, 10000);
            }
        } else if (data.type === 'SYSTEM_CMD') {
            handleSystemCommand(data.action);
        }
    });
}

function handleSystemCommand(action) {
    if (action === 'BAN') {
        localStorage.setItem('broke_banned', 'true');
        location.reload();
    } else if (action === 'GIVE_PREMIUM') {
        localStorage.setItem('broke_premium', 'true');
        location.reload();
    } else if (action === 'PURGE') {
        db.messages.clear();
        location.reload();
    } else if (action === 'LOCK') {
        document.body.innerHTML = "<h1 style='text-align:center; margin-top:20%;'>MAINTENANCE MODE</h1>";
    }
}

// 5. Utility
function appendMessage(data) {
    const box = document.getElementById('chat-box');
    const div = document.createElement('div');
    div.className = `message ${data.sender === myPeerId ? 'sent' : 'received'} ${data.premium ? 'premium-msg' : ''}`;
    div.style.alignSelf = data.sender === myPeerId ? 'flex-end' : 'flex-start';
    div.style.background = data.sender === myPeerId ? 'var(--accent)' : 'rgba(255,255,255,0.1)';
    div.innerText = data.text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function startHeartbeat() {
    setInterval(() => {
        if (conn && conn.open) conn.send({ type: 'HEARTBEAT' });
    }, 15000);
}

// 6. WebRTC Calls
function handleIncomingCall(call) {
    const overlay = document.getElementById('call-overlay');
    overlay.classList.remove('hidden');
    
    document.getElementById('accept-call').onclick = () => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            call.answer(stream);
            overlay.classList.add('hidden');
            showVideoUI(call, stream);
        });
    };
}

function showVideoUI(call, localStream) {
    const container = document.getElementById('video-container');
    container.classList.remove('hidden');
    document.getElementById('local-video').srcObject = localStream;
    
    call.on('stream', remoteStream => {
        document.getElementById('remote-video').srcObject = remoteStream;
    });
    
    document.getElementById('hangup-btn').onclick = () => {
        location.reload();
    };
}

// Connect to Peer by ID from input (for users)
document.getElementById('msg-input').onkeypress = (e) => {
    if (e.key === 'Enter') {
        if (!conn) {
            const peerIdToConnect = prompt("Enter Peer ID to chat:");
            if (peerIdToConnect) {
                conn = peer.connect(peerIdToConnect);
                setupDataListeners();
            }
        } else {
            sendMessage();
        }
    }
};
