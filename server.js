const ADMIN_LOGIN = "xeone";
const ADMIN_PASS = "565811";
const db = new Dexie("BrokeDB");
db.version(1).stores({ messages: '++id, peerId, text, timestamp, isGhost' });

let peer, conn, currentCall, localStream;
let isAdmin = false;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// ПРОВЕРКА БАНА
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').style.display = 'flex';
}

// 1. AUTH FLOW
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
    initPeer(null);
}

function handleLogin() {
    const id = document.getElementById('login-id').value;
    if (!id) return alert("Введите ID");
    initPeer(id);
}

// Авто-вход
window.onload = () => {
    const saved = localStorage.getItem('broke_my_id');
    if (saved) initPeer(saved);
};

// 2. PEERJS CORE
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

    peer.on('connection', c => { conn = c; setupConnListeners(); });
    peer.on('call', c => handleIncomingCall(c));
}

// 3. ADMIN ELEVATION (ЛОГИКА XEONE)
function openAdminModal() {
    document.getElementById('admin-modal').classList.remove('hidden');
}

function closeAdminModal() {
    document.getElementById('admin-modal').classList.add('hidden');
}

function tryElevateAdmin() {
    const log = document.getElementById('admin-login').value;
    const pass = document.getElementById('admin-password').value;

    if (log === ADMIN_LOGIN && pass === ADMIN_PASS) {
        isAdmin = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
        closeAdminModal();
        alert("ACCESS GRANTED: WELCOME XEONE");
    } else {
        alert("INVALID CREDENTIALS");
    }
}

// 4. ADMIN ACTIONS
function sendAdminCmd(type) {
    const tid = document.getElementById('target-peer-id').value;
    if(!tid) return alert("Enter target ID");
    const aConn = peer.connect(tid);
    aConn.on('open', () => {
        aConn.send({ type: type, adminToken: ADMIN_LOGIN });
        alert("Signal Sent: " + type);
        setTimeout(() => aConn.close(), 1000);
    });
}

// 5. LISTENERS
function setupConnListeners() {
    document.getElementById('active-contact').innerText = `Session: ${conn.peer}`;
    conn.on('data', data => {
        if (data.adminToken === ADMIN_LOGIN) {
            if(data.type === 'CMD_BAN') { localStorage.setItem('broke_banned', 'true'); location.reload(); }
            if(data.type === 'CMD_GIVE_PREMIUM') { localStorage.setItem('broke_premium', 'true'); location.reload(); }
            if(data.type === 'REMOTE_PURGE') { db.messages.clear().then(()=>location.reload()); }
            return;
        }
        if (data.type === 'MSG') {
            displayMessage(data.text, 'received', data.isGhost);
            if(data.selfDestruct) setTimeout(() => document.querySelectorAll('.msg-received:last-child')[0]?.remove(), data.selfDestruct);
        }
    });
}

// 6. CALLS & MESSAGING
async function handleIncomingCall(call) {
    const overlay = document.getElementById('call-overlay');
    overlay.style.display = 'flex';
    document.getElementById('accept-call').onclick = async () => {
        localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        document.getElementById('local-video').srcObject = localStream;
        call.answer(localStream);
        call.on('stream', rs => document.getElementById('remote-video').srcObject = rs);
    };
    document.getElementById('decline-call').onclick = () => { call.close(); overlay.style.display = 'none'; };
}

async function startCall(t) {
    if(!conn) return;
    const overlay = document.getElementById('call-overlay');
    overlay.style.display = 'flex';
    localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    document.getElementById('local-video').srcObject = localStream;
    const call = peer.call(conn.peer, localStream);
    call.on('stream', rs => document.getElementById('remote-video').srcObject = rs);
}

document.getElementById('send-btn').onclick = () => {
    const input = document.getElementById('msg-input');
    const timer = parseInt(document.getElementById('self-destruct-timer').value);
    if(conn && input.value) {
        conn.send({ type:'MSG', text: input.value, isGhost: isPremium, selfDestruct: timer > 0 ? timer : null });
        displayMessage(input.value, 'sent', isPremium);
        input.value = '';
    }
};

function displayMessage(t, type, ghost) {
    const c = document.getElementById('messages-container');
    const m = document.createElement('div');
    m.className = `msg msg-${type} ${ghost ? 'premium-msg' : ''}`;
    m.innerText = t;
    c.appendChild(m);
    c.scrollTop = c.scrollHeight;
}

function activatePremiumUI() {
    document.body.classList.add('premium-active');
    document.getElementById('premium-tools').classList.remove('hidden');
}

function logout() { localStorage.removeItem('broke_my_id'); location.reload(); }
function copyMyID() { navigator.clipboard.writeText(localStorage.getItem('broke_my_id')); alert("ID Copied"); }
function startHeartbeat() { setInterval(() => { if(peer) peer.socket.send({type:'HEARTBEAT'}); }, 15000); }
document.addEventListener('keydown', e => { if(e.key === 'Escape') document.body.classList.toggle('panic-mode'); });
