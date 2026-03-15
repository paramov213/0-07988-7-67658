// КОНСТАНТЫ
const ADMIN_LOGIN = "xeone";
const ADMIN_PASS = "565811";
const db = new Dexie("BrokeDB");
db.version(1).stores({ messages: '++id, peerId, text, timestamp, isGhost' });

let peer, conn, currentCall, localStream;
let isAdmin = false;
let isPremium = localStorage.getItem('broke_premium') === 'true';

// ЭЛЕМЕНТЫ УПРАВЛЕНИЯ
const dom = {
    authModal: document.getElementById('auth-modal'),
    regForm: document.getElementById('register-form'),
    loginForm: document.getElementById('login-form'),
    authOptions: document.getElementById('auth-options'),
    adminModal: document.getElementById('admin-modal'),
    app: document.getElementById('app'),
    msgContainer: document.getElementById('messages-container'),
    msgInput: document.getElementById('msg-input')
};

// ПРОВЕРКА БАНА
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').style.display = 'flex';
}

// --- СИСТЕМА АВТОРИЗАЦИИ ---

document.getElementById('btn-show-reg').onclick = () => {
    dom.authOptions.classList.add('hidden');
    dom.regForm.classList.remove('hidden');
};

document.getElementById('btn-show-login').onclick = () => {
    dom.authOptions.classList.add('hidden');
    dom.loginForm.classList.remove('hidden');
};

document.getElementById('btn-do-reg').onclick = () => {
    const name = document.getElementById('reg-name').value || "Пользователь";
    localStorage.setItem('broke_my_name', name);
    initPeer(null);
};

document.getElementById('btn-do-login').onclick = () => {
    const id = document.getElementById('login-id').value;
    if (id) initPeer(id);
    else alert("Введите ID");
};

// --- СИСТЕМА АДМИНА ---

document.getElementById('user-badge').onclick = () => {
    dom.adminModal.classList.remove('hidden');
};

document.getElementById('admin-close-btn').onclick = () => {
    dom.adminModal.classList.add('hidden');
};

document.getElementById('admin-proceed-btn').onclick = () => {
    const log = document.getElementById('admin-login').value;
    const pass = document.getElementById('admin-password').value;

    if (log === ADMIN_LOGIN && pass === ADMIN_PASS) {
        isAdmin = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
        dom.adminModal.classList.add('hidden');
        alert("ДОСТУП РАЗРЕШЕН. ПРИВЕТСТВУЮ, XEONE.");
    } else {
        alert("ОШИБКА ДОСТУПА");
    }
};

// --- КОМАНДЫ АДМИНА ---

document.getElementById('btn-admin-ban').onclick = () => sendAdminCmd('CMD_BAN');
document.getElementById('btn-admin-prem').onclick = () => sendAdminCmd('CMD_GIVE_PREMIUM');
document.getElementById('btn-admin-purge').onclick = () => sendAdminCmd('REMOTE_PURGE');

function sendAdminCmd(type) {
    const tid = document.getElementById('target-peer-id').value;
    if(!tid) return alert("Нужен ID цели");
    const aConn = peer.connect(tid);
    aConn.on('open', () => {
        aConn.send({ type: type, adminToken: ADMIN_LOGIN });
        alert("Команда отправлена: " + type);
        setTimeout(() => aConn.close(), 1000);
    });
}

// --- PEERJS CORE ---

function initPeer(id) {
    peer = new Peer(id, { debug: 1 });

    peer.on('open', (newId) => {
        localStorage.setItem('broke_my_id', newId);
        document.getElementById('my-id-display').innerText = `ID: ${newId}`;
        document.getElementById('display-name-ui').innerText = localStorage.getItem('broke_my_name') || "Авторизован";
        dom.authModal.classList.add('hidden');
        dom.app.classList.remove('hidden');
        if (isPremium) activatePremiumUI();
        startHeartbeat();
    });

    peer.on('connection', c => {
        conn = c;
        setupConnListeners();
    });

    peer.on('call', c => handleIncomingCall(c));
    
    peer.on('error', err => {
        console.error(err);
        if(err.type === 'unavailable-id') alert("ID занят");
    });
}

function setupConnListeners() {
    document.getElementById('active-contact').innerText = `Чат: ${conn.peer}`;
    conn.on('data', data => {
        if (data.adminToken === ADMIN_LOGIN) {
            if(data.type === 'CMD_BAN') { localStorage.setItem('broke_banned', 'true'); location.reload(); }
            if(data.type === 'CMD_GIVE_PREMIUM') { localStorage.setItem('broke_premium', 'true'); location.reload(); }
            if(data.type === 'REMOTE_PURGE') { db.messages.clear().then(()=>location.reload()); }
            return;
        }
        if (data.type === 'MSG') {
            displayMessage(data.text, 'received', data.isGhost);
            if(data.selfDestruct) {
                setTimeout(() => {
                    const all = document.querySelectorAll('.msg-received');
                    if(all.length) all[all.length-1].remove();
                }, data.selfDestruct);
            }
        }
    });
}

// --- ЧАТ И ЗВОНКИ ---

document.getElementById('btn-connect').onclick = () => {
    const id = document.getElementById('dest-id').value;
    if(id) {
        conn = peer.connect(id);
        setupConnListeners();
    }
};

document.getElementById('send-btn').onclick = sendMessage;
dom.msgInput.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

function sendMessage() {
    const text = dom.msgInput.value;
    const timer = parseInt(document.getElementById('self-destruct-timer').value);
    if(conn && text) {
        conn.send({ type:'MSG', text: text, isGhost: isPremium, selfDestruct: timer > 0 ? timer : null });
        displayMessage(text, 'sent', isPremium);
        dom.msgInput.value = '';
        if(timer > 0) {
            setTimeout(() => {
                const all = document.querySelectorAll('.msg-sent');
                if(all.length) all[all.length-1].remove();
            }, timer);
        }
    }
}

function displayMessage(t, type, ghost) {
    const m = document.createElement('div');
    m.className = `msg msg-${type} ${ghost ? 'premium-msg' : ''}`;
    m.innerText = t;
    dom.msgContainer.appendChild(m);
    dom.msgContainer.scrollTop = dom.msgContainer.scrollHeight;
}

// --- МЕДИА ---

document.getElementById('btn-start-call').onclick = async () => {
    if(!conn) return alert("Нет связи");
    const overlay = document.getElementById('call-overlay');
    overlay.style.display = 'flex';
    localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    document.getElementById('local-video').srcObject = localStream;
    const call = peer.call(conn.peer, localStream);
    call.on('stream', rs => document.getElementById('remote-video').srcObject = rs);
};

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

// --- СЕРВИСНЫЕ ---

function activatePremiumUI() {
    document.body.classList.add('premium-active');
    document.getElementById('premium-tools').classList.remove('hidden');
}

document.getElementById('btn-logout').onclick = () => {
    localStorage.removeItem('broke_my_id');
    location.reload();
};

document.getElementById('btn-fake-history').onclick = () => {
    dom.msgContainer.innerHTML = `<div class="msg msg-received">Мама: Ты поел?</div><div class="msg msg-sent">Да, все хорошо.</div>`;
};

document.getElementById('my-id-display').onclick = () => {
    const id = localStorage.getItem('broke_my_id');
    navigator.clipboard.writeText(id);
    alert("ID скопирован!");
};

function startHeartbeat() {
    setInterval(() => { if(peer) peer.socket.send({type:'HEARTBEAT'}); }, 15000);
}

document.addEventListener('keydown', e => { 
    if(e.key === 'Escape') document.body.classList.toggle('panic-mode'); 
});

// Авто-вход при загрузке
window.onload = () => {
    const saved = localStorage.getItem('broke_my_id');
    if(saved) initPeer(saved);
};
