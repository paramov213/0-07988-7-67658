const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');

const DB_FILE = './users.json';
let db = { users: {} };

// Загрузка базы данных
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { console.log("Ошибка чтения БД"); }
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

app.use(express.static(__dirname));

const activeSockets = {}; // login -> socketId
const userStatus = {};    // login -> status string

io.on('connection', (socket) => {
    // Вход и Регистрация
    socket.on('auth', (data) => {
        const login = data.login.trim();
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Логин уже занят');
            db.users[login] = data.password;
            saveDB();
        } else {
            if (!db.users[login] || db.users[login] !== data.password) {
                return socket.emit('auth-error', 'Неверный логин или пароль');
            }
        }
        
        socket.userName = login;
        activeSockets[login] = socket.id;
        userStatus[login] = 'online';
        
        io.emit('user-status-update', { user: login, status: 'online' });
        socket.emit('auth-success', { user: login });
    });

    // Исправленный поиск по юзернейму (без учета регистра)
    socket.on('search-user', (searchName) => {
        const query = searchName.toLowerCase().trim();
        const found = Object.keys(db.users).find(name => name.toLowerCase() === query);

        if (found) {
            socket.emit('search-result', { 
                exists: true, 
                username: found, 
                status: userStatus[found] || 'был(а) недавно'
            });
        } else {
            socket.emit('search-result', { exists: false });
        }
    });

    socket.on('get-status', (username) => {
        socket.emit('status-result', { 
            user: username, 
            status: userStatus[username] || 'был(а) недавно' 
        });
    });

    // Приватные сообщения
    socket.on('private-message', (data) => {
        if (!socket.userName) return;
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    // Звонки
    socket.on('call-request', (data) => {
        if (activeSockets[data.to]) {
            io.to(activeSockets[data.to]).emit('incoming-call', { from: socket.userName });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userName) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            userStatus[socket.userName] = `был(а) в ${time}`;
            io.emit('user-status-update', { user: socket.userName, status: userStatus[socket.userName] });
            delete activeSockets[socket.userName];
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log(`Celestra Server running on port ${PORT}`));
