// Константы и Инициализация БД
const ADMIN_ROOT_ID = "xeone";
const db = new Dexie("BrokeDB");
db.version(1).stores({
    messages: '++id, peerId, text, timestamp, isGhost'
});

let peer, conn, currentCall;
let isAdmin = false;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// 1. ПРОВЕРКА БАНА ПРИ ЗАПУСКЕ
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').classList.remove('hidden-overlay');
    throw new Error("Banned");
}

// 2. АДМИН МОДАЛКА
function checkAdmin() {
    const val = document.getElementById('admin-input').value;
    if (val === ADMIN_ROOT_ID) {
        isAdmin = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
    }
    if (isPremium) {
        document.body.classList.add('premium-active');
        document.getElementById('premium-tools').classList.remove('hidden');
        document.getElementById('user-badge').innerText = isAdmin ? "[ADMIN]" : "[GHOST]";
    }
    document.getElementById('admin-modal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initPeer();
}

// 3. PEERJS LOGIC
function initPeer() {
    peer = new Peer(null, { debug: 2 });

    peer.on('open', (id) => {
        document.getElementById('my-id-display').innerText = `ID: ${id}`;
        startHeartbeat();
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnListeners();
    });

    peer.on('call', async (call) => {
        if(confirm("Incoming Video/Audio Call. Accept?")) {
            const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
            document.getElementById('call-overlay').classList.remove('hidden-overlay');
            document.getElementById('local-video').srcObject = stream;
            call.answer(stream);
            call.on('stream', (remoteStream) => {
                document.getElementById('remote-video').srcObject = remoteStream;
            });
            currentCall = call;
        }
    });
}

// 4. ADMIN COMMANDS (BAN/PREMIUM)
function sendAdminCmd(type) {
    const targetId = document.getElementById('target-peer-id').value;
    if (!targetId) return alert("Enter Target ID");
    
    const tempConn = peer.connect(targetId);
    tempConn.on('open', () => {
        tempConn.send({ type: type, adminToken: ADMIN_ROOT_ID });
        alert(`Command ${type} sent to ${targetId}`);
    });
}

// 5. MESSAGE & SIGNAL HANDLING
function setupConnListeners() {
    conn.on('data', (data) => {
        // Обработка админских сигналов
        if (data.adminToken === ADMIN_ROOT_ID) {
            handleAdminSignals(data.type);
            return;
        }

        // Обработка сообщений
        if (data.type === 'MSG') {
            displayMessage(data.text, 'received', data.isGhost);
            saveToDB(conn.peer, data.text, data.isGhost);
            
            if (data.selfDestruct) {
                setTimeout(() => {
                    // Удаление последнего сообщения из UI
                    const msgs = document.querySelectorAll('.msg');
                    msgs[msgs.length - 1].remove();
                }, data.selfDestruct);
            }
        }
    });
}

function handleAdminSignals(cmd) {
    switch(cmd) {
        case 'CMD_BAN':
            localStorage.setItem('broke_banned', 'true');
            location.reload();
            break;
        case 'CMD_GIVE_PREMIUM':
            localStorage.setItem('broke_premium', 'true');
            alert("PREMIUM GRANTED. RESTART APP.");
            location.reload();
            break;
        case 'REMOTE_PURGE':
            db.messages.clear();
            alert("Network Notice: History Purged by Admin.");
            location.reload();
            break;
    }
}

// 6. GHOST & PREMIUM FEATURES
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
        document.body.classList.toggle('panic-mode');
    }
});

window.onblur = () => {
    if (isPremium) document.body.classList.add('panic-mode');
};
window.onfocus = () => {
    document.body.classList.remove('panic-mode');
};

function toggleFakeHistory() {
    const container = document.getElementById('messages-container');
    container.innerHTML = `
        <div class="msg msg-received">Mom: Don't forget to buy milk.</div>
        <div class="msg msg-sent">Okay, I will be home by 7.</div>
    `;
}

// 7. UI & DB ACTIONS
async function saveToDB(peerId, text, isGhost) {
    await db.messages.add({ peerId, text, timestamp: Date.now(), isGhost });
}

function displayMessage(text, type, isGhost = false) {
    const container = document.getElementById('messages-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg msg-${type} ${isGhost ? 'premium-msg' : ''}`;
    msgDiv.innerText = text;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

document.getElementById('send-btn').onclick = () => {
    const text = document.getElementById('msg-input').value;
    const timer = parseInt(document.getElementById('self-destruct-timer').value);
    
    if (conn && text) {
        const payload = {
            type: 'MSG',
            text: text,
            isGhost: isPremium,
            selfDestruct: timer > 0 ? timer : null
        };
        conn.send(payload);
        displayMessage(text, 'sent', isPremium);
        saveToDB('me', text, isPremium);
        document.getElementById('msg-input').value = '';
        
        if (timer > 0) {
            setTimeout(() => {
                const msgs = document.querySelectorAll('.msg-sent');
                msgs[msgs.length - 1].remove();
            }, timer);
        }
    }
};

function connectToPeer() {
    const id = document.getElementById('dest-id').value;
    conn = peer.connect(id);
    setupConnListeners();
    document.getElementById('active-contact').innerText = `Chatting with: ${id}`;
}

// Heartbeat to keep connection alive
function startHeartbeat() {
    setInterval(() => {
        if (peer && !peer.destroyed) {
            peer.socket.send({type: 'HEARTBEAT'});
        }
    }, 15000);
}
