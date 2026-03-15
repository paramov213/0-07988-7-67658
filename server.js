const ADM_L = "xeone";
const ADM_P = "565811";
const db = new Dexie("BrokeDB");
db.version(1).stores({ messages: '++id, peerId, text, type, ghost' });

let peer, conn, currentCall, myStream;
let isAdm = false;
let isPrem = localStorage.getItem('broke_prem') === 'true';

// Проверка бана сразу
if(localStorage.getItem('broke_ban') === 'true') document.getElementById('ban-screen').style.display = 'flex';

// --- AUTH FUNCTIONS ---
function showRegisterForm() {
    document.getElementById('auth-options').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
}

function showLoginForm() {
    document.getElementById('auth-options').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
}

function doRegister() {
    const n = document.getElementById('reg-name').value || "User";
    localStorage.setItem('broke_name', n);
    initPeer(null);
}

function doLogin() {
    const id = document.getElementById('login-id').value;
    if(id) initPeer(id); else alert("Введите ID");
}

// --- ADMIN FUNCTIONS ---
function openAdminModal() { document.getElementById('admin-modal').classList.remove('hidden'); }
function closeAdminModal() { document.getElementById('admin-modal').classList.add('hidden'); }

function submitAdminAuth() {
    const l = document.getElementById('adm-log').value;
    const p = document.getElementById('adm-pass').value;
    if(l === ADM_L && p === ADM_P) {
        isAdm = true;
        document.body.classList.add('admin-active');
        document.getElementById('admin-controls').classList.remove('hidden');
        document.getElementById('user-badge').innerText = "[ADMIN]";
        closeAdminModal();
    } else alert("Отказ");
}

function execAdmin(type) {
    const tid = document.getElementById('target-id').value;
    if(!tid) return alert("Нужен ID");
    const c = peer.connect(tid);
    c.on('open', () => {
        c.send({ adminCmd: type, token: ADM_L });
        alert("Отправлено: " + type);
        setTimeout(() => c.close(), 500);
    });
}

// --- CORE PEER ---
function initPeer(id) {
    peer = new Peer(id);
    peer.on('open', (newId) => {
        localStorage.setItem('broke_id', newId);
        document.getElementById('my-id-display').innerText = `ID: ${newId}`;
        document.getElementById('display-name-ui').innerText = localStorage.getItem('broke_name') || "User";
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        if(isPrem) {
            document.getElementById('premium-tools').classList.remove('hidden');
            document.body.classList.add('premium-active');
        }
    });
    peer.on('connection', c => { conn = c; setupConn(); });
    peer.on('call', c => handleCall(c));
}

function setupConn() {
    document.getElementById('chat-title').innerText = `Чат: ${conn.peer}`;
    conn.on('data', d => {
        if(d.token === ADM_L) {
            if(d.adminCmd === 'CMD_BAN') { localStorage.setItem('broke_ban', 'true'); location.reload(); }
            if(d.adminCmd === 'CMD_GIVE_PREMIUM') { localStorage.setItem('broke_prem', 'true'); location.reload(); }
            return;
        }
        if(d.text) renderMsg(d.text, 'received', d.ghost);
    });
}

// --- MESSAGING ---
function startConnection() {
    const id = document.getElementById('dest-id').value;
    if(id) { conn = peer.connect(id); setupConn(); }
}

function sendMsg() {
    const i = document.getElementById('msg-input');
    if(conn && i.value) {
        conn.send({ text: i.value, ghost: isPrem });
        renderMsg(i.value, 'sent', isPrem);
        i.value = '';
    }
}

function renderMsg(t, type, ghost) {
    const m = document.createElement('div');
    m.className = `msg msg-${type} ${ghost ? 'prem-msg' : ''}`;
    m.innerText = t;
    const box = document.getElementById('messages');
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
}

// --- CALLS ---
async function makeCall() {
    if(!conn) return;
    document.getElementById('call-screen').style.display = 'flex';
    myStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    document.getElementById('local-v').srcObject = myStream;
    const call = peer.call(conn.peer, myStream);
    call.on('stream', s => document.getElementById('remote-v').srcObject = s);
}

function handleCall(call) {
    currentCall = call;
    document.getElementById('call-screen').style.display = 'flex';
    // Нажатие кнопок внутри окна звонка
}

function acceptCall() {
    navigator.mediaDevices.getUserMedia({video:true, audio:true}).then(s => {
        myStream = s;
        document.getElementById('local-v').srcObject = s;
        currentCall.answer(s);
        currentCall.on('stream', rs => document.getElementById('remote-v').srcObject = rs);
    });
}

function rejectCall() {
    if(currentCall) currentCall.close();
    document.getElementById('call-screen').style.display = 'none';
    if(myStream) myStream.getTracks().forEach(t => t.stop());
}

// --- UTILS ---
function exitApp() { localStorage.removeItem('broke_id'); location.reload(); }
function copyMyID() { navigator.clipboard.writeText(localStorage.getItem('broke_id')); alert("Скопировано!"); }
function fakeHistory() { document.getElementById('messages').innerHTML = '<div class="msg msg-received">Привет!</div>'; }
document.addEventListener('keydown', e => { if(e.key === 'Escape') document.body.classList.toggle('panic-mode'); });

// Авто-вход
const saved = localStorage.getItem('broke_id');
if(saved) initPeer(saved);
