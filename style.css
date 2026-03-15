// Конфигурация и БД
const ADMIN_ROOT_ID = "xeone";
const db = new Dexie("BrokeDB");
db.version(1).stores({ messages: '++id, peerId, text, timestamp, isGhost' });

let peer, conn, currentCall, localStream;
let isAdmin = false;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// 1. ПРОВЕРКА БАНА
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').style.display = 'flex';
}

// 2. СИСТЕМА АДМИНИСТРАТОРА (ROOT)
function checkAdmin() {
    const val = document.getElementById('admin-input').value;
    if (val === ADMIN_ROOT_ID) {
        isAdmin = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
    }
    document.getElementById('admin-modal').classList.add('hidden');
    
    // После админа — проверяем сессию
    const savedID = localStorage.getItem('broke_my_id');
    if (savedID) {
        initPeer(savedID);
    } else {
        document.getElementById('auth-modal').classList.remove('hidden');
    }
}

// 3. AUTH LOGIC
function showRegister() {
    document.getElementById('auth-options').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('auth-options').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
}

function handleRegister() {
    const name = document.getElementById('reg-name').value || "User_" + Math.floor(Math.random()*999);
    localStorage.setItem('broke_my_name', name);
    initPeer(null); // Генерирует новый PeerID
}

function handleLogin() {
    const id = document.getElementById('login-id').value;
    if (!id) return alert("Введите ваш ID");
    initPeer(id);
}

// 4. CORE PEERJS
function initPeer(id) {
    peer = new Peer(id, { debug: 1 });

    peer.on('open', (newId) => {
        localStorage.setItem('broke_my_id', newId);
        document.getElementById('my-id-display').innerText = `ID: ${newId}`;
        document.getElementById('display-name-ui').innerText = localStorage.getItem('broke_my_name') || "Authenticated";
        
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        
        if (isPremium) activatePremiumUI();
        startHeartbeat();
    });

    peer.on('connection', c => {
        conn = c;
        setupConnListeners();
    });

    peer.on('call', c => handleIncomingCall(c));

    peer.on('error', err => {
        if(err.type === 'unavailable-id') alert("ID занят или уже в сети");
        console.error(err);
    });
}

// 5. MESSAGING & SIGNALS
function setupConnListeners() {
    document.getElementById('active-contact').innerText = `Сессия: ${conn.peer}`;
    
    conn.on('data', data => {
        // Проверка админ-сигналов
        if (data.adminToken === ADMIN_ROOT_ID) {
            handleAdminSignals(data.type);
            return;
        }

        if (data.type === 'MSG') {
            displayMessage(data.text, 'received', data.isGhost);
            saveToDB(conn.peer, data.text, data.isGhost);
            
            if (data.selfDestruct) {
                setTimeout(() => {
                    const msgs = document.querySelectorAll('.msg-received');
                    if(msgs.length) msgs[msgs.length-1].remove();
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
            alert("Активирован PREMIUM статус. Перезагрузка...");
            location.reload();
            break;
        case 'REMOTE_PURGE':
            db.messages.clear().then(() => location.reload());
            break;
        case 'CMD_LOCK':
            document.body.classList.add('panic-mode');
            alert("NETWORK LOCKED BY ADMIN");
            break;
    }
}

// 6. ADMIN ACTIONS (TARGETED)
function sendAdminCmd(type) {
    const tid = document.getElementById('target-peer-id').value;
    if(!tid) return alert("Нужен ID цели");
    const adminConn = peer.connect(tid);
    adminConn.on('open', () => {
        adminConn.send({ type: type, adminToken: ADMIN_ROOT_ID });
        alert("Команда отправлена: " + type);
        setTimeout(() => adminConn.close(), 1000);
    });
}

// 7. CALLS
async function handleIncomingCall(call) {
    currentCall = call;
    const overlay = document.getElementById('call-overlay');
    overlay.style.display = 'block';
    document.getElementById('call-status').innerText = "Входящий звонок...";

    document.getElementById('accept-call').onclick = async () => {
        localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        document.getElementById('local-video').srcObject = localStream;
        call.answer(localStream);
        call.on('stream', rs => document.getElementById('remote-video').srcObject = rs);
    };

    document.getElementById('decline-call').onclick = () => {
        call.close();
        overlay.style.display = 'none';
    };
}

async function startCall(type) {
    if(!conn) return alert("Сначала подключитесь к ID");
    const overlay = document.getElementById('call-overlay');
    overlay.style.display = 'block';
    localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    document.getElementById('local-video').srcObject = localStream;
    
    currentCall = peer.call(conn.peer, localStream);
    currentCall.on('stream', rs => document.getElementById('remote-video').srcObject = rs);
}

// 8. PREMIUM & GHOST
function activatePremiumUI() {
    document.body.classList.add('premium-active');
    document.getElementById('premium-tools').classList.remove('hidden');
    document.getElementById('user-badge').innerText = isAdmin ? "[ADMIN]" : "[GHOST]";
}

function toggleFakeHistory() {
    document.getElementById('messages-container').innerHTML = `
        <div class="msg msg-received">Mom: Ты скоро будешь?</div>
        <div class="msg msg-sent">Да, через 5 минут.</div>
    `;
}

// Panic (Esc)
document.addEventListener('keydown', e => {
    if(e.key === 'Escape') document.body.classList.toggle('panic-mode');
});

// 9. UTILS
async function saveToDB(peerId, text, isGhost) {
    await db.messages.add({ peerId, text, timestamp: Date.now(), isGhost });
}

function displayMessage(text, type, isGhost = false) {
    const container = document.getElementById('messages-container');
    const m = document.createElement('div');
    m.className = `msg msg-${type} ${isGhost ? 'premium-msg' : ''}`;
    m.innerText = text;
    container.appendChild(m);
    container.scrollTop = container.scrollHeight;
}

document.getElementById('send-btn').onclick = () => {
    const input = document.getElementById('msg-input');
    const timer = parseInt(document.getElementById('self-destruct-timer').value);
    if(conn && input.value) {
        const data = { type:'MSG', text: input.value, isGhost: isPremium, selfDestruct: timer > 0 ? timer : null };
        conn.send(data);
        displayMessage(input.value, 'sent', isPremium);
        saveToDB('me', input.value, isPremium);
        input.value = '';
        if(timer > 0) setTimeout(() => document.querySelectorAll('.msg-sent:last-child')[0]?.remove(), timer);
    }
};

function connectToPeer() {
    const id = document.getElementById('dest-id').value;
    conn = peer.connect(id);
    setupConnListeners();
}

function copyMyID() {
    const id = localStorage.getItem('broke_my_id');
    navigator.clipboard.writeText(id);
    alert("ID скопирован: " + id);
}

function logout() { localStorage.removeItem('broke_my_id'); location.reload(); }

function startHeartbeat() {
    setInterval(() => { if(peer) peer.socket.send({type:'HEARTBEAT'}); }, 15000);
}
