const socket = io();
let currentUser = null;
let activeChatId = null;

// Элементы DOM
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const chatList = document.getElementById('chat-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');

// Инициализация при загрузке
window.onload = () => {
    const token = localStorage.getItem('nitro_token');
    if (token) {
        authenticate(token);
    }
};

async function authenticate(token) {
    socket.emit('authenticate', token);
    // Здесь обычно идет запрос к /api/auth/me для получения данных юзера
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    loadChats();
}

// Авторизация
document.getElementById('login-btn').onclick = async () => {
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;

    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (data.token) {
        localStorage.setItem('nitro_token', data.token);
        currentUser = data.user;
        authenticate(data.token);
    } else {
        alert(data.error);
    }
};

// Поиск пользователей
document.getElementById('user-search').oninput = async (e) => {
    const query = e.target.value;
    if (query.length < 2) return;

    // Логика поиска через API и обновление chatList
};

// Отправка сообщений
document.getElementById('send-btn').onclick = sendMessage;
messageInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

function sendMessage() {
    const text = messageInput.value.trim();
    if (text && activeChatId) {
        socket.emit('sendMessage', { receiverId: activeChatId, text });
        messageInput.value = '';
    }
}

// Обработка входящих сообщений
socket.on('newMessage', (msg) => {
    if (activeChatId === msg.sender || activeChatId === msg.receiver) {
        renderMessage(msg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        updateUnreadIndicator(msg.sender);
    }
});

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.sender === currentUser._id ? 'own' : ''}`;
    div.innerHTML = `<div class="msg-content">${msg.text}</div>`;
    messagesContainer.appendChild(div);
}

// Стрики и Статус
socket.on('userStatusUpdate', (data) => {
    const statusEl = document.getElementById('chat-with-status');
    if (activeChatId === data.userId) {
        statusEl.innerText = data.isOnline ? 'В сети' : `Был(а) в сети: ${new Date(data.lastSeen).toLocaleTimeString('ru-RU', {timeZone: 'Europe/Moscow'})} MSK`;
        statusEl.className = data.isOnline ? 'status-text online' : 'status-text';
    }
});

// Профиль
document.getElementById('my-profile-btn').onclick = () => {
    document.getElementById('profile-modal').classList.remove('hidden');
    // Заполнение полей данными currentUser
};

document.getElementById('save-profile').onclick = async () => {
    // Сбор данных и PATCH запрос к API
    // После успеха - обновление currentUser и закрытие модалки
};

// Service Worker для Android Push
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
        console.log('Service Worker Registered for Android 14/15');
    });
}