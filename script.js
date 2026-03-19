const socket = io();
let currentUser = null;
let activePartnerId = null;
let isRegisterMode = false;

// DOM Элементы
const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleLink = document.getElementById('auth-toggle-link');
const messageInput = document.getElementById('message-input-field');
const messagesDisplay = document.getElementById('messages-display');

// Функция инициализации и автовхода
async function initializeApp() {
    const token = localStorage.getItem('nitro_token');
    
    if (!token) {
        showAuthInterface();
        return;
    }

    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const userData = await response.json();
            completeAuthentication(userData, token);
        } else {
            localStorage.removeItem('nitro_token');
            showAuthInterface();
        }
    } catch (error) {
        console.error("Ошибка инициализации:", error);
        showAuthInterface();
    }
}

// Переключение на интерфейс входа
function showAuthInterface() {
    loadingScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
}

// Завершение авторизации
function completeAuthentication(user, token) {
    currentUser = user;
    localStorage.setItem('nitro_token', token);
    
    // Обновление UI данными пользователя
    document.getElementById('user-avatar-top').src = user.avatar;
    
    // Смена экранов
    loadingScreen.classList.add('hidden');
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    
    // Подключение Socket.io
    socket.emit('authenticate', token);
}

// Логика переключения режима Вход/Регистрация
authToggleLink.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-header').innerText = isRegisterMode ? 'Создать аккаунт' : 'С возвращением!';
    document.getElementById('auth-subheader').innerText = isRegisterMode ? 'Присоединяйтесь к нам сегодня!' : 'Мы так рады видеть вас снова!';
    authSubmitBtn.innerText = isRegisterMode ? 'Зарегистрироваться' : 'Вход';
    document.getElementById('auth-footer-text').innerText = isRegisterMode ? 'Уже есть аккаунт?' : 'Нужен аккаунт?';
    authToggleLink.innerText = isRegisterMode ? 'Войти' : 'Зарегистрироваться';
});

// Обработка нажатия кнопки авторизации
authSubmitBtn.addEventListener('click', async () => {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!username || !password) {
        alert("Заполните все поля ввода!");
        return;
    }

    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            completeAuthentication(data.user, data.token);
        } else {
            alert(data.error || "Ошибка доступа");
        }
    } catch (error) {
        alert("Нет связи с сервером мессенджера.");
    }
});

// Отправка сообщений
document.getElementById('send-msg-btn').addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
});

function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || !activePartnerId) return;

    socket.emit('sendMessage', {
        receiverId: activePartnerId,
        text: text
    });
    messageInput.value = '';
}

// Прием новых сообщений
socket.on('newMessage', (msg) => {
    renderMessageBubble(msg);
});

function renderMessageBubble(msg) {
    const isOwn = msg.sender === currentUser._id;
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${isOwn ? 'own' : 'other'}`;
    bubble.innerText = msg.text;
    
    // Удаление приветственного экрана при первом сообщении
    const welcome = messagesDisplay.querySelector('.welcome-screen');
    if (welcome) welcome.remove();

    messagesDisplay.appendChild(bubble);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

// Запуск приложения
window.onload = initializeApp;
